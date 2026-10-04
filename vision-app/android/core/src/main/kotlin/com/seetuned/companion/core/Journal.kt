package com.seetuned.companion.core

import java.util.Base64

/**
 * The person's ORIGINAL value of every setting this app changed, so "Restore my original settings" can put the
 * phone back exactly as it was. Only the first original of each key is kept: applying a newer recipe later
 * must not make SeeTuned's own earlier value the "original".
 *
 * Stored as text, one entry per line: TABLE \t key \t base64(value) — or "-" for a key that was never set.
 */
class Journal private constructor(private val entries: LinkedHashMap<Pair<Table, String>, String?>) {

    val isEmpty: Boolean get() = entries.isEmpty()
    val size: Int get() = entries.size

    /** The original value, or null when the key was unset. Throws if the key is not in the journal. */
    fun original(table: Table, key: String): String? {
        require(contains(table, key)) { "$table/$key not in journal" }
        return entries[table to key]
    }

    fun contains(table: Table, key: String): Boolean = entries.containsKey(table to key)

    /** Remember [original] unless this key already has an entry. Returns a new journal. */
    fun recordIfAbsent(table: Table, key: String, original: String?): Journal {
        if (contains(table, key)) return this
        val copy = LinkedHashMap(entries)
        copy[table to key] = original
        return Journal(copy)
    }

    fun without(table: Table, key: String): Journal {
        val copy = LinkedHashMap(entries)
        copy.remove(table to key)
        return Journal(copy)
    }

    /** What restoring writes back: the original, or the platform default for a key that was never set. */
    fun restoreWrites(): List<SettingWrite> = entries.map { (k, v) ->
        SettingWrite(k.first, k.second, v ?: Keys.DEFAULTS[k.second] ?: "0")
    }

    fun encode(): String = entries.entries.joinToString("\n") { (k, v) ->
        val value = if (v == null) "-" else Base64.getEncoder().encodeToString(v.toByteArray(Charsets.UTF_8))
        "${k.first.name}\t${k.second}\t$value"
    }

    override fun equals(other: Any?): Boolean = other is Journal && other.entries == entries
    override fun hashCode(): Int = entries.hashCode()
    override fun toString(): String = "Journal($entries)"

    companion object {
        val EMPTY = Journal(LinkedHashMap())

        /** Tolerant: malformed lines are skipped (a damaged store must never block restoring the rest). */
        fun decode(text: String?): Journal {
            val map = LinkedHashMap<Pair<Table, String>, String?>()
            for (line in text.orEmpty().split('\n')) {
                val parts = line.split('\t')
                if (parts.size != 3) continue
                val table = Table.entries.firstOrNull { it.name == parts[0] } ?: continue
                val key = parts[1].takeIf { KEY_RE.matches(it) } ?: continue
                val value = if (parts[2] == "-") null else try {
                    String(Base64.getDecoder().decode(parts[2]), Charsets.UTF_8)
                } catch (_: IllegalArgumentException) { continue }
                map.putIfAbsent(table to key, value)
            }
            return Journal(map)
        }

        private val KEY_RE = Regex("^[a-z0-9_]{1,80}$")
    }
}

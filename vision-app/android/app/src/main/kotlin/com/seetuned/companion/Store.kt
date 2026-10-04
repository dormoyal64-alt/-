package com.seetuned.companion

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import com.seetuned.companion.core.Journal
import com.seetuned.companion.core.ParseResult
import com.seetuned.companion.core.Recipe
import com.seetuned.companion.core.RecipeCodec

/**
 * Everything this app keeps, on the device only (allowBackup is off): the last recipe from the web app,
 * the restore journal, the values it wrote last, and whether the lens disclosure was accepted.
 */
@SuppressLint("ApplySharedPref") // commit(): the journal must be on disk BEFORE a setting changes
class Store(context: Context) {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    var recipe: Recipe?
        get() = prefs.getString(KEY_RECIPE, null)?.let { (RecipeCodec.parse(it) as? ParseResult.Ok)?.recipe }
        set(value) = prefs.edit().apply { if (value == null) remove(KEY_RECIPE) else putString(KEY_RECIPE, RecipeCodec.encode(value)) }.apply()

    var journal: Journal
        get() = Journal.decode(prefs.getString(KEY_JOURNAL, null))
        set(value) { prefs.edit().putString(KEY_JOURNAL, value.encode()).commit() }

    /** "table/key" → the value this app wrote last (used when Android does not let apps read a setting back). */
    fun lastWritten(table: String, key: String): String? = prefs.getString("$KEY_WRITTEN$table/$key", null)

    fun setLastWritten(table: String, key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove("$KEY_WRITTEN$table/$key") else putString("$KEY_WRITTEN$table/$key", value) }.commit()
    }

    var lensDisclosureAccepted: Boolean
        get() = prefs.getBoolean(KEY_DISCLOSURE, false)
        set(value) = prefs.edit().putBoolean(KEY_DISCLOSURE, value).apply()

    /** Set when "Apply all" had to ask for access first; the app applies as soon as the person comes back with it. */
    var pendingApply: Boolean
        get() = prefs.getBoolean(KEY_PENDING, false)
        set(value) = prefs.edit().putBoolean(KEY_PENDING, value).apply()

    private companion object {
        const val FILE = "seetuned"
        const val KEY_RECIPE = "recipe"
        const val KEY_JOURNAL = "journal"
        const val KEY_WRITTEN = "written:"
        const val KEY_DISCLOSURE = "lensDisclosure"
        const val KEY_PENDING = "pendingApply"
    }
}

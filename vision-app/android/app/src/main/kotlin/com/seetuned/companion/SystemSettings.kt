package com.seetuned.companion

import android.Manifest
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import com.seetuned.companion.core.Access
import com.seetuned.companion.core.Device
import com.seetuned.companion.core.Journal
import com.seetuned.companion.core.Planner
import com.seetuned.companion.core.SettingWrite
import com.seetuned.companion.core.Table

/**
 * Reads and writes the phone's settings, keeping the restore journal up to date.
 *
 * - Settings.System (text size) needs "Modify system settings", which the person grants from this app.
 * - Settings.Secure (bold, contrast, colour filter, extra dim) needs WRITE_SECURE_SETTINGS, which Android grants
 *   only from a computer (adb). Without it those items stay guided.
 * - From Android 12, apps may not READ most hidden Secure keys. A read that fails falls back to the value this app
 *   wrote last, and an unreadable original is journaled as "unset" (restoring then writes the Android default).
 */
class SystemSettings(context: Context, private val store: Store = Store(context)) {
    private val context: Context = context.applicationContext
    private val resolver get() = context.contentResolver

    fun device(): Device = Device(sdk = Build.VERSION.SDK_INT, samsung = Build.MANUFACTURER.equals("samsung", ignoreCase = true))

    fun access(): Access = Access(canWriteSystem = canWriteSystem(), canWriteSecure = canWriteSecure(), lensEnabled = isLensEnabled())

    fun canWriteSystem(): Boolean = Settings.System.canWrite(context)

    fun canWriteSecure(): Boolean =
        context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED

    fun isLensEnabled(): Boolean {
        val am = context.getSystemService(AccessibilityManager::class.java) ?: return false
        val me = ComponentName(context, LensService::class.java)
        return am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
            .any { it.resolveInfo?.serviceInfo?.let { s -> ComponentName(s.packageName, s.name) } == me }
    }

    /** The current value, or null when unset. Throws [SecurityException] when Android does not let apps read it. */
    private fun readRaw(table: Table, key: String): String? = when (table) {
        Table.SYSTEM -> Settings.System.getString(resolver, key)
        Table.SECURE -> Settings.Secure.getString(resolver, key)
    }

    /** For the status of an item: the real value when readable, otherwise what this app wrote last. */
    fun read(table: Table, key: String): String? =
        try { readRaw(table, key) } catch (_: SecurityException) { store.lastWritten(table.name, key) }

    fun canRead(table: Table, key: String): Boolean = try { readRaw(table, key); true } catch (_: SecurityException) { false }

    data class Result(val written: List<SettingWrite>, val failed: List<SettingWrite>)

    /** Write [writes], journaling each original first. A write Android refuses is reported, never thrown. */
    fun apply(writes: List<SettingWrite>): Result {
        val written = mutableListOf<SettingWrite>()
        val failed = mutableListOf<SettingWrite>()
        for (w in writes) {
            var journal = store.journal
            if (!journal.contains(w.table, w.key)) {
                val original = try { readRaw(w.table, w.key) } catch (_: SecurityException) { null }
                journal = journal.recordIfAbsent(w.table, w.key, original)
                store.journal = journal
            }
            if (put(w)) { written += w; store.setLastWritten(w.table.name, w.key, w.value) } else failed += w
        }
        return Result(written, failed)
    }

    /** Put every journaled original back. Restored keys leave the journal; refused ones stay for a later try. */
    fun restore(): Result {
        val written = mutableListOf<SettingWrite>()
        val failed = mutableListOf<SettingWrite>()
        var journal = store.journal
        for (w in journal.restoreWrites()) {
            if (put(w)) {
                written += w
                journal = journal.without(w.table, w.key)
                store.setLastWritten(w.table.name, w.key, null)
            } else failed += w
        }
        store.journal = journal
        return Result(written, failed)
    }

    fun journal(): Journal = store.journal

    /**
     * Android saves its own copy of the text size right after every change. A write that lands in that moment (for
     * example just after the person moved the slider) can be overwritten. Look again after [delayMs] and write once
     * more whatever was reverted. [done] receives the writes that had to be repeated.
     */
    fun confirmLater(writes: List<SettingWrite>, delayMs: Long = CONFIRM_DELAY_MS, done: (List<SettingWrite>) -> Unit = {}) {
        val system = writes.filter { it.table == Table.SYSTEM }
        if (system.isEmpty()) { done(emptyList()); return }
        Handler(Looper.getMainLooper()).postDelayed({
            val reverted = system.filter { w -> !Planner.sameValue(w.key, read(w.table, w.key), w.value) }
            reverted.forEach { put(it) }
            done(reverted)
        }, delayMs)
    }

    companion object {
        const val CONFIRM_DELAY_MS = 1500L
    }

    private fun put(w: SettingWrite): Boolean = try {
        when (w.table) {
            Table.SYSTEM -> canWriteSystem() && Settings.System.putString(resolver, w.key, w.value)
            Table.SECURE -> canWriteSecure() && Settings.Secure.putString(resolver, w.key, w.value)
        }
    } catch (_: SecurityException) {
        false
    } catch (_: IllegalArgumentException) {
        // Raised for keys an app may not write at all.
        false
    }
}

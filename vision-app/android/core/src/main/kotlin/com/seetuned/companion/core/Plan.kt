package com.seetuned.companion.core

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.ln
import kotlin.math.max

/** Android settings tables this app can write. */
enum class Table { SYSTEM, SECURE }

/** One settings value. Keys are the raw Settings provider names (several are hidden constants in the SDK). */
data class SettingWrite(val table: Table, val key: String, val value: String)

object Keys {
    /** Settings.System.FONT_SCALE — writable with "Modify system settings" (WRITE_SETTINGS). */
    const val FONT_SCALE = "font_scale"
    /** Settings.Secure.FONT_WEIGHT_ADJUSTMENT (Android 12+): 300 = bold text. */
    const val FONT_WEIGHT_ADJUSTMENT = "font_weight_adjustment"
    /** Settings.Secure.ACCESSIBILITY_HIGH_TEXT_CONTRAST_ENABLED (hidden). */
    const val HIGH_TEXT_CONTRAST = "high_text_contrast_enabled"
    /** Settings.Secure.CONTRAST_LEVEL (Android 14+, hidden): 0 standard, 0.5 medium, 1 high. */
    const val CONTRAST_LEVEL = "contrast_level"
    const val DALTONIZER_ENABLED = "accessibility_display_daltonizer_enabled"
    /** AccessibilityManager.DALTONIZER_CORRECT_*: 11 protanomaly, 12 deuteranomaly, 13 tritanomaly. */
    const val DALTONIZER = "accessibility_display_daltonizer"
    /** Settings.Secure.REDUCE_BRIGHT_COLORS_ACTIVATED (Android 12+): "Extra dim". */
    const val EXTRA_DIM = "reduce_bright_colors_activated"

    const val BOLD_WEIGHT = "300"

    /** What a key means when it was never set (restoring an unset key writes this). */
    val DEFAULTS: Map<String, String> = mapOf(
        FONT_SCALE to "1.0",
        FONT_WEIGHT_ADJUSTMENT to "0",
        HIGH_TEXT_CONTRAST to "0",
        CONTRAST_LEVEL to "0.0",
        DALTONIZER_ENABLED to "0",
        DALTONIZER to "12",
        EXTRA_DIM to "0",
    )

    fun daltonizerMode(cvd: Cvd): String = when (cvd) {
        Cvd.PROTAN -> "11"
        Cvd.DEUTAN -> "12"
        Cvd.TRITAN -> "13"
    }
}

enum class ItemId { TEXT_SIZE, DISPLAY_SIZE, BOLD, CONTRAST, COLOR, DIM, DARK, MAGNIFICATION, LENS }

/** Which settings screen a guided item opens (the app layer maps these to intents). */
enum class Screen { DISPLAY, TEXT_READING, ACCESSIBILITY, COLOR_CORRECTION, MAGNIFICATION, DARK_THEME, EXTRA_DIM, LENS_SERVICE }

enum class Mechanism {
    /** Settings.System: "Modify system settings" access, which the person grants from this app. */
    SYSTEM_WRITE,
    /** Settings.Secure: WRITE_SECURE_SETTINGS, granted once from a computer (adb). Optional. */
    SECURE_WRITE,
    /** No API for apps: open the exact settings screen and show the value to pick. */
    GUIDED,
    /** This app's accessibility service (the screen lens). */
    LENS,
}

enum class Note { FONT_CAPPED, FONT_EXCEEDS }

data class Device(val sdk: Int, val samsung: Boolean)

data class Access(val canWriteSystem: Boolean, val canWriteSecure: Boolean, val lensEnabled: Boolean)

/**
 * One line of the plan. [writes] is what an automatic mechanism sets; a GUIDED item has no writes but may still
 * have [secureWrites] — what it would set automatically once the optional advanced access is granted.
 */
data class PlanItem(
    val id: ItemId,
    val mechanism: Mechanism,
    val writes: List<SettingWrite> = emptyList(),
    val screen: Screen? = null,
    val recommended: Boolean = true,
    val notes: List<Note> = emptyList(),
    /** Values for the item's text: font percent, display steps, colour option… */
    val fontScale: Double = 1.0,
    val displaySteps: Int = 0,
    val displayMax: Boolean = false,
    val cvd: Cvd? = null,
    val secureWrites: List<SettingWrite> = emptyList(),
)

object Planner {
    /** Android 14 brought non-linear font scaling up to 200 %; before that the largest step was 130 %. */
    fun maxFontScale(sdk: Int): Double = if (sdk >= 34) 2.0 else 1.3

    /** Rough gain of one Display size / Screen zoom step; same constant as engine/system-guide.js. */
    private const val DISPLAY_STEP_GAIN = 1.125
    /** Android 11 (API 30) added AccessibilityService.takeScreenshot, which the lens needs. */
    const val LENS_MIN_SDK = 30

    fun displaySteps(zoom: Double): Int =
        if (!zoom.isFinite() || zoom <= 1.01) 0 else max(1, ceil(ln(zoom) / ln(DISPLAY_STEP_GAIN) - 1e-9).toInt())

    fun plan(r: Recipe, device: Device, access: Access): List<PlanItem> {
        val out = mutableListOf<PlanItem>()
        val secure = access.canWriteSecure
        // Samsung keeps text size, bold and Screen zoom under Display; Android 13+ AOSP under "Display size and text".
        val textScreen = if (device.samsung) Screen.DISPLAY else Screen.TEXT_READING

        // Text size: the one system-wide setting any app may change once the person allows it.
        val cap = maxFontScale(device.sdk)
        val font = r.fontScale.coerceAtMost(cap)
        val capped = r.fontScale > cap + 1e-9
        var displaySteps = r.displaySteps
        var displayMax = r.displayMax
        if (capped) displaySteps = max(displaySteps, displaySteps(r.fontScale / cap))
        if (font > 1.0 + 1e-9) {
            val notes = buildList { if (capped) add(Note.FONT_CAPPED); if (r.fontExceeds) add(Note.FONT_EXCEEDS) }
            out += PlanItem(ItemId.TEXT_SIZE, Mechanism.SYSTEM_WRITE, listOf(SettingWrite(Table.SYSTEM, Keys.FONT_SCALE, fmt(font))),
                screen = textScreen, fontScale = font, notes = notes)
        }
        if (displaySteps > 0 || displayMax) {
            out += PlanItem(ItemId.DISPLAY_SIZE, Mechanism.GUIDED, screen = textScreen,
                displaySteps = max(1, displaySteps), displayMax = displayMax)
        }
        if (r.bold) {
            val w = if (device.sdk >= 31) listOf(SettingWrite(Table.SECURE, Keys.FONT_WEIGHT_ADJUSTMENT, Keys.BOLD_WEIGHT)) else emptyList()
            out += secureOrGuided(ItemId.BOLD, w, secure, textScreen)
        }
        r.contrast?.let { level ->
            val w = buildList {
                if (level == ContrastLevel.HIGH) add(SettingWrite(Table.SECURE, Keys.HIGH_TEXT_CONTRAST, "1"))
                // Pixel-style "Color contrast" (Android 14+); Samsung has no such setting.
                if (device.sdk >= 34 && !device.samsung) add(SettingWrite(Table.SECURE, Keys.CONTRAST_LEVEL, if (level == ContrastLevel.HIGH) "1.0" else "0.5"))
            }
            // Samsung's only contrast setting is "High contrast fonts"; the guide marks it optional at the medium level.
            val recommended = level == ContrastLevel.HIGH || !device.samsung
            out += secureOrGuided(ItemId.CONTRAST, w, secure, Screen.ACCESSIBILITY).copy(recommended = recommended)
        }
        r.cvd?.let { cvd ->
            val w = listOf(SettingWrite(Table.SECURE, Keys.DALTONIZER_ENABLED, "1"), SettingWrite(Table.SECURE, Keys.DALTONIZER, Keys.daltonizerMode(cvd)))
            // Optional, as in the written guide: many people prefer no filter.
            out += secureOrGuided(ItemId.COLOR, w, secure, Screen.COLOR_CORRECTION).copy(recommended = false, cvd = cvd)
        }
        if (r.dim) {
            val w = if (device.sdk >= 31) listOf(SettingWrite(Table.SECURE, Keys.EXTRA_DIM, "1")) else emptyList()
            out += secureOrGuided(ItemId.DIM, w, secure, Screen.EXTRA_DIM)
        }
        if (r.dark) out += PlanItem(ItemId.DARK, Mechanism.GUIDED, screen = Screen.DARK_THEME)
        if (r.magnification || displayMax) out += PlanItem(ItemId.MAGNIFICATION, Mechanism.GUIDED, screen = Screen.MAGNIFICATION)
        if (device.sdk >= LENS_MIN_SDK) out += PlanItem(ItemId.LENS, Mechanism.LENS, screen = Screen.LENS_SERVICE)
        return out
    }

    private fun secureOrGuided(id: ItemId, writes: List<SettingWrite>, canWriteSecure: Boolean, screen: Screen): PlanItem =
        if (writes.isNotEmpty() && canWriteSecure) PlanItem(id, Mechanism.SECURE_WRITE, writes, screen = screen, secureWrites = writes)
        else PlanItem(id, Mechanism.GUIDED, screen = screen, secureWrites = writes)

    /** Writes that "Apply all" performs with the current access: recommended automatic items only. */
    fun automaticWrites(plan: List<PlanItem>, access: Access): List<SettingWrite> = plan
        .filter { it.recommended }
        .flatMap {
            when (it.mechanism) {
                Mechanism.SYSTEM_WRITE -> if (access.canWriteSystem) it.writes else emptyList()
                Mechanism.SECURE_WRITE -> if (access.canWriteSecure) it.writes else emptyList()
                else -> emptyList()
            }
        }

    /** True when every write of an automatic item already holds (font scale compared with a small tolerance). */
    fun isApplied(item: PlanItem, read: (Table, String) -> String?): Boolean {
        if (item.writes.isEmpty()) return false
        return item.writes.all { w -> sameValue(w.key, read(w.table, w.key) ?: Keys.DEFAULTS[w.key], w.value) }
    }

    fun sameValue(key: String, current: String?, wanted: String): Boolean {
        if (current == null) return false
        val a = current.trim().toDoubleOrNull()
        val b = wanted.trim().toDoubleOrNull()
        return if (a != null && b != null) abs(a - b) < (if (key == Keys.FONT_SCALE) 0.005 else 1e-6) else current.trim() == wanted.trim()
    }

    fun fmt(v: Double): String {
        val r = Math.round(v * 100.0) / 100.0
        return r.toString()
    }
}

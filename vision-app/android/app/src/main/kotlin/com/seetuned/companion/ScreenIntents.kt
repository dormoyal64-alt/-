package com.seetuned.companion

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.seetuned.companion.core.Screen

/**
 * The settings screen for each guided item. Each screen has a list of candidate intents, most specific first:
 * several of the specific ones are not public API and differ between Android versions and One UI, so the app
 * tries them in order and always ends with a public screen (Display or Accessibility) that exists everywhere.
 */
object ScreenIntents {
    private const val TEXT_READING = "android.settings.TEXT_READING_SETTINGS"
    private const val COLOR_CORRECTION = "android.settings.ACCESSIBILITY_COLOR_SPACE_SETTINGS"
    private const val COLOR_CORRECTION_SETTINGS_APP = "com.android.settings.ACCESSIBILITY_COLOR_SPACE_SETTINGS"
    private const val DARK_THEME = "android.settings.DARK_THEME_SETTINGS"
    private const val EXTRA_DIM = "android.settings.REDUCE_BRIGHT_COLORS_SETTINGS"
    private const val MAGNIFICATION = "android.settings.ACCESSIBILITY_MAGNIFICATION_SETTINGS"

    fun candidates(screen: Screen, context: Context): List<Intent> {
        val display = Intent(Settings.ACTION_DISPLAY_SETTINGS)
        val accessibility = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        return when (screen) {
            Screen.DISPLAY -> listOf(display)
            Screen.TEXT_READING -> listOf(Intent(TEXT_READING), accessibility)
            Screen.ACCESSIBILITY -> listOf(accessibility)
            Screen.COLOR_CORRECTION -> listOf(Intent(COLOR_CORRECTION), Intent(COLOR_CORRECTION_SETTINGS_APP), accessibility)
            Screen.MAGNIFICATION -> listOf(Intent(MAGNIFICATION), accessibility)
            Screen.DARK_THEME -> listOf(Intent(DARK_THEME), display)
            Screen.EXTRA_DIM -> listOf(Intent(EXTRA_DIM), accessibility)
            Screen.LENS_SERVICE -> buildList {
                if (Build.VERSION.SDK_INT >= 33) {
                    add(Intent(Settings.ACTION_ACCESSIBILITY_DETAILS_SETTINGS)
                        .putExtra(Intent.EXTRA_COMPONENT_NAME, ComponentName(context, LensService::class.java).flattenToString()))
                }
                add(accessibility)
            }
        }
    }

    /** "Modify system settings" for this app. */
    fun writeSettings(context: Context): Intent =
        Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${context.packageName}"))

    /** Open the first candidate that starts. Returns the intent that worked, or null if none did. */
    fun open(context: Context, screen: Screen): Intent? = openFirst(context, candidates(screen, context))

    fun openFirst(context: Context, intents: List<Intent>): Intent? {
        for (intent in intents) {
            if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                return intent
            } catch (_: ActivityNotFoundException) {
                // try the next one
            } catch (_: SecurityException) {
                // exists but not exported on this phone
            }
        }
        return null
    }
}

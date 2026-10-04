package com.seetuned.companion

import android.app.UiAutomation
import android.content.Context
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice

/**
 * Shared helpers for the on-device tests. UiAutomation normally SUSPENDS every accessibility service while a test
 * runs; the lens is one, so every connection here keeps them running.
 */
object TestEnv {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    val context: Context get() = instrumentation.targetContext
    val pkg: String get() = context.packageName

    private fun automation(): UiAutomation =
        instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)

    fun device(): UiDevice {
        Configurator.getInstance().uiAutomationFlags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
        return UiDevice.getInstance(instrumentation)
    }

    /** Run a shell command as the shell user (it may grant permissions and change any setting). */
    fun shell(cmd: String): String {
        val pfd = automation().executeShellCommand(cmd)
        return ParcelFileDescriptor.AutoCloseInputStream(pfd).bufferedReader().use { it.readText() }.trim()
    }

    fun setting(table: String, key: String): String = shell("settings get $table $key")

    fun waitUntil(timeoutMs: Long = 10_000, condition: () -> Boolean): Boolean {
        val end = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < end) {
            if (condition()) return true
            SystemClock.sleep(100)
        }
        return condition()
    }

    fun clearAppState() {
        context.getSharedPreferences("seetuned", Context.MODE_PRIVATE).edit().clear().commit()
    }
}

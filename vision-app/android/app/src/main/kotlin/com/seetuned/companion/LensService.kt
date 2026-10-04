package com.seetuned.companion

import android.accessibilityservice.AccessibilityButtonController
import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.widget.Toast
import androidx.annotation.RequiresApi
import com.seetuned.companion.core.LensParams
import com.seetuned.companion.core.Strings

/**
 * The SeeTuned lens: an accessibility service that does nothing until the person taps the accessibility button
 * (or the Quick Settings tile). Then it takes ONE screenshot (Android 11+), processes it with the profile's photo
 * parameters on the phone, and shows it full screen with pan and zoom. It never reads other apps' content
 * (canRetrieveWindowContent=false), keeps nothing, and has no network access (the app has no INTERNET permission).
 */
class LensService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private var buttonCallback: AccessibilityButtonController.AccessibilityButtonCallback? = null

    /** The lens on screen, if any (also read by the instrumented tests). */
    @Volatile var overlay: LensOverlay? = null
        private set

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        val cb = object : AccessibilityButtonController.AccessibilityButtonCallback() {
            override fun onClicked(controller: AccessibilityButtonController) = showLens(fromShade = false)
        }
        accessibilityButtonController.registerAccessibilityButtonCallback(cb)
        buttonCallback = cb
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        buttonCallback?.let { accessibilityButtonController.unregisterAccessibilityButtonCallback(it) }
        if (Build.VERSION.SDK_INT >= 30) overlay?.dismiss() // the lens only exists on Android 11+
        overlay = null
        if (instance === this) instance = null
        super.onDestroy()
    }

    /**
     * Capture the screen and open the lens. From the Quick Settings tile the shade is closed first, so the picture
     * shows the app underneath rather than the shade.
     */
    fun showLens(fromShade: Boolean) {
        if (Build.VERSION.SDK_INT < 30) {
            toast("lens.unavailable")
            return
        }
        if (overlay != null) return
        if (fromShade) {
            if (Build.VERSION.SDK_INT >= 31) performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
            else performGlobalAction(GLOBAL_ACTION_BACK)
            main.postDelayed({ capture() }, SHADE_CLOSE_MS)
        } else {
            capture()
        }
    }

    @RequiresApi(30)
    private fun capture() {
        takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                val buffer = result.hardwareBuffer
                val bitmap = try {
                    Bitmap.wrapHardwareBuffer(buffer, result.colorSpace)?.copy(Bitmap.Config.ARGB_8888, false)
                } finally {
                    buffer.close()
                }
                if (bitmap == null) { toast("lens.error"); return }
                open(bitmap)
            }

            override fun onFailure(errorCode: Int) = toast("lens.error")
        })
    }

    @RequiresApi(30)
    private fun open(bitmap: Bitmap) {
        val store = Store(this)
        val recipe = store.recipe
        // Without a profile the lens is still a plain 2× magnifier.
        val params = recipe?.lens ?: LensParams(zoom = 2.0)
        val lang = recipe?.lang ?: if (java.util.Locale.getDefault().language in setOf("he", "iw")) "he" else "en"
        overlay = LensOverlay(this, bitmap, params, Strings.of(lang), lang == "he") { overlay = null }.also { it.show() }
    }

    private fun toast(key: String) {
        val lang = Store(this).recipe?.lang ?: "he"
        Toast.makeText(this, Strings.of(lang)(key), Toast.LENGTH_LONG).show()
    }

    companion object {
        private const val SHADE_CLOSE_MS = 600L

        /** The running service, or null when the lens is off in Accessibility settings. Cleared in onDestroy. */
        @SuppressLint("StaticFieldLeak")
        @Volatile var instance: LensService? = null
            private set
    }
}

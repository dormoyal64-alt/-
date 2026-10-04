package com.seetuned.companion

import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.seetuned.companion.TestEnv.pkg
import com.seetuned.companion.TestEnv.shell
import com.seetuned.companion.TestEnv.waitUntil
import com.seetuned.companion.core.LensParams
import com.seetuned.companion.core.Recipe
import com.seetuned.companion.core.Strings
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** The lens on a real system: enable the accessibility service, capture, process, show, close. */
@RunWith(AndroidJUnit4::class)
class LensServiceTest {
    private lateinit var device: UiDevice
    private var enabledBefore = ""
    private val he = Strings.of("he")

    @Before fun setUp() {
        assumeTrue("the lens needs Android 11", Build.VERSION.SDK_INT >= 30)
        device = TestEnv.device()
        device.wakeUp()
        shell("wm dismiss-keyguard")
        TestEnv.clearAppState()
        Store(TestEnv.context).recipe = Recipe(lang = "he", lens = LensParams(contrast = 1.4, sharpenAmount = 1.0, sharpenSigmaPx = 1.0, zoom = 2.0))
        enabledBefore = shell("settings get secure enabled_accessibility_services").let { if (it == "null") "" else it }
        shell("settings put secure enabled_accessibility_services $pkg/$pkg.LensService")
        shell("settings put secure accessibility_enabled 1")
        assertTrue("lens service connected", waitUntil(15_000) { LensService.instance != null })
    }

    @After fun tearDown() {
        if (Build.VERSION.SDK_INT < 30) return
        LensService.instance?.overlay?.let { o -> InstrumentationRegistry.getInstrumentation().runOnMainSync { o.dismiss() } }
        if (enabledBefore.isEmpty()) shell("settings delete secure enabled_accessibility_services")
        else shell("settings put secure enabled_accessibility_services $enabledBefore")
        TestEnv.clearAppState()
        device.pressHome()
    }

    private fun showSomething() {
        // Our own screen (a lot of text) is what the lens will capture. The link carries the lens parameters.
        TestEnv.context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("seetuned://apply?v=1&lang=he&font=1.3&bold=1&lc=1.4&lsa=1&lss=1&lz=2"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        assertNotNull(device.wait(Until.findObject(By.text(he("apply.all"))), 10_000))
        device.waitForIdle()
    }

    @Test fun lensCapturesTheScreenEnhancesItAndCloses() {
        showSomething()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LensService.instance!!.showLens(fromShade = false) }
        assertTrue("lens ready", waitUntil(30_000) { LensService.instance?.overlay?.state == LensOverlay.State.READY })
        val overlay = LensService.instance!!.overlay!!
        val src: Bitmap = overlay.source
        val out: Bitmap = overlay.processed!!
        assertTrue("screenshot size ${src.width}x${src.height}", src.width > 0 && src.height > 0)
        assertEquals(src.width, out.width)
        assertEquals(src.height, out.height)
        // The profile (contrast 1.4, sharpening) changed the picture.
        var changed = 0
        for (y in 0 until src.height step 17) for (x in 0 until src.width step 13) if (src.getPixel(x, y) != out.getPixel(x, y)) changed++
        assertTrue("pixels changed: $changed", changed > 50)
        // What the person sees: the close button, in Hebrew, above everything.
        val close = device.wait(Until.findObject(By.text(he("lens.close"))), 5_000)
        assertNotNull("close button shown", close)
        assertNotNull("compare button shown", device.wait(Until.findObject(By.text(he("lens.original"))), 5_000))
        close.click()
        assertTrue("lens closed", waitUntil(5_000) { LensService.instance?.overlay == null })
    }

    @Test fun backClosesTheLensAndCompareShowsTheOriginal() {
        showSomething()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LensService.instance!!.showLens(fromShade = false) }
        assertTrue("lens ready", waitUntil(30_000) { LensService.instance?.overlay?.state == LensOverlay.State.READY })
        val compare = device.wait(Until.findObject(By.text(he("lens.original"))), 10_000)
        assertNotNull("compare button shown", compare)
        compare.click()
        assertNotNull("compare switched to the original", device.wait(Until.findObject(By.text(he("lens.enhanced"))), 10_000))
        device.waitForIdle()
        device.pressBack()
        assertTrue("back closed the lens (sdk ${Build.VERSION.SDK_INT})", waitUntil(10_000) { LensService.instance?.overlay == null })
    }

    @Test fun fromQuickSettingsTheShadeClosesFirst() {
        showSomething()
        device.openQuickSettings()
        device.waitForIdle()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LensService.instance!!.showLens(fromShade = true) }
        assertTrue("lens ready", waitUntil(30_000) { LensService.instance?.overlay?.state == LensOverlay.State.READY })
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LensService.instance!!.overlay!!.dismiss() }
        assertTrue("lens closed", waitUntil(5_000) { LensService.instance?.overlay == null })
    }

    @Test fun appShowsTheLensAsOn() {
        showSomething()
        assertTrue(SystemSettings(TestEnv.context).isLensEnabled())
        val scroll = androidx.test.uiautomator.UiScrollable(androidx.test.uiautomator.UiSelector().scrollable(true))
        if (scroll.exists()) scroll.scrollIntoView(androidx.test.uiautomator.UiSelector().text(he("item.LENS.title")))
        assertNotNull(device.wait(Until.findObject(By.text("✓ " + he("status.lensOn"))), 5_000))
    }
}

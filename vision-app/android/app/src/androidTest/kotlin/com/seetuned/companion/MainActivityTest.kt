package com.seetuned.companion

import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiScrollable
import androidx.test.uiautomator.UiSelector
import androidx.test.uiautomator.Until
import com.seetuned.companion.TestEnv.pkg
import com.seetuned.companion.TestEnv.setting
import com.seetuned.companion.TestEnv.shell
import com.seetuned.companion.TestEnv.waitUntil
import com.seetuned.companion.core.Keys
import com.seetuned.companion.core.Screen
import com.seetuned.companion.core.Strings
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** The app as a person uses it: open the link from the web app, tap "Apply all", restore. */
@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    private lateinit var device: UiDevice
    private lateinit var originalFont: String
    private val he = Strings.of("he")
    private val en = Strings.of("en")

    @Before fun setUp() {
        device = TestEnv.device()
        TestEnv.clearAppState()
        originalFont = setting("system", Keys.FONT_SCALE)
        shell("settings put system ${Keys.FONT_SCALE} 1.0")
        device.wakeUp()
        shell("wm dismiss-keyguard")
    }

    @After fun tearDown() {
        device.pressHome()
        shell("settings put system ${Keys.FONT_SCALE} ${if (originalFont == "null") "1.0" else originalFont}")
        shell("appops set $pkg WRITE_SETTINGS default")
        TestEnv.clearAppState()
    }

    private fun openLink(query: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("seetuned://apply?$query"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        TestEnv.context.startActivity(intent)
    }

    private fun waitText(text: String, timeoutMs: Long = 10_000) =
        assertNotNull("\"$text\" on screen", device.wait(Until.findObject(By.text(text)), timeoutMs))

    private fun scrollTo(text: String) {
        val scroll = UiScrollable(UiSelector().scrollable(true))
        if (scroll.exists()) scroll.scrollIntoView(UiSelector().text(text))
    }

    @Test fun linkFromTheWebAppAppliesTheTextSizeInOneTapAndRestores() {
        shell("appops set $pkg WRITE_SETTINGS allow")
        openLink("v=1&lang=he&font=1.3&bold=1&cvd=deutan&cvdi=0.5&lc=1.2&lz=2")
        waitText(he("apply.all"))
        for (k in listOf("item.TEXT_SIZE.title", "item.BOLD.title", "item.COLOR.title")) {
            scrollTo(he(k))
            waitText(he(k))
        }
        scrollTo(he("apply.all"))
        device.findObject(By.text(he("apply.all"))).click()
        assertTrue("font_scale is ${setting("system", Keys.FONT_SCALE)}",
            waitUntil { setting("system", Keys.FONT_SCALE).toDoubleOrNull() == 1.3 })
        assertTrue("the whole phone uses it: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(1.3f))
        // The screen comes back (recreated for the new font size) with the result and the restore button.
        waitText(he("apply.done", "n" to 1), 15_000)
        scrollTo(he("restore.button"))
        device.wait(Until.findObject(By.text(he("restore.button"))), 10_000).click()
        assertTrue(waitUntil { setting("system", Keys.FONT_SCALE).toDoubleOrNull() == 1.0 })
        assertTrue("restored for the whole phone: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(1.0f))
        waitText(he("restore.done"), 15_000)
    }

    @Test fun withoutAccessApplyAllOpensTheSystemPermissionScreen() {
        shell("appops set $pkg WRITE_SETTINGS default")
        openLink("v=1&lang=en&font=1.3")
        waitText(en("access.title"))
        device.findObject(By.text(en("apply.all"))).click()
        assertTrue("permission screen opened, now in ${device.currentPackageName}",
            waitUntil(10_000) { device.currentPackageName != pkg && device.currentPackageName != null })
        // Grant it the way a person would (the switch differs by Android version), then come back: applied at once.
        shell("appops set $pkg WRITE_SETTINGS allow")
        device.pressBack()
        assertTrue("applied on return, font_scale ${setting("system", Keys.FONT_SCALE)}",
            waitUntil(15_000) { setting("system", Keys.FONT_SCALE).toDoubleOrNull() == 1.3 })
    }

    @Test fun badAndNewerLinksExplainWhatToDoInTheLinksLanguage() {
        openLink("v=9&lang=he&font=1.3")
        waitText(he("state.tooNew"))
        openLink("v=9&lang=en&font=1.3")
        waitText(en("state.tooNew"))
        openLink("lang=he&font=1.3")
        waitText(he("state.invalid"))
    }

    @Test fun launcherWithoutARecipeExplainsHowToStart() {
        val intent = TestEnv.context.packageManager.getLaunchIntentForPackage(pkg)!!
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        TestEnv.context.startActivity(intent)
        assertTrue(device.wait(Until.hasObject(By.textStartsWith(he("state.noRecipe").take(12)).pkg(pkg)), 10_000) ||
            device.wait(Until.hasObject(By.textStartsWith(en("state.noRecipe").take(12)).pkg(pkg)), 2_000))
    }

    /** True once the Settings app (any vendor's package with "settings" in its name) is in front. */
    private fun waitForSettings(label: String): String {
        val seen = linkedSetOf<String>()
        val ok = waitUntil(8_000) {
            val p = device.currentPackageName
            if (p != null) seen += p
            p != null && p.contains("settings", ignoreCase = true)
        }
        Log.i(SystemSettingsTest.PROBE, "$label: foreground packages seen $seen")
        assertTrue("$label: Settings did not open, saw $seen", ok)
        return device.currentPackageName
    }

    /** Opens a settings screen from the app's own screen, as its buttons do (Android blocks starts from the background). */
    private fun openFromApp(label: String, open: (android.app.Activity) -> Intent?) {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var used: Intent? = null
            scenario.onActivity { used = open(it) }
            assertNotNull("$label opened something", used)
            waitForSettings("$label via ${used?.action}")
        }
        device.pressHome()
    }

    @Test fun everyGuidedButtonOpensASettingsScreen() {
        for (screen in Screen.entries) openFromApp("screen $screen") { ScreenIntents.open(it, screen) }
        openFromApp("modify system settings") { ScreenIntents.openFirst(it, listOf(ScreenIntents.writeSettings(it))) }
    }
}

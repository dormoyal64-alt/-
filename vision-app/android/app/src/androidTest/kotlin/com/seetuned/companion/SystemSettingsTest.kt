package com.seetuned.companion

import android.content.res.Resources
import android.os.Build
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.seetuned.companion.TestEnv.pkg
import com.seetuned.companion.TestEnv.setting
import com.seetuned.companion.TestEnv.shell
import com.seetuned.companion.TestEnv.waitUntil
import com.seetuned.companion.core.ContrastLevel
import com.seetuned.companion.core.Cvd
import com.seetuned.companion.core.ItemId
import com.seetuned.companion.core.Keys
import com.seetuned.companion.core.Planner
import com.seetuned.companion.core.Recipe
import com.seetuned.companion.core.SettingWrite
import com.seetuned.companion.core.Table
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/** Real settings on a real Android system: what the person gets after tapping "Apply all". */
@RunWith(AndroidJUnit4::class)
class SystemSettingsTest {
    private lateinit var originalFont: String

    @Before fun setUp() {
        TestEnv.clearAppState()
        originalFont = setting("system", Keys.FONT_SCALE)
        shell("appops set $pkg WRITE_SETTINGS allow")
    }

    @After fun tearDown() {
        shell("settings put system ${Keys.FONT_SCALE} ${if (originalFont == "null") "1.0" else originalFont}")
        shell("appops set $pkg WRITE_SETTINGS default")
        shell("pm revoke $pkg android.permission.WRITE_SECURE_SETTINGS")
        TestEnv.clearAppState()
    }

    @Test fun textSizeChangesForTheWholePhoneAndRestores() {
        // A person who never changed the size: SeeTuned sets it, the system draws everything with it, restore undoes it.
        shell("settings put system ${Keys.FONT_SCALE} 1.0")
        assertTrue("settle: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(1.0f))
        val s = SystemSettings(TestEnv.context)
        assertTrue(s.canWriteSystem())
        val plan = Planner.plan(Recipe(fontScale = 1.3), s.device(), s.access())
        val result = s.apply(Planner.automaticWrites(plan, s.access()))
        assertEquals(listOf(SettingWrite(Table.SYSTEM, Keys.FONT_SCALE, "1.3")), result.written)
        assertEquals(1.3, setting("system", Keys.FONT_SCALE).toDouble(), 1e-6)
        assertTrue("applied: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(1.3f))
        assertTrue(Planner.isApplied(plan.first { it.id == ItemId.TEXT_SIZE }) { t, k -> s.read(t, k) })

        assertTrue(s.restore().failed.isEmpty())
        assertEquals(1.0, setting("system", Keys.FONT_SCALE).toDouble(), 1e-6)
        assertTrue("restored: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(1.0f))
        assertTrue(s.journal().isEmpty)
    }

    @Test fun aPersonsOwnSizeComesBackExactly() {
        // A person who had already chosen 115 %: SeeTuned changes it, restore brings back 115 %.
        shell("settings put system ${Keys.FONT_SCALE} 1.15")
        assertTrue("settle: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(1.15f))
        val s = SystemSettings(TestEnv.context)
        s.apply(listOf(SettingWrite(Table.SYSTEM, Keys.FONT_SCALE, "1.3")))
        Log.i(PROBE, "sdk=${Build.VERSION.SDK_INT} after app write: ${TestEnv.fontDiagnostics()}")
        assertTrue("applied: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(1.3f))
        s.restore()
        assertEquals(1.15, setting("system", Keys.FONT_SCALE).toDouble(), 1e-6)
        assertTrue("restored: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(1.15f))
    }

    @Test fun aChangeRightAfterAnotherIsConfirmed() {
        // Android writes its own copy of the size just after a change; SeeTuned's write may land in that moment.
        // confirmLater() looks again and repeats the write, so the phone ends at SeeTuned's size either way.
        shell("settings put system ${Keys.FONT_SCALE} 1.15")
        val s = SystemSettings(TestEnv.context)
        val writes = listOf(SettingWrite(Table.SYSTEM, Keys.FONT_SCALE, "1.3"))
        val repeated = java.util.concurrent.atomic.AtomicReference<List<SettingWrite>>()
        s.confirmLater(s.apply(writes).written) { repeated.set(it) }
        assertTrue("confirmed", waitUntil(10_000) { repeated.get() != null })
        Log.i(PROBE, "sdk=${Build.VERSION.SDK_INT} race: repeated ${repeated.get()} -> ${TestEnv.fontDiagnostics()}")
        assertTrue("applied: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(1.3f))
        s.confirmLater(s.restore().written)
        assertTrue("restored: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(1.15f))
    }

    @Test fun androidFourteenAndLaterAcceptTwoHundredPercent() {
        assumeTrue(Build.VERSION.SDK_INT >= 34)
        val s = SystemSettings(TestEnv.context)
        s.apply(Planner.automaticWrites(Planner.plan(Recipe(fontScale = 2.0), s.device(), s.access()), s.access()))
        assertEquals(2.0, setting("system", Keys.FONT_SCALE).toDouble(), 1e-6)
        assertTrue("applied: ${TestEnv.fontDiagnostics()}", TestEnv.waitFontScale(2.0f))
        s.restore()
    }

    @Test fun olderAndroidIsCappedAtItsLargestStep() {
        assumeTrue(Build.VERSION.SDK_INT < 34)
        val s = SystemSettings(TestEnv.context)
        val plan = Planner.plan(Recipe(fontScale = 1.8), s.device(), s.access())
        s.apply(Planner.automaticWrites(plan, s.access()))
        assertEquals(1.3, setting("system", Keys.FONT_SCALE).toDouble(), 1e-6)
        assertTrue(plan.any { it.id == ItemId.DISPLAY_SIZE })
        s.restore()
    }

    @Test fun withoutAccessNothingIsWrittenAndNothingCrashes() {
        shell("appops set $pkg WRITE_SETTINGS deny")
        val s = SystemSettings(TestEnv.context)
        assertTrue(waitUntil { !s.canWriteSystem() })
        val before = setting("system", Keys.FONT_SCALE)
        val r = s.apply(listOf(SettingWrite(Table.SYSTEM, Keys.FONT_SCALE, "1.5")))
        assertTrue(r.written.isEmpty())
        assertEquals(1, r.failed.size)
        assertEquals(before, setting("system", Keys.FONT_SCALE))
        assertFalse(s.canWriteSecure())
        assertTrue(s.apply(listOf(SettingWrite(Table.SECURE, Keys.HIGH_TEXT_CONTRAST, "1"))).written.isEmpty())
    }

    @Test fun advancedAccessAppliesBoldContrastColourAndDimThenRestoresThem() {
        assumeTrue(Build.VERSION.SDK_INT >= 31)
        val keys = listOf(Keys.FONT_WEIGHT_ADJUSTMENT, Keys.HIGH_TEXT_CONTRAST, Keys.DALTONIZER_ENABLED, Keys.DALTONIZER, Keys.EXTRA_DIM, Keys.CONTRAST_LEVEL)
        val originals = keys.associateWith { setting("secure", it) }
        shell("pm grant $pkg android.permission.WRITE_SECURE_SETTINGS")
        val s = SystemSettings(TestEnv.context)
        assertTrue(s.canWriteSecure())
        for (k in keys) Log.i(PROBE, "sdk=${Build.VERSION.SDK_INT} secure/$k readable by apps: ${s.canRead(Table.SECURE, k)}")

        val plan = Planner.plan(Recipe(bold = true, contrast = ContrastLevel.HIGH, cvd = Cvd.DEUTAN, dim = true), s.device(), s.access())
        val writes = Planner.automaticWrites(plan, s.access()) + plan.first { it.id == ItemId.COLOR }.writes
        val r = s.apply(writes)
        assertTrue("refused: ${r.failed}", r.failed.isEmpty())
        assertEquals("300", setting("secure", Keys.FONT_WEIGHT_ADJUSTMENT))
        assertTrue("bold text reached the system configuration",
            waitUntil { Resources.getSystem().configuration.fontWeightAdjustment == 300 })
        assertEquals("1", setting("secure", Keys.HIGH_TEXT_CONTRAST))
        assertEquals("1", setting("secure", Keys.DALTONIZER_ENABLED))
        assertEquals("12", setting("secure", Keys.DALTONIZER))
        assertEquals("1", setting("secure", Keys.EXTRA_DIM))
        if (Build.VERSION.SDK_INT >= 34) assertEquals(1.0, setting("secure", Keys.CONTRAST_LEVEL).toDouble(), 1e-6)
        for (item in plan.filter { it.writes.isNotEmpty() }) {
            assertTrue("${item.id} shows as applied", Planner.isApplied(item) { t, k -> s.read(t, k) })
        }

        val back = s.restore()
        assertTrue("not restored: ${back.failed}", back.failed.isEmpty())
        for (k in keys) {
            val now = setting("secure", k)
            val was = originals.getValue(k)
            if (was == "null") assertTrue("$k back to default, is $now", now == "null" || Planner.sameValue(k, now, Keys.DEFAULTS.getValue(k)))
            else assertTrue("$k back to $was, is $now", Planner.sameValue(k, now, was))
        }
        assertTrue(waitUntil { Resources.getSystem().configuration.fontWeightAdjustment != 300 })
    }

    @Test fun restoreKeepsTheFirstOriginalAcrossTwoApplies() {
        shell("settings put system ${Keys.FONT_SCALE} 1.0")
        val s = SystemSettings(TestEnv.context)
        s.apply(listOf(SettingWrite(Table.SYSTEM, Keys.FONT_SCALE, "1.3")))
        s.apply(listOf(SettingWrite(Table.SYSTEM, Keys.FONT_SCALE, "1.15")))
        assertNotEquals("1.0", setting("system", Keys.FONT_SCALE))
        s.restore()
        assertEquals(1.0, setting("system", Keys.FONT_SCALE).toDouble(), 1e-6)
    }

    companion object {
        const val PROBE = "SeeTunedProbe"
    }
}

package com.seetuned.companion.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlannerTest {
    private val galaxyS24 = Device(sdk = 34, samsung = true)
    private val pixel = Device(sdk = 35, samsung = false)
    private val oldGalaxy = Device(sdk = 30, samsung = true)
    private val none = Access(canWriteSystem = false, canWriteSecure = false, lensEnabled = false)
    private val system = Access(canWriteSystem = true, canWriteSecure = false, lensEnabled = false)
    private val all = Access(canWriteSystem = true, canWriteSecure = true, lensEnabled = true)

    private val full = Recipe(fontScale = 1.5, bold = true, contrast = ContrastLevel.HIGH, cvd = Cvd.DEUTAN, dim = true, dark = true, magnification = true)

    private fun List<PlanItem>.item(id: ItemId) = first { it.id == id }

    @Test fun textSizeIsAutomaticWithSystemAccess() {
        val plan = Planner.plan(Recipe(fontScale = 1.5), galaxyS24, system)
        val text = plan.item(ItemId.TEXT_SIZE)
        assertEquals(Mechanism.SYSTEM_WRITE, text.mechanism)
        assertEquals(listOf(SettingWrite(Table.SYSTEM, Keys.FONT_SCALE, "1.5")), text.writes)
        assertEquals(Screen.DISPLAY, text.screen)
        assertEquals(listOf(SettingWrite(Table.SYSTEM, Keys.FONT_SCALE, "1.5")), Planner.automaticWrites(plan, system))
        // Without access nothing is written, but the item is still listed (the app asks for access).
        assertEquals(emptyList<SettingWrite>(), Planner.automaticWrites(Planner.plan(Recipe(fontScale = 1.5), galaxyS24, none), none))
    }

    @Test fun defaultTextSizeIsLeftAlone() {
        val plan = Planner.plan(Recipe(fontScale = 1.0), pixel, all)
        assertFalse(plan.any { it.id == ItemId.TEXT_SIZE })
        assertEquals(listOf(ItemId.LENS), plan.map { it.id })
    }

    @Test fun olderAndroidCapsTheFontAndAddsDisplaySize() {
        val plan = Planner.plan(Recipe(fontScale = 1.8), oldGalaxy, system)
        val text = plan.item(ItemId.TEXT_SIZE)
        assertEquals("1.3", text.writes.single().value)
        assertEquals(listOf(Note.FONT_CAPPED), text.notes)
        // 1.8 / 1.3 = 1.385 → ceil(ln 1.385 / ln 1.125) = 3 steps.
        assertEquals(3, plan.item(ItemId.DISPLAY_SIZE).displaySteps)
        assertEquals(Mechanism.GUIDED, plan.item(ItemId.DISPLAY_SIZE).mechanism)
    }

    @Test fun samsungWithoutAdvancedAccessGuidesTheSecureSettings() {
        val plan = Planner.plan(full, galaxyS24, system)
        for (id in listOf(ItemId.BOLD, ItemId.CONTRAST, ItemId.COLOR, ItemId.DIM, ItemId.DARK, ItemId.MAGNIFICATION)) {
            assertEquals(id.name, Mechanism.GUIDED, plan.item(id).mechanism)
            assertTrue(id.name, plan.item(id).writes.isEmpty())
        }
        assertEquals(listOf(SettingWrite(Table.SECURE, Keys.FONT_WEIGHT_ADJUSTMENT, "300")), plan.item(ItemId.BOLD).secureWrites)
        // Samsung: high contrast fonts only (no Pixel-style contrast level).
        assertEquals(listOf(SettingWrite(Table.SECURE, Keys.HIGH_TEXT_CONTRAST, "1")), plan.item(ItemId.CONTRAST).secureWrites)
        assertEquals(Screen.COLOR_CORRECTION, plan.item(ItemId.COLOR).screen)
        assertEquals(Mechanism.LENS, plan.item(ItemId.LENS).mechanism)
    }

    @Test fun advancedAccessMakesThemAutomaticButKeepsTheColourFilterOptional() {
        val plan = Planner.plan(full, pixel, all)
        assertEquals(Mechanism.SECURE_WRITE, plan.item(ItemId.BOLD).mechanism)
        assertEquals(
            listOf(SettingWrite(Table.SECURE, Keys.HIGH_TEXT_CONTRAST, "1"), SettingWrite(Table.SECURE, Keys.CONTRAST_LEVEL, "1.0")),
            plan.item(ItemId.CONTRAST).writes,
        )
        val colour = plan.item(ItemId.COLOR)
        assertEquals(Mechanism.SECURE_WRITE, colour.mechanism)
        assertFalse(colour.recommended)
        assertEquals(listOf(SettingWrite(Table.SECURE, Keys.DALTONIZER_ENABLED, "1"), SettingWrite(Table.SECURE, Keys.DALTONIZER, "12")), colour.writes)
        val auto = Planner.automaticWrites(plan, all).map { it.key }
        assertEquals(listOf(Keys.FONT_SCALE, Keys.FONT_WEIGHT_ADJUSTMENT, Keys.HIGH_TEXT_CONTRAST, Keys.CONTRAST_LEVEL, Keys.EXTRA_DIM), auto)
        assertFalse(Keys.DALTONIZER in auto)
    }

    @Test fun mediumContrastOnSamsungIsOptionalAndGuided() {
        val item = Planner.plan(Recipe(contrast = ContrastLevel.MEDIUM), galaxyS24, all).item(ItemId.CONTRAST)
        assertEquals(Mechanism.GUIDED, item.mechanism)
        assertFalse(item.recommended)
        val pixelItem = Planner.plan(Recipe(contrast = ContrastLevel.MEDIUM), pixel, all).item(ItemId.CONTRAST)
        assertEquals(listOf(SettingWrite(Table.SECURE, Keys.CONTRAST_LEVEL, "0.5")), pixelItem.writes)
        assertTrue(pixelItem.recommended)
    }

    @Test fun boldAndDimNeedAndroid12() {
        val plan = Planner.plan(full, Device(sdk = 30, samsung = false), all)
        assertEquals(Mechanism.GUIDED, plan.item(ItemId.BOLD).mechanism)
        assertEquals(Mechanism.GUIDED, plan.item(ItemId.DIM).mechanism)
        assertEquals(Mechanism.SECURE_WRITE, plan.item(ItemId.CONTRAST).mechanism)
    }

    @Test fun lensNeedsAndroid11() {
        assertFalse(Planner.plan(full, Device(sdk = 29, samsung = true), all).any { it.id == ItemId.LENS })
        assertTrue(Planner.plan(full, Device(sdk = 30, samsung = true), all).any { it.id == ItemId.LENS })
    }

    @Test fun displayMaxAddsMagnification() {
        val plan = Planner.plan(Recipe(fontScale = 2.0, displaySteps = 5, displayMax = true), pixel, all)
        assertTrue(plan.item(ItemId.DISPLAY_SIZE).displayMax)
        assertTrue(plan.any { it.id == ItemId.MAGNIFICATION })
    }

    @Test fun isAppliedComparesFontScaleWithTolerance() {
        val text = Planner.plan(Recipe(fontScale = 1.5), pixel, system).item(ItemId.TEXT_SIZE)
        assertTrue(Planner.isApplied(text) { _, _ -> "1.5000001" })
        assertTrue(Planner.isApplied(text) { _, _ -> "1.50" })
        assertFalse(Planner.isApplied(text) { _, _ -> "1.3" })
        assertFalse(Planner.isApplied(text) { _, _ -> null })
        val bold = Planner.plan(Recipe(bold = true), pixel, all).item(ItemId.BOLD)
        assertTrue(Planner.isApplied(bold) { _, _ -> "300" })
        assertFalse(Planner.isApplied(bold) { _, _ -> null }) // unset = 0
        assertFalse(Planner.isApplied(PlanItem(ItemId.DARK, Mechanism.GUIDED)) { _, _ -> "1" })
    }

    @Test fun displayStepsMatchesTheWebGuide() {
        // engine/system-guide.js displaySizeSteps: 0 at ≤ 1.01, then ceil(ln z / ln 1.125).
        assertEquals(0, Planner.displaySteps(1.0))
        assertEquals(0, Planner.displaySteps(Double.NaN))
        assertEquals(1, Planner.displaySteps(1.05))
        assertEquals(1, Planner.displaySteps(1.125))
        assertEquals(2, Planner.displaySteps(1.2))
        assertEquals(3, Planner.displaySteps(1.4))
    }
}

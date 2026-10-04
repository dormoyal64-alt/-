package com.seetuned.companion.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StringsTest {
    private val placeholder = Regex("\\{[a-z]+\\}")

    @Test fun bothLanguagesHaveTheSameKeysAndPlaceholders() {
        assertEquals(Strings.HE.keys, Strings.EN.keys)
        for (k in Strings.HE.keys) {
            assertEquals(k, placeholder.findAll(Strings.HE.getValue(k)).map { it.value }.toSet(), placeholder.findAll(Strings.EN.getValue(k)).map { it.value }.toSet())
            assertTrue(k, Strings.HE.getValue(k).isNotBlank())
        }
    }

    @Test fun everyPlanItemHasATitleAndEveryGuidedItemSaysWhere() {
        val he = Strings.of("he")
        for (id in ItemId.entries) assertTrue(id.name, he.has("item.${id.name}.title"))
        val guided = ItemId.entries - setOf(ItemId.LENS)
        for (os in listOf("samsung", "android")) for (id in guided) assertTrue("$os ${id.name}", he.has("where.$os.${id.name}"))
        for (n in Note.entries) assertTrue(n.name, he.has("note.${n.name}"))
        for (c in Cvd.entries) for (os in listOf("samsung", "android")) assertTrue(he.has("option.$os.${c.wire}"))
    }

    @Test fun interpolationAndFallbacks() {
        val en = Strings.of("en")
        assertEquals("150% of the standard size", en("value.text", "pct" to 150))
        assertEquals("no.such.key", en("no.such.key"))
        assertEquals(Strings.HE.getValue("app.subtitle"), Strings.of("fr")("app.subtitle"))
    }

    @Test fun noClinicalNotation() {
        // The product never shows prescriptions or chart scores (docs/brand/BRAND.md).
        val clinical = Regex("(\\d+/\\d+)|dioptr|דיופטר|logMAR|Snellen|\\b[+-]\\d+(\\.\\d+)?\\s*D\\b", RegexOption.IGNORE_CASE)
        for ((k, v) in Strings.HE + Strings.EN.mapKeys { "en:" + it.key }) assertFalse("$k: $v", clinical.containsMatchIn(v))
    }
}

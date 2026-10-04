package com.seetuned.companion.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JournalTest {
    @Test fun keepsOnlyTheFirstOriginal() {
        val j = Journal.EMPTY
            .recordIfAbsent(Table.SYSTEM, Keys.FONT_SCALE, "1.15")
            .recordIfAbsent(Table.SYSTEM, Keys.FONT_SCALE, "1.5") // SeeTuned's own earlier value: ignored
            .recordIfAbsent(Table.SECURE, Keys.FONT_WEIGHT_ADJUSTMENT, null)
        assertEquals(2, j.size)
        assertEquals("1.15", j.original(Table.SYSTEM, Keys.FONT_SCALE))
        assertNull(j.original(Table.SECURE, Keys.FONT_WEIGHT_ADJUSTMENT))
        // Same key name in another table is a different entry.
        assertFalse(j.contains(Table.SECURE, Keys.FONT_SCALE))
    }

    @Test fun restoreWritesOriginalsAndDefaultsForUnsetKeys() {
        val j = Journal.EMPTY
            .recordIfAbsent(Table.SYSTEM, Keys.FONT_SCALE, "1.15")
            .recordIfAbsent(Table.SECURE, Keys.FONT_WEIGHT_ADJUSTMENT, null)
            .recordIfAbsent(Table.SECURE, Keys.DALTONIZER, null)
            .recordIfAbsent(Table.SECURE, "some_unknown_key", null)
        assertEquals(
            listOf(
                SettingWrite(Table.SYSTEM, Keys.FONT_SCALE, "1.15"),
                SettingWrite(Table.SECURE, Keys.FONT_WEIGHT_ADJUSTMENT, "0"),
                SettingWrite(Table.SECURE, Keys.DALTONIZER, "12"),
                SettingWrite(Table.SECURE, "some_unknown_key", "0"),
            ),
            j.restoreWrites(),
        )
    }

    @Test fun encodeDecodeRoundTripsAnyValue() {
        val j = Journal.EMPTY
            .recordIfAbsent(Table.SYSTEM, Keys.FONT_SCALE, "1.0")
            .recordIfAbsent(Table.SECURE, Keys.CONTRAST_LEVEL, "tab\there\nnew line ✓ עברית")
            .recordIfAbsent(Table.SECURE, Keys.EXTRA_DIM, null)
            .recordIfAbsent(Table.SECURE, Keys.HIGH_TEXT_CONTRAST, "")
        assertEquals(j, Journal.decode(j.encode()))
        assertTrue(Journal.decode(null).isEmpty)
        assertTrue(Journal.decode("").isEmpty)
    }

    @Test fun decodeSkipsDamagedLinesButKeepsTheRest() {
        val good = Journal.EMPTY.recordIfAbsent(Table.SYSTEM, Keys.FONT_SCALE, "1.3").encode()
        val text = listOf("garbage", "OTHER\tx\t-", "SECURE\tBad Key!\t-", "SECURE\tok_key\t@@not-base64@@", good, "SYSTEM\tfont_scale\tMi4w").joinToString("\n")
        val j = Journal.decode(text)
        assertEquals(1, j.size)
        assertEquals("1.3", j.original(Table.SYSTEM, Keys.FONT_SCALE))
    }

    @Test fun withoutRemovesOneEntry() {
        val j = Journal.EMPTY.recordIfAbsent(Table.SYSTEM, Keys.FONT_SCALE, "1.0").recordIfAbsent(Table.SECURE, Keys.EXTRA_DIM, "0")
        val k = j.without(Table.SYSTEM, Keys.FONT_SCALE)
        assertEquals(1, k.size)
        assertTrue(k.contains(Table.SECURE, Keys.EXTRA_DIM))
        assertEquals(2, j.size) // immutable
    }
}

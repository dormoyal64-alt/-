package com.seetuned.companion.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecipeCodecTest {
    private fun ok(q: String): Recipe {
        val r = RecipeCodec.parse(q)
        assertTrue("expected Ok for $q, got $r", r is ParseResult.Ok)
        return (r as ParseResult.Ok).recipe
    }

    @Test fun parsesAFullRecipeFromTheWebApp() {
        // The exact shape engine/android-link.js produces (URLSearchParams encodes the commas).
        val r = ok("v=1&lang=en&font=1.8&fontx=1&ds=3&dsmax=1&bold=1&contrast=high&cvd=deutan&cvdi=0.6&dim=1&dark=1&mag=1" +
            "&lm=1.1%2C-0.1%2C0%2C0.05%2C0.95%2C0%2C0%2C0%2C1&lc=1.25&lb=0.9&ls=1.1&lsa=0.8&lss=1.2&lz=2&lw=0.3&linv=1")
        assertEquals(1, r.version)
        assertEquals("en", r.lang)
        assertEquals(1.8, r.fontScale, 0.0)
        assertTrue(r.fontExceeds)
        assertEquals(3, r.displaySteps)
        assertTrue(r.displayMax)
        assertTrue(r.bold)
        assertEquals(ContrastLevel.HIGH, r.contrast)
        assertEquals(Cvd.DEUTAN, r.cvd)
        assertEquals(0.6, r.cvdIntensity, 0.0)
        assertTrue(r.dim && r.dark && r.magnification)
        assertEquals(listOf(1.1, -0.1, 0.0, 0.05, 0.95, 0.0, 0.0, 0.0, 1.0), r.lens.colorMatrix)
        assertEquals(LensParams(r.lens.colorMatrix, 1.25, 0.9, 1.1, 0.8, 1.2, 2.0, 0.3, true), r.lens)
    }

    @Test fun minimalRecipeHasSafeDefaults() {
        val r = ok("v=1")
        assertEquals(Recipe(), r)
        assertTrue(r.lens.isIdentityMatrix)
    }

    @Test fun refusesMissingBadOrNewerVersions() {
        assertTrue(RecipeCodec.parse(null) is ParseResult.Invalid)
        assertTrue(RecipeCodec.parse("") is ParseResult.Invalid)
        assertTrue(RecipeCodec.parse("font=1.5") is ParseResult.Invalid)
        assertTrue(RecipeCodec.parse("v=abc") is ParseResult.Invalid)
        assertTrue(RecipeCodec.parse("v=0") is ParseResult.Invalid)
        assertEquals(ParseResult.TooNew(2), RecipeCodec.parse("v=2&font=1.5"))
        assertTrue(RecipeCodec.parse("v=1&x=" + "a".repeat(5000)) is ParseResult.Invalid)
    }

    @Test fun clampsEveryNumberAndIgnoresJunk() {
        val r = ok("v=1&lang=fr&font=9&ds=99&contrast=extreme&cvd=purple&cvdi=-4&lm=1,2,3&lc=NaN&lb=-1&ls=99&lsa=-2&lss=0&lz=100&lw=7&linv=yes&bold=true&evil=%3Cscript%3E")
        assertEquals("he", r.lang)
        assertEquals(Recipe.MAX_FONT_SCALE, r.fontScale, 0.0)
        assertEquals(Recipe.MAX_DISPLAY_STEPS, r.displaySteps)
        assertNull(r.contrast)
        assertNull(r.cvd)
        assertEquals(0.0, r.cvdIntensity, 0.0)
        assertTrue(r.lens.isIdentityMatrix)
        assertEquals(1.0, r.lens.contrast, 0.0)
        assertEquals(0.0, r.lens.brightness, 0.0)
        assertEquals(5.0, r.lens.saturation, 0.0)
        assertEquals(0.0, r.lens.sharpenAmount, 0.0)
        assertEquals(0.3, r.lens.sharpenSigmaPx, 0.0)
        assertEquals(8.0, r.lens.zoom, 0.0)
        assertEquals(1.0, r.lens.warmth, 0.0)
        assertFalse(r.lens.invert)
        assertFalse(r.bold)
        assertEquals(Recipe.MIN_FONT_SCALE, ok("v=1&font=0.1").fontScale, 0.0)
        assertEquals(1.0, ok("v=1&font=Infinity").fontScale, 0.0)
        assertEquals(listOf(8.0, -8.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0), ok("v=1&lm=99,-99,0,0,1,0,0,0,1").lens.colorMatrix)
    }

    @Test fun firstOccurrenceWinsAndBadEscapesAreKept() {
        assertEquals(1.5, ok("v=1&font=1.5&font=2").fontScale, 0.0)
        assertEquals(mapOf("a" to "%zz", "b" to "x y"), RecipeCodec.splitQuery("?a=%zz&b=x+y&&=c"))
    }

    @Test fun encodeRoundTrips() {
        val samples = listOf(
            Recipe(),
            Recipe(lang = "en", fontScale = 1.3, bold = true, contrast = ContrastLevel.MEDIUM, cvd = Cvd.TRITAN, cvdIntensity = 0.25, dark = true),
            Recipe(fontScale = 2.0, fontExceeds = true, displaySteps = 4, displayMax = true, dim = true, magnification = true,
                lens = LensParams(listOf(1.2, -0.2, 0.0, 0.1, 0.9, 0.0, 0.0, -0.05, 1.05), 1.4, 1.1, 0.7, 1.5, 2.0, 3.0, 0.5, true)),
        )
        for (r in samples) assertEquals(r, ok(RecipeCodec.encode(r)))
    }
}

package com.seetuned.companion.core

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs

class LensMathTest {
    private val golden = JSONObject(javaClass.getResource("/lens-golden.json")!!.readText())

    /** RGBA bytes (the JavaScript ImageData order) → Android ARGB ints. */
    private fun argb(rgba: List<Int>): IntArray = IntArray(rgba.size / 4) { i ->
        (rgba[i * 4 + 3] shl 24) or (rgba[i * 4] shl 16) or (rgba[i * 4 + 1] shl 8) or rgba[i * 4 + 2]
    }

    @Test fun matchesTheJavaScriptReferenceWithinOneLevel() {
        val w = golden.getInt("width")
        val h = golden.getInt("height")
        val cases = golden.getJSONArray("cases")
        assertTrue(cases.length() >= 5)
        for (k in 0 until cases.length()) {
            val c = cases.getJSONObject(k)
            val lens = (RecipeCodec.parse(c.getString("query")) as ParseResult.Ok).recipe.lens
            val input = c.getJSONArray("input").let { a -> List(a.length()) { a.getInt(it) } }
            val expected = c.getJSONArray("output").let { a -> IntArray(a.length()) { a.getInt(it) } }
            val px = argb(input)
            LensMath.process(px, w, h, lens, c.getDouble("sigma"))
            var worst = 0
            for (i in 0 until w * h) {
                assertEquals("opaque output", 0xff, (px[i] ushr 24) and 0xff)
                val got = intArrayOf((px[i] shr 16) and 0xff, (px[i] shr 8) and 0xff, px[i] and 0xff)
                for (ch in 0 until 3) worst = maxOf(worst, abs(got[ch] - expected[i * 3 + ch]))
            }
            assertTrue("case '${c.getString("name")}': worst difference $worst levels", worst <= 1)
        }
    }

    @Test fun parallelRowsGiveTheSameResult() {
        val w = 97
        val h = 61
        val src = IntArray(w * h) { (0xff shl 24) or ((it * 2654435761L).toInt() and 0xffffff) }
        val p = LensParams(listOf(1.1, -0.06, -0.04, 0.12, 0.84, 0.04, -0.03, 0.1, 0.93), contrast = 1.2, sharpenAmount = 1.0, sharpenSigmaPx = 1.3, warmth = 0.2)
        val a = src.copyOf()
        LensMath.process(a, w, h, p, 2.6)
        val pool = Executors.newFixedThreadPool(4)
        try {
            val parallel = LensMath.RowRunner { rows, body ->
                val chunk = (rows + 3) / 4
                (0 until rows step chunk).map { s -> pool.submit { body(s until minOf(rows, s + chunk)) } }.forEach { it.get(10, TimeUnit.SECONDS) }
            }
            val b = src.copyOf()
            LensMath.process(b, w, h, p, 2.6, parallel)
            assertArrayEquals(a, b)
        } finally {
            pool.shutdown()
        }
    }

    @Test fun neutralParamsLeaveOpaquePixelsAlone() {
        val px = intArrayOf(0xff102030.toInt(), 0xfffefdfc.toInt(), 0xff000000.toInt(), 0xffffffff.toInt())
        val copy = px.copyOf()
        LensMath.process(px, 2, 2, LensParams(), 2.0)
        assertArrayEquals(copy, px)
    }

    @Test fun transparentPixelsBecomeWhite() {
        val px = intArrayOf(0x00000000, 0x80000000.toInt())
        LensMath.process(px, 2, 1, LensParams(), 1.0)
        assertEquals(0xffffffff.toInt(), px[0])
        // 50 % black over white ≈ 127.
        assertTrue(abs(((px[1] shr 16) and 0xff) - 127) <= 1)
    }

    @Test fun emptyAndTinyImagesAreSafe() {
        LensMath.process(IntArray(0), 0, 0, LensParams(sharpenAmount = 2.0), 3.0)
        val one = intArrayOf(0xff336699.toInt())
        LensMath.process(one, 1, 1, LensParams(sharpenAmount = 2.0, contrast = 1.5), 3.0)
        assertEquals(0xff, (one[0] ushr 24) and 0xff)
    }

    @Test fun kernelIsNormalisedAndClampedSigmaHasRadius60() {
        assertEquals(1.0, LensMath.gaussianKernel(1.7).sum(), 1e-12)
        assertArrayEquals(doubleArrayOf(1.0), LensMath.gaussianKernel(0.0), 0.0)
        assertEquals(121, LensMath.gaussianKernel(LensMath.MAX_SIGMA_PX).size)
    }

    @Test fun fullScreenFitsAReasonableTime() {
        // A 1080 × 2340 screenshot with sharpening on 4 threads: a sanity bound, not a benchmark.
        val w = 1080
        val h = 2340
        val px = IntArray(w * h) { (0xff shl 24) or (it * 31 and 0xffffff) }
        val pool = Executors.newFixedThreadPool(4)
        try {
            val parallel = LensMath.RowRunner { rows, body ->
                val chunk = (rows + 7) / 8
                (0 until rows step chunk).map { s -> pool.submit { body(s until minOf(rows, s + chunk)) } }.forEach { it.get(60, TimeUnit.SECONDS) }
            }
            val t0 = System.nanoTime()
            LensMath.process(px, w, h, LensParams(sharpenAmount = 1.0, sharpenSigmaPx = 1.0, contrast = 1.2), 2.75, parallel)
            val ms = (System.nanoTime() - t0) / 1e6
            assertTrue("took $ms ms", ms < 20_000)
        } finally {
            pool.shutdown()
        }
    }
}

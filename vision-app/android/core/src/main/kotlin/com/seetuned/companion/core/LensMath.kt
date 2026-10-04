package com.seetuned.companion.core

import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * The screen lens's per-pixel pipeline: a port of processImageData() in public/app/js/render/filter-math.js, in
 * the same order (colour matrix in linear light → unsharp mask → warmth, brightness, contrast, saturation, invert).
 * test/…/LensMathTest checks it against outputs of the JavaScript reference (lens-golden.json, ±1 of 255).
 *
 * Pixels are Android ARGB ints (Bitmap.getPixels). Memory: five float planes the size of the image.
 */
object LensMath {
    const val MAX_SIGMA_PX = 20.0
    private const val WARMTH_GREEN = 0.12
    private const val WARMTH_BLUE = 0.5
    private const val LUMA_R = 0.2126
    private const val LUMA_G = 0.7152
    private const val LUMA_B = 0.0722

    /** Runs `body` over row ranges that together cover 0 until `rows`; may run them in parallel. */
    fun interface RowRunner {
        fun run(rows: Int, body: (IntRange) -> Unit)
    }

    val SEQUENTIAL = RowRunner { rows, body -> if (rows > 0) body(0 until rows) }

    fun srgbToLinear(c: Double): Double = if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)

    fun linearToSrgb(l: Double): Double = if (l <= 0.0031308) 12.92 * l else 1.055 * l.pow(1 / 2.4) - 0.055

    private val TO_LINEAR = FloatArray(256) { srgbToLinear(it / 255.0).toFloat() }

    /** linear → sRGB through a fine table with linear interpolation (the exact curve costs a pow() per channel). */
    private const val LUT_SIZE = 16384
    private val TO_SRGB = FloatArray(LUT_SIZE + 1) { linearToSrgb(it / LUT_SIZE.toDouble()).toFloat() }

    private fun toSrgb(l: Float): Float {
        val x = l.coerceIn(0f, 1f) * LUT_SIZE
        val i = x.toInt().coerceAtMost(LUT_SIZE - 1)
        val f = x - i
        return TO_SRGB[i] + (TO_SRGB[i + 1] - TO_SRGB[i]) * f
    }

    /** Normalised Gaussian, radius ceil(3σ); σ ≤ 0 → [1]. Same as gaussianKernel() in filter-math.js. */
    fun gaussianKernel(sigma: Double): DoubleArray {
        if (!(sigma > 0)) return doubleArrayOf(1.0)
        val radius = ceil(3 * sigma).toInt()
        val k = DoubleArray(2 * radius + 1) { val i = it - radius; exp(-(i * i) / (2 * sigma * sigma)) }
        val sum = k.sum()
        for (i in k.indices) k[i] /= sum
        return k
    }

    /**
     * Process [pixels] (ARGB, width × height) in place. [sigmaPx] is the unsharp-mask sigma in pixels of THIS image
     * (the lens passes sharpenSigmaPx × display density). The output is opaque.
     */
    fun process(pixels: IntArray, width: Int, height: Int, p: LensParams, sigmaPx: Double, runner: RowRunner = SEQUENTIAL) {
        require(width >= 0 && height >= 0 && pixels.size >= width * height) { "bad size" }
        val n = width * height
        if (n == 0) return
        val r = FloatArray(n)
        val g = FloatArray(n)
        val b = FloatArray(n)
        val identity = p.isIdentityMatrix
        val m = FloatArray(9) { p.colorMatrix[it].toFloat() }

        // Stage A: composite onto white, colour matrix in linear light.
        runner.run(height) { rows ->
            for (y in rows) for (x in 0 until width) {
                val i = y * width + x
                val c = pixels[i]
                val a = (c ushr 24) and 0xff
                val r8 = (c shr 16) and 0xff
                val g8 = (c shr 8) and 0xff
                val b8 = c and 0xff
                if (a == 255) {
                    if (identity) { r[i] = r8 / 255f; g[i] = g8 / 255f; b[i] = b8 / 255f; continue }
                    val lr = TO_LINEAR[r8]; val lg = TO_LINEAR[g8]; val lb = TO_LINEAR[b8]
                    r[i] = toSrgb(m[0] * lr + m[1] * lg + m[2] * lb)
                    g[i] = toSrgb(m[3] * lr + m[4] * lg + m[5] * lb)
                    b[i] = toSrgb(m[6] * lr + m[7] * lg + m[8] * lb)
                } else {
                    val al = a / 255.0
                    val cr = r8 / 255.0 * al + (1 - al)
                    val cg = g8 / 255.0 * al + (1 - al)
                    val cb = b8 / 255.0 * al + (1 - al)
                    if (identity) { r[i] = cr.toFloat(); g[i] = cg.toFloat(); b[i] = cb.toFloat(); continue }
                    val lr = srgbToLinear(cr); val lg = srgbToLinear(cg); val lb = srgbToLinear(cb)
                    r[i] = toSrgb((m[0] * lr + m[1] * lg + m[2] * lb).toFloat())
                    g[i] = toSrgb((m[3] * lr + m[4] * lg + m[5] * lb).toFloat())
                    b[i] = toSrgb((m[6] * lr + m[7] * lg + m[8] * lb).toFloat())
                }
            }
        }

        // Stage B: unsharp mask, one plane at a time (two scratch planes).
        if (p.sharpenAmount > 0) {
            val kernel = gaussianKernel(min(sigmaPx, MAX_SIGMA_PX)).map { it.toFloat() }.toFloatArray()
            if (kernel.size > 1) {
                val tmp = FloatArray(n)
                val blurred = FloatArray(n)
                val amount = p.sharpenAmount.toFloat()
                for (plane in arrayOf(r, g, b)) {
                    blur(plane, tmp, blurred, width, height, kernel, runner)
                    runner.run(height) { rows ->
                        for (y in rows) for (x in 0 until width) {
                            val i = y * width + x
                            plane[i] = (plane[i] + amount * (plane[i] - blurred[i])).coerceIn(0f, 1f)
                        }
                    }
                }
            }
        }

        // Stage C: tone, then pack.
        val w = p.warmth.toFloat()
        val br = p.brightness.toFloat()
        val ct = p.contrast.toFloat()
        val sat = p.saturation.toFloat()
        val gMul = 1 - WARMTH_GREEN.toFloat() * w
        val bMul = 1 - WARMTH_BLUE.toFloat() * w
        runner.run(height) { rows ->
            for (y in rows) for (x in 0 until width) {
                val i = y * width + x
                var rr = r[i] * br
                var gg = g[i] * gMul * br
                var bb = b[i] * bMul * br
                rr = (rr - 0.5f) * ct + 0.5f; gg = (gg - 0.5f) * ct + 0.5f; bb = (bb - 0.5f) * ct + 0.5f
                val l = LUMA_R.toFloat() * rr + LUMA_G.toFloat() * gg + LUMA_B.toFloat() * bb
                rr = (l + (rr - l) * sat).coerceIn(0f, 1f)
                gg = (l + (gg - l) * sat).coerceIn(0f, 1f)
                bb = (l + (bb - l) * sat).coerceIn(0f, 1f)
                if (p.invert) { rr = 1 - rr; gg = 1 - gg; bb = 1 - bb }
                pixels[i] = (0xff shl 24) or (to8(rr) shl 16) or (to8(gg) shl 8) or to8(bb)
            }
        }
    }

    private fun to8(v: Float): Int = (v * 255f).roundToInt().coerceIn(0, 255)

    /** Separable Gaussian with clamp-to-edge: src → tmp (horizontal) → dst (vertical). */
    private fun blur(src: FloatArray, tmp: FloatArray, dst: FloatArray, width: Int, height: Int, k: FloatArray, runner: RowRunner) {
        val r = (k.size - 1) / 2
        runner.run(height) { rows ->
            for (y in rows) {
                val row = y * width
                for (x in 0 until width) {
                    var acc = 0f
                    for (j in -r..r) {
                        val xx = (x + j).coerceIn(0, width - 1)
                        acc += k[j + r] * src[row + xx]
                    }
                    tmp[row + x] = acc
                }
            }
        }
        runner.run(height) { rows ->
            for (y in rows) {
                for (x in 0 until width) {
                    var acc = 0f
                    for (j in -r..r) {
                        val yy = (y + j).coerceIn(0, height - 1)
                        acc += k[j + r] * tmp[yy * width + x]
                    }
                    dst[y * width + x] = acc
                }
            }
        }
    }
}

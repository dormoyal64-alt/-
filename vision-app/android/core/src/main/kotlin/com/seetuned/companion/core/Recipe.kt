package com.seetuned.companion.core

import java.net.URLDecoder
import java.net.URLEncoder

/** Colour vision type for the system colour-correction filter. [wire] is the value in the link. */
enum class Cvd(val wire: String) { PROTAN("protan"), DEUTAN("deutan"), TRITAN("tritan") }

enum class ContrastLevel(val wire: String) { MEDIUM("medium"), HIGH("high") }

/**
 * Photo / screen-lens parameters: profile.media of the web app (FilterParams), already range-checked.
 * Same ranges as sanitizeParams() in public/app/js/render/filter-math.js.
 */
data class LensParams(
    /** 3x3 row-major, applied in LINEAR RGB. */
    val colorMatrix: List<Double> = IDENTITY,
    val contrast: Double = 1.0,
    val brightness: Double = 1.0,
    val saturation: Double = 1.0,
    val sharpenAmount: Double = 0.0,
    /** Unsharp-mask sigma in CSS px (dp) at zoom 1. */
    val sharpenSigmaPx: Double = 1.0,
    val zoom: Double = 1.0,
    val warmth: Double = 0.0,
    val invert: Boolean = false,
) {
    val isIdentityMatrix: Boolean get() = colorMatrix.indices.all { kotlin.math.abs(colorMatrix[it] - IDENTITY[it]) <= 1e-6 }

    companion object {
        val IDENTITY: List<Double> = listOf(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
    }
}

/**
 * What the web app asks this phone to change. Display values only, never eye measurements.
 * Built by public/app/js/engine/android-link.js (format version 1, documented there).
 */
data class Recipe(
    val version: Int = Recipe.VERSION,
    val lang: String = "he",
    /** Android font scale the written guide recommends (1.0 = the default size). */
    val fontScale: Double = 1.0,
    /** Even the largest font step is smaller than the recommended size. */
    val fontExceeds: Boolean = false,
    /** Display size / Screen zoom steps above the default (0 = leave it). */
    val displaySteps: Int = 0,
    val displayMax: Boolean = false,
    val bold: Boolean = false,
    val contrast: ContrastLevel? = null,
    val cvd: Cvd? = null,
    val cvdIntensity: Double = 0.5,
    val dim: Boolean = false,
    val dark: Boolean = false,
    val magnification: Boolean = false,
    val lens: LensParams = LensParams(),
) {
    companion object {
        const val VERSION = 1
        const val MIN_FONT_SCALE = 0.85
        const val MAX_FONT_SCALE = 2.0
        const val MAX_DISPLAY_STEPS = 6
        /** Links longer than this are refused (the real ones are a few hundred characters). */
        const val MAX_QUERY_LENGTH = 4096
    }
}

sealed interface ParseResult {
    data class Ok(val recipe: Recipe) : ParseResult
    /** Made by a newer web app: ask the person to update this app. */
    data class TooNew(val version: Int) : ParseResult
    data class Invalid(val reason: String) : ParseResult
}

/** The Charset overloads of URLEncoder/URLDecoder need Android 13; the "UTF-8" ones work everywhere (minSdk 26). */
object RecipeCodec {
    /** Parse the query of seetuned://apply?… (raw, still percent-encoded). Never throws. */
    fun parse(rawQuery: String?): ParseResult {
        if (rawQuery.isNullOrEmpty()) return ParseResult.Invalid("empty")
        if (rawQuery.length > Recipe.MAX_QUERY_LENGTH) return ParseResult.Invalid("too long")
        return parse(splitQuery(rawQuery))
    }

    fun parse(q: Map<String, String>): ParseResult {
        val version = q["v"]?.trim()?.toIntOrNull() ?: return ParseResult.Invalid("no version")
        if (version < 1) return ParseResult.Invalid("bad version")
        if (version > Recipe.VERSION) return ParseResult.TooNew(version)
        fun flag(k: String) = q[k] == "1"
        fun num(k: String, fallback: Double, lo: Double, hi: Double): Double {
            val v = q[k]?.trim()?.toDoubleOrNull()
            return if (v == null || !v.isFinite()) fallback else v.coerceIn(lo, hi)
        }
        val matrix = q["lm"]?.split(',')?.map { it.trim().toDoubleOrNull() }
            ?.takeIf { m -> m.size == 9 && m.all { it != null && it.isFinite() } }
            ?.map { it!!.coerceIn(-8.0, 8.0) }
            ?: LensParams.IDENTITY
        val lens = LensParams(
            colorMatrix = matrix,
            contrast = num("lc", 1.0, 0.0, 5.0),
            brightness = num("lb", 1.0, 0.0, 5.0),
            saturation = num("ls", 1.0, 0.0, 5.0),
            sharpenAmount = num("lsa", 0.0, 0.0, 8.0),
            sharpenSigmaPx = num("lss", 1.0, 0.3, 12.0),
            zoom = num("lz", 1.0, 1.0, 8.0),
            warmth = num("lw", 0.0, 0.0, 1.0),
            invert = flag("linv"),
        )
        return ParseResult.Ok(
            Recipe(
                version = version,
                lang = if (q["lang"] == "en") "en" else "he",
                fontScale = num("font", 1.0, Recipe.MIN_FONT_SCALE, Recipe.MAX_FONT_SCALE),
                fontExceeds = flag("fontx"),
                displaySteps = q["ds"]?.trim()?.toIntOrNull()?.coerceIn(0, Recipe.MAX_DISPLAY_STEPS) ?: 0,
                displayMax = flag("dsmax"),
                bold = flag("bold"),
                contrast = ContrastLevel.entries.firstOrNull { it.wire == q["contrast"] },
                cvd = Cvd.entries.firstOrNull { it.wire == q["cvd"] },
                cvdIntensity = num("cvdi", 0.5, 0.0, 1.0),
                dim = flag("dim"),
                dark = flag("dark"),
                magnification = flag("mag"),
                lens = lens,
            ),
        )
    }

    /** The inverse of [parse] (used to keep the last recipe on the device). */
    fun encode(r: Recipe): String {
        val q = linkedMapOf<String, String>()
        q["v"] = r.version.toString()
        q["lang"] = r.lang
        q["font"] = fmt(r.fontScale)
        if (r.fontExceeds) q["fontx"] = "1"
        if (r.displaySteps > 0) q["ds"] = r.displaySteps.toString()
        if (r.displayMax) q["dsmax"] = "1"
        if (r.bold) q["bold"] = "1"
        r.contrast?.let { q["contrast"] = it.wire }
        r.cvd?.let { q["cvd"] = it.wire; q["cvdi"] = fmt(r.cvdIntensity) }
        if (r.dim) q["dim"] = "1"
        if (r.dark) q["dark"] = "1"
        if (r.magnification) q["mag"] = "1"
        val l = r.lens
        if (!l.isIdentityMatrix) q["lm"] = l.colorMatrix.joinToString(",") { fmt(it) }
        if (l.contrast != 1.0) q["lc"] = fmt(l.contrast)
        if (l.brightness != 1.0) q["lb"] = fmt(l.brightness)
        if (l.saturation != 1.0) q["ls"] = fmt(l.saturation)
        if (l.sharpenAmount > 0.0) { q["lsa"] = fmt(l.sharpenAmount); q["lss"] = fmt(l.sharpenSigmaPx) }
        if (l.zoom != 1.0) q["lz"] = fmt(l.zoom)
        if (l.warmth > 0.0) q["lw"] = fmt(l.warmth)
        if (l.invert) q["linv"] = "1"
        return q.entries.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
    }

    /** a=1&b=x%2Cy → {a: "1", b: "x,y"}. The first occurrence of a key wins; malformed escapes keep the raw text. */
    fun splitQuery(raw: String): Map<String, String> {
        val out = linkedMapOf<String, String>()
        for (part in raw.removePrefix("?").split('&')) {
            if (part.isEmpty()) continue
            val i = part.indexOf('=')
            val k = decode(if (i >= 0) part.substring(0, i) else part)
            val v = if (i >= 0) decode(part.substring(i + 1)) else ""
            if (k.isNotEmpty() && k !in out) out[k] = v
        }
        return out
    }

    private fun decode(s: String): String =
        try { URLDecoder.decode(s, "UTF-8") } catch (_: IllegalArgumentException) { s }

    private fun fmt(v: Double): String {
        val r = Math.round(v * 10000.0) / 10000.0
        return if (r == r.toLong().toDouble()) r.toLong().toString() else r.toString()
    }
}

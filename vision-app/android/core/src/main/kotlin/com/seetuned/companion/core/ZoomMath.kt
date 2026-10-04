package com.seetuned.companion.core

import kotlin.math.max
import kotlin.math.min

/**
 * Pan / zoom of the lens image inside its view. scale = view px per image px; (tx, ty) = where the image's
 * top-left corner lands in the view. The image always covers the view along an axis where it is larger,
 * and is centred along an axis where it is smaller.
 */
data class ZoomState(val scale: Double, val tx: Double, val ty: Double)

data class Viewport(val viewW: Double, val viewH: Double, val imageW: Double, val imageH: Double) {
    val valid: Boolean get() = viewW > 0 && viewH > 0 && imageW > 0 && imageH > 0
}

object ZoomMath {
    /** The lens never zooms beyond 8× the "fit" size (the web magnifier's limit too). */
    const val MAX_ZOOM = 8.0

    fun fitScale(v: Viewport): Double = if (!v.valid) 1.0 else min(v.viewW / v.imageW, v.viewH / v.imageH)

    fun clampScale(scale: Double, v: Viewport): Double {
        val fit = fitScale(v)
        return if (!scale.isFinite()) fit else scale.coerceIn(fit, fit * MAX_ZOOM)
    }

    fun clamp(s: ZoomState, v: Viewport): ZoomState {
        val scale = clampScale(s.scale, v)
        return ZoomState(scale, clampAxis(s.tx, v.viewW, v.imageW * scale), clampAxis(s.ty, v.viewH, v.imageH * scale))
    }

    private fun clampAxis(t: Double, view: Double, content: Double): Double =
        if (content <= view) (view - content) / 2 else t.coerceIn(view - content, 0.0).let { if (it.isFinite()) it else 0.0 }

    /** Start at [zoom] × fit, centred on the middle of the image. */
    fun initial(v: Viewport, zoom: Double): ZoomState {
        val scale = clampScale(fitScale(v) * max(1.0, if (zoom.isFinite()) zoom else 1.0), v)
        return clamp(ZoomState(scale, (v.viewW - v.imageW * scale) / 2, (v.viewH - v.imageH * scale) / 2), v)
    }

    /** Multiply the scale by [factor], keeping the image point under (fx, fy) in place. */
    fun zoomAt(s: ZoomState, factor: Double, fx: Double, fy: Double, v: Viewport): ZoomState {
        val scale = clampScale(s.scale * factor, v)
        val k = scale / s.scale
        return clamp(ZoomState(scale, fx - (fx - s.tx) * k, fy - (fy - s.ty) * k), v)
    }

    fun pan(s: ZoomState, dx: Double, dy: Double, v: Viewport): ZoomState = clamp(ZoomState(s.scale, s.tx + dx, s.ty + dy), v)

    /** Double tap: zoom in to [zoom] × fit at the tap, or back out to fit when already zoomed in. */
    fun toggle(s: ZoomState, fx: Double, fy: Double, v: Viewport, zoom: Double): ZoomState {
        val fit = fitScale(v)
        val target = fit * max(2.0, if (zoom.isFinite()) zoom else 2.0)
        return if (s.scale > fit * 1.05) clamp(ZoomState(fit, 0.0, 0.0), v) else zoomAt(s, target / s.scale, fx, fy, v)
    }
}

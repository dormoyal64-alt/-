package com.seetuned.companion.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ZoomMathTest {
    private val screen = Viewport(1080.0, 2340.0, 1080.0, 2340.0)
    private val eps = 1e-9

    @Test fun initialZoomIsCentred() {
        val s = ZoomMath.initial(screen, 2.0)
        assertEquals(2.0, s.scale, eps)
        assertEquals(-540.0, s.tx, eps)
        assertEquals(-1170.0, s.ty, eps)
        assertEquals(ZoomState(1.0, 0.0, 0.0), ZoomMath.initial(screen, 1.0))
        assertEquals(ZoomState(1.0, 0.0, 0.0), ZoomMath.initial(screen, Double.NaN))
        assertEquals(ZoomMath.MAX_ZOOM, ZoomMath.initial(screen, 50.0).scale, eps)
    }

    @Test fun panStaysInsideTheImage() {
        val s = ZoomMath.initial(screen, 2.0)
        val far = ZoomMath.pan(s, 10_000.0, 10_000.0, screen)
        assertEquals(0.0, far.tx, eps)
        assertEquals(0.0, far.ty, eps)
        val other = ZoomMath.pan(s, -10_000.0, -10_000.0, screen)
        assertEquals(1080.0 - 2160.0, other.tx, eps)
        assertEquals(2340.0 - 4680.0, other.ty, eps)
    }

    @Test fun zoomKeepsTheFocusPointStill() {
        val s = ZoomMath.initial(screen, 2.0)
        val fx = 300.0
        val fy = 900.0
        val imgX = (fx - s.tx) / s.scale
        val imgY = (fy - s.ty) / s.scale
        val z = ZoomMath.zoomAt(s, 1.5, fx, fy, screen)
        assertEquals(3.0, z.scale, eps)
        assertEquals(fx, z.tx + imgX * z.scale, 1e-6)
        assertEquals(fy, z.ty + imgY * z.scale, 1e-6)
    }

    @Test fun cannotZoomOutPastFitAndFitIsCentred() {
        val wide = Viewport(1000.0, 2000.0, 2000.0, 1000.0) // landscape image in a portrait view
        assertEquals(0.5, ZoomMath.fitScale(wide), eps)
        val s = ZoomMath.zoomAt(ZoomState(0.5, 0.0, 0.0), 0.1, 0.0, 0.0, wide)
        assertEquals(0.5, s.scale, eps)
        assertEquals(0.0, s.tx, eps)
        assertEquals((2000.0 - 500.0) / 2, s.ty, eps)
    }

    @Test fun doubleTapTogglesBetweenFitAndZoom() {
        val fit = ZoomState(1.0, 0.0, 0.0)
        val zoomed = ZoomMath.toggle(fit, 540.0, 1170.0, screen, 3.0)
        assertEquals(3.0, zoomed.scale, eps)
        assertEquals(fit, ZoomMath.toggle(zoomed, 10.0, 10.0, screen, 3.0))
        // A profile without zoom still doubles on double tap.
        assertEquals(2.0, ZoomMath.toggle(fit, 0.0, 0.0, screen, 1.0).scale, eps)
    }

    @Test fun invalidViewportDoesNotProduceNaN() {
        val bad = Viewport(0.0, 0.0, 0.0, 0.0)
        val s = ZoomMath.initial(bad, 2.0)
        assertTrue(s.scale.isFinite() && s.tx.isFinite() && s.ty.isFinite())
    }
}

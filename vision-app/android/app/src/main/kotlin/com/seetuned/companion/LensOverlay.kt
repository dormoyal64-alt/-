package com.seetuned.companion

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi
import com.seetuned.companion.core.LensMath
import com.seetuned.companion.core.LensParams
import com.seetuned.companion.core.Strings
import com.seetuned.companion.core.Viewport
import com.seetuned.companion.core.ZoomMath
import com.seetuned.companion.core.ZoomState
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The lens window: the screenshot, processed with the profile on background threads, shown full screen above every
 * app (TYPE_ACCESSIBILITY_OVERLAY) with pinch-zoom, drag and double-tap. "Compare" flips to the original picture.
 * Close or Back removes it; nothing is kept.
 */
@RequiresApi(30)
class LensOverlay(
    private val service: AccessibilityService,
    private val original: Bitmap,
    private val params: LensParams,
    private val t: Strings.T,
    private val rtl: Boolean,
    private val onClosed: () -> Unit,
) {
    enum class State { PREPARING, READY, CLOSED }

    @Volatile var state: State = State.PREPARING
        private set

    /** The processed picture once READY (the instrumented tests compare it with [original]). */
    @Volatile var processed: Bitmap? = null
        private set

    val source: Bitmap get() = original

    private val main = Handler(Looper.getMainLooper())
    private val wm = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val ui = Ui(service, Palette.of(service))
    private val lens = LensView(service, params.zoom)
    private val preparing = ui.text(t("lens.preparing"), 20f, bold = true, color = Color.WHITE).apply { gravity = Gravity.CENTER }
    private var showingOriginal = false
    private var unregisterBack: (() -> Unit)? = null
    private val compare = ui.button(t("lens.original")) { toggleCompare() }.apply { visibility = View.GONE }
    private val root = object : FrameLayout(service) {
        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                if (event.action == KeyEvent.ACTION_UP) dismiss()
                return true
            }
            return super.dispatchKeyEvent(event)
        }
    }

    fun show() {
        root.setBackgroundColor(Color.BLACK)
        root.layoutDirection = if (rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        root.isFocusableInTouchMode = true
        lens.setBitmap(original)
        root.addView(lens, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(preparing, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))

        val close = ui.button(t("lens.close"), primary = true) { dismiss() }.apply { tag = "lensClose" }
        val top = LinearLayout(service).apply {
            gravity = Gravity.END
            setPadding(ui.dp(12), ui.dp(12), ui.dp(12), ui.dp(12))
            addView(close)
        }
        val hint = ui.text(t("lens.hint") + "\n" + t("lens.secure"), 15f, color = Color.WHITE)
        val bottom = LinearLayout(service).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(12))
            background = GradientDrawable().apply { setColor(0xCC000000.toInt()) }
            addView(compare, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(hint, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = ui.dp(8) })
        }
        root.addView(top, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        root.addView(bottom, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        // Keep the buttons clear of the status bar, the camera cut-out and the navigation bar.
        root.setOnApplyWindowInsetsListener { _, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            top.setPadding(ui.dp(12), ui.dp(12) + bars.top, ui.dp(12), ui.dp(12))
            bottom.setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(12) + bars.bottom)
            insets
        }

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.OPAQUE,
        ).apply { layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS }
        wm.addView(root, lp)
        root.requestFocus()
        // Back: key events on older versions (dispatchKeyEvent above); with predictive back (Android 13+ when the
        // app opts in, and by default from Android 16) the window's back dispatcher instead.
        if (Build.VERSION.SDK_INT >= 33) {
            root.findOnBackInvokedDispatcher()?.let { d ->
                val cb = OnBackInvokedCallback { dismiss() }
                d.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_OVERLAY, cb)
                unregisterBack = { d.unregisterOnBackInvokedCallback(cb) }
            }
        }
        process()
    }

    private fun process() {
        if (isNeutral(params)) { ready(original); return }
        val density = service.resources.displayMetrics.density.toDouble()
        val threads = Runtime.getRuntime().availableProcessors().coerceIn(1, 4)
        Thread({
            val pool = Executors.newFixedThreadPool(threads)
            try {
                val w = original.width
                val h = original.height
                val px = IntArray(w * h)
                original.getPixels(px, 0, w, 0, 0, w, h)
                val runner = LensMath.RowRunner { rows, body ->
                    val chunk = (rows + threads * 2 - 1) / (threads * 2)
                    (0 until rows step chunk).map { s -> pool.submit { body(s until minOf(rows, s + chunk)) } }.forEach { it.get(30, TimeUnit.SECONDS) }
                }
                LensMath.process(px, w, h, params, params.sharpenSigmaPx * density, runner)
                val out = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
                main.post { if (state == State.CLOSED) out.recycle() else ready(out) }
            } catch (e: Throwable) {
                // Out of memory or a timeout: show the picture unprocessed rather than nothing.
                main.post { if (state != State.CLOSED) ready(original) }
            } finally {
                pool.shutdownNow()
            }
        }, "SeeTunedLens").start()
    }

    private fun ready(bitmap: Bitmap) {
        processed = bitmap
        lens.setBitmap(bitmap, keepView = true)
        preparing.visibility = View.GONE
        if (bitmap !== original) compare.visibility = View.VISIBLE
        state = State.READY
    }

    private fun toggleCompare() {
        val p = processed ?: return
        showingOriginal = !showingOriginal
        lens.setBitmap(if (showingOriginal) original else p, keepView = true)
        compare.text = t(if (showingOriginal) "lens.enhanced" else "lens.original")
    }

    fun dismiss() {
        if (state == State.CLOSED) return
        state = State.CLOSED
        unregisterBack?.invoke()
        unregisterBack = null
        try { wm.removeView(root) } catch (_: IllegalArgumentException) { /* already gone */ }
        onClosed()
    }

    companion object {
        fun isNeutral(p: LensParams): Boolean =
            p.isIdentityMatrix && p.contrast == 1.0 && p.brightness == 1.0 && p.saturation == 1.0 &&
                p.sharpenAmount == 0.0 && p.warmth == 0.0 && !p.invert
    }
}

/** Shows a bitmap with pinch-zoom, drag and double-tap (core/ZoomMath does the arithmetic). */
@SuppressLint("ViewConstructor")
class LensView(context: Context, private val zoom: Double) : View(context) {
    private var bitmap: Bitmap? = null
    private var zs: ZoomState? = null
    private val m = Matrix()
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)

    private fun viewport(): Viewport? {
        val b = bitmap ?: return null
        return Viewport(width.toDouble(), height.toDouble(), b.width.toDouble(), b.height.toDouble()).takeIf { it.valid }
    }

    fun setBitmap(b: Bitmap, keepView: Boolean = false) {
        val sameSize = bitmap?.let { it.width == b.width && it.height == b.height } ?: false
        bitmap = b
        if (!(keepView && sameSize)) zs = viewport()?.let { ZoomMath.initial(it, zoom) }
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        zs = viewport()?.let { ZoomMath.initial(it, zoom) }
    }

    override fun onDraw(canvas: android.graphics.Canvas) {
        val b = bitmap ?: return
        val s = zs ?: return
        m.setScale(s.scale.toFloat(), s.scale.toFloat())
        m.postTranslate(s.tx.toFloat(), s.ty.toFloat())
        canvas.drawBitmap(b, m, paint)
    }

    private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(d: ScaleGestureDetector): Boolean {
            val v = viewport() ?: return false
            zs = zs?.let { ZoomMath.zoomAt(it, d.scaleFactor.toDouble(), d.focusX.toDouble(), d.focusY.toDouble(), v) }
            invalidate()
            return true
        }
    })

    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent): Boolean = true

        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
            val v = viewport() ?: return false
            zs = zs?.let { ZoomMath.pan(it, -dx.toDouble(), -dy.toDouble(), v) }
            invalidate()
            return true
        }

        override fun onDoubleTap(e: MotionEvent): Boolean {
            val v = viewport() ?: return false
            zs = zs?.let { ZoomMath.toggle(it, e.x.toDouble(), e.y.toDouble(), v, zoom) }
            invalidate()
            return true
        }
    })

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        if (!scaleDetector.isInProgress) gestures.onTouchEvent(event)
        return true
    }
}

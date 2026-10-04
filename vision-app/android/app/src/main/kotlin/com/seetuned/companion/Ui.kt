package com.seetuned.companion

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Colours of the web app (css/base.css), light and dark. */
data class Palette(
    val bg: Int, val surface: Int, val ink: Int, val muted: Int, val line: Int,
    val primary: Int, val onPrimary: Int, val success: Int, val noteBg: Int,
) {
    companion object {
        fun of(context: Context): Palette {
            val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
            return if (night) {
                Palette(c("#0b1220"), c("#121c2e"), c("#e8eef6"), c("#a9b6c8"), c("#2b3a55"), c("#3cc7bd"), c("#06201e"), c("#7ddc98"), c("#16302f"))
            } else {
                Palette(c("#f5f8fb"), c("#ffffff"), c("#0f1b2d"), c("#4a5a70"), c("#cfd9e5"), c("#0a6b66"), c("#ffffff"), c("#1b7a3a"), c("#e3f1ef"))
            }
        }

        private fun c(hex: String) = Color.parseColor(hex)
    }
}

/**
 * Small view builders so every screen looks the same: text in sp (it follows the font size this app changes),
 * touch targets of at least 52 dp, high-contrast colours, headings marked for screen readers.
 */
class Ui(val context: Context, val p: Palette = Palette.of(context)) {
    fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), context.resources.displayMetrics).toInt()

    fun column(gap: Int = 12): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
        dividerDrawable = GradientDrawable().apply { setSize(0, dp(gap)) }
    }

    fun text(s: CharSequence, sizeSp: Float = 17f, bold: Boolean = false, color: Int = p.ink): TextView = TextView(context).apply {
        text = s
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setLineSpacing(0f, 1.25f)
        textAlignment = View.TEXT_ALIGNMENT_VIEW_START
    }

    fun heading(s: CharSequence, sizeSp: Float = 21f): TextView = text(s, sizeSp, bold = true).apply {
        if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
    }

    fun button(label: String, primary: Boolean = false, onClick: () -> Unit): Button = Button(context).apply {
        text = label
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        setTypeface(typeface, Typeface.BOLD)
        minHeight = dp(52)
        minimumHeight = dp(52)
        setPadding(dp(16), dp(10), dp(16), dp(10))
        ellipsize = null
        setTextColor(if (primary) p.onPrimary else p.primary)
        background = GradientDrawable().apply {
            cornerRadius = dp(14).toFloat()
            setColor(if (primary) p.primary else p.surface)
            setStroke(dp(2), p.primary)
        }
        stateListAnimator = null
        setOnClickListener { onClick() }
    }

    fun card(vararg children: View?, background: Int = p.surface): LinearLayout = column(10).apply {
        setPadding(dp(16), dp(16), dp(16), dp(16))
        this.background = GradientDrawable().apply {
            cornerRadius = dp(16).toFloat()
            setColor(background)
            setStroke(dp(1), p.line)
        }
        children.filterNotNull().forEach { addView(it, matchWidth()) }
    }

    fun matchWidth(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

    /** "Label: value" on one line, the label bold. */
    fun labelled(label: String, value: String): TextView = text(TextUtils.concat(bold(label), " ", value))

    private fun bold(s: String): CharSequence = android.text.SpannableString(s).apply {
        setSpan(android.text.style.StyleSpan(Typeface.BOLD), 0, s.length, 0)
    }

    fun status(s: String, ok: Boolean): TextView = text(s, 16f, bold = true, color = if (ok) p.success else p.muted).apply {
        gravity = Gravity.START
    }
}

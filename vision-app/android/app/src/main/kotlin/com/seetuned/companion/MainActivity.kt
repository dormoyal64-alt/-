package com.seetuned.companion

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.seetuned.companion.core.ItemId
import com.seetuned.companion.core.Mechanism
import com.seetuned.companion.core.ParseResult
import com.seetuned.companion.core.PlanItem
import com.seetuned.companion.core.Planner
import com.seetuned.companion.core.Recipe
import com.seetuned.companion.core.RecipeCodec
import com.seetuned.companion.core.Screen
import com.seetuned.companion.core.Strings
import java.util.Locale
import kotlin.math.roundToInt

/**
 * The one screen of the app. Opened by the web app's link (seetuned://apply?…) or from the launcher (then it shows
 * the last recipe it received). Lists what changes on the phone, applies what it may, opens the right settings
 * screen for the rest, turns on the lens, and restores the original settings.
 */
class MainActivity : Activity() {
    private lateinit var store: Store
    private lateinit var settings: SystemSettings
    private var linkProblem: String? = null
    private var message: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        settings = SystemSettings(this, store)
        if (savedInstanceState == null) handleIntent(intent) else {
            linkProblem = savedInstanceState.getString(STATE_PROBLEM)
            message = savedInstanceState.getString(STATE_MESSAGE)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        message = null
        handleIntent(intent)
        render()
    }

    override fun onResume() {
        super.onResume()
        // Back from "Modify system settings": apply right away if access was given (one tap for the person).
        val pending = store.pendingApply
        store.pendingApply = false
        if (pending && settings.canWriteSystem()) applyAll() else render()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_PROBLEM, linkProblem)
        outState.putString(STATE_MESSAGE, message)
    }

    private fun handleIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (intent.action != Intent.ACTION_VIEW || data.scheme != "seetuned" || data.host != "apply") return
        linkProblem = when (val r = RecipeCodec.parse(data.encodedQuery)) {
            is ParseResult.Ok -> { store.recipe = r.recipe; null }
            is ParseResult.TooNew -> "state.tooNew"
            is ParseResult.Invalid -> "state.invalid"
        }
    }

    private fun lang(recipe: Recipe?): String =
        recipe?.lang ?: if (Locale.getDefault().language in setOf("he", "iw")) "he" else "en"

    private fun render() {
        val recipe = store.recipe
        val lang = lang(recipe)
        val t = Strings.of(lang)
        val ui = Ui(this)
        val rtl = lang == "he"
        val col = ui.column(16).apply {
            setPadding(ui.dp(16), ui.dp(20), ui.dp(16), ui.dp(32))
            layoutDirection = if (rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        }
        fun add(v: View?) { if (v != null) col.addView(v, ui.matchWidth()) }

        add(ui.heading(t("app.title"), 28f))
        add(ui.text(t("app.subtitle"), color = ui.p.muted))
        linkProblem?.let { add(ui.card(ui.text(t(it)), background = ui.p.noteBg)) }
        message?.let { msg ->
            add(ui.card(ui.text(msg).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }, background = ui.p.noteBg).apply { tag = TAG_MESSAGE })
        }

        if (recipe == null) {
            add(ui.card(ui.text(t("state.noRecipe"))))
            add(ui.text(t("footer.disclaimer"), 14f, color = ui.p.muted))
            show(col, ui, rtl)
            return
        }

        val device = settings.device()
        val access = settings.access()
        val plan = Planner.plan(recipe, device, access)
        add(ui.text(t("state.received"), color = ui.p.muted))

        if (plan.any { it.mechanism == Mechanism.SYSTEM_WRITE } && !access.canWriteSystem) {
            add(ui.card(
                ui.heading(t("access.title"), 19f),
                ui.text(t("access.body")),
                ui.button(t("access.allow"), primary = true) { askWriteAccess() },
            ))
        }
        add(ui.button(t("apply.all"), primary = true) { applyAll() }.apply { tag = TAG_APPLY_ALL })

        add(ui.heading(t("items.title")))
        val os = if (device.samsung) "samsung" else "android"
        for (item in plan) add(itemCard(item, recipe, ui, t, os, access.canWriteSystem, access.lensEnabled, device.sdk))

        if (plan.any { it.secureWrites.isNotEmpty() }) {
            add(if (access.canWriteSecure) ui.card(ui.text(t("advanced.granted"))) else ui.card(
                ui.heading(t("advanced.title"), 18f),
                ui.text(t("advanced.body")),
                ui.text(adbGrant(packageName), 15f).apply {
                    setTextIsSelectable(true)
                    typeface = android.graphics.Typeface.MONOSPACE
                    textDirection = View.TEXT_DIRECTION_LTR
                },
                ui.button(t("advanced.copy")) {
                    getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("adb", adbGrant(packageName)))
                    message = t("advanced.copied")
                    render()
                },
            ))
        }

        if (!settings.journal().isEmpty) {
            add(ui.card(
                ui.heading(t("restore.title"), 18f),
                ui.text(t("restore.body")),
                ui.button(t("restore.button")) { restore() }.apply { tag = TAG_RESTORE },
            ))
        }
        add(ui.text(t("footer.disclaimer"), 14f, color = ui.p.muted))
        show(col, ui, rtl)
    }

    private fun show(col: LinearLayout, ui: Ui, rtl: Boolean) {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(ui.p.bg)
            isFillViewport = true
            layoutDirection = if (rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
            addView(col)
        }
        // Android 15 draws apps edge to edge: keep the content clear of the status and navigation bars.
        val top = col.paddingTop
        val bottom = col.paddingBottom
        scroll.setOnApplyWindowInsetsListener { _, insets ->
            val (barTop, barBottom) = if (Build.VERSION.SDK_INT >= 30) {
                insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()).let { it.top to it.bottom }
            } else {
                @Suppress("DEPRECATION")
                insets.systemWindowInsetTop to insets.systemWindowInsetBottom
            }
            col.setPadding(col.paddingLeft, top + barTop, col.paddingRight, bottom + barBottom)
            insets
        }
        setContentView(scroll)
        window.decorView.layoutDirection = scroll.layoutDirection
    }

    private fun itemCard(
        item: PlanItem, recipe: Recipe, ui: Ui, t: Strings.T, os: String,
        canWriteSystem: Boolean, lensEnabled: Boolean, sdk: Int,
    ): View {
        val id = item.id
        val pct = (item.fontScale * 100).roundToInt()
        val option = item.cvd?.let { t("option.$os.${it.wire}") } ?: ""
        val level = t(if (recipe.contrast == com.seetuned.companion.core.ContrastLevel.HIGH) "level.high" else "level.medium")
        val value: String? = when (id) {
            ItemId.TEXT_SIZE -> t("value.text", "pct" to pct)
            ItemId.DISPLAY_SIZE -> if (item.displayMax) t("value.displayMax") else t("value.display", "n" to item.displaySteps)
            ItemId.COLOR -> option
            ItemId.DARK -> t("value.dark")
            ItemId.LENS -> null
            else -> t("value.on")
        }
        val applied = Planner.isApplied(item) { table, key -> settings.read(table, key) }
        val status: TextView = when (item.mechanism) {
            Mechanism.SYSTEM_WRITE -> when {
                applied -> ui.status("✓ " + t("status.applied"), ok = true)
                canWriteSystem -> ui.status(t("status.pending"), ok = false)
                else -> ui.status(t("status.needsAccess"), ok = false)
            }
            Mechanism.SECURE_WRITE -> if (applied) ui.status("✓ " + t("status.applied"), ok = true)
                else ui.status(t(if (item.recommended) "status.pending" else "status.optional"), ok = false)
            Mechanism.GUIDED -> ui.status(t(if (item.recommended) "status.guided" else "status.optional"), ok = false)
            Mechanism.LENS -> if (lensEnabled) ui.status("✓ " + t("status.lensOn"), ok = true) else ui.status(t("status.lensOff"), ok = false)
        }
        val card = ui.card(ui.heading(t("item.${id.name}.title"), 18f))
        fun add(v: View) = card.addView(v, ui.matchWidth())
        card.tag = "item:${id.name}"
        if (value != null) add(ui.labelled(t("value.label"), value))
        add(status)
        val cap = (Planner.maxFontScale(sdk) * 100).roundToInt()
        for (note in item.notes) add(ui.text(t("note.${note.name}", "max" to cap), 16f, color = ui.p.muted))
        when (item.mechanism) {
            Mechanism.GUIDED -> {
                val key = "where.$os.${id.name}" + if (id == ItemId.DISPLAY_SIZE && item.displayMax) "_MAX" else ""
                add(ui.text(t(key, "pct" to pct, "n" to item.displaySteps, "option" to option, "level" to level), 16f))
                item.screen?.let { screen -> add(ui.button(t("button.open")) { ScreenIntents.open(this, screen) }) }
            }
            Mechanism.SECURE_WRITE -> if (!item.recommended && !applied) add(ui.button(t("apply.one")) { applyItem(item) })
            Mechanism.LENS -> {
                add(ui.text(t("lens.body"), 16f))
                if (!lensEnabled) add(ui.button(t("lens.enable")) { enableLens() }.apply { tag = TAG_LENS })
            }
            Mechanism.SYSTEM_WRITE -> Unit
        }
        return card
    }

    private fun currentPlan(): List<PlanItem> {
        val recipe = store.recipe ?: return emptyList()
        return Planner.plan(recipe, settings.device(), settings.access())
    }

    private fun t(): Strings.T = Strings.of(lang(store.recipe))

    private fun askWriteAccess() {
        store.pendingApply = true
        ScreenIntents.openFirst(this, listOf(ScreenIntents.writeSettings(this)))
    }

    private fun applyAll() {
        val plan = currentPlan()
        val access = settings.access()
        if (plan.any { it.mechanism == Mechanism.SYSTEM_WRITE } && !access.canWriteSystem) {
            askWriteAccess()
            return
        }
        val writes = Planner.automaticWrites(plan, access)
        message = if (writes.isEmpty()) t()("apply.nothing") else {
            val r = settings.apply(writes)
            val n = plan.count { item -> item.writes.isNotEmpty() && r.written.containsAll(item.writes) }
            if (r.failed.isEmpty()) t()("apply.done", "n" to n) else t()("apply.failed")
        }
        render()
    }

    private fun applyItem(item: PlanItem) {
        val r = settings.apply(item.writes)
        message = if (r.failed.isEmpty()) t()("apply.done", "n" to 1) else t()("apply.failed")
        render()
    }

    private fun restore() {
        val r = settings.restore()
        message = t()(if (r.failed.isEmpty()) "restore.done" else "restore.partial")
        render()
    }

    private fun enableLens() {
        val t = t()
        val go = {
            store.lensDisclosureAccepted = true
            message = t("lens.howTo")
            render()
            ScreenIntents.open(this, Screen.LENS_SERVICE)
        }
        if (store.lensDisclosureAccepted) { go(); return }
        AlertDialog.Builder(this)
            .setTitle(t("lens.disclosure.title"))
            .setMessage(t("lens.disclosure.body"))
            .setPositiveButton(t("lens.disclosure.agree")) { _, _ -> go() }
            .setNegativeButton(t("lens.disclosure.cancel"), null)
            .show()
    }

    companion object {
        fun adbGrant(pkg: String) = "adb shell pm grant $pkg android.permission.WRITE_SECURE_SETTINGS"
        const val TAG_APPLY_ALL = "applyAll"
        const val TAG_RESTORE = "restore"
        const val TAG_LENS = "enableLens"
        const val TAG_MESSAGE = "message"
        private const val STATE_PROBLEM = "linkProblem"
        private const val STATE_MESSAGE = "message"
    }
}

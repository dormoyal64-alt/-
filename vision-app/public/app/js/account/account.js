// @ts-check
/**
 * #/account — email, plan & status, trial days left, renewal/end date, one-click cancel (confirm dialog stating when
 * access ends; "cancel now + full refund" inside the 14-day window), resume, explicit-consent renew for fixed-term
 * plans, invoices, logout and delete account. Handles #/account?checkout=success|cancel.
 */
import { h, delay } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { clearAllLocalData } from '../core/storage.js';
import { ACCOUNT_STRINGS } from './strings.js';
import { api, safeCheckoutUrl } from './api.js';
import { errorKey, isWrongPassword } from './errors.js';
import { trialDaysLeft, accessEndsAt, subscriptionActions, refundWindowOpen } from './entitlement.js';
import { planRenewal } from './paywall.js';
import { legalUrl } from '../shell/brand.js';
import { formatDate, formatShortDate, formatMinor } from '../shell/format.js';
import { icon } from '../shell/icons.js';
import { openDialog } from '../shell/dialog.js';
import {
  pageHeader, notice, card, infoList, actionButton, linkButton, setBusy, checkboxField, passwordField, radioGroup, spinner, formAlert,
} from '../shell/components.js';

/** @typedef {import('./entitlement.js').Entitlement} Entitlement */
/** @typedef {import('./api.js').Plan} Plan */
/** @typedef {import('./api.js').Invoice} Invoice */

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(ACCOUNT_STRINGS, ctx.lang);
  const lang = ctx.lang;
  const top = h('div', { class: 'va-stack', 'data-testid': 'account-notices' });
  const subHost = h('div', { class: 'va-stack' });
  const invoicesBody = h('div', { class: 'va-stack' }, spinner(ctx.t('loading')));
  /** @type {Plan[]|null} */
  let plans = null;
  /** @type {Invoice[]|null} */
  let invoices = null;

  const checkout = ctx.route.query.checkout;
  if (checkout) {
    // Drop the query so a reload doesn't repeat the message (replaceState fires no hashchange).
    history.replaceState(null, '', '#/account');
    if (checkout === 'success') void confirmCheckout();
    else if (checkout === 'cancel') {
      top.append(notice('info', t('account.checkoutCancel'), {
        role: 'status', testId: 'checkout-cancel', actions: [linkButton(t('account.checkoutRetry'), '#/paywall', { variant: 'secondary' })],
      }));
    }
  }

  const unsubscribe = ctx.store.subscribe((next, prev) => {
    if (next.entitlement !== prev.entitlement || next.online !== prev.online) renderSubscription();
  });

  async function confirmCheckout() {
    const pending = notice('info', t('account.checkoutPending'), { role: 'status', testId: 'checkout-pending' });
    top.prepend(pending);
    for (let i = 0; i < 8 && !ctx.signal.aborted; i++) {
      await ctx.shell.session.refresh();
      const e = ctx.store.get().entitlement;
      if (e && (e.status === 'active' || e.status === 'canceled') && e.hasAccess && e.plan) {
        pending.replaceWith(notice('success', t('account.checkoutSuccess'), { role: 'status', testId: 'checkout-success' }));
        ctx.shell.announce(t('account.checkoutSuccess'));
        void loadInvoices();
        return;
      }
      try { await delay(i < 3 ? 1500 : 3000, ctx.signal); } catch { return; }
    }
  }

  function renderSubscription() {
    const { user, entitlement: e, online, source } = ctx.store.get();
    const now = Date.now();
    const canAct = online && source !== 'cache';
    const end = accessEndsAt(e);
    const endDate = end ? formatDate(end, lang) : '';
    const acts = subscriptionActions(e, now);
    const renewal = e?.renewal === 'auto' || e?.renewal === 'manual' ? e.renewal : e?.plan ? planRenewalFor(e.plan) : null;

    /** @type {Array<[string, any]>} */
    const rows = [[t('account.email'), h('span', { dir: 'ltr', class: 'va-ltr' }, user?.email || '')]];
    rows.push([t('account.plan'), e?.plan ? h('span', null, t(`plan.${e.plan}`), ' · ', h('span', { class: 'va-muted' }, t(`plan.${e.plan}.sub`))) : t('account.noPlan')]);
    rows.push([t('account.status'), h('span', { class: `va-status va-status--${e?.status || 'expired'}`, 'data-testid': 'account-status' }, t(`status.${e?.status || 'expired'}`))]);

    let when = '';
    if (e?.status === 'trial') {
      const days = trialDaysLeft(e, now) ?? 0;
      when = t('account.trialLeft', { days, date: endDate });
    } else if (e && end) {
      if (!e.hasAccess || e.status === 'expired') when = t('account.endedOn', { date: endDate });
      else if (e.cancelAtPeriodEnd || e.status === 'canceled') when = t('account.accessUntil', { date: endDate });
      else if (renewal === 'auto') when = t('account.renewsOn', { date: endDate });
      else when = t('account.endsOn', { date: endDate });
    }
    if (when) rows.push([t('account.validity'), h('span', { 'data-testid': 'account-when' }, when)]);

    const actions = [];
    if (acts.needsPaymentFix) actions.push(linkButton(t('account.fixPayment'), '#/paywall', { testId: 'account-fix-payment' }));
    if (acts.canResume) actions.push(actionButton(t('account.resume'), { testId: 'account-resume', disabled: !canAct, onClick: (ev) => void resume(/** @type {HTMLButtonElement} */ (ev.currentTarget)) }));
    if (acts.canSubscribe) actions.push(linkButton(t('account.subscribe'), '#/paywall', { testId: 'account-subscribe', variant: e?.status === 'trial' ? 'secondary' : 'primary' }));
    if (acts.canCancel) actions.push(actionButton(t('account.cancel'), { variant: 'secondary', className: 'va-btn--danger-outline', testId: 'account-cancel', disabled: !canAct, onClick: (ev) => void cancel(/** @type {HTMLButtonElement} */ (ev.currentTarget), e) }));

    const parts = [
      infoList(rows, 'account-info'),
      e?.status === 'trial' ? h('p', { class: 'va-hint' }, t('account.trialNoCharge')) : null,
      acts.canCancel ? h('p', { class: 'va-hint' }, t('account.cancelNote')) : null,
    ];
    const cards = [card({ title: t('account.subTitle'), iconName: 'receipt', children: parts, actions, testId: 'account-subscription' })];
    const renewable = typeof e?.canRenew === 'boolean' ? e.canRenew : !!e?.plan && renewal === 'manual' && e.status !== 'trial';
    if (e?.plan && renewable) cards.push(renewCard(e, canAct));
    const offline = !canAct ? notice('warning', t('account.offline'), { testId: 'account-offline' }) : null;
    subHost.replaceChildren(...[offline, ...cards].filter(Boolean));
  }

  /** @param {string} planId @returns {'auto'|'manual'} */
  function planRenewalFor(planId) {
    const p = plans?.find((x) => x.id === planId);
    return p ? planRenewal(p) : planId === 'monthly' ? 'auto' : 'manual';
  }

  /** @param {Entitlement} e @param {boolean} canAct */
  function renewCard(e, canAct) {
    const name = t(`plan.${e.plan}`);
    const p = plans?.find((x) => x.id === e.plan);
    const alert = formAlert();
    const consent = checkboxField({
      name: 'renewConsent', testId: 'renew-consent',
      label: p ? t('account.renewConsent', { price: formatMinor(p.price, p.currency, lang), name }) : t('account.renewConsentGeneric', { name }),
      onChange: (on) => { if (on) consent.setError(null); },
    });
    const btn = actionButton(t('account.renew'), { testId: 'account-renew', disabled: !canAct, iconName: 'retest' });
    btn.addEventListener('click', async () => {
      alert.set(null);
      if (!consent.input.checked) { consent.setError(t('account.renewConsentMissing')); consent.input.focus(); return; }
      setBusy(btn, true);
      try {
        const res = await api.renew(/** @type {any} */ (e.plan));
        if (res?.url) {
          const url = safeCheckoutUrl(res.url, location.origin);
          if (url) { location.assign(url); return; }
        }
        if (res?.entitlement) {
          ctx.shell.session.setEntitlement(res.entitlement);
          ctx.shell.toast(t('account.renewed'), { kind: 'success' });
        }
      } catch (err) {
        if (!ctx.signal.aborted) alert.set(t(errorKey(err)));
      } finally {
        setBusy(btn, false);
      }
    });
    return card({ title: t('account.renewTitle'), iconName: 'retest', testId: 'account-renew-card', children: [h('p', { class: 'va-text' }, t('account.renewLead')), alert.el, consent.el], actions: [btn] });
  }

  /** @param {HTMLButtonElement} btn @param {Entitlement|null} e */
  async function cancel(btn, e) {
    const end = accessEndsAt(e);
    const date = end ? formatDate(end, lang) : '';
    const until = e && typeof e.refundEligibleUntil === 'string' ? Date.parse(e.refundEligibleUntil) : NaN;
    const refundable = e && 'refundEligibleUntil' in e
      ? Number.isFinite(until) && Date.now() <= until
      : refundWindowOpen(invoices, Date.now());
    const choice = /** @type {{mode: 'period_end'|'now'}} */ ({ mode: 'period_end' });
    const body = [date ? t('account.cancelConfirmBody', { date }) : t('account.cancelConfirmBodyNoDate')];
    if (refundable) {
      const group = radioGroup({
        legend: t('account.cancelMode.legend'), name: 'cancelMode', value: 'period_end', testId: 'cancel-mode',
        options: [
          { value: 'period_end', label: date ? t('account.cancelMode.periodEnd', { date }) : t('account.cancelMode.periodEndNoDate') },
          { value: 'now', label: t('account.cancelMode.now'), hint: t('account.cancelMode.nowHint') },
        ],
        onChange: (v) => { choice.mode = v === 'now' ? 'now' : 'period_end'; },
      });
      body.push(/** @type {any} */ (group.el));
    }
    const ok = await openDialog({
      title: t('account.cancelConfirmTitle'), body, testId: 'cancel-dialog', dismissValue: false, focusIndex: 0,
      actions: [
        { label: t('account.keep'), value: false, variant: 'secondary', testId: 'cancel-keep' },
        { label: t('account.cancelConfirm'), value: true, variant: 'danger', testId: 'cancel-confirm' },
      ],
    });
    if (!ok || ctx.signal.aborted) return;
    setBusy(btn, true);
    try {
      const mode = choice.mode;
      const res = await api.cancel(mode);
      if (res?.entitlement) ctx.shell.session.setEntitlement(res.entitlement);
      const newEnd = accessEndsAt(res?.entitlement);
      ctx.shell.toast(mode === 'now' ? t('account.canceledNow') : t('account.canceled', { date: newEnd ? formatDate(newEnd, lang) : date }), { kind: 'success' });
    } catch (err) {
      if (!ctx.signal.aborted) ctx.shell.toast(t(errorKey(err)), { kind: 'error' });
    } finally {
      if (btn.isConnected) setBusy(btn, false);
    }
  }

  /** @param {HTMLButtonElement} btn */
  async function resume(btn) {
    setBusy(btn, true);
    try {
      const res = await api.resume();
      if (res?.entitlement) ctx.shell.session.setEntitlement(res.entitlement);
      ctx.shell.toast(t('account.resumed'), { kind: 'success' });
    } catch (err) {
      if (!ctx.signal.aborted) ctx.shell.toast(t(errorKey(err)), { kind: 'error' });
    } finally {
      if (btn.isConnected) setBusy(btn, false);
    }
  }

  async function loadInvoices() {
    if (!ctx.store.get().online) { invoicesBody.replaceChildren(h('p', { class: 'va-hint' }, t('account.offline'))); return; }
    try {
      const res = await api.invoices(ctx.signal);
      if (ctx.signal.aborted) return;
      invoices = Array.isArray(res?.invoices) ? res.invoices : [];
      renderInvoices();
    } catch (err) {
      if (ctx.signal.aborted || /** @type {any} */ (err)?.name === 'AbortError') return;
      invoicesBody.replaceChildren(h('p', { class: 'va-hint' }, t('account.invoicesError')));
    }
  }

  function renderInvoices() {
    if (!invoices?.length) { invoicesBody.replaceChildren(h('p', { class: 'va-hint', 'data-testid': 'no-invoices' }, t('account.noInvoices'))); return; }
    invoicesBody.replaceChildren(h('ul', { class: 'va-list va-invoices', 'data-testid': 'invoices' }, invoices.map((inv) => {
      const date = formatShortDate(inv.issuedAt, lang);
      const amount = typeof inv.amount === 'number' ? formatMinor(inv.amount, inv.currency || 'ILS', lang) : '';
      const statusKey = inv.status ? `account.invoice.${inv.status}` : '';
      const statusText = statusKey && t(statusKey) !== statusKey ? t(statusKey) : inv.status || '';
      return h('li', { class: 'va-list__item va-invoice' },
        h('span', { class: 'va-invoice__date' }, date),
        h('span', { class: 'va-invoice__plan' }, inv.plan ? t(`plan.${inv.plan}`) : ''),
        h('span', { class: 'va-invoice__amount', dir: 'ltr' }, amount),
        h('span', { class: 'va-invoice__status' }, statusText),
        inv.url && safeCheckoutUrl(inv.url, location.origin)
          ? h('a', { class: 'va-icon-btn', href: safeCheckoutUrl(inv.url, location.origin), target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('account.invoiceDownload', { date }) }, icon('receipt'))
          : h('span', { class: 'va-invoice__nolink' }),
      );
    })));
  }

  async function logout() {
    try { await api.logout(); } catch { /* clear locally anyway */ }
    ctx.shell.session.clear();
    ctx.shell.toast(t('account.loggedOut'));
    ctx.navigate('/welcome', { replace: true });
  }

  async function deleteAccount() {
    const alert = formAlert();
    const pw = passwordField({ label: t('auth.password'), name: 'current-password', autocomplete: 'current-password', showLabel: t('auth.showPassword'), hideLabel: t('auth.hidePassword'), testId: 'delete-password' });
    const alsoLocal = checkboxField({ name: 'deleteLocal', label: t('account.deleteLocal'), checked: true, testId: 'delete-local' });
    const done = await openDialog({
      title: t('account.deleteDialogTitle'), testId: 'delete-dialog', dismissValue: false, focusIndex: 0,
      body: [t('account.deleteDialogBody'), alert.el, pw.el, alsoLocal.el],
      initialFocus: pw.input,
      actions: [
        { label: ctx.t('cancel'), value: false, variant: 'secondary', testId: 'delete-cancel' },
        { label: t('account.deleteConfirm'), value: true, variant: 'danger', submit: true, testId: 'delete-confirm' },
      ],
      onSubmit: async () => {
        alert.set(null);
        if (!pw.input.value) { pw.setError(t('v.passwordRequired')); pw.input.focus(); return false; }
        try {
          await api.deleteAccount(pw.input.value);
          return true;
        } catch (err) {
          if (isWrongPassword(err)) { pw.setError(t('err.wrongPassword')); pw.input.select(); } else alert.set(t(errorKey(err)));
          return false;
        }
      },
    });
    if (!done) return;
    const wipeLocal = alsoLocal.input.checked;
    ctx.shell.session.clear();
    if (wipeLocal) clearAllLocalData();
    ctx.shell.toast(t('account.deleted'), { kind: 'success' });
    ctx.navigate('/welcome', { replace: true });
  }

  renderSubscription();
  void loadInvoices();
  if (ctx.store.get().online) {
    api.plans(ctx.signal).then((res) => { plans = res?.plans || null; if (!ctx.signal.aborted) renderSubscription(); }).catch(() => { /* optional */ });
  }

  const { online, source } = ctx.store.get();
  const el = h('div', { class: 'va-page va-page--wide', 'data-testid': 'screen-account' },
    pageHeader({ title: t('account.title') }),
    top,
    h('div', { class: 'va-grid-2' },
      subHost,
      h('div', { class: 'va-stack' },
        card({ title: t('account.invoicesTitle'), iconName: 'receipt', children: invoicesBody, testId: 'account-invoices' }),
        card({
          title: t('account.moreTitle'), iconName: 'user',
          children: h('div', { class: 'va-stack' },
            actionButton(t('account.logout'), { variant: 'secondary', iconName: 'logout', testId: 'account-logout', onClick: () => void logout() }),
            h('nav', { class: 'va-footlinks', 'aria-label': t('account.legal') },
              h('a', { href: legalUrl('terms', lang) }, t('account.terms')),
              h('a', { href: legalUrl('privacy', lang) }, t('account.privacy')),
              h('a', { href: legalUrl('cancellation', lang) }, t('account.cancellation')),
            ),
          ),
        }),
        card({
          title: t('account.deleteTitle'), iconName: 'trash', className: 'va-card--danger',
          children: h('p', { class: 'va-text' }, t('account.deleteLead')),
          actions: [actionButton(t('account.delete'), { variant: 'danger', iconName: 'trash', testId: 'account-delete', disabled: !online || source === 'cache', onClick: () => void deleteAccount() })],
        }),
      ),
    ),
  );
  return { el, destroy: unsubscribe };
}

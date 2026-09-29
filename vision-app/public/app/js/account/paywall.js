// @ts-check
/**
 * #/paywall — three plan cards (VAT-inclusive total, price per month, savings, renewal terms), trial status,
 * secure-payment and cancellation notes. Choosing a plan -> POST /api/billing/checkout -> hosted payment page.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { ACCOUNT_STRINGS } from './strings.js';
import { api, safeCheckoutUrl } from './api.js';
import { errorKey } from './errors.js';
import { trialDaysLeft, hasEffectiveAccess } from './entitlement.js';
import { brandName, legalUrl } from '../shell/brand.js';
import { formatMinor } from '../shell/format.js';
import { icon } from '../shell/icons.js';
import { pageHeader, notice, spinner, actionButton, linkButton, setBusy, card } from '../shell/components.js';

/** @typedef {import('./api.js').Plan} Plan */

/** @param {Plan} p @returns {'auto'|'manual'} */
export function planRenewal(p) {
  return p.renewal === 'auto' || p.renewal === 'manual' ? p.renewal : p.id === 'monthly' ? 'auto' : 'manual';
}

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(ACCOUNT_STRINGS, ctx.lang);
  const { entitlement, online, source } = ctx.store.get();
  const brand = brandName(ctx.lang);
  const status = h('div', { class: 'va-stack' });
  const plansHost = h('div', { class: 'va-plans', 'data-testid': 'plans' }, spinner(ctx.t('loading')));
  const errorHost = h('div', { role: 'alert', class: 'va-stack' });

  // Trial / subscription status.
  const days = trialDaysLeft(entitlement, Date.now());
  if (!online || (source === 'cache' && !hasEffectiveAccess(entitlement, source, Date.now()))) {
    status.append(notice('warning', t('paywall.offlineCheck'), { testId: 'paywall-offline', actions: [actionButton(ctx.t('retry'), { variant: 'secondary', onClick: () => void recheck() })] }));
  } else if (entitlement?.status === 'trial' && entitlement.hasAccess && days !== null) {
    status.append(notice('info', days <= 0 ? t('paywall.trialLastDay') : t('paywall.trialLeft', { days }), { testId: 'paywall-trial', iconName: 'clock' }));
  } else if (entitlement?.status === 'trial' || (entitlement?.status === 'expired' && !entitlement.plan)) {
    status.append(notice('warning', t('paywall.expired', { brand }), { testId: 'paywall-expired' }));
  } else if (entitlement?.status === 'past_due') {
    status.append(notice('warning', t('paywall.pastDue'), { testId: 'paywall-pastdue' }));
  } else if (entitlement?.hasAccess && entitlement.status === 'active' && !entitlement.cancelAtPeriodEnd) {
    status.append(notice('info', t('paywall.active'), { actions: [linkButton(t('paywall.manage'), '#/account', { variant: 'secondary' })] }));
  } else if (entitlement && !entitlement.hasAccess) {
    status.append(notice('warning', t('paywall.ended'), { testId: 'paywall-expired' }));
  }

  async function recheck() {
    await ctx.shell.session.refresh();
    if (!ctx.signal.aborted) ctx.goDefault();
  }

  /** @param {Plan} p @param {boolean} best */
  function planCard(p, best) {
    const renewal = planRenewal(p);
    const name = t(`plan.${p.id}`);
    const btn = actionButton(t('plan.chooseShort'), { variant: best ? 'primary' : 'secondary', testId: `plan-${p.id}`, className: 'va-btn--block' });
    btn.setAttribute('aria-label', t('plan.choose', { name }));
    btn.addEventListener('click', () => void checkout(p, btn));
    const headingId = `plan-${p.id}-title`;
    return h('article', { class: `va-plan${best ? ' va-plan--best' : ''}`, 'aria-labelledby': headingId, 'data-testid': `plan-card-${p.id}` },
      best ? h('p', { class: 'va-plan__ribbon' }, icon('star', { size: 18 }), t('plan.best')) : null,
      h('h2', { class: 'va-plan__name', id: headingId }, name),
      h('p', { class: 'va-plan__sub' }, t(`plan.${p.id}.sub`)),
      h('p', { class: 'va-plan__price' }, h('span', { class: 'va-plan__amount', dir: 'ltr' }, formatMinor(p.price, p.currency, ctx.lang))),
      h('p', { class: 'va-plan__vat' }, t('plan.inclVat')),
      p.months > 1 ? h('p', { class: 'va-plan__permonth' }, t('plan.perMonth', { price: formatMinor(p.pricePerMonth, p.currency, ctx.lang) })) : null,
      p.savingsPercent > 0 ? h('p', { class: 'va-badge va-badge--save', 'data-testid': `plan-save-${p.id}` }, t('plan.save', { pct: p.savingsPercent })) : null,
      h('p', { class: 'va-plan__renew' }, icon(renewal === 'auto' ? 'retest' : 'clock', { size: 18 }), h('span', null, t(`plan.renew.${renewal}`))),
      btn,
    );
  }

  /** @param {Plan} p @param {HTMLButtonElement} btn */
  async function checkout(p, btn) {
    errorHost.replaceChildren();
    setBusy(btn, true);
    const label = /** @type {HTMLElement} */ (btn.lastElementChild);
    const original = label.textContent;
    label.textContent = t('plan.redirecting');
    ctx.shell.announce(t('plan.redirecting'));
    try {
      const res = await api.checkout(p.id);
      const url = safeCheckoutUrl(res?.url, location.origin);
      if (!url) throw Object.assign(new Error('bad checkout url'), { code: 'PROVIDER_ERROR' });
      location.assign(url);
    } catch (err) {
      if (ctx.signal.aborted) return;
      label.textContent = original;
      setBusy(btn, false);
      errorHost.replaceChildren(notice('danger', t(errorKey(err)), { testId: 'checkout-error' }));
      ctx.shell.announce(t(errorKey(err)), true);
    }
  }

  async function loadPlans() {
    plansHost.replaceChildren(spinner(ctx.t('loading')));
    try {
      const res = await api.plans(ctx.signal);
      if (ctx.signal.aborted) return;
      const plans = (res?.plans || []).slice().sort((a, b) => a.months - b.months);
      if (!plans.length) throw new Error('no plans');
      const bestId = plans.reduce((b, p) => (p.savingsPercent > (b?.savingsPercent ?? -1) ? p : b), plans[0]).id;
      plansHost.replaceChildren(...plans.map((p) => planCard(p, p.id === bestId && plans.length > 1)));
    } catch (err) {
      if (ctx.signal.aborted || /** @type {any} */ (err)?.name === 'AbortError') return;
      plansHost.replaceChildren(notice('warning', [t('paywall.loadError'), t(errorKey(err))], {
        testId: 'plans-error', actions: [actionButton(ctx.t('retry'), { variant: 'secondary', onClick: () => void loadPlans() })],
      }));
    }
  }
  void loadPlans();

  const el = h('div', { class: 'va-page va-page--wide', 'data-testid': 'screen-paywall' },
    pageHeader({ title: t('paywall.title'), lead: t('paywall.lead') }),
    status,
    errorHost,
    plansHost,
    h('div', { class: 'va-grid-2 va-paywall__info' },
      card({
        title: t('paywall.includedTitle'), iconName: 'sparkle', className: 'va-card--soft',
        children: h('ul', { class: 'va-checklist' }, ['inc1', 'inc2', 'inc3', 'inc4', 'inc5'].map((k) => h('li', null, icon('check', { size: 20 }), h('span', null, t(`paywall.${k}`))))),
      }),
      h('div', { class: 'va-stack' },
        card({ title: t('paywall.secureTitle'), iconName: 'shield', className: 'va-card--soft', children: h('p', { class: 'va-text' }, t('paywall.secure')), testId: 'secure-note' }),
        card({
          title: t('paywall.cancelTitle'), iconName: 'check', className: 'va-card--soft',
          children: [h('p', { class: 'va-text' }, t('paywall.cancel')), h('p', null, h('a', { href: legalUrl('cancellation', ctx.lang) }, t('account.cancellation')))],
        }),
      ),
    ),
    h('div', { class: 'va-row va-paywall__foot' },
      linkButton(t('paywall.manage'), '#/account', { variant: 'ghost', iconName: 'user' }),
      actionButton(t('paywall.logout'), {
        variant: 'ghost', iconName: 'logout', testId: 'paywall-logout',
        onClick: async () => {
          try { await api.logout(); } catch { /* still clear locally */ }
          ctx.shell.session.clear();
          ctx.navigate('/welcome', { replace: true });
        },
      }),
    ),
  );
  return { el };
}

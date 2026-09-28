// @ts-check
/**
 * #/welcome — value proposition, "Start your free month", login link, honest disclaimer, legal + cancel links.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { ACCOUNT_STRINGS } from './strings.js';
import { brandName, brandTagline, legalUrl } from '../shell/brand.js';
import { icon } from '../shell/icons.js';
import { linkButton } from '../shell/components.js';
import { api } from './api.js';
import { formatMinor } from '../shell/format.js';

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(ACCOUNT_STRINGS, ctx.lang);
  const brand = brandName(ctx.lang);
  const priceNote = h('p', { class: 'va-hint va-welcome__price', 'data-testid': 'welcome-price', hidden: true });

  api.plans(ctx.signal).then((res) => {
    const monthly = res?.plans?.find((p) => p.id === 'monthly') || res?.plans?.[0];
    const cheapest = (res?.plans || []).reduce((min, p) => (min === null || p.pricePerMonth < min.pricePerMonth ? p : min), /** @type {any} */ (null));
    const p = cheapest || monthly;
    if (!p || ctx.signal.aborted) return;
    priceNote.textContent = t('welcome.fromPrice', { price: formatMinor(p.pricePerMonth, p.currency, ctx.lang) });
    priceNote.hidden = false;
  }).catch(() => { /* optional: offline or API down */ });

  const value = (/** @type {string} */ ic, /** @type {string} */ key) => h('li', { class: 'va-value' },
    h('span', { class: 'va-value__icon' }, icon(ic, { size: 28 })),
    h('div', null, h('h2', { class: 'va-value__title' }, t(`${key}.title`)), h('p', { class: 'va-value__body' }, t(`${key}.body`))));

  const el = h('div', { class: 'va-page va-welcome', 'data-testid': 'screen-welcome' },
    h('section', { class: 'va-hero' },
      h('div', { class: 'va-hero__mark', 'aria-hidden': 'true' }, icon('logo', { size: 44 })),
      h('p', { class: 'va-hero__brand' }, brand, h('span', { class: 'va-hero__tagline' }, brandTagline(ctx.lang))),
      h('h1', { class: 'va-title va-hero__title', tabindex: '-1' }, t('welcome.title')),
      h('p', { class: 'va-lead' }, t('welcome.lead', { brand })),
      h('div', { class: 'va-actions va-hero__actions' },
        linkButton(t('welcome.cta'), '#/register', { testId: 'welcome-start', className: 'va-btn--lg' }),
        linkButton(t('welcome.login'), '#/login', { variant: 'secondary', testId: 'welcome-login' }),
      ),
      h('p', { class: 'va-hint va-hero__note' }, t('welcome.ctaNote')),
      priceNote,
    ),
    h('ul', { class: 'va-values', role: 'list' },
      value('eye', 'welcome.v1'),
      value('photo', 'welcome.v2'),
      value('phone', 'welcome.v3'),
    ),
    h('p', { class: 'va-privacy-note' }, icon('lock', { size: 20 }), h('span', null, t('welcome.privacy'))),
    h('footer', { class: 'va-welcome__foot' },
      h('p', { class: 'va-hint' }, t('welcome.disclaimer', { brand })),
      h('nav', { class: 'va-footlinks', 'aria-label': t('account.legal') },
        h('a', { href: legalUrl('terms', ctx.lang) }, t('account.terms')),
        h('a', { href: legalUrl('privacy', ctx.lang) }, t('account.privacy')),
        h('a', { href: legalUrl('cancellation', ctx.lang) }, t('account.cancellation')),
        h('a', { href: '#/account', 'data-testid': 'welcome-cancel-link' }, t('welcome.cancelLink')),
      ),
    ),
  );
  return { el };
}

// @ts-check
/**
 * #/help — FAQ, visible "Cancel subscription" link (Israeli law: easy online cancellation), disclaimer, contact,
 * legal documents in the UI language.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { SCREEN_STRINGS } from './strings.js';
import { BRAND, brandName, legalUrl, LEGAL_DOCS } from '../shell/brand.js';
import { pageHeader, card, linkButton, notice } from '../shell/components.js';

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(SCREEN_STRINGS, ctx.lang);
  const brand = brandName(ctx.lang);
  const faq = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => h('details', { class: 'va-faq__item', 'data-testid': `faq-${n}` },
    h('summary', { class: 'va-faq__q' }, t(`help.q${n}`)),
    h('p', { class: 'va-faq__a' }, t(`help.a${n}`, { brand }))));

  const el = h('div', { class: 'va-page va-page--wide', 'data-testid': 'screen-help' },
    pageHeader({ title: t('help.title') }),
    h('div', { class: 'va-grid-2' },
      h('section', { class: 'va-card va-faq', 'aria-labelledby': 'faq-h' }, h('h2', { class: 'va-card__title', id: 'faq-h' }, t('help.faqTitle')), ...faq),
      h('div', { class: 'va-stack' },
        card({
          title: t('help.cancelTitle'), iconName: 'receipt', testId: 'help-cancel',
          children: h('p', { class: 'va-text' }, t('help.cancelBody')),
          actions: [linkButton(t('help.cancelLink'), '#/account', { variant: 'secondary', testId: 'help-cancel-link' })],
        }),
        notice('warning', t('help.disclaimer', { brand }), { title: t('help.disclaimerTitle') }),
        card({
          title: t('help.contactTitle'), iconName: 'help',
          children: [h('p', { class: 'va-text' }, t('help.contactBody')), h('p', { dir: 'ltr', class: 'va-ltr' }, BRAND.supportEmail)],
          actions: [linkButton(t('help.contactEmail'), `mailto:${BRAND.supportEmail}`, { variant: 'secondary' })],
        }),
        card({
          title: t('help.legalTitle'), iconName: 'shield',
          children: h('ul', { class: 'va-linklist' }, LEGAL_DOCS.map((d) => h('li', null, h('a', { href: legalUrl(d, ctx.lang) }, t(`legal.${d}`))))),
        }),
      ),
    ),
  );
  return { el };
}

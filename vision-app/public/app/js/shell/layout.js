// @ts-check
/**
 * App chrome: skip link, app bar (back/up, brand, tabs, actions), banners, <main>, toasts and live regions.
 * The tab bar is part of the header in the DOM; on phones app.css pins it to the bottom of the screen.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { SHELL_STRINGS } from './strings.js';
import { BRAND, brandName } from './brand.js';
import { NAV_TABS, ROUTES } from './routes.js';
import { icon } from './icons.js';
import { initFeedback } from './dialog.js';

/** @typedef {import('./routes.js').RouteDef} RouteDef */
/** @typedef {import('./store.js').AppState} AppState */

/**
 * @typedef {Object} LayoutView
 * @property {RouteDef} def
 * @property {AppState} state
 * @property {boolean} loggedIn
 * @property {boolean} hasAccess
 */

/**
 * @param {HTMLElement} root
 * @param {{onToggleLang: () => void, onUp: (path: string) => void, onApplyUpdate: () => void}} actions
 */
export function createLayout(root, actions) {
  const skip = h('a', { class: 'va-skip', href: '#main' });
  const header = h('header', { class: 'va-appbar', 'data-testid': 'appbar' });
  const banners = h('div', { class: 'va-banners', 'data-testid': 'banners' });
  const main = h('main', { id: 'main', class: 'va-main', tabindex: '-1', 'data-testid': 'main' });
  const toasts = h('div', { class: 'va-toasts', 'data-testid': 'toasts' });
  const polite = h('div', { class: 'va-visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-testid': 'live-polite' });
  const assertive = h('div', { class: 'va-visually-hidden', role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true' });
  // The skip link must not change the hash (the router owns it): move focus programmatically.
  skip.addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
  root.replaceChildren(skip, header, banners, main, toasts, polite, assertive);
  root.classList.add('va-app');

  /** @param {LayoutView} v */
  function update(v) {
    const { def, state } = v;
    const t = makeT(SHELL_STRINGS, state.lang);
    const brand = brandName(state.lang);
    initFeedback({ polite, assertive, toasts, dismissLabel: t('dismiss') });
    skip.textContent = t('skipToContent');
    const showTabs = v.hasAccess && def.layout === 'app';
    root.dataset.layout = def.layout;
    root.classList.toggle('has-tabs', showTabs);
    header.hidden = def.layout === 'stage';

    // Up / back button: goes to the logical parent screen (system Back still uses history).
    let up = null;
    if (def.parent && !(def.layout === 'app' && showTabs && def.tab && def.path === `/${def.tab}`)) {
      const parentPath = !v.loggedIn && def.parent === '/home' ? '/welcome' : v.loggedIn && !v.hasAccess && def.parent === '/home' ? '/paywall' : def.parent;
      const parentDef = ROUTES.find((r) => r.path === parentPath);
      const label = parentDef ? t('backTo', { page: t(parentDef.titleKey) }) : t('back');
      if (parentPath !== def.path) {
        up = h('button', { type: 'button', class: 'va-icon-btn va-appbar__back', 'aria-label': label, title: label, 'data-testid': 'appbar-back', on: { click: () => actions.onUp(parentPath) } }, icon('back'));
      }
    }
    const homeHref = v.loggedIn ? (v.hasAccess ? '#/home' : '#/paywall') : '#/welcome';
    const brandLink = h('a', { class: 'va-brand', href: homeHref, 'aria-label': t('homeLink', { brand }), 'data-testid': 'brand-link' },
      h('span', { class: 'va-brand__mark', 'aria-hidden': 'true' }, icon('logo', { size: 22 })),
      h('span', { class: 'va-brand__name' }, brand));

    const titleEl = def.layout === 'viewer' ? h('span', { class: 'va-appbar__title' }, t(def.titleKey)) : null;

    const nav = showTabs
      ? h('nav', { class: 'va-tabs', 'aria-label': t('nav.label'), 'data-testid': 'tabs' },
        h('ul', { class: 'va-tabs__list' }, NAV_TABS.map((tab) => h('li', null,
          h('a', {
            class: 'va-tabs__link', href: `#${tab.path}`, 'aria-current': def.tab === tab.tab ? 'page' : undefined, 'data-testid': `tab-${tab.tab}`,
          }, icon(tab.icon), h('span', { class: 'va-tabs__label' }, t(tab.labelKey)))))))
      : null;

    const tools = [];
    if (!v.loggedIn || def.layout === 'bare') {
      const other = state.lang === 'he' ? 'en' : 'he';
      tools.push(h('button', {
        type: 'button', class: 'va-lang-toggle', lang: other, 'aria-label': t('switchLang'), 'data-testid': 'lang-toggle',
        on: { click: actions.onToggleLang },
      }, icon('globe', { size: 20 }), h('span', null, t('switchLangShort'))));
    }
    if (def.layout !== 'viewer') {
      if (def.path !== '/settings') tools.push(h('a', { class: 'va-icon-btn', href: '#/settings', 'aria-label': t('settings'), title: t('settings'), 'data-testid': 'appbar-settings' }, icon('settings')));
      if (def.path !== '/help') tools.push(h('a', { class: 'va-icon-btn', href: '#/help', 'aria-label': t('help'), title: t('help'), 'data-testid': 'appbar-help' }, icon('help')));
    }

    header.replaceChildren(h('div', { class: 'va-appbar__inner' },
      h('div', { class: 'va-appbar__start' }, up, titleEl || brandLink),
      h('div', { class: 'va-appbar__tools' }, ...tools),
      nav,
    ));

    // Banners
    const list = [];
    if (def.layout !== 'stage') {
      if (!state.online) list.push(banner('offline', t('offline'), 'warning'));
      else if (state.sessionUnknown) list.push(banner('server', t('serverUnreachable'), 'warning'));
      else if (state.source === 'cache' && v.loggedIn) list.push(banner('cached', t('offlineCached'), 'info'));
      if (state.updateReady) {
        list.push(banner('update', t('updateReady'), 'info',
          h('button', { type: 'button', class: 'va-btn va-btn--primary va-banner__btn', 'data-testid': 'update-now', on: { click: actions.onApplyUpdate } }, t('updateNow'))));
      }
    }
    banners.replaceChildren(...list);
    banners.hidden = list.length === 0;
  }

  return { main, header, update, brandColor: BRAND.themeColor };
}

/**
 * @param {string} id @param {string} text @param {'info'|'warning'} kind @param {Node} [action]
 */
function banner(id, text, kind, action) {
  return h('div', { class: `va-banner va-banner--${kind}`, 'data-testid': `banner-${id}` },
    icon(kind === 'warning' ? 'warning' : 'info', { size: 20 }),
    h('span', { class: 'va-banner__text' }, text),
    action || null,
  );
}

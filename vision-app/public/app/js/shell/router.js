// @ts-check
/**
 * Hash router controller: guards, lazy screen loading, teardown, focus management, document.title, and
 * "are you sure?" vetoes on system Back (screen.canLeave()).
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { parseHash, buildHash, matchRoute, sanitizeReturnTo } from './route-utils.js';
import { guardRoute, defaultPath } from './guards.js';
import { closeAllDialogs } from './dialog.js';
import { SHELL_STRINGS } from './strings.js';
import { brandName } from './brand.js';
import { emptyState, actionButton, spinner } from './components.js';

/** @typedef {import('./routes.js').RouteDef} RouteDef */
/** @typedef {import('./screen-types.js').ScreenInstance} ScreenInstance */
/** @typedef {import('./screen-types.js').ScreenContext} ScreenContext */
/** @typedef {import('./screen-types.js').NavigateOptions} NavigateOptions */
/** @typedef {import('./guards.js').GuardState} GuardState */

const RETURN_KEY = 'va.returnTo';

/**
 * @param {{
 *   routes: readonly RouteDef[], notFound: RouteDef,
 *   main: HTMLElement,
 *   store: import('./store.js').AppStore,
 *   guardState: () => GuardState,
 *   onLayout: (def: RouteDef, gs: GuardState) => void,
 *   services: () => import('./screen-types.js').ShellServices,
 * }} opts
 */
export function createRouter(opts) {
  const { routes, notFound, main, store } = opts;
  let seq = 0;
  /** @type {{def: RouteDef, hash: string, instance: ScreenInstance|null, controller: AbortController}|null} */
  let current = null;
  let firstRender = true;

  /** @param {string} path @param {NavigateOptions} [o] */
  function navigate(path, o = {}) {
    const hash = buildHash(path, o.query);
    if (hash === location.hash && !o.replace) { void render(true); return; }
    if (o.replace) location.replace(hash); else location.hash = hash;
  }

  function onHashChange() {
    void render(false);
  }

  /** Remember where a logged-out user wanted to go. @param {string|undefined} target */
  function rememberReturn(target) {
    const safe = sanitizeReturnTo(target);
    try { if (safe) sessionStorage.setItem(RETURN_KEY, safe); } catch { /* ignore */ }
  }

  /** Consume the remembered target (after login / subscribe). @returns {string|null} */
  function takeReturnTo() {
    try {
      const v = sanitizeReturnTo(sessionStorage.getItem(RETURN_KEY));
      sessionStorage.removeItem(RETURN_KEY);
      return v;
    } catch { return null; }
  }

  /** Go to the right place for the current session (optionally honouring a remembered target). @param {{useReturn?: boolean}} [o] */
  function goDefault(o = {}) {
    const gs = opts.guardState();
    const back = o.useReturn ? takeReturnTo() : null;
    if (back) {
      const parsed = parseHash('#' + back);
      const def = matchRoute(routes, parsed.path);
      if (def && guardRoute(def.access, gs).type === 'allow') { navigate(parsed.path, { replace: true, query: parsed.query }); return; }
    }
    navigate(defaultPath(gs), { replace: true });
  }

  function teardown() {
    if (!current) return;
    current.controller.abort();
    try { current.instance?.destroy?.(); } catch (err) { console.error('screen destroy failed', err); }
    current = null;
  }

  /** @param {boolean} force skip canLeave (refresh) */
  async function render(force) {
    const token = ++seq;
    const route = parseHash(location.hash);
    const gs = opts.guardState();
    if (route.path === '/') { location.replace(buildHash(defaultPath(gs))); return; }
    const def = matchRoute(routes, route.path) ?? notFound;
    const requested = route.path + (Object.keys(route.query).length ? '?' + new URLSearchParams(route.query).toString() : '');
    const decision = guardRoute(def.access, gs, requested);
    if (decision.type === 'redirect') {
      if (decision.returnTo) rememberReturn(decision.returnTo);
      location.replace(buildHash(decision.to));
      return;
    }

    if (current && !force && current.instance?.canLeave && current.hash !== location.hash) {
      let ok = true;
      try { ok = await current.instance.canLeave(); } catch { ok = true; }
      if (!ok) {
        // Stay: put the previous URL back (pushState does not fire hashchange, so nothing re-renders).
        history.pushState(null, '', current.hash || '#/home');
        return;
      }
      if (token !== seq) return;
    }

    teardown();
    closeAllDialogs();
    opts.onLayout(def, gs);
    const t = makeT(SHELL_STRINGS, store.get().lang);
    const loadingTimer = setTimeout(() => { if (token === seq) main.replaceChildren(spinner(t('loading'))); }, 150);

    const controller = new AbortController();
    current = { def, hash: location.hash, instance: null, controller };
    /** @type {ScreenInstance} */
    let instance;
    try {
      const mod = await def.load();
      if (token !== seq) return;
      /** @type {ScreenContext} */
      const ctx = {
        lang: store.get().lang, t, route, signal: controller.signal, store, navigate, goDefault, shell: opts.services(), params: def.params,
      };
      instance = await mod.mount(ctx);
    } catch (err) {
      if (token !== seq) return;
      console.error('screen failed to load', err);
      instance = { el: loadError(t) };
    } finally {
      clearTimeout(loadingTimer);
    }
    if (token !== seq || current?.controller !== controller) { try { instance.destroy?.(); } catch { /* ignore */ } return; }
    current.instance = instance;
    main.replaceChildren(instance.el);
    const pageTitle = instance.title || t(def.titleKey);
    document.title = `${pageTitle} · ${brandName(store.get().lang)}`;
    window.scrollTo(0, 0);
    if (!firstRender) {
      const heading = /** @type {HTMLElement|null} */ (main.querySelector('h1'));
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      } else {
        main.focus({ preventScroll: true });
      }
    }
    firstRender = false;
    document.documentElement.dataset.route = def.path;
  }

  /** @param {(key: string) => string} t */
  function loadError(t) {
    return h('div', { class: 'va-page' }, emptyState({
      iconName: 'warning', title: t('loadErrorTitle'), body: t('loadErrorBody'), testId: 'load-error',
      actions: [actionButton(t('retry'), { iconName: 'retest', onClick: () => location.reload() })],
    }));
  }

  return {
    navigate,
    goDefault,
    takeReturnTo,
    /** Re-render the current route without asking canLeave (language switch, session change). */
    refresh: () => render(true),
    start() {
      window.addEventListener('hashchange', onHashChange);
      return render(true);
    },
    get current() { return current?.def ?? null; },
  };
}

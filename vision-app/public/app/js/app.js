// @ts-check
/**
 * App entry: language/theme, session gate (GET /api/me with offline entitlement cache), chrome, router,
 * connectivity, UI adaptation and service-worker registration.
 */
import { getInitialLang, saveLang, applyLangToDocument, makeT } from './core/i18n.js';
import { getActiveProfile, onProfilesChanged } from './core/storage.js';
import { createStore } from './shell/store.js';
import { createLayout } from './shell/layout.js';
import { createRouter } from './shell/router.js';
import { ROUTES, NOT_FOUND_ROUTE } from './shell/routes.js';
import { SHELL_STRINGS } from './shell/strings.js';
import { toast, announce, confirmDialog } from './shell/dialog.js';
import { spinner } from './shell/components.js';
import { getTheme, applyTheme, applyAdaptation, setAdaptationPaused } from './shell/prefs.js';
import { registerServiceWorker, applyUpdate } from './shell/sw-client.js';
import { configureApi } from './account/api.js';
import { createSession } from './account/session.js';

/** @typedef {import('./shell/store.js').AppState} AppState */

const SESSION_RECHECK_MS = 30 * 60_000;

const root = /** @type {HTMLElement} */ (document.getElementById('app'));
/** @type {import('./shell/store.js').AppStore} */
const store = createStore(/** @type {AppState} */ ({
  lang: getInitialLang(), user: null, entitlement: null, source: null, checkedAt: null,
  online: navigator.onLine !== false, sessionUnknown: false, updateReady: false,
}));
const t = () => makeT(SHELL_STRINGS, store.get().lang);
applyLangToDocument(store.get().lang);
applyTheme(getTheme());

const session = createSession(store);
/** @type {import('./shell/routes.js').RouteDef|null} */
let currentDef = null;

const layout = createLayout(root, {
  onToggleLang: () => store.set({ lang: store.get().lang === 'he' ? 'en' : 'he' }),
  onUp: (path) => router.navigate(path),
  onApplyUpdate: () => applyUpdate(),
});
layout.main.replaceChildren(spinner(t()('loading')));

/** @type {import('./shell/screen-types.js').ShellServices} */
const services = {
  toast,
  announce,
  confirm: confirmDialog,
  refresh: () => { void router.refresh(); },
  pauseAdaptation: (paused) => { setAdaptationPaused(paused); void applyAdaptation(getActiveProfile(), { force: true }); },
  applyAdaptation: (opts) => { void applyAdaptation(getActiveProfile(), opts); },
  session,
};

const router = createRouter({
  routes: ROUTES,
  notFound: NOT_FOUND_ROUTE,
  main: layout.main,
  store,
  guardState: () => session.guardState(),
  onLayout: (def) => { currentDef = def; updateChrome(); },
  services: () => services,
});

function updateChrome() {
  if (!currentDef) return;
  const gs = session.guardState();
  layout.update({ def: currentDef, state: store.get(), loggedIn: gs.loggedIn, hasAccess: gs.hasAccess });
  requestAnimationFrame(() => {
    const offset = layout.header.hidden ? 0 : layout.header.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--va-viewer-offset', `${Math.round(offset)}px`);
  });
}

configureApi({
  onUnauthorized: () => {
    const wasLoggedIn = !!store.get().user;
    session.clear();
    if (wasLoggedIn) toast(t()('sessionEnded'), { kind: 'error' });
    router.navigate('/welcome', { replace: true });
  },
});

store.subscribe((next, prev) => {
  if (next.lang !== prev.lang) {
    saveLang(next.lang);
    applyLangToDocument(next.lang);
    void router.refresh();
    return;
  }
  if (next.online !== prev.online || next.updateReady !== prev.updateReady || next.sessionUnknown !== prev.sessionUnknown
    || next.source !== prev.source || next.user !== prev.user || next.entitlement !== prev.entitlement) {
    updateChrome();
  }
});

/** Re-check the session; re-route if access changed (e.g. trial ended while the app was open). */
async function recheck() {
  const before = session.guardState();
  await session.refresh();
  const after = session.guardState();
  if (before.loggedIn !== after.loggedIn || before.hasAccess !== after.hasAccess) void router.refresh();
}

window.addEventListener('online', () => {
  store.set({ online: true });
  const s = store.get();
  if (s.sessionUnknown || s.source === 'cache') void recheck();
});
window.addEventListener('offline', () => store.set({ online: false }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !store.get().online) return;
  const { checkedAt, user } = store.get();
  if (user && (!checkedAt || Date.now() - checkedAt > SESSION_RECHECK_MS)) void recheck();
});
onProfilesChanged(() => { void applyAdaptation(getActiveProfile()); });

async function boot() {
  await session.init();
  void applyAdaptation(getActiveProfile());
  await router.start();
  root.dataset.state = 'ready';
  registerServiceWorker({ onUpdateReady: () => store.set({ updateReady: true }) });
}

boot().catch((err) => {
  console.error('App failed to start', err);
  root.dataset.state = 'error';
});

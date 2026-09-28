// @ts-check
/**
 * Route table. Screens are loaded lazily so start-up stays fast.
 * access:  public = anyone; guest = only when logged out; auth = logged in; access = logged in with an active trial/plan.
 * layout:  app = app bar (+ tab bar when the user has access); bare = minimal header; stage = full-screen flow; viewer = full-height viewer.
 */

/** @typedef {'public'|'guest'|'auth'|'access'} Access */
/** @typedef {'app'|'bare'|'stage'|'viewer'} Layout */
/** @typedef {'home'|'results'|'guide'|'account'} NavTab */

/**
 * @typedef {Object} RouteDef
 * @property {string} path
 * @property {Access} access
 * @property {Layout} layout
 * @property {string} titleKey            key in shell/strings.js
 * @property {string|null} parent         "Up" target for the app-bar back button (null = root screen).
 * @property {NavTab} [tab]               Highlighted tab-bar item.
 * @property {Object<string, string>} [params]
 * @property {() => Promise<import('./screen-types.js').ScreenModule>} load
 */

/** @type {readonly RouteDef[]} */
export const ROUTES = Object.freeze([
  { path: '/welcome', access: 'guest', layout: 'bare', titleKey: 'route.welcome', parent: null, load: () => import('../account/welcome.js') },
  { path: '/login', access: 'guest', layout: 'bare', titleKey: 'route.login', parent: '/welcome', load: () => import('../account/login.js') },
  { path: '/register', access: 'guest', layout: 'bare', titleKey: 'route.register', parent: '/welcome', load: () => import('../account/register.js') },
  { path: '/reset', access: 'public', layout: 'bare', titleKey: 'route.reset', parent: '/login', load: () => import('../account/reset.js') },
  { path: '/reset-password', access: 'public', layout: 'bare', titleKey: 'route.reset', parent: '/login', load: () => import('../account/reset.js') },
  { path: '/paywall', access: 'auth', layout: 'app', titleKey: 'route.paywall', parent: '/home', load: () => import('../account/paywall.js') },
  { path: '/account', access: 'auth', layout: 'app', titleKey: 'route.account', parent: '/home', tab: 'account', load: () => import('../account/account.js') },
  { path: '/onboarding', access: 'access', layout: 'stage', titleKey: 'route.onboarding', parent: '/home', load: () => import('../flows/onboarding.js') },
  { path: '/home', access: 'access', layout: 'app', titleKey: 'route.home', parent: null, tab: 'home', load: () => import('../screens/home.js') },
  { path: '/results', access: 'access', layout: 'app', titleKey: 'route.results', parent: '/home', tab: 'results', load: () => import('../screens/results.js') },
  { path: '/profiles', access: 'access', layout: 'app', titleKey: 'route.profiles', parent: '/home', tab: 'home', load: () => import('../screens/profiles.js') },
  { path: '/guide', access: 'access', layout: 'app', titleKey: 'route.guide', parent: '/home', tab: 'guide', load: () => import('../screens/guide.js') },
  { path: '/viewer/photo', access: 'access', layout: 'viewer', titleKey: 'route.viewer.photo', parent: '/home', params: { kind: 'photo' }, load: () => import('../screens/viewer.js') },
  { path: '/viewer/video', access: 'access', layout: 'viewer', titleKey: 'route.viewer.video', parent: '/home', params: { kind: 'video' }, load: () => import('../screens/viewer.js') },
  { path: '/viewer/magnifier', access: 'access', layout: 'viewer', titleKey: 'route.viewer.magnifier', parent: '/home', params: { kind: 'magnifier' }, load: () => import('../screens/viewer.js') },
  { path: '/viewer/reader', access: 'access', layout: 'viewer', titleKey: 'route.viewer.reader', parent: '/home', params: { kind: 'reader' }, load: () => import('../screens/viewer.js') },
  { path: '/share', access: 'access', layout: 'app', titleKey: 'route.share', parent: '/home', load: () => import('../screens/share.js') },
  { path: '/settings', access: 'public', layout: 'app', titleKey: 'route.settings', parent: '/home', load: () => import('../screens/settings.js') },
  { path: '/help', access: 'public', layout: 'app', titleKey: 'route.help', parent: '/home', load: () => import('../screens/help.js') },
]);

/** @type {RouteDef} */
export const NOT_FOUND_ROUTE = Object.freeze({
  path: '/404', access: 'public', layout: 'app', titleKey: 'route.notFound', parent: '/home', load: () => import('../screens/not-found.js'),
});

/** Tab bar items (shown to users with access). */
export const NAV_TABS = /** @type {const} */ ([
  { tab: 'home', path: '/home', labelKey: 'nav.home', icon: 'home' },
  { tab: 'results', path: '/results', labelKey: 'nav.results', icon: 'results' },
  { tab: 'guide', path: '/guide', labelKey: 'nav.guide', icon: 'phone' },
  { tab: 'account', path: '/account', labelKey: 'nav.account', icon: 'user' },
]);

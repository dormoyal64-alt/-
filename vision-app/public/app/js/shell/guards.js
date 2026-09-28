// @ts-check
/**
 * Pure route-guard decisions (no DOM), unit-tested in test/unit/shell/guards.test.js.
 */

/** @typedef {import('./routes.js').Access} Access */

/**
 * @typedef {Object} GuardState
 * @property {boolean} loggedIn
 * @property {boolean} hasAccess     Trial or paid plan currently grants access.
 * @property {boolean} hasProfile    At least one VisionProfile on this device.
 */

/**
 * @typedef {{type: 'allow'} | {type: 'redirect', to: string, returnTo?: string}} GuardDecision
 */

/**
 * Where to send the user when no specific route was requested ("#/" or after login).
 * @param {GuardState} s
 * @returns {string}
 */
export function defaultPath(s) {
  if (!s.loggedIn) return '/welcome';
  if (!s.hasAccess) return '/paywall';
  return s.hasProfile ? '/home' : '/onboarding';
}

/**
 * @param {Access} access
 * @param {GuardState} s
 * @param {string} [requested]  the requested "/path?query", remembered for after login
 * @returns {GuardDecision}
 */
export function guardRoute(access, s, requested) {
  switch (access) {
    case 'public':
      return { type: 'allow' };
    case 'guest':
      return s.loggedIn ? { type: 'redirect', to: defaultPath(s) } : { type: 'allow' };
    case 'auth':
      return s.loggedIn ? { type: 'allow' } : { type: 'redirect', to: '/welcome', returnTo: requested };
    case 'access':
      if (!s.loggedIn) return { type: 'redirect', to: '/welcome', returnTo: requested };
      if (!s.hasAccess) return { type: 'redirect', to: '/paywall', returnTo: requested };
      return { type: 'allow' };
    default:
      return { type: 'redirect', to: defaultPath(s) };
  }
}

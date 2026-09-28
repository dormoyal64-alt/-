// @ts-check
/**
 * JSDoc contracts between the shell (router/layout) and screen modules. Types only.
 */

/** @typedef {import('../core/types.js').Lang} Lang */
/** @typedef {import('./route-utils.js').ParsedRoute} ParsedRoute */
/** @typedef {import('./store.js').AppStore} AppStore */

/**
 * @typedef {Object} NavigateOptions
 * @property {boolean} [replace]                               Replace the current history entry.
 * @property {Record<string, string|number|boolean|null|undefined>} [query]
 */

/**
 * Services the shell offers to every screen.
 * @typedef {Object} ShellServices
 * @property {(message: string, opts?: {kind?: 'info'|'success'|'error', timeoutMs?: number}) => void} toast
 * @property {(message: string, assertive?: boolean) => void} announce
 * @property {(opts: import('./dialog.js').ConfirmOptions) => Promise<boolean>} confirm
 * @property {() => void} refresh                              Re-render the current route (e.g. after a language switch).
 * @property {(paused: boolean) => void} pauseAdaptation       Temporarily remove profile-based UI adaptation (during tests).
 * @property {() => void} applyAdaptation                      Re-apply the active profile to the app UI.
 * @property {import('../account/session.js').Session} session
 */

/**
 * @typedef {Object} ScreenContext
 * @property {Lang} lang
 * @property {(key: string, params?: Record<string, string|number>) => string} t   Shell strings.
 * @property {ParsedRoute} route
 * @property {AbortSignal} signal         Aborted when the user leaves the route.
 * @property {AppStore} store
 * @property {(path: string, opts?: NavigateOptions) => void} navigate
 * @property {ShellServices} shell
 * @property {Object<string, string>} [params]   Static params from the route definition (e.g. viewer kind).
 */

/**
 * @typedef {Object} ScreenInstance
 * @property {HTMLElement} el
 * @property {() => void} [destroy]
 * @property {() => (boolean|Promise<boolean>)} [canLeave]  Return false to stay on the screen (e.g. test in progress).
 * @property {string} [title]                                  Overrides the route title in document.title.
 */

/**
 * @typedef {Object} ScreenModule
 * @property {(ctx: ScreenContext) => (ScreenInstance|Promise<ScreenInstance>)} mount
 */

export {};

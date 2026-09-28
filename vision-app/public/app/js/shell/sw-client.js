// @ts-check
/**
 * Service-worker registration (scope /app/) with a user-controlled update: when a new version is waiting,
 * the shell shows a banner; "Update now" activates it and reloads once.
 */

/** @type {ServiceWorker|null} */
let waiting = null;
let updateRequested = false;

/**
 * @param {{onUpdateReady: () => void}} opts
 */
export function registerServiceWorker({ onUpdateReady }) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;
  const swUrl = new URL('../../sw.js', import.meta.url);
  const scope = new URL('../../', import.meta.url).pathname;
  const markWaiting = (/** @type {ServiceWorker|null} */ w) => {
    if (!w || !navigator.serviceWorker.controller) return; // first install: nothing to update
    waiting = w;
    onUpdateReady();
  };
  navigator.serviceWorker.register(swUrl.href, { scope, type: 'classic' }).then((reg) => {
    markWaiting(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') markWaiting(w); });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => { /* offline */ });
    });
  }).catch((err) => console.warn('Service worker registration failed', err));

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });
}

/** Activate the waiting worker; the page reloads on controllerchange. */
export function applyUpdate() {
  if (!waiting) { location.reload(); return; }
  updateRequested = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

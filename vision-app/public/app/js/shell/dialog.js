// @ts-check
/**
 * Modal dialogs (native <dialog>: focus trap, Escape, inert background), toasts and aria-live announcements.
 */
import { h } from '../core/dom.js';
import { icon } from './icons.js';

/**
 * @typedef {Object} ConfirmOptions
 * @property {string} title
 * @property {string|Node|Array<string|Node>} [body]
 * @property {string} confirmLabel
 * @property {string} cancelLabel
 * @property {boolean} [danger]
 * @property {string} [testId]
 */

/** @type {{polite: HTMLElement|null, assertive: HTMLElement|null, toasts: HTMLElement|null, dismissLabel: string}} */
const hosts = { polite: null, assertive: null, toasts: null, dismissLabel: 'Dismiss' };
/** @type {Set<{close: (value: any) => void}>} */
const openDialogs = new Set();

/** @param {{polite: HTMLElement, assertive: HTMLElement, toasts: HTMLElement, dismissLabel: string}} opts */
export function initFeedback(opts) {
  Object.assign(hosts, opts);
}

/**
 * Announce a message to screen readers.
 * @param {string} message @param {boolean} [assertive]
 */
export function announce(message, assertive = false) {
  const region = assertive ? hosts.assertive : hosts.polite;
  if (!region) return;
  region.textContent = '';
  // A short delay makes repeated identical messages be re-announced.
  setTimeout(() => { region.textContent = message; }, 60);
}

/**
 * Visual toast + screen-reader announcement.
 * @param {string} message
 * @param {{kind?: 'info'|'success'|'error', timeoutMs?: number}} [opts]
 */
export function toast(message, { kind = 'info', timeoutMs = 6000 } = {}) {
  announce(message, kind === 'error');
  const host = hosts.toasts;
  if (!host) return;
  const close = () => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 200); };
  const el = h('div', { class: `va-toast va-toast--${kind}`, 'data-testid': 'toast' },
    icon(kind === 'success' ? 'check' : kind === 'error' ? 'warning' : 'info'),
    h('span', { class: 'va-toast__text' }, message),
    h('button', { type: 'button', class: 'va-toast__close', 'aria-label': hosts.dismissLabel, on: { click: close } }, icon('close', { size: 20 })),
  );
  host.appendChild(el);
  while (host.childElementCount > 3) host.firstElementChild?.remove();
  if (timeoutMs > 0) setTimeout(close, timeoutMs);
}

/**
 * Generic modal dialog. Resolves with the value of the pressed action, or `dismissValue` on Escape/close.
 * @template T
 * @param {{title: string, body?: Array<string|Node>|string|Node, actions: {label: string, value: T, variant?: 'primary'|'secondary'|'ghost'|'danger', testId?: string, submit?: boolean}[],
 *   dismissValue: T, testId?: string, onSubmit?: (value: T) => boolean|Promise<boolean>, initialFocus?: HTMLElement, focusIndex?: number}} opts
 *   onSubmit: return false to keep the dialog open (e.g. validation failed).
 * @returns {Promise<T>}
 */
export function openDialog(opts) {
  return new Promise((resolve) => {
    const titleId = `dlg-title-${Math.random().toString(36).slice(2, 8)}`;
    const bodyId = `${titleId}-body`;
    const previous = /** @type {HTMLElement|null} */ (document.activeElement);
    const bodyParts = Array.isArray(opts.body) ? opts.body : opts.body ? [opts.body] : [];
    /** @type {HTMLButtonElement[]} */
    const buttons = [];
    const form = h('form', { method: 'dialog', class: 'va-dialog__form', novalidate: true });
    const dlg = h('dialog', { class: 'va-dialog', 'aria-labelledby': titleId, 'aria-describedby': bodyParts.length ? bodyId : undefined, 'data-testid': opts.testId },
      form,
    );
    let settled = false;
    const finish = (/** @type {T} */ value) => {
      if (settled) return;
      settled = true;
      openDialogs.delete(entry);
      try { if (dlg.open) dlg.close(); } catch { /* ignore */ }
      dlg.remove();
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
      resolve(value);
    };
    const entry = { close: (/** @type {any} */ v) => finish(v ?? opts.dismissValue) };
    for (const a of opts.actions) {
      const b = h('button', {
        type: a.submit ? 'submit' : 'button', class: `va-btn va-btn--${a.variant || 'secondary'}`, 'data-testid': a.testId,
      }, a.label);
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        if (a.submit && opts.onSubmit) {
          buttons.forEach((x) => { x.disabled = true; });
          let ok = false;
          try { ok = await opts.onSubmit(a.value); } finally { buttons.forEach((x) => { x.disabled = false; }); }
          if (!ok) return;
        }
        finish(a.value);
      });
      buttons.push(b);
    }
    form.append(
      h('h2', { class: 'va-dialog__title', id: titleId }, opts.title),
      h('div', { class: 'va-dialog__body', id: bodyId }, ...bodyParts.map((p) => (typeof p === 'string' ? h('p', null, p) : p))),
      h('div', { class: 'va-dialog__actions' }, ...buttons),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const submitBtn = buttons.find((_, i) => opts.actions[i].submit);
      submitBtn?.click();
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(opts.dismissValue); });
    openDialogs.add(entry);
    document.body.appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    (opts.initialFocus || buttons[opts.focusIndex ?? buttons.length - 1] || dlg).focus();
  });
}

/**
 * Yes/no confirmation. The safe choice (cancel) is listed first; the confirm button gets initial focus
 * only when it is not destructive.
 * @param {ConfirmOptions} opts
 * @returns {Promise<boolean>}
 */
export async function confirmDialog(opts) {
  return openDialog({
    title: opts.title,
    body: opts.body,
    testId: opts.testId || 'confirm-dialog',
    dismissValue: false,
    focusIndex: opts.danger ? 0 : 1,
    actions: [
      { label: opts.cancelLabel, value: false, variant: 'secondary', testId: 'confirm-cancel' },
      { label: opts.confirmLabel, value: true, variant: opts.danger ? 'danger' : 'primary', testId: 'confirm-ok' },
    ],
  }).then((v) => v === true);
}

/** Close every open dialog (route change). */
export function closeAllDialogs() {
  for (const d of [...openDialogs]) d.close(undefined);
}

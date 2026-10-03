// @ts-check
/** Small DOM building blocks for the pilot pages (built with the app's safe h() helper; no innerHTML). */
import { h } from '../../app/js/core/dom.js';

/**
 * @param {string} label
 * @param {{variant?: 'primary'|'secondary'|'ghost'|'danger', onClick?: (e: MouseEvent) => void, testId?: string,
 *   disabled?: boolean, type?: 'button'|'submit', className?: string, ariaLabel?: string}} [o]
 */
export function button(label, o = {}) {
  return h('button', {
    type: o.type || 'button', class: `p-btn p-btn--${o.variant || 'primary'} ${o.className || ''}`.trim(),
    'data-testid': o.testId, disabled: !!o.disabled, 'aria-label': o.ariaLabel, on: o.onClick ? { click: o.onClick } : undefined,
  }, label);
}

/** @param {string} label @param {string} href @param {{variant?: string, testId?: string, onClick?: (e: MouseEvent) => void}} [o] */
export function linkButton(label, href, o = {}) {
  return h('a', { class: `p-btn p-btn--${o.variant || 'primary'}`, href, 'data-testid': o.testId, on: o.onClick ? { click: o.onClick } : undefined }, label);
}

let uid = 0;
/** @param {string} prefix */
export function nextId(prefix) {
  uid += 1;
  return `${prefix}-${uid}`;
}

/**
 * Radio group shown as large tiles (>= 48 px).
 * @param {{name: string, legend: string, options: Array<{value: string, label: string}>, value?: string|null,
 *   onChange: (v: string) => void, testId?: string, hint?: string, compact?: boolean}} o
 */
export function choiceGroup(o) {
  const hintId = o.hint ? nextId('hint') : undefined;
  return h('fieldset', { class: `p-choices${o.compact ? ' p-choices--compact' : ''}`, 'data-testid': o.testId, 'aria-describedby': hintId },
    h('legend', { class: 'p-legend' }, o.legend),
    o.hint ? h('p', { class: 'p-hint', id: hintId }, o.hint) : null,
    h('div', { class: 'p-choices__list' }, o.options.map((opt) => {
      const id = nextId(o.name);
      return h('label', { class: 'p-choice', for: id },
        h('input', {
          type: 'radio', id, name: o.name, value: opt.value, checked: o.value === opt.value,
          'data-testid': o.testId ? `${o.testId}-${opt.value}` : undefined,
          on: { change: (/** @type {Event} */ e) => { if (/** @type {HTMLInputElement} */ (e.target).checked) o.onChange(opt.value); } },
        }),
        h('span', null, opt.label));
    })));
}

/**
 * 1..5 rating with labelled ends.
 * @param {{name: string, legend: string, lo: string, hi: string, value?: number|null, onChange: (v: number) => void, testId?: string}} o
 */
export function scale5(o) {
  const endsId = nextId('ends');
  return h('fieldset', { class: 'p-scale', 'data-testid': o.testId, 'aria-describedby': endsId },
    h('legend', { class: 'p-legend' }, o.legend),
    h('div', { class: 'p-scale__row' }, [1, 2, 3, 4, 5].map((n) => {
      const id = nextId(o.name);
      return h('label', { class: 'p-scale__opt', for: id },
        h('input', {
          type: 'radio', id, name: o.name, value: String(n), checked: o.value === n,
          'data-testid': o.testId ? `${o.testId}-${n}` : undefined,
          on: { change: () => o.onChange(n) },
        }),
        h('span', null, String(n)));
    })),
    h('p', { class: 'p-scale__ends', id: endsId }, h('span', null, o.lo), h('span', null, o.hi)));
}

/**
 * Copy text: Clipboard API first, then select the text in `selectEl` so the person can copy it by hand.
 * @param {string} text @param {HTMLTextAreaElement|HTMLInputElement|null} [selectEl] @returns {Promise<boolean>}
 */
export async function copyText(text, selectEl) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back to selection */ }
  if (selectEl) {
    selectEl.focus();
    selectEl.select();
    try {
      // Legacy path for browsers without the async Clipboard API in this context.
      if (document.execCommand && document.execCommand('copy')) return true;
    } catch { /* manual copy */ }
  }
  return false;
}

/** Polite live region. @param {string} [testId] */
export function liveRegion(testId) {
  return h('p', { class: 'p-status', role: 'status', 'aria-live': 'polite', 'data-testid': testId });
}

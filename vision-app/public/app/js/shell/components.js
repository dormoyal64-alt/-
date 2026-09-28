// @ts-check
/**
 * Reusable, accessible UI pieces for shell screens (labelled fields, notices, empty states, cards).
 * Everything is built with h(); no innerHTML.
 */
import { h } from '../core/dom.js';
import { icon } from './icons.js';

/** @typedef {Node|string|number|null|undefined|false} Child */

let uid = 0;
/** @param {string} prefix */
export function uniqueId(prefix = 'va') {
  uid += 1;
  return `${prefix}-${uid}`;
}

/**
 * Screen heading block. The h1 is focusable (-1) so the router can move focus to it.
 * @param {{title: string, lead?: Child|Child[], eyebrow?: string, testId?: string}} opts
 */
export function pageHeader({ title, lead, eyebrow, testId }) {
  return h('header', { class: 'va-page-head', 'data-testid': testId },
    eyebrow ? h('p', { class: 'va-eyebrow' }, eyebrow) : null,
    h('h1', { class: 'va-title', tabindex: '-1' }, title),
    lead ? h('p', { class: 'va-lead' }, lead) : null,
  );
}

/**
 * A link styled as a button.
 * @param {string} label @param {string} href
 * @param {{variant?: 'primary'|'secondary'|'ghost'|'danger', iconName?: string, testId?: string, external?: boolean, className?: string, newWindowLabel?: string}} [opts]
 */
export function linkButton(label, href, { variant = 'primary', iconName, testId, external, className = '', newWindowLabel } = {}) {
  return h('a', {
    class: `va-btn va-btn--${variant} ${className}`.trim(), href, 'data-testid': testId,
    target: external ? '_blank' : undefined, rel: external ? 'noopener noreferrer' : undefined,
  }, iconName ? icon(iconName) : null, h('span', null, label), external && newWindowLabel ? h('span', { class: 'va-visually-hidden' }, ' ' + newWindowLabel) : null);
}

/**
 * Button with icon + visible label.
 * @param {string} label
 * @param {{variant?: 'primary'|'secondary'|'ghost'|'danger', iconName?: string, onClick?: (e: MouseEvent) => void, testId?: string, type?: 'button'|'submit', disabled?: boolean, className?: string}} [opts]
 */
export function actionButton(label, { variant = 'primary', iconName, onClick, testId, type = 'button', disabled, className = '' } = {}) {
  return h('button', {
    type, class: `va-btn va-btn--${variant} ${className}`.trim(), 'data-testid': testId, disabled: !!disabled,
    on: onClick ? { click: onClick } : undefined,
  }, iconName ? icon(iconName) : null, h('span', null, label));
}

/**
 * Icon-only button with an accessible name.
 * @param {{iconName: string, label: string, onClick?: (e: MouseEvent) => void, testId?: string, className?: string}} opts
 */
export function iconButton({ iconName, label, onClick, testId, className = '' }) {
  return h('button', {
    type: 'button', class: `va-icon-btn ${className}`.trim(), 'aria-label': label, title: label, 'data-testid': testId,
    on: onClick ? { click: onClick } : undefined,
  }, icon(iconName));
}

/**
 * Wrap a control with label, hint and an error slot; wires aria-describedby / aria-invalid.
 * @param {{label: Child|Child[], control: HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement, hint?: Child|Child[], requiredMark?: string, className?: string}} opts
 */
export function field({ label, control, hint, requiredMark, className = '' }) {
  if (!control.id) control.id = uniqueId('fld');
  const hintId = `${control.id}-hint`;
  const errId = `${control.id}-err`;
  const errEl = h('p', { class: 'va-field__error', id: errId, hidden: true });
  const hintEl = hint ? h('p', { class: 'va-hint', id: hintId }, hint) : null;
  const describe = () => {
    const ids = [];
    if (hintEl) ids.push(hintId);
    if (!errEl.hidden) ids.push(errId);
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' ')); else control.removeAttribute('aria-describedby');
  };
  describe();
  const el = h('div', { class: `va-field ${className}`.trim() },
    h('label', { class: 'va-label', for: control.id }, label, requiredMark ? h('span', { class: 'va-req', 'aria-hidden': 'true' }, ' *') : null),
    hintEl,
    control,
    errEl,
  );
  return {
    el,
    /** @param {string|null} message */
    setError(message) {
      errEl.textContent = message || '';
      errEl.hidden = !message;
      if (message) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
      el.classList.toggle('has-error', !!message);
      describe();
    },
  };
}

/**
 * @param {{label: string, name: string, type?: string, autocomplete?: string, required?: boolean, value?: string, inputmode?: string,
 *   hint?: Child|Child[], testId?: string, min?: string|number, max?: string|number, step?: string|number, dir?: string, maxlength?: number, placeholder?: string}} opts
 */
export function textField(opts) {
  const input = h('input', {
    class: 'va-input', type: opts.type || 'text', name: opts.name, id: uniqueId(opts.name), autocomplete: opts.autocomplete,
    required: !!opts.required, inputmode: opts.inputmode, 'data-testid': opts.testId, min: opts.min, max: opts.max, step: opts.step,
    dir: opts.dir, maxlength: opts.maxlength, placeholder: opts.placeholder, 'aria-required': opts.required ? 'true' : undefined,
  });
  if (opts.value !== undefined && opts.value !== null) input.value = String(opts.value);
  const f = field({ label: opts.label, control: input, hint: opts.hint, requiredMark: opts.required ? '*' : undefined });
  return { el: f.el, input, setError: f.setError };
}

/**
 * Password input with a show/hide toggle.
 * @param {{label: string, name: string, autocomplete: string, showLabel: string, hideLabel: string, testId?: string, hint?: Child|Child[], required?: boolean}} opts
 */
export function passwordField(opts) {
  const input = h('input', {
    class: 'va-input va-input--password', type: 'password', name: opts.name, id: uniqueId(opts.name), autocomplete: opts.autocomplete,
    required: opts.required !== false, 'aria-required': 'true', 'data-testid': opts.testId, dir: 'ltr', spellcheck: 'false', autocapitalize: 'off',
  });
  const toggle = h('button', {
    type: 'button', class: 'va-pw-toggle', 'aria-pressed': 'false', 'aria-label': opts.showLabel, title: opts.showLabel,
    'data-testid': opts.testId ? `${opts.testId}-toggle` : undefined,
  }, icon('eye'));
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? opts.hideLabel : opts.showLabel);
    toggle.title = show ? opts.hideLabel : opts.showLabel;
    toggle.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
  });
  const f = field({ label: opts.label, control: input, hint: opts.hint, requiredMark: '*' });
  // Put the toggle next to the input inside a positioned wrapper.
  const wrap = h('div', { class: 'va-pw-wrap' });
  input.replaceWith(wrap);
  wrap.append(input, toggle);
  return { el: f.el, input, setError: f.setError };
}

/**
 * @param {{label: Child|Child[], name: string, required?: boolean, checked?: boolean, testId?: string, onChange?: (checked: boolean) => void, className?: string}} opts
 */
export function checkboxField(opts) {
  const input = h('input', {
    type: 'checkbox', class: 'va-check__input', name: opts.name, id: uniqueId(opts.name), required: !!opts.required,
    'aria-required': opts.required ? 'true' : undefined, 'data-testid': opts.testId, checked: !!opts.checked,
  });
  if (opts.onChange) input.addEventListener('change', () => opts.onChange?.(input.checked));
  const errId = `${input.id}-err`;
  const errEl = h('p', { class: 'va-field__error', id: errId, hidden: true });
  const el = h('div', { class: `va-check ${opts.className || ''}`.trim() },
    h('div', { class: 'va-check__row' }, input, h('label', { for: input.id, class: 'va-check__label' }, opts.label)),
    errEl,
  );
  return {
    el, input,
    /** @param {string|null} message */
    setError(message) {
      errEl.textContent = message || '';
      errEl.hidden = !message;
      if (message) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', errId); } else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
      el.classList.toggle('has-error', !!message);
    },
  };
}

/**
 * Radio group rendered as large tappable options.
 * @param {{legend: string, name: string, options: {value: string, label: Child|Child[], hint?: string, lang?: string}[], value?: string|null,
 *   onChange?: (value: string) => void, testId?: string, className?: string, required?: boolean, hint?: string}} opts
 */
export function radioGroup(opts) {
  const errEl = h('p', { class: 'va-field__error', id: uniqueId('rg-err'), hidden: true });
  const hintEl = opts.hint ? h('p', { class: 'va-hint', id: uniqueId('rg-hint') }, opts.hint) : null;
  /** @type {HTMLInputElement[]} */
  const inputs = [];
  const el = h('fieldset', { class: `va-choice ${opts.className || ''}`.trim(), 'data-testid': opts.testId, 'aria-describedby': hintEl ? hintEl.id : undefined },
    h('legend', { class: 'va-label' }, opts.legend, opts.required ? h('span', { class: 'va-req', 'aria-hidden': 'true' }, ' *') : null),
    hintEl,
    h('div', { class: 'va-choice__options' }, opts.options.map((o) => {
      const input = h('input', {
        type: 'radio', class: 'va-choice__input', name: opts.name, value: o.value, id: uniqueId(opts.name),
        checked: opts.value === o.value, 'data-testid': opts.testId ? `${opts.testId}-${o.value}` : undefined,
        required: !!opts.required,
      });
      inputs.push(input);
      input.addEventListener('change', () => { if (input.checked) opts.onChange?.(o.value); });
      return h('label', { class: 'va-choice__option', for: input.id, lang: o.lang },
        input,
        h('span', { class: 'va-choice__text' }, h('span', { class: 'va-choice__label' }, o.label), o.hint ? h('span', { class: 'va-hint' }, o.hint) : null),
      );
    })),
    errEl,
  );
  return {
    el,
    get value() { return inputs.find((i) => i.checked)?.value ?? null; },
    focus() { (inputs.find((i) => i.checked) || inputs[0])?.focus(); },
    /** @param {string|null} message */
    setError(message) {
      errEl.textContent = message || '';
      errEl.hidden = !message;
      el.classList.toggle('has-error', !!message);
      const ids = [hintEl?.id, message ? errEl.id : null].filter(Boolean).join(' ');
      if (ids) el.setAttribute('aria-describedby', ids); else el.removeAttribute('aria-describedby');
    },
  };
}

/**
 * On/off switch (checkbox with role=switch).
 * @param {{label: string, description?: string, checked?: boolean, disabled?: boolean, onChange?: (on: boolean) => void, testId?: string}} opts
 */
export function switchField(opts) {
  const input = h('input', {
    type: 'checkbox', role: 'switch', class: 'va-switch__input', id: uniqueId('sw'), checked: !!opts.checked,
    disabled: !!opts.disabled, 'data-testid': opts.testId,
  });
  const descId = opts.description ? `${input.id}-desc` : undefined;
  if (descId) input.setAttribute('aria-describedby', descId);
  if (opts.onChange) input.addEventListener('change', () => opts.onChange?.(input.checked));
  const el = h('div', { class: 'va-switch' },
    h('div', { class: 'va-switch__text' },
      h('label', { class: 'va-label', for: input.id }, opts.label),
      opts.description ? h('p', { class: 'va-hint', id: descId }, opts.description) : null,
    ),
    h('span', { class: 'va-switch__control' }, input, h('span', { class: 'va-switch__track', 'aria-hidden': 'true' })),
  );
  return { el, input };
}

/**
 * @param {'info'|'success'|'warning'|'danger'} kind
 * @param {Child|Child[]} content
 * @param {{title?: string, role?: 'status'|'alert'|'note', testId?: string, actions?: Node[], iconName?: string}} [opts]
 */
export function notice(kind, content, opts = {}) {
  const iconName = opts.iconName || (kind === 'success' ? 'check' : kind === 'info' ? 'info' : 'warning');
  return h('div', { class: `va-notice va-notice--${kind} va-callout`, role: opts.role, 'data-testid': opts.testId },
    h('span', { class: 'va-callout__icon' }, icon(iconName)),
    h('div', { class: 'va-callout__body' },
      opts.title ? h('p', { class: 'va-callout__title' }, opts.title) : null,
      ...(Array.isArray(content) ? content : [content]).map((c) => (typeof c === 'string' ? h('p', { class: 'va-callout__text' }, c) : c)),
      opts.actions?.length ? h('div', { class: 'va-callout__actions' }, ...opts.actions) : null,
    ),
  );
}

/**
 * @param {{iconName?: string, title: string, body?: string|string[], actions?: Node[], testId?: string, headingLevel?: 1|2}} opts
 */
export function emptyState({ iconName = 'info', title, body, actions = [], testId, headingLevel = 1 }) {
  const heading = headingLevel === 1
    ? h('h1', { class: 'va-title va-empty__title', tabindex: '-1' }, title)
    : h('h2', { class: 'va-empty__title' }, title);
  return h('section', { class: 'va-empty', 'data-testid': testId },
    h('div', { class: 'va-empty__icon' }, icon(iconName, { size: 40 })),
    heading,
    ...(Array.isArray(body) ? body : body ? [body] : []).map((b) => h('p', { class: 'va-empty__text' }, b)),
    actions.length ? h('div', { class: 'va-actions va-actions--center' }, ...actions) : null,
  );
}

/** @param {string} label */
export function spinner(label) {
  return h('div', { class: 'va-loading', role: 'status' }, h('span', { class: 'va-spinner', 'aria-hidden': 'true' }), h('span', { class: 'va-loading__label' }, label));
}

/**
 * A titled card section.
 * @param {{title?: string, iconName?: string, children?: Child|Child[], actions?: Node[], testId?: string, className?: string, headingLevel?: 2|3, id?: string}} opts
 */
export function card({ title, iconName, children, actions, testId, className = '', headingLevel = 2, id }) {
  const Tag = headingLevel === 3 ? 'h3' : 'h2';
  return h('section', { class: `va-card ${className}`.trim(), 'data-testid': testId, id, 'aria-labelledby': title && id ? `${id}-h` : undefined },
    title ? h('div', { class: 'va-card__head' }, iconName ? h('span', { class: 'va-card__icon' }, icon(iconName)) : null, h(Tag, { class: 'va-card__title', id: id ? `${id}-h` : undefined }, title)) : null,
    ...(Array.isArray(children) ? children : [children]),
    actions?.length ? h('div', { class: 'va-card__actions' }, ...actions) : null,
  );
}

/**
 * Error summary shown at the top of a form (role=alert so it is announced).
 */
export function formAlert() {
  const el = h('div', { class: 'va-form-alert', role: 'alert', hidden: true, 'data-testid': 'form-alert' });
  return {
    el,
    /** @param {string|null} message */
    set(message) {
      el.replaceChildren(...(message ? [icon('warning'), h('span', null, message)] : []));
      el.hidden = !message;
    },
  };
}

/**
 * Busy state for a submit button while a request is in flight.
 * @param {HTMLButtonElement} btn @param {boolean} busy
 */
export function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.classList.toggle('is-busy', busy);
  if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}

/**
 * Definition-style rows ("Plan: Yearly").
 * @param {Array<[string, Child|Child[]]>} rows @param {string} [testId]
 */
export function infoList(rows, testId) {
  return h('dl', { class: 'va-info', 'data-testid': testId },
    rows.map(([k, v]) => h('div', { class: 'va-info__row' }, h('dt', null, k), h('dd', null, v))));
}

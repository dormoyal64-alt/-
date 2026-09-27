// @ts-check
/**
 * Safe DOM construction helpers. NEVER use innerHTML with dynamic data (XSS).
 * Styles: use the `style` object form (CSSOM) — never a style attribute string (CSP).
 */

/**
 * @typedef {Object<string, any>} Attrs
 * Special keys: class (string), style (object of CSS props / custom properties), dataset (object),
 * on (object of event listeners), text (textContent). Boolean true => empty attribute; false/null => omitted.
 */

/**
 * Create an element.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Attrs|null} [attrs]
 * @param {...(Node|string|number|null|undefined|false|Array<Node|string|number|null|undefined|false>)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

/**
 * Create an SVG element.
 * @param {string} tag
 * @param {Attrs|null} [attrs]
 * @param {...(Node|string|null|undefined|false|Array<Node|string|null|undefined|false>)} children
 * @returns {SVGElement}
 */
export function s(tag, attrs, ...children) {
  const el = /** @type {SVGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', tag));
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

/** @param {Element} el @param {Attrs|null|undefined} attrs */
function applyAttrs(el, attrs) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.setAttribute('class', String(value));
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'style' && typeof value === 'object') {
      const style = /** @type {HTMLElement} */ (el).style;
      for (const [prop, v] of Object.entries(value)) {
        if (v === undefined || v === null) continue;
        if (prop.startsWith('--') || prop.includes('-')) style.setProperty(prop, String(v));
        else style[prop] = String(v);
      }
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) /** @type {HTMLElement} */ (el).dataset[k] = String(v);
    } else if (key === 'on' && typeof value === 'object') {
      for (const [evt, fn] of Object.entries(value)) el.addEventListener(evt, fn);
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
}

/** @param {Node} el @param {any[]} children */
function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Remove all children of an element. @param {Element} el */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** @returns {DOMException} */
export function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

/** @param {unknown} err */
export function isAbortError(err) {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Throw an AbortError if the signal is aborted.
 * @param {AbortSignal|undefined} signal
 */
export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

/**
 * Resolve after ms, reject with AbortError on abort.
 * @param {number} ms @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const id = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(id); reject(abortError()); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wraps a view body so abort always triggers cleanup exactly once and rejects with AbortError.
 * Usage inside a view:
 *   return runView(ctx.signal, async (onCleanup) => { onCleanup(() => stream.stop()); ...; return result; });
 * @template T
 * @param {AbortSignal|undefined} signal
 * @param {(onCleanup: (fn: () => void) => void) => Promise<T>} body
 * @returns {Promise<T>}
 */
export async function runView(signal, body) {
  /** @type {Array<() => void>} */
  const cleanups = [];
  const onCleanup = (fn) => { cleanups.push(fn); };
  const runCleanups = () => {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch (err) { console.error('cleanup failed', err); }
    }
  };
  throwIfAborted(signal);
  /** @type {Promise<never>} */
  const aborted = new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
  aborted.catch(() => { /* handled via Promise.race; avoid unhandled rejection after completion */ });
  try {
    return await Promise.race([body(onCleanup), aborted]);
  } finally {
    runCleanups();
  }
}

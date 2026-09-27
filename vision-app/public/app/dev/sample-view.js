// @ts-check
// Sample view used to verify the harness + shared UI kit. DEV ONLY.
import { h, runView } from '../js/core/dom.js';
import { coverEyeScreen, directionPad, screen } from '../js/core/ui.js';

/** @param {HTMLElement} container @param {import('../js/core/types.js').TestContext} ctx */
export function runSample(container, ctx) {
  return runView(ctx.signal, async (onCleanup) => {
    await coverEyeScreen(container, { eye: ctx.eye || 'right', lang: ctx.lang, signal: ctx.signal });
    return new Promise((resolve) => {
      const pad = directionPad({ lang: ctx.lang, onAnswer: (d) => resolve({ answer: d, eye: ctx.eye }) });
      onCleanup(() => { pad.destroy(); container.replaceChildren(); });
      container.appendChild(screen({ title: 'Sample', body: [h('div', { class: 'va-test-surface', style: { height: '120px' } }, 'E')], actions: [pad.el] }));
    });
  });
}

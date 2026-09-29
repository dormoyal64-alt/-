// @ts-check
/**
 * Full-screen stage for the onboarding flow: top bar with exit button, "Step X of N", step title, a progress bar
 * fed by ctx.onProgress, and overall progress dots. Test views render inside `body`.
 */
import { h } from '../core/dom.js';
import { progressBar } from '../core/ui.js';
import { iconButton } from '../shell/components.js';

/**
 * @param {{t: (key: string, params?: Record<string, string|number>) => string, onExit: () => void}} opts
 */
export function createStage({ t, onExit }) {
  const stepText = h('p', { class: 'va-stage__step', 'data-testid': 'stage-step' });
  const titleText = h('p', { class: 'va-stage__title', 'data-testid': 'stage-title' });
  const bar = progressBar();
  bar.el.setAttribute('aria-label', t('progressLabel'));
  bar.el.classList.add('va-stage__progress');
  bar.el.dataset.testid = 'stage-progress';
  const dots = h('ol', { class: 'va-stage__dots', 'aria-hidden': 'true' });
  const overall = h('p', { class: 'va-visually-hidden' });
  const body = h('div', { class: 'va-stage__body', 'data-testid': 'stage-body' });
  const el = h('div', { class: 'va-stage', 'data-testid': 'screen-onboarding' },
    h('div', { class: 'va-stage__top' },
      h('div', { class: 'va-stage__bar' },
        iconButton({ iconName: 'close', label: t('exit'), onClick: onExit, testId: 'stage-exit', className: 'va-stage__exit' }),
        h('div', { class: 'va-stage__meta' }, stepText, titleText),
      ),
      bar.el,
      dots,
      overall,
    ),
    body,
  );
  return {
    el,
    body,
    /**
     * @param {{step?: number, total?: number, title: string, done?: number, label?: string}} o
     *   step/total: "Step X of N"; label replaces that text (e.g. "Before we start")
     */
    setHeader(o) {
      stepText.textContent = o.label ?? (o.step && o.total ? t('stepOf', { n: o.step, total: o.total }) : '');
      titleText.textContent = o.title;
      const total = o.total || 0;
      dots.replaceChildren(...Array.from({ length: total }, (_, i) => h('li', {
        class: `va-stage__dot${i < (o.done ?? 0) ? ' is-done' : ''}${o.step && i === o.step - 1 ? ' is-current' : ''}`,
      })));
      dots.hidden = total === 0;
      overall.textContent = total ? t('overallLabel', { done: o.done ?? 0, total }) : '';
    },
    /** @param {number} fraction */
    setProgress(fraction) { bar.set(Number.isFinite(fraction) ? fraction : 0); },
  };
}

// @ts-check
/**
 * #/guide — "Adapt my whole phone": engine/system-guide.js detectPlatform + buildSystemGuide with the active
 * profile's `system` targets; platform switcher; per-section "done" ticks persisted on this device; progress.
 * On Android / Samsung, a card hands the profile's display values to the SeeTuned Android app
 * (engine/android-link.js). Without the app installed, the browser comes back here with ?companion=missing.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { getActiveProfile } from '../core/storage.js';
import { SCREEN_STRINGS } from './strings.js';
import { loadModule, unavailableState } from '../shell/modules.js';
import { pageHeader, emptyState, linkButton, actionButton, notice } from '../shell/components.js';
import { icon } from '../shell/icons.js';
import { loadGuideDone, saveGuideDone, guideProgress } from './guide-progress.js';
import { buildAndroidRecipe, androidIntentUrl } from '../engine/android-link.js';
import { ANDROID_APP_URL } from '../shell/brand.js';

/** @typedef {import('../core/types.js').GuideSection} GuideSection */
/** @typedef {import('../core/types.js').Platform} Platform */

const PLATFORM_KEY = 'va.guide.platform';
/** @type {Platform[]} */
const CHOICES = ['ios', 'ipados', 'android', 'samsung'];

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export async function mount(ctx) {
  const t = makeT(SCREEN_STRINGS, ctx.lang);
  const profile = getActiveProfile();
  const el = h('div', { class: 'va-page va-guide', 'data-testid': 'screen-guide' });
  if (!profile) {
    el.append(emptyState({ iconName: 'phone', title: t('guide.title'), body: t('guide.noProfile'), testId: 'guide-noprofile', actions: [linkButton(t('viewer.start'), '#/onboarding')] }));
    return { el };
  }
  const res = await loadModule('systemGuide', 'buildSystemGuide');
  if (!res.ok || typeof res.mod.detectPlatform !== 'function') {
    el.append(unavailableState(ctx.lang, { reason: res.ok ? 'missing' : res.reason, onRetry: () => ctx.shell.refresh(), testId: 'guide-unavailable', title: t('guide.title') }));
    return { el };
  }
  const guideMod = res.mod;
  /** @type {Platform} */
  let detected = 'other';
  let model = '';
  try {
    const uad = /** @type {any} */ (navigator).userAgentData;
    if (uad?.getHighEntropyValues) model = (await uad.getHighEntropyValues(['model']))?.model || '';
  } catch { /* UA-CH unavailable */ }
  try { detected = guideMod.detectPlatform(navigator.userAgent, navigator.maxTouchPoints, model); } catch { /* keep other */ }
  /** @type {Platform} */
  let platform = /** @type {Platform} */ (readPlatform() || detected);
  const choices = CHOICES.includes(detected) ? CHOICES : [...CHOICES, detected];
  const content = h('div', { class: 'va-stack' });

  const switcher = h('fieldset', { class: 'va-segmented', 'data-testid': 'guide-platforms' },
    h('legend', { class: 'va-label' }, t('guide.platform')),
    h('div', { class: 'va-segmented__options' }, choices.map((p) => {
      const input = h('input', { type: 'radio', name: 'platform', value: p, id: `plat-${p}`, checked: p === platform, class: 'va-segmented__input', 'data-testid': `platform-${p}` });
      input.addEventListener('change', () => { if (input.checked) { platform = p; writePlatform(p); render(); } });
      return h('label', { for: `plat-${p}`, class: 'va-segmented__option' }, input, h('span', null, t(`guide.p.${p}`)));
    })),
    h('p', { class: 'va-hint' }, t('guide.detected', { platform: t(`guide.p.${detected}`) })));

  function render() {
    /** @type {GuideSection[]} */
    let sections = [];
    try { sections = guideMod.buildSystemGuide(profile.system, platform, ctx.lang) || []; } catch (err) { console.warn('buildSystemGuide failed', err); }
    const done = loadGuideDone(profile.id, platform);
    const progressText = h('p', { class: 'va-guide__progress-text', 'data-testid': 'guide-progress' });
    const bar = h('div', { class: 'va-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { class: 'va-progress__fill' }));
    const allDone = notice('success', t('guide.allDone'), { role: 'status', testId: 'guide-alldone' });
    const update = () => {
      const pr = guideProgress(sections, done);
      progressText.textContent = t('guide.progress', { done: pr.done, total: pr.total });
      /** @type {HTMLElement} */ (bar.firstElementChild).style.width = `${pr.percent}%`;
      bar.setAttribute('aria-valuenow', String(pr.percent));
      bar.setAttribute('aria-label', progressText.textContent);
      allDone.hidden = !(pr.total > 0 && pr.done >= pr.total);
    };
    const companion = platform === 'android' || platform === 'samsung' ? companionCard() : null;
    if (!sections.length) { content.replaceChildren(...(companion ? [companion] : []), notice('info', t('guide.empty'))); return; }
    const items = sections.map((s, i) => {
      const cb = h('input', { type: 'checkbox', class: 'va-check__input', id: `g-${s.id}`, checked: done.has(s.id), 'data-testid': `guide-done-${s.id}` });
      const item = h('li', { class: `va-guide-step${done.has(s.id) ? ' is-done' : ''}`, 'data-testid': `guide-section-${s.id}` },
        h('div', { class: 'va-guide-step__head' },
          h('span', { class: 'va-guide-step__num', 'aria-hidden': 'true' }, String(i + 1)),
          h('h2', { class: 'va-guide-step__title' }, s.title),
          h('span', { class: `va-badge${s.recommended ? ' va-badge--rec' : ''}` }, s.recommended ? t('guide.recommended') : t('guide.optional'))),
        s.why ? h('p', { class: 'va-guide-step__why' }, h('strong', null, t('guide.why') + ' '), s.why) : null,
        s.value ? h('p', { class: 'va-guide-step__value' }, icon('sparkle', { size: 20 }), h('span', null, h('strong', null, t('guide.setTo') + ' '), s.value)) : null,
        h('ol', { class: 'va-guide-step__steps' }, (s.steps || []).map((st) => h('li', null, st))),
        h('div', { class: 'va-check va-guide-step__done' }, h('div', { class: 'va-check__row' }, cb, h('label', { for: cb.id, class: 'va-check__label' }, t('guide.done')))));
      cb.addEventListener('change', () => {
        if (cb.checked) done.add(s.id); else done.delete(s.id);
        item.classList.toggle('is-done', cb.checked);
        saveGuideDone(profile.id, platform, done);
        update();
        ctx.shell.announce(progressText.textContent || '');
      });
      return item;
    });
    update();
    content.replaceChildren(
      ...(companion ? [companion] : []),
      h('div', { class: 'va-card va-guide__progress' }, progressText, bar),
      allDone,
      h('ol', { class: 'va-guide-steps', role: 'list' }, ...items),
      h('div', { class: 'va-actions va-actions--row' }, actionButton(t('guide.reset'), {
        variant: 'ghost', iconName: 'retest', testId: 'guide-reset',
        onClick: () => { done.clear(); saveGuideDone(profile.id, platform, done); render(); },
      })),
    );
  }

  /** The "apply everything automatically" card (Android / Samsung only). */
  function companionCard() {
    const fallback = `${location.href.split('#')[0]}#/guide?companion=missing`;
    const href = androidIntentUrl(buildAndroidRecipe(profile, ctx.lang), fallback);
    const missing = ctx.route.query.companion === 'missing';
    return h('section', { class: 'va-card va-stack va-guide__companion', 'data-testid': 'guide-companion', 'aria-labelledby': 'guide-companion-title' },
      h('h2', { id: 'guide-companion-title', class: 'va-guide-step__title' }, t('guide.companion.title')),
      h('p', null, t('guide.companion.body')),
      missing ? notice('info', [t('guide.companion.missing'), ANDROID_APP_URL ? '' : t('guide.companion.pilotOnly')].filter(Boolean), {
        role: 'status', testId: 'guide-companion-missing',
        actions: ANDROID_APP_URL ? [linkButton(t('guide.companion.get'), ANDROID_APP_URL, { variant: 'secondary', testId: 'guide-companion-get' })] : [],
      }) : null,
      h('div', { class: 'va-actions' }, linkButton(t('guide.companion.open'), href, { iconName: 'phone', testId: 'guide-companion-open' })),
      h('p', { class: 'va-hint' }, t('guide.companion.privacy')));
  }

  render();
  el.append(pageHeader({ title: t('guide.title'), lead: t('guide.lead') }), switcher, content);
  return { el };
}

/** @returns {Platform|null} */
function readPlatform() {
  try { return /** @type {Platform|null} */ (localStorage.getItem(PLATFORM_KEY)); } catch { return null; }
}
/** @param {Platform} p */
function writePlatform(p) {
  try { localStorage.setItem(PLATFORM_KEY, p); } catch { /* ignore */ }
}

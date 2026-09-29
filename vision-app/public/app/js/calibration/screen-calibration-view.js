// @ts-check
/**
 * Physical screen calibration (spec §1.2): match an ID-1 card outline (slider + ±1 px), two matches from
 * too-large / too-small starts (≤ 1.5% agreement, else a third match and the median), plausibility check on the
 * device pixel pitch, a known-model cross-check, and a final confirmation. Fallbacks: ruler, or a default estimate.
 */
import { h, clear, runView } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { screen as uiScreen, button } from '../core/ui.js';
import {
  CARD_WIDTH_MM, RULER_LENGTH_MM, clamp, evaluateCardMatches, isPlausibleCssPxPerMm, plausibleCssPxPerMmRange,
  knownDevicePpi, cssPxPerMmFromPpi, crossCheckKnownDevice, defaultCssPxPerMm, cssPxPerMmFromCard, cssPxPerMmFromLength,
} from './calibration-math.js';
import { choose, show, stickyBar, sizeMatcher, cardIllustration } from './calibration-ui.js';
import { SCREEN_STRINGS, COMMON_STRINGS } from './strings.js';

/** @typedef {import('../core/types.js').ScreenCalibration} ScreenCalibration */
/** @typedef {import('../core/types.js').TestContext} TestContext */

const STRINGS = {
  he: { ...COMMON_STRINGS.he, ...SCREEN_STRINGS.he },
  en: { ...COMMON_STRINGS.en, ...SCREEN_STRINGS.en },
};

/** Start the "too large" / "too small" matches this far from the best guess (spec step 5). */
const START_OFFSET = 0.12;
const MAX_ATTEMPTS = 2;

/** @returns {{screenWidthCssPx: number, screenHeightCssPx: number, dpr: number, apple: boolean, touch: boolean}} */
function deviceInfo() {
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 0;
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
  return {
    screenWidthCssPx: window.screen.width, screenHeightCssPx: window.screen.height,
    dpr: window.devicePixelRatio || 1, apple, touch,
  };
}

/**
 * @param {HTMLElement} container
 * @param {TestContext} ctx
 * @returns {Promise<ScreenCalibration>}
 */
export function runScreenCalibration(container, ctx) {
  return runView(ctx.signal, async (onCleanup) => {
    const t = makeT(STRINGS, ctx.lang);
    onCleanup(() => clear(container));
    /** @type {Array<() => void>} */
    const disposers = [];
    onCleanup(() => disposers.splice(0).forEach((fn) => fn()));
    const dev = deviceInfo();
    const range = plausibleCssPxPerMmRange(dev.dpr);
    const knownPpi = knownDevicePpi(dev);
    const expected = knownPpi ? cssPxPerMmFromPpi(knownPpi, dev.dpr) : null;
    const guess = clamp(defaultCssPxPerMm(dev), range.min, range.max);
    ctx.onProgress?.(0);

    /** @param {number} cssPxPerMm @param {'card'|'ruler'|'default'} method @returns {ScreenCalibration} */
    const result = (cssPxPerMm, method) => ({
      cssPxPerMm, dpr: dev.dpr, method,
      screenWidthCssPx: window.screen.width, screenHeightCssPx: window.screen.height,
      measuredAt: new Date().toISOString(),
    });

    /**
     * One match on the size-matcher screen.
     * @param {'card'|'ruler'} kind @param {number} startCssPxPerMm @param {number} step
     * @returns {Promise<number>} matched CSS px per mm
     */
    const matchOnce = (kind, startCssPxPerMm, step) => new Promise((resolve) => {
      const lengthMm = kind === 'card' ? CARD_WIDTH_MM : RULER_LENGTH_MM;
      const matcher = sizeMatcher({
        kind,
        minPx: Math.ceil(range.min * lengthMm),
        maxPx: Math.floor(range.max * lengthMm),
        startPx: startCssPxPerMm * lengthMm,
        sliderLabel: t(kind === 'card' ? 'sliderCard' : 'sliderRuler'),
        smallerLabel: t('smaller'),
        largerLabel: t('larger'),
      });
      disposers.push(matcher.destroy);
      const hint = kind === 'card'
        ? (step === 1 ? t('matchHint') : t('matchAgainHint'))
        : (step === 1 ? `${t('rulerIntro')} ${t('rulerHint')}` : `${t('matchAgainHint')} ${t('rulerHint')}`);
      const done = button(t('matchDone'), {
        testId: 'match-done',
        onClick: () => {
          matcher.destroy();
          resolve(kind === 'card' ? cssPxPerMmFromCard(matcher.value()) : cssPxPerMmFromLength(matcher.value(), lengthMm));
        },
      });
      show(container, uiScreen({
        title: t(kind === 'card' ? 'matchTitle' : 'rulerTitle'),
        testId: `screen-match-${kind}`,
        body: [
          h('p', { class: 'va-hint', 'data-testid': 'match-step' }, `${t('matchStep', { n: step })} · ${hint}`),
          matcher.figureEl,
          stickyBar(matcher.controlsEl, done),
        ],
      }));
    });

    /**
     * Repeated matches until they agree (spec step 5) and pass the plausibility check.
     * @param {'card'|'ruler'} kind
     * @returns {Promise<number|null>} CSS px per mm, or null when the user gives up
     */
    const matchProcedure = async (kind) => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        /** @type {number[]} */
        const matches = [];
        let verdict = evaluateCardMatches(matches);
        while (verdict.status === 'repeat' && matches.length < 3) {
          const n = matches.length;
          const base = n === 0 ? guess : matches[0];
          const start = n === 0 ? base * (1 + START_OFFSET) : n === 1 ? base * (1 - START_OFFSET) : guess;
          matches.push(await matchOnce(kind, clamp(start, range.min, range.max), n + 1));
          ctx.onProgress?.(Math.min(0.8, 0.3 * matches.length));
          verdict = evaluateCardMatches(matches);
        }
        if (verdict.status === 'accept' && isPlausibleCssPxPerMm(verdict.cssPxPerMm, dev.dpr)) {
          const confirmed = await confirmStep(kind, verdict.cssPxPerMm);
          if (confirmed) return verdict.cssPxPerMm;
          continue;
        }
        const again = await choose(container, {
          title: t('implausibleTitle'), paragraphs: [t('implausibleBody')], testId: 'screen-implausible',
          options: [
            { label: t('tryAgain'), value: 'again', testId: 'implausible-again' },
            { label: t('useDefault'), value: 'default', variant: 'secondary', testId: 'implausible-default' },
          ],
        });
        if (again === 'default') return null;
      }
      return null;
    };

    /**
     * Show the final outline at the matched size; the user confirms with the card once more.
     * @param {'card'|'ruler'} kind @param {number} cssPxPerMm
     * @returns {Promise<boolean>}
     */
    const confirmStep = (kind, cssPxPerMm) => new Promise((resolve) => {
      const lengthMm = kind === 'card' ? CARD_WIDTH_MM : RULER_LENGTH_MM;
      const px = cssPxPerMm * lengthMm;
      const matcher = sizeMatcher({
        kind, minPx: Math.floor(px), maxPx: Math.ceil(px) + 1, startPx: px,
        sliderLabel: t(kind === 'card' ? 'sliderCard' : 'sliderRuler'), smallerLabel: t('smaller'), largerLabel: t('larger'),
      });
      disposers.push(matcher.destroy);
      // Draw the exact (fractional) mean size rather than the rounded slider value.
      const svg = /** @type {SVGElement} */ (matcher.figureEl.firstChild);
      const scale = px / matcher.value();
      svg.setAttribute('width', String(Number(svg.getAttribute('width')) * scale));
      svg.setAttribute('height', String(Number(svg.getAttribute('height')) * scale));
      const check = kind === 'card' ? crossCheckKnownDevice(cssPxPerMm, expected) : { warn: false };
      const finish = (/** @type {boolean} */ ok) => { matcher.destroy(); resolve(ok); };
      show(container, uiScreen({
        title: t('confirmTitle'),
        testId: 'screen-confirm',
        body: [
          check.warn ? h('p', { class: 'va-notice va-notice--warning', role: 'status', 'data-testid': 'known-device-warning' }, t('warnKnown')) : null,
          h('p', { class: 'va-text' }, t(kind === 'card' ? 'confirmBody' : 'confirmBodyRuler')),
          matcher.figureEl,
          stickyBar(
            button(t('confirmYes'), { testId: 'confirm-yes', onClick: () => finish(true) }),
            button(t('confirmNo'), { variant: 'secondary', testId: 'confirm-no', onClick: () => finish(false) }),
          ),
        ].filter(Boolean),
      }));
    });

    // ---- flow ----
    let route = await choose(container, {
      title: t('title'), illustration: cardIllustration(), paragraphs: [t('intro1'), t('intro2'), t('intro3')],
      testId: 'screen-intro',
      options: [
        { label: t('haveCard'), value: 'card', testId: 'screen-have-card' },
        { label: t('noCard'), value: 'nocard', variant: 'secondary', testId: 'screen-no-card' },
      ],
    });
    for (;;) {
      if (route === 'card' || route === 'ruler') {
        const v = await matchProcedure(route);
        if (v !== null) { ctx.onProgress?.(1); return result(v, route); }
        route = 'default';
      }
      if (route === 'nocard') {
        route = await choose(container, {
          title: t('noCardTitle'), paragraphs: [t('noCardBody')], testId: 'screen-no-card-options',
          options: [
            { label: t('useRuler'), value: 'ruler', testId: 'screen-use-ruler' },
            { label: t('useDefault'), value: 'default', variant: 'secondary', testId: 'screen-use-default' },
            { label: t('backToCard'), value: 'card', variant: 'ghost', testId: 'screen-back-to-card' },
          ],
        });
        continue;
      }
      if (route === 'default') {
        const ok = await choose(container, {
          title: t('defaultTitle'), paragraphs: [t('defaultBody')], testId: 'screen-default',
          options: [
            { label: t('continue'), value: 'ok', testId: 'screen-default-ok' },
            { label: t('backToCard'), value: 'card', variant: 'secondary', testId: 'screen-back-to-card' },
          ],
        });
        if (ok === 'ok') {
          ctx.onProgress?.(1);
          return result(defaultCssPxPerMm(dev), 'default');
        }
        route = 'card';
      }
    }
  });
}

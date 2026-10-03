// @ts-check
/**
 * "Small detail check" view — adaptive Tumbling-E acuity test (vision-science.md §1.3, §3).
 * runAcuityTest(container, ctx) → Promise<AcuityResult>. User-facing text never shows clinical notation.
 */
import { h, runView, delay, throwIfAborted } from '../../core/dom.js';
import { makeT } from '../../core/i18n.js';
import { coverEyeScreen, instructionScreen, directionPad, focusTitle } from '../../core/ui.js';
import { DEFAULT_CSS_PX_PER_MM } from '../../core/types.js';
import {
  minRenderableLogMAR, maxFittingLogMAR, strokeDevicePx, decimalFromLogMAR, snellen6, snellen20,
} from './acuity-math.js';
import { createAcuityProcedure } from './acuity-procedure.js';
import { layoutTumblingE, fillRects } from './optotype.js';
import { createStimulusCanvas } from './stimulus-canvas.js';
import { createAnswerChannel, createDistanceSource, squareStimulusSize } from './view-kit.js';
import { mulberry32, nextOrientation } from './random.js';

/** @typedef {import('../../core/types.js').TestContext} TestContext */
/** @typedef {import('../../core/types.js').AcuityResult} AcuityResult */
/** @typedef {import('./random.js').Direction} Direction */

const STRINGS = {
  he: {
    introTitle: 'בדיקת פרטים קטנים',
    intro1: 'תופיע האות E, בכל פעם בכיוון אחר. הקישו על החץ שמראה לאן פונות שלוש הרגליים של ה-E, או החליקו באצבע על האות לאותו כיוון.',
    intro2: 'האות תלך ותקטן. כשקשה לראות — פשוט נחשו. טעויות הן חלק מהבדיקה.',
    intro3: 'החזיקו את המכשיר במרחק הרגיל שלכם ואל תקרבו אותו במהלך הבדיקה.',
    practiceTitle: 'תרגול קצר',
    testTitle: 'לאן פונות הרגליים של ה-E?',
    practiceCorrect: 'נכון!',
    practiceWrong: 'לא בדיוק — הרגליים פנו {dir}. ננסה שוב.',
    readyTitle: 'מעולה, מתחילים',
    ready1: 'מעכשיו לא נראה אם צדקתם. אם אתם לא בטוחים — נחשו, או הקישו "לא בטוח/ה".',
    ready2: 'הבדיקה נמשכת כדקה.',
    start: 'התחל',
    moveCloser: 'התקרבו מעט למסך',
    moveFarther: 'התרחקו מעט מהמסך',
    up: 'למעלה', down: 'למטה', left: 'שמאלה', right: 'ימינה',
    stimulusLabel: 'האות E',
  },
  en: {
    introTitle: 'Small detail check',
    intro1: 'You will see the letter E, turned a different way each time. Tap the arrow that shows where the E’s three arms point, or swipe on the letter in that direction.',
    intro2: 'The letter will get smaller. When it is hard to see, just take your best guess. Mistakes are part of the check.',
    intro3: 'Hold the device at your usual distance and don’t bring it closer during the check.',
    practiceTitle: 'Quick practice',
    testTitle: 'Which way do the E’s arms point?',
    practiceCorrect: 'Correct!',
    practiceWrong: 'Not quite — the arms pointed {dir}. Let’s try again.',
    readyTitle: 'Great, let’s start',
    ready1: 'From now on you won’t see whether you were right. If you’re not sure, guess or tap “Not sure”.',
    ready2: 'The check takes about a minute.',
    start: 'Start',
    moveCloser: 'Move a little closer to the screen',
    moveFarther: 'Move a little farther from the screen',
    up: 'up', down: 'down', left: 'left', right: 'right',
    stimulusLabel: 'The letter E',
  },
};

const PRACTICE_LOGMAR = 1.0;
const PRACTICE_MAX_TRIALS = 4;
const PRACTICE_NEEDED = 2;
const BLANK_MS = 250;

/**
 * @param {HTMLElement} container
 * @param {TestContext} ctx
 * @returns {Promise<AcuityResult>}
 */
export function runAcuityTest(container, ctx) {
  return runView(ctx.signal, async (onCleanup) => {
    onCleanup(() => container.replaceChildren());
    const t = makeT(STRINGS, ctx.lang);
    const signal = ctx.signal;
    const eye = ctx.eye || 'right';
    const cssPxPerMm = ctx.screen?.cssPxPerMm || DEFAULT_CSS_PX_PER_MM;
    const distance = createDistanceSource(ctx);
    const rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);

    await coverEyeScreen(container, { eye, lang: ctx.lang, signal });
    await instructionScreen(container, {
      title: t('introTitle'), paragraphs: [t('intro1'), t('intro2'), t('intro3')],
      primaryLabel: t('start'), signal, testId: 'acuity-intro',
    });

    // ---- trial screen (kept for practice and test) ----
    const side = squareStimulusSize(container, { reserveHeight: 420 });
    const stim = createStimulusCanvas(side, side);
    onCleanup(() => stim.destroy());
    stim.canvas.dataset.testid = 'acuity-canvas';
    const surface = h('div', {
      class: 'va-test-surface', dir: 'ltr', role: 'img', 'aria-label': t('stimulusLabel'),
      style: { width: `${side}px`, height: `${side}px`, direction: 'ltr', marginInline: 'auto' },
    }, stim.canvas);
    /** @type {ReturnType<typeof createAnswerChannel<Direction|'unsure'>>} */
    const answers = createAnswerChannel(signal);
    onCleanup(() => answers.dispose());
    const pad = directionPad({ lang: ctx.lang, onAnswer: (d) => answers.push(d), swipeTarget: surface });
    onCleanup(() => pad.destroy());
    const title = h('h1', { class: 'va-title', tabindex: '-1' }, t('practiceTitle'));
    const question = h('p', { class: 'va-text' }, t('testTitle'));
    const status = h('p', { class: 'va-hint', role: 'status', 'aria-live': 'polite', 'data-testid': 'acuity-status', style: { minHeight: '1.5em', margin: '0' } });
    const screenEl = h('section', { class: 'va-screen', 'data-testid': 'acuity-test' },
      title, question, surface, status, pad.el);
    container.replaceChildren(screenEl);
    focusTitle(container);

    /** @param {number} logMAR @param {Direction} orientation @param {number} dMm */
    const present = (logMAR, orientation, dMm) => {
      const dpr = stim.devicePxPerCssPx();
      stim.draw((g, devW, devH) => {
        const strokeDev = strokeDevicePx(logMAR, dMm, cssPxPerMm, dpr);
        const lay = layoutTumblingE({ devW, devH, strokeDevPx: strokeDev, orientation, surround: true });
        fillRects(g, lay.rects, '#000000');
      });
      stim.canvas.dataset.orientation = orientation;
      stim.canvas.dataset.logmar = logMAR.toFixed(3);
      stim.canvas.dataset.strokeDevPx = strokeDevicePx(logMAR, dMm, cssPxPerMm, dpr).toFixed(3);
    };
    const blank = async () => {
      pad.setEnabled(false);
      stim.draw(() => {});
      delete stim.canvas.dataset.orientation;
      await delay(BLANK_MS, signal);
    };
    const limitsAt = (/** @type {number} */ dMm) => ({
      minLogMAR: minRenderableLogMAR(dMm, cssPxPerMm, stim.devicePxPerCssPx()),
      maxLogMAR: maxFittingLogMAR(dMm, cssPxPerMm, side),
    });
    const hint = (/** @type {'closer'|'farther'|null} */ s) => {
      status.textContent = s === 'closer' ? t('moveCloser') : s === 'farther' ? t('moveFarther') : '';
    };

    // ---- practice with a large E (feedback, not scored) ----
    /** @type {Direction[]} */
    const practiceHistory = [];
    let practiceCorrect = 0;
    for (let i = 0; i < PRACTICE_MAX_TRIALS && practiceCorrect < PRACTICE_NEEDED; i++) {
      await blank();
      const d = distance.current();
      const lim = limitsAt(d);
      const orientation = nextOrientation(rng, practiceHistory);
      practiceHistory.push(orientation);
      present(Math.max(lim.minLogMAR, Math.min(PRACTICE_LOGMAR, lim.maxLogMAR)), orientation, d);
      pad.setEnabled(true);
      const resp = await answers.next();
      pad.setEnabled(false);
      delete stim.canvas.dataset.orientation;
      if (resp === orientation) { practiceCorrect++; status.textContent = t('practiceCorrect'); }
      else status.textContent = t('practiceWrong', { dir: t(orientation) });
      await delay(900, signal);
    }
    status.textContent = '';

    await instructionScreen(container, {
      title: t('readyTitle'), paragraphs: [t('ready1'), t('ready2')], primaryLabel: t('start'), signal, testId: 'acuity-ready',
    });
    title.textContent = t('introTitle');
    container.replaceChildren(screenEl);
    focusTitle(container);

    // ---- adaptive test ----
    const proc = createAcuityProcedure({ age: ctx.age, rng });
    ctx.onProgress?.(0);
    const startedAt = performance.now();
    while (!proc.isDone()) {
      await blank();
      const { distanceMm: d, blanked } = await distance.settle({ signal, onHint: hint });
      const trial = proc.next(limitsAt(d));
      if (!trial) break;
      present(trial.logMAR, trial.orientation, d);
      stim.canvas.dataset.trial = String(trial.index);
      stim.canvas.dataset.kind = trial.kind;
      pad.setEnabled(true);
      const t0 = performance.now();
      const resp = await answers.next();
      throwIfAborted(signal);
      pad.setEnabled(false);
      delete stim.canvas.dataset.orientation;
      proc.respond(resp, { rtMs: performance.now() - t0, blanked, distanceMm: d });
      ctx.onProgress?.(proc.progress());
    }
    const durationMs = Math.round(performance.now() - startedAt);
    pad.setEnabled(false);

    const est = proc.result();
    const logMAR = est.logMAR;
    return /** @type {AcuityResult} */ ({
      eye,
      logMAR,
      decimal: Math.round(decimalFromLogMAR(logMAR) * 100) / 100,
      snellen6: snellen6(logMAR),
      snellen20: snellen20(logMAR),
      distanceMm: Math.round(Number.isFinite(est.meanDistanceMm) ? est.meanDistanceMm : distance.target),
      reliable: est.reliable,
      floorLimited: est.floorLimited,
      trials: est.trials,
      durationMs,
      // optional contract fields: the engine's ceiling-limited / unreliable rules need them
      ...(Number.isFinite(est.sd) ? { sd: est.sd } : {}),
      ...(Array.isArray(est.ci95) && est.ci95.every(Number.isFinite) ? { ci95: [est.ci95[0], est.ci95[1]] } : {}),
      ceilingLimited: !!est.ceilingLimited,
      reasons: Array.isArray(est.reasons) ? [...est.reasons] : [],
    });
  });
}

// @ts-check
/**
 * "Faint letter check" view — Tumbling-E contrast threshold, 4AFC (vision-science.md §5.2–5.3).
 * runContrastTest(container, ctx) → Promise<ContrastResult>. Large letters (2.8°) well above the acuity
 * limit; letter luminance set by bit-stealing on a white background. No clinical notation in the UI.
 */
import { h, runView, delay, throwIfAborted } from '../../core/dom.js';
import { makeT } from '../../core/i18n.js';
import { coverEyeScreen, instructionScreen, directionPad, focusTitle } from '../../core/ui.js';
import { DEFAULT_CSS_PX_PER_MM } from '../../core/types.js';
import { createContrastProcedure } from './contrast-procedure.js';
import { bitStealColour, sizeMmForDegrees, CONTRAST_LETTER_DEG } from './contrast-math.js';
import { layoutTumblingE, fillRects } from '../acuity/optotype.js';
import { createStimulusCanvas } from '../acuity/stimulus-canvas.js';
import { createAnswerChannel, createDistanceSource, squareStimulusSize } from '../acuity/view-kit.js';
import { mulberry32, nextOrientation } from '../acuity/random.js';

/** @typedef {import('../../core/types.js').TestContext} TestContext */
/** @typedef {import('../../core/types.js').ContrastResult} ContrastResult */
/** @typedef {import('../acuity/random.js').Direction} Direction */

const STRINGS = {
  he: {
    introTitle: 'בדיקת אותיות חיוורות',
    intro1: 'תופיע האות E, גדולה וברורה, ובכל פעם בכיוון אחר. הקישו על החץ שמראה לאן פונות שלוש הרגליים שלה, או החליקו באצבע על האות.',
    intro2: 'האות תלך ותהיה חיוורת יותר, עד שיהיה קשה להבחין בה. כשלא בטוחים — נחשו.',
    intro3: 'כדאי שבהירות המסך תהיה גבוהה ושמסנני "אור כחול" או "נוחות עיניים" יהיו כבויים.',
    practiceTitle: 'תרגול קצר',
    testTitle: 'לאן פונות הרגליים של ה-E?',
    practiceCorrect: 'נכון!',
    practiceWrong: 'לא בדיוק — הרגליים פנו {dir}. ננסה שוב.',
    readyTitle: 'מתחילים',
    ready1: 'מעכשיו לא נראה אם צדקתם. גם כשהאות כמעט נעלמת — נחשו.',
    start: 'התחל',
    moveCloser: 'התקרבו מעט למסך',
    moveFarther: 'התרחקו מעט מהמסך',
    up: 'למעלה', down: 'למטה', left: 'שמאלה', right: 'ימינה',
    stimulusLabel: 'האות E',
  },
  en: {
    introTitle: 'Faint letter check',
    intro1: 'You will see a large letter E, turned a different way each time. Tap the arrow that shows where its three arms point, or swipe on the letter.',
    intro2: 'The letter will get fainter until it is hard to make out. When you’re not sure, take your best guess.',
    intro3: 'Screen brightness should be high, with “blue light” or “eye comfort” filters turned off.',
    practiceTitle: 'Quick practice',
    testTitle: 'Which way do the E’s arms point?',
    practiceCorrect: 'Correct!',
    practiceWrong: 'Not quite — the arms pointed {dir}. Let’s try again.',
    readyTitle: 'Let’s start',
    ready1: 'From now on you won’t see whether you were right. Even when the letter almost disappears, take a guess.',
    start: 'Start',
    moveCloser: 'Move a little closer to the screen',
    moveFarther: 'Move a little farther from the screen',
    up: 'up', down: 'down', left: 'left', right: 'right',
    stimulusLabel: 'The letter E',
  },
};

const PRACTICE_CONTRAST = 0.5;
const PRACTICE_MAX_TRIALS = 3;
const PRACTICE_NEEDED = 1;
const BLANK_MS = 250;
/** The letter may use at most this fraction of the stimulus square (2.8° is not size-critical). */
const MAX_LETTER_FRACTION = 0.8;

/**
 * @param {HTMLElement} container
 * @param {TestContext} ctx
 * @returns {Promise<ContrastResult>}
 */
export function runContrastTest(container, ctx) {
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
      primaryLabel: t('start'), signal, testId: 'contrast-intro',
    });

    const side = squareStimulusSize(container, { reserveHeight: 420 });
    const stim = createStimulusCanvas(side, side);
    onCleanup(() => stim.destroy());
    stim.canvas.dataset.testid = 'contrast-canvas';
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
    const status = h('p', { class: 'va-hint', role: 'status', 'aria-live': 'polite', 'data-testid': 'contrast-status', style: { minHeight: '1.5em', margin: '0' } });
    const screenEl = h('section', { class: 'va-screen', 'data-testid': 'contrast-test' }, title, question, surface, status, pad.el);
    container.replaceChildren(screenEl);
    focusTitle(container);

    /** @param {{css: string}} colour @param {number} contrast @param {Direction} orientation @param {number} dMm */
    const present = (colour, contrast, orientation, dMm) => {
      const dpr = stim.devicePxPerCssPx();
      const letterCss = Math.min(sizeMmForDegrees(CONTRAST_LETTER_DEG, dMm) * cssPxPerMm, side * MAX_LETTER_FRACTION);
      stim.draw((g, devW, devH) => {
        // Integer-snapped geometry: size is not critical here, crisp uniform-luminance strokes are (§5.3).
        const lay = layoutTumblingE({ devW, devH, strokeDevPx: (letterCss * dpr) / 5, orientation, surround: false, snapStroke: true });
        fillRects(g, lay.rects, colour.css);
      });
      stim.canvas.dataset.orientation = orientation;
      stim.canvas.dataset.contrast = contrast.toPrecision(4);
      stim.canvas.dataset.colour = colour.css;
    };
    const blank = async () => {
      pad.setEnabled(false);
      stim.draw(() => {});
      delete stim.canvas.dataset.orientation;
      await delay(BLANK_MS, signal);
    };
    const hint = (/** @type {'closer'|'farther'|null} */ s) => {
      status.textContent = s === 'closer' ? t('moveCloser') : s === 'farther' ? t('moveFarther') : '';
    };

    // ---- practice ----
    /** @type {Direction[]} */
    const practiceHistory = [];
    let practiceCorrect = 0;
    const practiceColour = bitStealColour(PRACTICE_CONTRAST);
    for (let i = 0; i < PRACTICE_MAX_TRIALS && practiceCorrect < PRACTICE_NEEDED; i++) {
      await blank();
      const orientation = nextOrientation(rng, practiceHistory);
      practiceHistory.push(orientation);
      present(practiceColour, practiceColour.contrast, orientation, distance.current());
      pad.setEnabled(true);
      const resp = await answers.next();
      pad.setEnabled(false);
      delete stim.canvas.dataset.orientation;
      if (resp === orientation) { practiceCorrect++; status.textContent = t('practiceCorrect'); }
      else status.textContent = t('practiceWrong', { dir: t(orientation) });
      await delay(900, signal);
    }
    status.textContent = '';

    await instructionScreen(container, { title: t('readyTitle'), paragraphs: [t('ready1')], primaryLabel: t('start'), signal, testId: 'contrast-ready' });
    title.textContent = t('introTitle');
    container.replaceChildren(screenEl);
    focusTitle(container);

    // ---- adaptive test ----
    const proc = createContrastProcedure({ rng });
    ctx.onProgress?.(0);
    while (!proc.isDone()) {
      await blank();
      const { distanceMm: d, blanked } = await distance.settle({ signal, onHint: hint });
      const trial = proc.next();
      if (!trial) break;
      present(trial.colour, trial.contrast, trial.orientation, d);
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
    pad.setEnabled(false);
    const est = proc.result();
    return /** @type {ContrastResult} */ ({ eye, logCS: est.logCS, reliable: est.reliable });
  });
}

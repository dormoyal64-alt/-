// @ts-check
/**
 * "Reading comfort check" view — MNREAD-like timed reading with both eyes (vision-science.md §4.4).
 * Sentences shrink in 0.1-log steps; the user taps "Done" when finished (or "Can't read"), then answers a
 * 2-choice word check. runReadingTest(container, ctx) → Promise<ReadingResult>.
 */
import { h, runView, throwIfAborted } from '../../core/dom.js';
import { makeT } from '../../core/i18n.js';
import { coverEyeScreen, instructionScreen, button, focusTitle } from '../../core/ui.js';
import { DEFAULT_CSS_PX_PER_MM } from '../../core/types.js';
import {
  READING_PARAMS, fontPxForPrintSize, printSizeForFontPx, printSizeSequence, largestFittingPrintSize,
  smallestRenderablePrintSize, standardWords, wordsPerMinute, analyseReading, shouldStopReading,
} from './reading-math.js';
import { SENTENCES, splitIntoLines } from './sentences.js';
import { createAnswerChannel, createDistanceSource } from '../acuity/view-kit.js';
import { mulberry32 } from '../acuity/random.js';

/** @typedef {import('../../core/types.js').TestContext} TestContext */
/** @typedef {import('../../core/types.js').ReadingResult} ReadingResult */
/** @typedef {import('./sentences.js').Sentence} Sentence */

const STRINGS = {
  he: {
    introTitle: 'בדיקת נוחות קריאה',
    intro1: 'יופיעו משפטים קצרים, וכל משפט יהיה קטן יותר מהקודם.',
    intro2: 'קראו כל משפט מהר ככל שנוח לכם (בשקט או בקול), והקישו "סיימתי" מיד כשסיימתם. אחר כך תענו על שאלה קצרה.',
    intro3: 'כשהטקסט קטן מדי לקריאה, הקישו "לא מצליח/ה לקרוא".',
    practiceTitle: 'משפט לתרגול',
    readTitle: 'קראו את המשפט',
    done: 'סיימתי',
    cantRead: 'לא מצליח/ה לקרוא',
    questionTitle: 'איזו מהמילים הופיעה במשפט?',
    readyTitle: 'מתחילים',
    ready1: 'מעכשיו נמדוד את זמן הקריאה. קראו בקצב הרגיל והנוח שלכם.',
    start: 'התחל',
    moveCloser: 'התקרבו מעט למסך',
    moveFarther: 'התרחקו מעט מהמסך',
  },
  en: {
    introTitle: 'Reading comfort check',
    intro1: 'You will see short sentences, each one a little smaller than the last.',
    intro2: 'Read each sentence as quickly as is comfortable (silently or aloud) and tap “Done” as soon as you finish. Then answer a quick question.',
    intro3: 'When the text is too small to read, tap “Can’t read”.',
    practiceTitle: 'Practice sentence',
    readTitle: 'Read the sentence',
    done: 'Done',
    cantRead: 'Can’t read',
    questionTitle: 'Which of these words was in the sentence?',
    readyTitle: 'Let’s start',
    ready1: 'From now on your reading time is measured. Read at your usual, comfortable pace.',
    start: 'Start',
    moveCloser: 'Move a little closer to the screen',
    moveFarther: 'Move a little farther from the screen',
  },
};

const LINE_HEIGHT = 1.4;
const SURFACE_PADDING = 12;

/**
 * Measure x-height (Latin 'x') or Hebrew body height ('ה') as a fraction of the em (§4.2), with fallbacks.
 * @param {'he'|'en'} lang @param {string} fontFamily
 */
function measureXRatio(lang, fontFamily) {
  try {
    const g = document.createElement('canvas').getContext('2d');
    if (!g) throw new Error('no 2d');
    g.font = `100px ${fontFamily}`;
    const r = g.measureText(lang === 'he' ? 'ה' : 'x').actualBoundingBoxAscent / 100;
    if (r > 0.3 && r < 0.9) return r;
  } catch { /* fall through */ }
  return READING_PARAMS.xRatioFallback[lang];
}

/**
 * Widest line (in em) over all sentences of a set when split into 3 lines.
 * @param {Sentence[]} sentences @param {string} fontFamily
 */
function widestLineEm(sentences, fontFamily) {
  const g = document.createElement('canvas').getContext('2d');
  if (!g) return 12;
  g.font = `100px ${fontFamily}`;
  let w = 0;
  for (const s of sentences) for (const line of splitIntoLines(s.text)) w = Math.max(w, g.measureText(line).width / 100);
  return w || 12;
}

/**
 * @template T
 * @param {T[]} arr @param {() => number} rng
 * @returns {T[]}
 */
function shuffled(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * @param {HTMLElement} container
 * @param {TestContext} ctx
 * @returns {Promise<ReadingResult>}
 */
export function runReadingTest(container, ctx) {
  return runView(ctx.signal, async (onCleanup) => {
    onCleanup(() => container.replaceChildren());
    const lang = ctx.lang === 'he' ? 'he' : 'en';
    const t = makeT(STRINGS, lang);
    const signal = ctx.signal;
    const cssPxPerMm = ctx.screen?.cssPxPerMm || DEFAULT_CSS_PX_PER_MM;
    const dpr = window.devicePixelRatio || 1;
    const distance = createDistanceSource(ctx);
    const rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
    const set = SENTENCES[lang];

    await coverEyeScreen(container, { eye: 'both', lang: ctx.lang, signal });
    await instructionScreen(container, {
      title: t('introTitle'), paragraphs: [t('intro1'), t('intro2'), t('intro3')], primaryLabel: t('start'), signal, testId: 'reading-intro',
    });

    const fontFamily = getComputedStyle(container).fontFamily || 'system-ui, sans-serif';
    const xRatio = measureXRatio(lang, fontFamily);
    const lineEm = widestLineEm([set.practice, ...set.sentences], fontFamily);
    const availableCss = Math.min(640, (container.clientWidth || window.innerWidth) - 32 - 2 * SURFACE_PADDING);
    const maxFontPx = availableCss / lineEm;
    const d0 = distance.current();
    const pStart = largestFittingPrintSize({ widestLineEm: lineEm, availableCssPx: availableCss, dMm: d0, cssPxPerMm, xRatio });
    const pMin = Math.min(pStart, smallestRenderablePrintSize({ dMm: d0, cssPxPerMm, dpr }));
    const sizes = printSizeSequence(pStart, pMin);
    const order = shuffled(set.sentences, rng);

    // ---- persistent reading screen ----
    /** @type {ReturnType<typeof createAnswerChannel<'done'|'cant'>>} */
    const readAnswers = createAnswerChannel(signal);
    onCleanup(() => readAnswers.dispose());
    const title = h('h1', { class: 'va-title', tabindex: '-1' }, t('practiceTitle'));
    const status = h('p', { class: 'va-hint', role: 'status', 'aria-live': 'polite', style: { minHeight: '1.5em', margin: '0' } });
    const textBox = h('div', { lang, dir: lang === 'he' ? 'rtl' : 'ltr', 'data-testid': 'reading-text', style: { color: '#000', fontFamily, lineHeight: String(LINE_HEIGHT), textAlign: 'start' } });
    const surface = h('div', {
      class: 'va-test-surface', 'data-testid': 'reading-surface',
      style: { padding: `${SURFACE_PADDING}px`, minHeight: `${Math.ceil(3 * LINE_HEIGHT * Math.min(maxFontPx, fontPxForPrintSize(pStart, d0, cssPxPerMm, xRatio)) + 2 * SURFACE_PADDING)}px` },
    }, textBox);
    const doneBtn = button(t('done'), { testId: 'reading-done', onClick: () => readAnswers.push('done') });
    const cantBtn = button(t('cantRead'), { variant: 'secondary', testId: 'reading-cant', onClick: () => readAnswers.push('cant') });
    const readScreen = h('section', { class: 'va-screen', 'data-testid': 'reading-test' },
      title, surface, status, h('div', { class: 'va-actions' }, doneBtn, cantBtn));

    /**
     * Show a sentence at print size p and time the reading.
     * @param {Sentence} sentence @param {number} p
     * @returns {Promise<{choice: 'done'|'cant', timeMs: number, pActual: number, dMm: number}>}
     */
    const showSentence = async (sentence, p) => {
      const dMm = distance.current();
      const hintKey = distance.status(dMm);
      status.textContent = hintKey === 'closer' ? t('moveCloser') : hintKey === 'farther' ? t('moveFarther') : '';
      const fontPx = Math.min(maxFontPx, fontPxForPrintSize(p, dMm, cssPxPerMm, xRatio));
      textBox.style.fontSize = `${fontPx}px`;
      textBox.replaceChildren(...splitIntoLines(sentence.text).map((line) => h('div', { style: { whiteSpace: 'nowrap' } }, line)));
      textBox.dataset.printSize = p.toFixed(2);
      container.replaceChildren(readScreen);
      focusTitle(container);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const t0 = performance.now();
      const choice = await readAnswers.next();
      const timeMs = performance.now() - t0;
      throwIfAborted(signal);
      textBox.replaceChildren();
      return { choice, timeMs, pActual: printSizeForFontPx(fontPx, dMm, cssPxPerMm, xRatio), dMm };
    };

    /**
     * 2-choice word check. Resolves true when the word from the sentence was chosen.
     * @param {Sentence} sentence
     */
    const wordCheck = async (sentence) => {
      /** @type {ReturnType<typeof createAnswerChannel<boolean>>} */
      const ch = createAnswerChannel(signal);
      const opts = shuffled([{ w: sentence.word, ok: true }, { w: sentence.foil, ok: false }], rng);
      const el = h('section', { class: 'va-screen', 'data-testid': 'reading-question' },
        h('h1', { class: 'va-title', tabindex: '-1' }, t('questionTitle')),
        h('div', { class: 'va-actions', lang },
          ...opts.map((o, i) => {
            const b = button(o.w, { variant: 'secondary', testId: `reading-option-${i}`, onClick: () => ch.push(o.ok) });
            b.dataset.correct = String(o.ok);
            b.style.fontSize = '1.25rem';
            return b;
          })));
      container.replaceChildren(el);
      focusTitle(container);
      try { return await ch.next(); } finally { ch.dispose(); }
    };

    // ---- practice (not scored) ----
    const practice = await showSentence(set.practice, pStart);
    if (practice.choice === 'done') await wordCheck(set.practice);
    await instructionScreen(container, { title: t('readyTitle'), paragraphs: [t('ready1')], primaryLabel: t('start'), signal, testId: 'reading-ready' });

    // ---- timed sentences ----
    /** @type {Array<{p: number, wpm: number, passed: boolean, timeMs: number, dMm: number}>} */
    const history = [];
    ctx.onProgress?.(0);
    for (let i = 0; i < sizes.length; i++) {
      const sentence = order[i % order.length];
      title.textContent = t('readTitle');
      const r = await showSentence(sentence, sizes[i]);
      let passed = false;
      if (r.choice === 'done') passed = await wordCheck(sentence);
      const wpm = passed ? wordsPerMinute(standardWords(sentence.text), r.timeMs) : 0;
      history.push({ p: r.pActual, wpm, passed, timeMs: r.choice === 'done' ? r.timeMs : 0, dMm: r.dMm });
      ctx.onProgress?.((i + 1) / sizes.length);
      if (shouldStopReading(history, i === sizes.length - 1)) break;
    }
    ctx.onProgress?.(1);

    const a = analyseReading(history);
    const notRead = Math.round((pStart + READING_PARAMS.stepLog) * 100) / 100;
    const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
    const meanD = history.reduce((s, q) => s + q.dMm, 0) / Math.max(1, history.length);
    return /** @type {ReadingResult} */ ({
      criticalPrintSizeLogMAR: a.cps === null ? notRead : r2(a.cps),
      readingAcuityLogMAR: a.readingAcuity === null ? notRead : r2(a.readingAcuity),
      maxReadingSpeedWpm: Math.round(a.mrs),
      distanceMm: Math.round(meanD || distance.target),
      reliable: a.reliable,
    });
  });
}

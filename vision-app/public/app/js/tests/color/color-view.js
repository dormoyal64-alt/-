// @ts-check
/**
 * Colour check view: runColorTest(container, ctx) => Promise<ColorResult>.
 * CCT-style plates (color-plates.js) + three interleaved Bayesian staircases (color-procedure.js); an optional
 * red/grey luminance match is added only when a red–green result has an uncertain type (§7.3 tie-breaker).
 * User-facing text is functional ("colour profile", "colour filter"), never a condition name.
 * The correct answer of the current plate is exposed as data-answer on the canvas (scripted observers in tests).
 */
import { h, clear, delay, runView } from '../../core/dom.js';
import { makeT } from '../../core/i18n.js';
import { screen, button, instructionScreen, coverEyeScreen, directionPad, progressBar, hiDpiCanvas, focusTitle } from '../../core/ui.js';
import { DEFAULT_CSS_PX_PER_MM } from '../../core/types.js';
import { linearToSrgb } from '../../engine/color-math.js';
import { layoutPlate, colorizePlate, plateDiameterCssPx, GAP_SRGB8, mulberry32 } from './color-plates.js';
import { createColorProcedure, PROCEDURE, RED_LUMINANCE } from './color-procedure.js';

/** @typedef {import('../../core/types.js').TestContext} TestContext */
/** @typedef {import('./color-procedure.js').ColorTestResult} ColorTestResult */
/** @typedef {import('./color-plates.js').PlateLayout} PlateLayout */
/** @typedef {import('./color-plates.js').Direction} Direction */

const STRINGS = {
  he: {
    title: 'בדיקת צבעים',
    intro: 'יופיע לפניכם עיגול של נקודות. בתוכו מסתתרת טבעת עם פתח, שנבדלת מהרקע רק בגוון הצבע.',
    task: 'הקישו על החץ לכיוון הפתח. אם אינכם רואים טבעת — הקישו "לא רואה טבעת". זה צפוי לקרות מדי פעם.',
    settings: 'לפני שמתחילים: כבו מצב לילה, מסנן אור כחול, מסנני צבע ותיקון צבע בהגדרות המכשיר, והעמידו את הבהירות על רמה נוחה וגבוהה יחסית.',
    room: 'עדיף חדר מואר באופן אחיד, בלי השתקפויות על המסך. הבדיקה נמשכת כשלוש דקות.',
    exampleLabel: 'דוגמה: הטבעת כהה כאן כדי שיהיה קל לראות. הפתח פונה ימינה.',
    start: 'התחל',
    question: 'לאן פונה הפתח של הטבעת?',
    hint: 'הטבעת מוצגת לרגע קצר — אפשר לענות גם אחרי שהיא נעלמת.',
    cantSee: 'לא רואה טבעת',
    plateLabel: 'לוח נקודות לבדיקת צבעים',
    matchTitle: 'עוד שלב קצר',
    matchBody: 'הזיזו את המחוון עד ששני חצאי העיגול נראים בהירים באותה מידה — כלומר עד שהקו ביניהם הכי פחות בולט.',
    matchStep: 'התאמה {n} מתוך {total}',
    matchSlider: 'בהירות החצי האפור',
    done: 'סיימתי',
    skip: 'דלג',
  },
  en: {
    title: 'Colour check',
    intro: 'You will see a circle of dots. Hidden in it is a ring with an opening, which differs from the background only in its colour.',
    task: 'Tap the arrow that points to the opening. If you can’t see a ring, tap “I can’t see a ring” — that is expected now and then.',
    settings: 'Before you start: turn off night mode, blue-light filters, colour filters and colour correction in your device settings, and set the brightness to a comfortable, fairly bright level.',
    room: 'An evenly lit room without reflections on the screen works best. The check takes about three minutes.',
    exampleLabel: 'Example: here the ring is dark so it is easy to see. The opening points right.',
    start: 'Start',
    question: 'Which way does the ring open?',
    hint: 'The ring shows briefly — you can still answer after it fades.',
    cantSee: 'I can’t see a ring',
    plateLabel: 'Dot pattern for the colour check',
    matchTitle: 'One more short step',
    matchBody: 'Move the slider until both halves of the circle look equally bright — that is, until the edge between them is least visible.',
    matchStep: 'Match {n} of {total}',
    matchSlider: 'Brightness of the grey half',
    done: 'Done',
    skip: 'Skip',
  },
};

/** Pause between plates (dark panel), ms. */
const ISI_MS = 350;
/** Luminance match: grey linear luminance on a log slider from MATCH_MIN to MATCH_MAX. */
const MATCH_MIN = 0.03;
const MATCH_MAX = 0.6;
const MATCH_STEPS = 1000;
const GAP_CSS = `rgb(${GAP_SRGB8} ${GAP_SRGB8} ${GAP_SRGB8})`;

/** @param {number} v slider value @returns {number} grey linear luminance */
function sliderToLinear(v) {
  return MATCH_MIN * (MATCH_MAX / MATCH_MIN) ** (v / MATCH_STEPS);
}
/** @param {number} lin @returns {number} */
function linearToSlider(lin) {
  return Math.round((MATCH_STEPS * Math.log(lin / MATCH_MIN)) / Math.log(MATCH_MAX / MATCH_MIN));
}

/**
 * Paint a plate (discs over the dark neutral surround) centred at (cx, cy).
 * @param {CanvasRenderingContext2D} g @param {number} w @param {number} hgt
 * @param {PlateLayout|null} layout @param {Array<[number, number, number]>|null} colors @param {number} radiusPx
 */
function paintPlate(g, w, hgt, layout, colors, radiusPx) {
  g.fillStyle = GAP_CSS;
  g.fillRect(0, 0, w, hgt);
  if (!layout || !colors) return;
  const cx = w / 2; const cy = hgt / 2;
  layout.discs.forEach((d, i) => {
    const [r, gr, b] = colors[i];
    g.fillStyle = `rgb(${r} ${gr} ${b})`;
    g.beginPath();
    g.arc(cx + d.x * radiusPx, cy + d.y * radiusPx, d.r * radiusPx, 0, 2 * Math.PI);
    g.fill();
  });
}

/** Small static example plate for the instructions (luminance-defined ring, opening right). */
function examplePlate() {
  const size = 168;
  const c = hiDpiCanvas(size, size);
  c.canvas.style.borderRadius = '16px';
  c.canvas.setAttribute('aria-hidden', 'true');
  const layout = layoutPlate({ seed: 20260928, gap: 'right' });
  paintPlate(c.ctx, size, size, layout, colorizePlate(layout, { kind: 'catch' }), size / 2 - 8);
  return c.canvas;
}

/**
 * @param {HTMLElement} container
 * @param {TestContext} ctx
 * @returns {Promise<ColorTestResult>}
 */
export function runColorTest(container, ctx) {
  const t = makeT(STRINGS, ctx.lang);
  const signal = ctx.signal;
  return runView(signal, async (onCleanup) => {
    onCleanup(() => clear(container));
    const started = Date.now();

    await instructionScreen(container, {
      title: t('title'),
      paragraphs: [t('intro'), t('task'), t('settings'), t('room')],
      illustration: h('figure', { class: 'va-stack', style: { margin: '0', alignItems: 'center' } },
        examplePlate(), h('figcaption', { class: 'va-hint', style: { textAlign: 'center' } }, t('exampleLabel'))),
      primaryLabel: t('start'),
      signal,
      testId: 'color-intro',
    });
    if (ctx.eye) await coverEyeScreen(container, { eye: ctx.eye, lang: ctx.lang, signal });

    const seedSource = new Uint32Array(1);
    globalThis.crypto?.getRandomValues?.(seedSource);
    const rng = mulberry32(seedSource[0] || Date.now());
    const proc = createColorProcedure({ rng });

    // ---------- test screen ----------
    const progress = progressBar();
    const surface = h('div', { class: 'va-test-surface', dir: 'ltr', style: { background: GAP_CSS, width: '100%' } });
    const stim = hiDpiCanvas(300, 300);
    stim.canvas.setAttribute('role', 'img');
    stim.canvas.setAttribute('aria-label', t('plateLabel'));
    stim.canvas.dataset.testid = 'color-plate';
    surface.appendChild(stim.canvas);

    /** @type {((a: Direction|'unsure') => void)|null} */
    let answerResolver = null;
    const onAnswer = (/** @type {Direction|'unsure'} */ a) => {
      const r = answerResolver;
      answerResolver = null;
      r?.(a);
    };
    const pad = directionPad({ lang: ctx.lang, onAnswer, includeUnsure: false, swipeTarget: surface });
    onCleanup(() => pad.destroy());
    const cantSee = button(t('cantSee'), { variant: 'secondary', testId: 'color-cant-see', onClick: () => onAnswer('unsure') });
    container.appendChild(screen({
      title: t('question'),
      body: [h('p', { class: 'va-hint' }, t('hint')), progress.el, surface, pad.el, cantSee],
      testId: 'color-test',
    }));
    focusTitle(container);

    const cssPxPerMm = ctx.screen?.cssPxPerMm || DEFAULT_CSS_PX_PER_MM;
    const distanceMm = ctx.distance?.distanceMm || 400;
    let dims = { w: 300, hgt: 300, radius: 140 };
    /** @type {{layout: PlateLayout|null, colors: Array<[number, number, number]>|null}} */
    let shown = { layout: null, colors: null };
    const layoutCanvas = () => {
      const w = Math.max(200, Math.floor(surface.clientWidth || container.clientWidth || 320));
      const availH = Math.max(200, (window.innerHeight || 700) - 440);
      const diameter = Math.min(plateDiameterCssPx(distanceMm, cssPxPerMm), w - 24, availH);
      const hgt = Math.round(diameter + 24);
      dims = { w, hgt, radius: diameter / 2 };
      stim.resize(w, hgt);
      paintPlate(stim.ctx, w, hgt, shown.layout, shown.colors, dims.radius);
    };
    const show = (/** @type {PlateLayout|null} */ layout, /** @type {Array<[number, number, number]>|null} */ colors) => {
      shown = { layout, colors };
      paintPlate(stim.ctx, dims.w, dims.hgt, layout, colors, dims.radius);
    };
    layoutCanvas();
    window.addEventListener('resize', layoutCanvas);
    onCleanup(() => window.removeEventListener('resize', layoutCanvas));

    /** @type {ReturnType<typeof setTimeout>|null} */
    let hideTimer = null;
    onCleanup(() => { if (hideTimer) clearTimeout(hideTimer); });
    const setEnabled = (/** @type {boolean} */ on) => { pad.setEnabled(on); cantSee.disabled = !on; };

    ctx.onProgress?.(0);
    for (let trial = proc.next(); trial; trial = proc.next()) {
      const layout = layoutPlate({ seed: trial.seed, gap: trial.gap });
      const stimulus = trial.kind === 'catch' || !trial.axis
        ? /** @type {const} */ ({ kind: 'catch' })
        : /** @type {const} */ ({ kind: 'axis', axis: trial.axis, c: trial.c });
      show(layout, colorizePlate(layout, stimulus));
      Object.assign(stim.canvas.dataset, { answer: trial.gap, kind: trial.kind, axis: trial.axis || '', trial: String(trial.index) });
      setEnabled(true);
      const t0 = performance.now();
      hideTimer = setTimeout(() => { hideTimer = null; show(layout, colorizePlate(layout, { kind: 'none' })); }, PROCEDURE.stimulusMs);
      const answer = await new Promise((resolve) => { answerResolver = resolve; });
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      proc.respond(trial, /** @type {Direction|'unsure'} */ (answer), Math.round(performance.now() - t0));
      setEnabled(false);
      delete stim.canvas.dataset.answer;
      show(null, null);
      progress.set(proc.progress());
      ctx.onProgress?.(proc.progress() * 0.95);
      await delay(ISI_MS, signal);
    }

    if (proc.needsLuminanceMatch()) {
      pad.destroy();
      clear(container);
      proc.setLuminanceMatch(await luminanceMatch(container, t, rng, signal));
    }
    ctx.onProgress?.(1);
    const result = proc.result();
    result.details.eye = ctx.eye ?? null;
    result.details.durationMs = Date.now() - started;
    return result;
  });
}

/**
 * Minimally-distinct-border luminance match of pure red against grey (2 settings, red on the left, then right).
 * Resolves with the geometric mean of grey/red luminance ratios, or null when skipped.
 * @param {HTMLElement} container @param {(k: string, p?: Record<string, string|number>) => string} t
 * @param {() => number} rng @param {AbortSignal|undefined} signal
 * @returns {Promise<number|null>}
 */
async function luminanceMatch(container, t, rng, signal) {
  const size = 220;
  const ratios = [];
  for (let n = 1; n <= 2; n++) {
    const redLeft = n === 1;
    const c = hiDpiCanvas(size, size);
    c.canvas.dataset.testid = 'color-match';
    c.canvas.dataset.answer = String(linearToSlider(RED_LUMINANCE));
    c.canvas.setAttribute('aria-hidden', 'true');
    const slider = h('input', {
      type: 'range', class: 'va-range', min: '0', max: String(MATCH_STEPS), step: '1',
      value: String(Math.round(MATCH_STEPS * (0.25 + 0.5 * rng()))), 'aria-label': t('matchSlider'), 'data-testid': 'color-match-slider',
    });
    const paint = () => {
      const grey = Math.round(linearToSrgb(sliderToLinear(Number(slider.value))) * 255);
      const g = c.ctx;
      g.fillStyle = GAP_CSS;
      g.fillRect(0, 0, size, size);
      const half = (/** @type {boolean} */ left, /** @type {string} */ fill) => {
        g.fillStyle = fill;
        g.beginPath();
        g.moveTo(size / 2, size / 2);
        g.arc(size / 2, size / 2, size / 2 - 6, left ? Math.PI / 2 : -Math.PI / 2, left ? 1.5 * Math.PI : Math.PI / 2);
        g.closePath();
        g.fill();
      };
      half(redLeft, 'rgb(255 0 0)');
      half(!redLeft, `rgb(${grey} ${grey} ${grey})`);
    };
    slider.addEventListener('input', paint);
    paint();
    const choice = await new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      const finish = (/** @type {'done'|'skip'} */ v) => { signal?.removeEventListener('abort', onAbort); resolve(v); };
      clear(container);
      container.appendChild(screen({
        title: t('matchTitle'),
        body: [
          t('matchBody'),
          h('p', { class: 'va-hint' }, t('matchStep', { n, total: 2 })),
          h('div', { class: 'va-center', dir: 'ltr' }, c.canvas),
          slider,
        ],
        actions: [
          button(t('done'), { testId: 'color-match-done', onClick: () => finish('done') }),
          button(t('skip'), { variant: 'ghost', testId: 'color-match-skip', onClick: () => finish('skip') }),
        ],
        testId: 'color-match-screen',
      }));
      focusTitle(container);
    });
    if (choice === 'skip') return null;
    ratios.push(sliderToLinear(Number(slider.value)) / RED_LUMINANCE);
    await delay(150, signal);
  }
  return Math.sqrt(ratios[0] * ratios[1]);
}

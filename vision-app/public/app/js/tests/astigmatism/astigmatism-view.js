// @ts-check
/**
 * "Line sharpness check" view — clock dial (vision-science.md §6.2, item 26). Per eye; 3 presentations with
 * a random rotation; the user taps the lines that look darker/sharper or "All look the same".
 * runAstigmatismTest(container, ctx) → Promise<AstigmatismResult>. The UI never names a condition or axis.
 */
import { h, runView, throwIfAborted } from '../../core/dom.js';
import { makeT } from '../../core/i18n.js';
import { coverEyeScreen, instructionScreen, button, focusTitle } from '../../core/ui.js';
import { DEFAULT_CSS_PX_PER_MM } from '../../core/types.js';
import { DIAL, spokeAngles, spokeIndexForTap, dialGeometry, spokeQuads, inferFromAnswers, isFoggedAt } from './astigmatism-math.js';
import { createStimulusCanvas } from '../acuity/stimulus-canvas.js';
import { createAnswerChannel, createDistanceSource, squareStimulusSize } from '../acuity/view-kit.js';
import { mulberry32 } from '../acuity/random.js';

/** @typedef {import('../../core/types.js').TestContext} TestContext */
/** @typedef {import('../../core/types.js').AstigmatismResult} AstigmatismResult */

const STRINGS = {
  he: {
    introTitle: 'בדיקת חדות קווים',
    intro1: 'יופיע עיגול של קווים, כמו שעון. הביטו בנקודה שבמרכז, בלי למצמץ ובלי לכווץ את העיניים.',
    intro2: 'אם הקווים בכיוון מסוים נראים לכם כהים או חדים יותר מהשאר — הקישו עליהם. אם כל הקווים נראים בערך אותו דבר, הקישו "כולם נראים אותו דבר".',
    intro3: 'נציג את העיגול שלוש פעמים, כל פעם מסובב קצת אחרת.',
    title: 'בדיקת חדות קווים',
    question: 'הביטו בנקודה שבמרכז. אילו קווים נראים כהים או חדים יותר?',
    stepOf: 'תמונה {n} מתוך {total}',
    selected: 'נבחר כיוון. הקישו "אישור" או בחרו כיוון אחר.',
    confirm: 'אישור',
    allSame: 'כולם נראים אותו דבר',
    start: 'התחל',
    dialLabel: 'עיגול קווים. הקישו על הקווים שנראים כהים יותר, או השתמשו בחיצים ובמקש Enter.',
  },
  en: {
    introTitle: 'Line sharpness check',
    intro1: 'You will see a circle of lines, like a clock. Look at the dot in the centre without squinting.',
    intro2: 'If the lines in one direction look darker or sharper than the rest, tap them. If all the lines look about the same, tap “All look the same”.',
    intro3: 'We will show the circle three times, turned slightly differently each time.',
    title: 'Line sharpness check',
    question: 'Look at the centre dot. Which lines look darker or sharper?',
    stepOf: 'Picture {n} of {total}',
    selected: 'Direction selected. Tap “Confirm” or choose another.',
    confirm: 'Confirm',
    allSame: 'All look the same',
    start: 'Start',
    dialLabel: 'Circle of lines. Tap the lines that look darker, or use the arrow keys and Enter.',
  },
};

const LABEL_GAP_CSS = 24;    // clock numerals sit this far outside the spokes
const MARKER_GAP_CSS = 9;    // selection markers sit this far outside the spokes
const SELECT_COLOUR = '#0a6b66';

/**
 * @param {HTMLElement} container
 * @param {TestContext} ctx
 * @returns {Promise<AstigmatismResult>}
 */
export function runAstigmatismTest(container, ctx) {
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
      title: t('introTitle'), paragraphs: [t('intro1'), t('intro2'), t('intro3')], primaryLabel: t('start'), signal, testId: 'astig-intro',
    });

    const side = squareStimulusSize(container, { reserveHeight: 330, max: 460 });
    const stim = createStimulusCanvas(side, side);
    onCleanup(() => stim.destroy());
    stim.canvas.dataset.testid = 'astig-canvas';
    /** @type {ReturnType<typeof createAnswerChannel<number|'equal'>>} */
    const answers = createAnswerChannel(signal);
    onCleanup(() => answers.dispose());

    const surface = h('div', {
      class: 'va-test-surface', dir: 'ltr', tabindex: '0', role: 'group', 'aria-label': t('dialLabel'), 'data-testid': 'astig-dial',
      style: { width: `${side}px`, height: `${side}px`, direction: 'ltr', marginInline: 'auto', cursor: 'pointer' },
    }, stim.canvas);
    const title = h('h1', { class: 'va-title', tabindex: '-1' }, t('title'));
    const step = h('p', { class: 'va-hint', 'data-testid': 'astig-step' });
    const question = h('p', { class: 'va-text', 'aria-live': 'polite' }, t('question'));
    const status = h('p', { class: 'va-hint', role: 'status', 'aria-live': 'polite', style: { minHeight: '1.5em', margin: '0' } });
    /** @type {number|null} */
    let selected = null;
    let offset = 0;
    const confirmBtn = button(t('confirm'), { testId: 'astig-confirm', disabled: true, onClick: () => { if (selected !== null) answers.push(spokeAngles(offset)[selected]); } });
    const sameBtn = button(t('allSame'), { variant: 'secondary', testId: 'astig-same', onClick: () => answers.push('equal') });
    container.replaceChildren(h('section', { class: 'va-screen', 'data-testid': 'astig-test' },
      title, step, question, surface, status, h('div', { class: 'va-actions' }, confirmBtn, sameBtn)));
    focusTitle(container);

    let geo = null;
    const render = () => {
      const dpr = stim.devicePxPerCssPx();
      const dMm = distance.current();
      stim.draw((g, devW, devH) => {
        const cx = devW / 2; const cy = devH / 2;
        geo = dialGeometry({ dMm, cssPxPerMm, dpr, maxRadiusDevPx: Math.min(devW, devH) / 2 - (LABEL_GAP_CSS + 14) * dpr });
        const angles = spokeAngles(offset);
        g.beginPath();
        for (const phi of angles) {
          for (const q of spokeQuads({ cx, cy, phi, lineDev: geo.lineDev, gapDev: geo.gapDev, innerR: geo.innerR, outerR: geo.outerR })) {
            g.moveTo(q[0].x, q[0].y);
            for (let i = 1; i < 4; i++) g.lineTo(q[i].x, q[i].y);
            g.closePath();
          }
        }
        g.fillStyle = '#000000';
        g.fill('nonzero');
        // fixation dot
        g.beginPath();
        g.arc(cx, cy, Math.max(3, 2 * geo.lineDev), 0, 2 * Math.PI);
        g.fill();
        // clock numerals (orientation reference only) and half-hour dots
        g.fillStyle = '#333333';
        g.font = `${Math.round(14 * dpr)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const rl = geo.outerR + LABEL_GAP_CSS * dpr;
        for (let hr = 1; hr <= 12; hr++) {
          const a = ((90 - 30 * hr) * Math.PI) / 180;
          g.fillText(String(hr), cx + rl * Math.cos(a), cy - rl * Math.sin(a));
          const ah = ((90 - 30 * (hr - 0.5)) * Math.PI) / 180;
          g.beginPath();
          g.arc(cx + rl * Math.cos(ah), cy - rl * Math.sin(ah), 1.5 * dpr, 0, 2 * Math.PI);
          g.fill();
        }
        if (selected !== null) {
          const phi = (angles[selected] * Math.PI) / 180;
          const rm = geo.outerR + MARKER_GAP_CSS * dpr;
          g.fillStyle = SELECT_COLOUR;
          for (const sgn of [1, -1]) {
            g.beginPath();
            g.arc(cx + sgn * rm * Math.cos(phi), cy - sgn * rm * Math.sin(phi), 5 * dpr, 0, 2 * Math.PI);
            g.fill();
          }
        }
      });
      stim.canvas.dataset.offset = offset.toFixed(2);
      stim.canvas.dataset.spokes = JSON.stringify(spokeAngles(offset).map((a) => Math.round(a * 100) / 100));
      stim.canvas.dataset.radiusCss = geo ? (geo.outerR / dpr).toFixed(1) : '';
      if (selected === null) delete stim.canvas.dataset.selected;
      else stim.canvas.dataset.selected = String(Math.round(spokeAngles(offset)[selected] * 100) / 100);
    };

    /** @param {number|null} k */
    const select = (k) => {
      selected = k;
      confirmBtn.disabled = k === null;
      status.textContent = k === null ? '' : t('selected');
      render();
    };
    /** @param {PointerEvent} e */
    const onPointerUp = (e) => {
      const rect = stim.canvas.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const rCss = geo ? geo.outerR / stim.devicePxPerCssPx() : rect.width / 2;
      if (Math.hypot(dx, dy) < 0.12 * rCss) return;
      select(spokeIndexForTap(dx, dy, offset));
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); select(((selected ?? -1) + 1) % DIAL.spokes); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); select(((selected ?? 1) - 1 + DIAL.spokes) % DIAL.spokes); }
      else if (e.key === 'Enter' && selected !== null) { e.preventDefault(); answers.push(spokeAngles(offset)[selected]); }
    };
    surface.addEventListener('pointerup', onPointerUp);
    surface.addEventListener('keydown', onKey);
    onCleanup(() => { surface.removeEventListener('pointerup', onPointerUp); surface.removeEventListener('keydown', onKey); });

    /** @type {Array<number|'equal'>} */
    const results = [];
    ctx.onProgress?.(0);
    for (let n = 1; n <= DIAL.presentations; n++) {
      offset = rng() * DIAL.spokeStepDeg;
      step.textContent = t('stepOf', { n, total: DIAL.presentations });
      select(null);
      const ans = await answers.next();
      throwIfAborted(signal);
      results.push(ans);
      ctx.onProgress?.(n / DIAL.presentations);
      if (n < DIAL.presentations) focusTitle(container);
    }
    // The rule of 30 needs a fogged eye; at phone distance only an eye beyond its measured far point is fogged.
    const fogged = isFoggedAt(ctx.focusRange, distance.current());
    const inf = inferFromAnswers(results, { fogged });
    // consistent: the view only reports `suspected` for ≥ 2 of 3 agreeing answers. lineAngleDeg + fogged keep the raw
    // observation so the internal axis can be recomputed if the fog decision is ever revised.
    return /** @type {AstigmatismResult} */ ({
      eye, suspected: inf.suspected, axisDeg: inf.axisDeg, consistent: inf.suspected, lineAngleDeg: inf.lineAngleDeg, fogged,
    });
  });
}

// @ts-check
/**
 * "Your comfortable sharp-viewing range" (spec §9.2–9.4). With a live camera distance: a 2-line sentence held at a
 * constant visual angle (x-height max(L+0.2, 0.3) logMAR for the close range, L+0.1 or 0.1 for the far range),
 * 3 runs each, medians; camera floor 150 mm; far point measurable up to 650 mm (else null). Without a camera: a
 * manual ruler fallback. Wording is functional only — no diopters or refraction terms (spec 9.4, PRODUCT CLAIMS).
 */
import { h, clear, runView } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { screen as uiScreen, button, coverEyeScreen, getCorrectionMode } from '../core/ui.js';
import { DEFAULT_CSS_PX_PER_MM } from '../core/types.js';
import {
  FOCUS, xHeightMmForLogMAR, fontPxForXHeight, nearTargetLogMAR, farTargetLogMAR, combineNearPointRuns,
  combineFarPointRuns, movementSpeedMmPerS, isPlausibleFocalLength,
} from './calibration-math.js';
import { choose, show, cmField, focusIllustration, stickyBar } from './calibration-ui.js';
import { cameraSupported } from './face-iris.js';
import { createDistanceTracker } from './distance-tracker.js';
import { FOCUS_STRINGS, COMMON_STRINGS } from './strings.js';

/** @typedef {import('../core/types.js').FocusRangeResult} FocusRangeResult */
/** @typedef {import('../core/types.js').TestContext} TestContext */
/** @typedef {import('../core/types.js').DistanceTracker} DistanceTracker */

const STRINGS = {
  he: { ...COMMON_STRINGS.he, ...FOCUS_STRINGS.he },
  en: { ...COMMON_STRINGS.en, ...FOCUS_STRINGS.en },
};

/** Face lost below this distance while moving closer ⇒ the camera floor was reached. */
const FLOOR_LOST_MM = 200;
/** Manual fallback: fixed text size designed for these distances [D]. */
const MANUAL_NEAR_DESIGN_MM = 250;

/**
 * Best known logMAR for the eye under test, if the caller passed one (optional, not part of TestContext).
 * @param {TestContext} ctx @param {string} eye @returns {number|null}
 */
function userLogMAR(ctx, eye) {
  const anyCtx = /** @type {any} */ (ctx);
  if (Number.isFinite(anyCtx.acuityLogMAR)) return anyCtx.acuityLogMAR;
  const acu = anyCtx.profile?.input?.acuity;
  if (!acu) return null;
  const pick = (/** @type {any} */ r) => (r && Number.isFinite(r.logMAR) ? r.logMAR : null);
  if (eye !== 'both' && pick(acu[eye]) !== null) return pick(acu[eye]);
  const vals = [pick(acu.both), pick(acu.right), pick(acu.left)].filter((v) => v !== null);
  return vals.length ? Math.min(...vals) : null;
}

/** x-height / font-size ratio of the UI font, measured at runtime (spec item 19). @param {string} lang @param {string} family */
function measureXRatio(lang, family) {
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (c) {
      c.font = `100px ${family}`;
      const r = c.measureText(lang === 'he' ? 'ה' : 'x').actualBoundingBoxAscent / 100;
      if (r > 0.3 && r < 0.9) return r;
    }
  } catch { /* fall through */ }
  return lang === 'he' ? 0.584 : 0.52;
}

/**
 * @param {HTMLElement} container
 * @param {TestContext} ctx
 * @returns {Promise<FocusRangeResult>}
 */
export function runFocusRangeTest(container, ctx) {
  return runView(ctx.signal, async (onCleanup) => {
    const t = makeT(STRINGS, ctx.lang);
    const eye = ctx.eye || 'both';
    /** @type {Array<() => void>} */
    const disposers = [];
    onCleanup(() => clear(container));
    onCleanup(() => disposers.splice(0).reverse().forEach((fn) => fn()));
    const cssPxPerMm = ctx.screen?.cssPxPerMm || DEFAULT_CSS_PX_PER_MM;
    const xr = measureXRatio(ctx.lang, getComputedStyle(container).fontFamily || 'sans-serif');
    const L = userLogMAR(ctx, eye);
    // Glasses-free mode: this step is required (it finds where the user sees sharply without correction).
    const glassesFree = getCorrectionMode() === 'none';
    ctx.onProgress?.(0);

    /** Sample sentence whose x-height is set physically. */
    const target = () => {
      const text = h('p', {
        lang: ctx.lang, dir: ctx.lang === 'he' ? 'rtl' : 'ltr', 'data-testid': 'focus-target',
        style: { margin: '0', color: '#000', lineHeight: '1.35', textAlign: 'center', fontWeight: '400', whiteSpace: 'nowrap' },
      }, t('sentence1'), h('br'), t('sentence2'));
      const surface = h('div', {
        class: 'va-test-surface', role: 'img', 'aria-label': t('targetLabel'),
        style: { minHeight: '22vh', padding: '16px 12px', flexDirection: 'column' },
      }, text);
      return {
        el: surface,
        /** @param {number} mm @param {number} logMAR */
        size(mm, logMAR) {
          const px = fontPxForXHeight(xHeightMmForLogMAR(mm, logMAR), xr, cssPxPerMm);
          text.style.fontSize = `${px.toFixed(2)}px`;
          text.dataset.fontPx = px.toFixed(2);
        },
      };
    };

    const nothing = () => /** @type {FocusRangeResult} */ ({ eye, nearPointMm: null, farPointMm: null });

    // ---- intro ----
    const start = await choose(container, {
      title: t('title'), illustration: focusIllustration('near'), paragraphs: [t('intro1'), t(glassesFree ? 'intro2None' : 'intro2')], testId: 'focus-intro',
      options: [
        { label: t('start'), value: 'start', testId: 'focus-start' },
        ...(glassesFree ? [] : [{ label: t('skip'), value: 'skip', variant: /** @type {const} */ ('secondary'), testId: 'focus-skip' }]),
      ],
    });
    if (start === 'skip') { ctx.onProgress?.(1); return nothing(); }

    // ---- distance source ----
    /** @type {DistanceTracker|null} */
    let tracker = ctx.distanceTracker || null;
    let cameraNotice = false;
    if (!tracker && isPlausibleFocalLength(ctx.distance?.focalLengthPx) && cameraSupported()) {
      const cam = await choose(container, {
        title: t('camTitle'), paragraphs: [t('camBody')], testId: 'focus-camera-consent',
        options: [
          { label: t('camYes'), value: 'yes', testId: 'focus-camera-yes' },
          { label: t('camNo'), value: 'no', variant: 'secondary', testId: 'focus-camera-no' },
        ],
      });
      if (cam === 'yes') {
        const own = await createDistanceTracker({ screen: ctx.screen, distance: ctx.distance });
        if (own) { tracker = own; disposers.push(() => own.stop()); } else cameraNotice = true;
      }
    } else if (!tracker) {
      cameraNotice = true;
    }

    await coverEyeScreen(container, { eye, lang: ctx.lang, signal: ctx.signal, showGlassesHint: false });

    // ---- camera procedure ----
    /**
     * Preparation screen for one run. @param {'near'|'far'} kind @param {number} n @param {DistanceTracker} tr
     * @param {string|null} notice
     * @returns {Promise<'start'|'ruler'>}
     */
    const prepare = (kind, n, tr, notice) => new Promise((resolve) => {
      const live = h('p', { class: 'va-text', 'aria-live': 'polite', 'data-testid': 'focus-live' });
      const update = (/** @type {number|null} */ mm) => {
        live.textContent = mm === null ? t('noFace') : t('now', { cm: Math.round(mm / 10) });
      };
      update(tr.current());
      const unsub = tr.subscribe(update);
      disposers.push(unsub);
      const done = (/** @type {'start'|'ruler'} */ v) => { unsub(); resolve(v); };
      show(container, uiScreen({
        title: t(kind === 'near' ? 'nearTitle' : 'farTitle', { n, total: FOCUS.runs }), testId: `focus-prep-${kind}`,
        body: [
          notice ? h('p', { class: 'va-notice va-notice--success', role: 'status' }, notice) : null,
          h('div', { class: 'va-illustration' }, focusIllustration(kind)),
          t(kind === 'near' ? 'nearPrep' : 'farPrep'),
          live,
        ].filter(Boolean),
        actions: [
          button(t('start'), { testId: 'focus-run-start', onClick: () => done('start') }),
          button(t('useRuler'), { variant: 'ghost', testId: 'focus-use-ruler', onClick: () => done('ruler') }),
        ],
      }));
    });

    /**
     * One sweep with the constant-angle target.
     * @param {'near'|'far'} kind @param {DistanceTracker} tr
     * @returns {Promise<{mm: number|null, floor?: boolean}|'ruler'>}
     */
    const sweep = (kind, tr) => new Promise((resolve) => {
      const level = kind === 'near' ? nearTargetLogMAR(L) : farTargetLogMAR(L);
      const tgt = target();
      /** @type {number|null} */
      let lastMm = tr.current();
      tgt.size(lastMm ?? (kind === 'near' ? FOCUS.nearStartMm : FOCUS.farStartMm), level);
      /** @type {Array<{t: number, mm: number}>} */
      const history = [];
      const live = h('p', { class: 'va-text', 'aria-live': 'polite', 'data-testid': 'focus-live', style: { minHeight: '1.5em' } });
      const slow = h('p', { class: 'va-notice va-notice--warning', role: 'status', 'data-testid': 'focus-slower', style: { display: 'none' } }, t('slower'));
      let settled = false;
      const done = (/** @type {{mm: number|null, floor?: boolean}|'ruler'} */ v) => {
        if (settled) return;
        settled = true;
        unsub();
        resolve(v);
      };
      const onDistance = (/** @type {number|null} */ mm) => {
        if (mm === null) {
          live.textContent = t('noFace');
          // The face leaves the frame at very close range: treat as reaching the camera floor.
          if (kind === 'near' && lastMm !== null && lastMm < FLOOR_LOST_MM) done({ mm: FOCUS.cameraFloorMm, floor: true });
          return;
        }
        lastMm = mm;
        const now = performance.now();
        history.push({ t: now, mm });
        while (history.length && now - history[0].t > 2000) history.shift();
        tgt.size(mm, level);
        live.textContent = t('now', { cm: Math.round(mm / 10) });
        slow.style.display = movementSpeedMmPerS(history) > FOCUS.maxSpeedMmPerS ? '' : 'none';
        if (kind === 'near' && mm <= FOCUS.cameraFloorMm) done({ mm: FOCUS.cameraFloorMm, floor: true });
        if (kind === 'far' && mm >= FOCUS.farPointMaxMm) done({ mm: null });
      };
      const unsub = tr.subscribe(onDistance);
      disposers.push(unsub);
      const actions = [button(t('blurryNow'), {
        testId: 'focus-blurry',
        onClick: () => {
          const mm = tr.current() ?? lastMm;
          if (mm === null) { live.textContent = t('noFace'); return; }
          done({ mm });
        },
      })];
      if (kind === 'far') actions.push(button(t('stillSharp'), { variant: 'secondary', testId: 'focus-still-sharp', onClick: () => done({ mm: null }) }));
      show(container, uiScreen({
        title: t(kind === 'near' ? 'manualNearTitle' : 'manualFarTitle'), testId: `focus-run-${kind}`,
        body: [h('p', { class: 'va-hint' }, t(kind === 'near' ? 'nearRun' : 'farRun')), tgt.el, live, slow, stickyBar(...actions)],
      }));
    });

    /** @param {DistanceTracker} tr @returns {Promise<{near: number|null, floor: boolean, far: number|null}|'ruler'>} */
    const cameraProcedure = async (tr) => {
      /** @type {number[]} */
      const nearRuns = [];
      /** @type {string|null} */
      let notice = null;
      for (let n = 1; n <= FOCUS.runs; n++) {
        if ((await prepare('near', n, tr, notice)) === 'ruler') return 'ruler';
        const r = await sweep('near', tr);
        if (r === 'ruler') return 'ruler';
        nearRuns.push(/** @type {number} */ (r.mm));
        notice = r.floor ? t('floorReached') : null;
        ctx.onProgress?.(n / (FOCUS.runs * 2));
      }
      /** @type {Array<number|null>} */
      const farRuns = [];
      for (let n = 1; n <= FOCUS.runs; n++) {
        if ((await prepare('far', n, tr, notice)) === 'ruler') return 'ruler';
        notice = null;
        const r = await sweep('far', tr);
        if (r === 'ruler') return 'ruler';
        farRuns.push(r.mm);
        ctx.onProgress?.(0.5 + n / (FOCUS.runs * 2));
        // Two "still sharp at arm's length" runs settle the median already.
        if (farRuns.filter((v) => v === null).length >= 2) break;
      }
      const near = combineNearPointRuns(nearRuns);
      return { near: near.nearPointMm, floor: near.floorLimited, far: combineFarPointRuns(farRuns) };
    };

    // ---- manual (ruler) procedure ----
    /**
     * @param {'near'|'far'} kind @param {boolean} showNoCamera
     * @returns {Promise<number|null>} mm (near: floor-limited to 150; far: null = beyond)
     */
    const manualStep = (kind, showNoCamera) => new Promise((resolve) => {
      const tgt = target();
      if (kind === 'near') tgt.size(MANUAL_NEAR_DESIGN_MM, nearTargetLogMAR(L));
      else tgt.size(FOCUS.farPointMaxMm, farTargetLogMAR(L));
      const field = cmField({ label: t('manualLabel'), min: 10, max: 100, testId: `focus-manual-${kind}` });
      const error = h('p', { class: 'va-hint', role: 'alert', style: { color: 'var(--va-danger)' } });
      const submit = () => {
        const cm = field.read();
        if (!Number.isFinite(cm) || cm < 10 || cm > 100) { error.textContent = t('manualInvalid'); return; }
        resolve(cm * 10);
      };
      field.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      show(container, uiScreen({
        title: t(kind === 'near' ? 'manualNearTitle' : 'manualFarTitle'), testId: `focus-manual-${kind}-screen`,
        body: [
          showNoCamera ? h('p', { class: 'va-notice', role: 'status', 'data-testid': 'focus-no-camera' }, t('noCamera')) : null,
          t(kind === 'near' ? 'manualNearBody' : 'manualFarBody'),
          tgt.el, field.el, h('p', { class: 'va-hint' }, t('rulerHint')), error,
        ].filter(Boolean),
        actions: [
          button(t('continue'), { testId: `focus-manual-${kind}-continue`, onClick: submit }),
          button(t(kind === 'near' ? 'stillSharpClose' : 'neverBlurry'), {
            variant: 'secondary', testId: `focus-manual-${kind}-sharp`,
            onClick: () => resolve(kind === 'near' ? FOCUS.cameraFloorMm : null),
          }),
        ],
      }));
    });

    /** @param {boolean} showNoCamera */
    const manualProcedure = async (showNoCamera) => {
      const nearMm = await manualStep('near', showNoCamera);
      ctx.onProgress?.(0.5);
      const farMm = await manualStep('far', false);
      const near = combineNearPointRuns(nearMm === null ? [] : [nearMm]);
      return { near: near.nearPointMm, floor: near.floorLimited, far: combineFarPointRuns([farMm]) };
    };

    let outcome = tracker ? await cameraProcedure(tracker) : 'ruler';
    if (outcome === 'ruler') outcome = await manualProcedure(cameraNotice);
    ctx.onProgress?.(1);

    // ---- result ----
    const { near, floor, far } = outcome;
    const cm = (/** @type {number} */ mm) => t('nearValue', { cm: Math.round(mm / 10) });
    /** @type {Array<string|Node>} */
    const paragraphs = near === null
      ? [t('resultNone')]
      : [t(glassesFree ? 'resultRangeNone' : 'resultRange', { near: floor ? t('nearFloor') : cm(near), far: far === null ? t('farBeyond') : cm(far) })];
    paragraphs.push(h('p', { class: 'va-hint' }, t('disclaimer')));
    await choose(container, {
      title: t('resultTitle'), paragraphs, testId: 'focus-result',
      options: [{ label: t('continue'), value: 'ok', testId: 'focus-result-continue' }],
    });
    /** @type {FocusRangeResult} */
    const result = { eye, nearPointMm: near, farPointMm: far };
    return result;
  });
}

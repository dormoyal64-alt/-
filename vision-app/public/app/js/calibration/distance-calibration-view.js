// @ts-check
/**
 * Viewing-distance calibration (spec §2.1 + §2.2 option 1): blind-spot "virtual chinrest" adapted for phones —
 * landscape, left-eye run then right-eye run, 4 "disappear" + 4 "reappear" trials each, disc 0.5° moving at 2°/s
 * (time-based), rejection rules (4°–22° window, CV ≤ 10%, eyes within 12%), D_bs = median of kept trials.
 * Optionally the front camera records the open eye's iris size during the trials to calibrate focalLengthPx
 * (640-px normalised). Fallbacks: manual entry; quick camera measurement when a focal length already exists.
 */
import { h, clear, delay, runView } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { screen as uiScreen, button } from '../core/ui.js';
import {
  BLIND_SPOT, blindSpotLayout, isBlindSpotFeasible, blindSpotStartOffsetMm, blindSpotSpeedMmPerS,
  blindSpotTrialSchedule, blindSpotRunningEstimate, evaluateBlindSpotRun, combineBlindSpotEyes, offsetMmForAngle,
  focalLengthFromKnownDistance, normalisePx, isFrontalPose, isPlausibleFocalLength, isPlausibleDistanceMm,
  defaultDistanceMm, isTabletSize, median,
} from './calibration-math.js';
import { choose, show, cmField, blindSpotIllustration, rotateIllustration } from './calibration-ui.js';
import { startFaceEngine, cameraSupported } from './face-iris.js';
import { createDistanceTracker } from './distance-tracker.js';
import { DISTANCE_STRINGS, COMMON_STRINGS } from './strings.js';

/** @typedef {import('../core/types.js').DistanceCalibration} DistanceCalibration */
/** @typedef {import('../core/types.js').TestContext} TestContext */
/** @typedef {import('./calibration-math.js').BlindSpotTrial} BlindSpotTrial */
/** @typedef {import('./face-iris.js').FaceEngine} FaceEngine */

const STRINGS = {
  he: { ...COMMON_STRINGS.he, ...DISTANCE_STRINGS.he },
  en: { ...COMMON_STRINGS.en, ...DISTANCE_STRINGS.en },
};

/** Pause before the disc starts moving, and between trials (ms) [D]. */
const READY_MS = 600;
const BETWEEN_MS = 700;
/** Taps within this time after motion onset are anticipations and are ignored [D]. */
const MIN_RESPONSE_MS = 400;
/** Reappear trials run inward until 1° from fixation. */
const REAPPEAR_END_DEG = 1;
/** Minimum frontal iris samples to calibrate the camera [D]. */
const MIN_IRIS_SAMPLES = 10;
const DISC_COLOR = '#e00000';

/**
 * @param {HTMLElement} container
 * @param {TestContext} ctx
 * @returns {Promise<DistanceCalibration>}
 */
export function runDistanceCalibration(container, ctx) {
  return runView(ctx.signal, async (onCleanup) => {
    const t = makeT(STRINGS, ctx.lang);
    const signal = ctx.signal;
    let closed = false;
    /** @type {Array<() => void>} */
    const disposers = [];
    onCleanup(() => clear(container));
    onCleanup(() => { closed = true; disposers.splice(0).reverse().forEach((fn) => fn()); });
    const scr = ctx.screen && ctx.screen.cssPxPerMm > 0 ? ctx.screen : null;
    const tablet = isTabletSize(window.screen.width, window.screen.height);
    ctx.onProgress?.(0);

    // ---------------------------------------------------------------------------------------------------------
    // Manual entry
    // ---------------------------------------------------------------------------------------------------------
    /** @returns {Promise<number>} mm */
    const manualEntry = () => new Promise((resolve) => {
      const field = cmField({ label: t('manualLabel'), value: defaultDistanceMm(tablet) / 10, min: 15, max: 100, testId: 'distance-manual-input' });
      const error = h('p', { class: 'va-hint', role: 'alert', 'data-testid': 'distance-manual-error', style: { color: 'var(--va-danger)' } });
      const presets = (tablet ? [30, 35, 40, 45, 50] : [25, 30, 35, 40, 45]).map((cm) => h('button', {
        type: 'button', class: 'va-btn va-btn--secondary', 'data-testid': `distance-preset-${cm}`, style: { minWidth: '72px' },
        on: { click: () => { field.input.value = String(cm); error.textContent = ''; field.input.focus(); } },
      }, t('cm', { cm })));
      const submit = () => {
        const cm = field.read();
        const mm = cm * 10;
        if (!Number.isFinite(cm) || cm < 15 || cm > 100 || !isPlausibleDistanceMm(mm)) { error.textContent = t('manualInvalid'); return; }
        resolve(mm);
      };
      field.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      show(container, uiScreen({
        title: t('manualTitle'), testId: 'distance-manual',
        body: [
          t('manualBody'),
          h('div', { class: 'va-row', role: 'group', 'aria-label': t('manualPresets') }, ...presets),
          field.el, error,
        ],
        actions: [button(t('continue'), { testId: 'distance-manual-continue', onClick: submit })],
      }));
    });

    // ---------------------------------------------------------------------------------------------------------
    // Quick camera measurement (focal length already calibrated)
    // ---------------------------------------------------------------------------------------------------------
    /** @returns {Promise<number|null>} */
    const quickCamera = async () => {
      const tracker = await createDistanceTracker({ screen: scr || undefined, distance: ctx.distance });
      if (!tracker || closed) { tracker?.stop(); return null; }
      disposers.push(() => tracker.stop());
      const live = h('p', { class: 'va-text', 'aria-live': 'polite', 'data-testid': 'distance-quick-live' }, t('quickNoFace'));
      show(container, uiScreen({ title: t('quickTitle'), testId: 'distance-quick', body: [t('quickBody'), live] }));
      /** @type {number[]} */
      const values = [];
      const started = performance.now();
      return new Promise((resolve) => {
        const unsub = tracker.subscribe((mm) => {
          live.textContent = mm === null ? t('quickNoFace') : t('quickNow', { cm: Math.round(mm / 10) });
          if (mm !== null) values.push(mm);
          const enough = values.length >= 30;
          if (enough || performance.now() - started > 15000) {
            unsub();
            tracker.stop();
            const m = values.length >= 10 ? median(values.slice(-30)) : NaN;
            resolve(isPlausibleDistanceMm(m) ? m : null);
          }
        });
        disposers.push(unsub);
      });
    };

    // ---------------------------------------------------------------------------------------------------------
    // Blind-spot procedure
    // ---------------------------------------------------------------------------------------------------------
    /** @returns {{left: number, right: number}} safe-area insets in CSS px */
    const safeInsets = () => {
      const probe = h('div', { style: { position: 'absolute', visibility: 'hidden', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' } });
      container.appendChild(probe);
      const cs = getComputedStyle(probe);
      const out = { left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0 };
      probe.remove();
      return out;
    };
    /** @param {'left'|'right'} eye */
    const layoutFor = (eye) => {
      const ins = safeInsets();
      return blindSpotLayout({
        surfaceWidthCssPx: container.clientWidth, cssPxPerMm: /** @type {number} */ (scr?.cssPxPerMm), eye,
        insetLeftCssPx: ins.left, insetRightCssPx: ins.right,
      });
    };

    /**
     * Ask for landscape until the surface is wide enough. Resolves false if the user chooses manual entry.
     * @returns {Promise<boolean>}
     */
    const ensureFeasible = async () => {
      for (;;) {
        if (isBlindSpotFeasible(layoutFor('left').maxTravelMm)) return true;
        const landscape = window.innerWidth > window.innerHeight;
        const outcome = await new Promise((resolve) => {
          const onChange = () => { if (isBlindSpotFeasible(layoutFor('left').maxTravelMm)) done('ok'); };
          const done = (/** @type {string} */ v) => {
            window.removeEventListener('resize', onChange);
            window.screen.orientation?.removeEventListener?.('change', onChange);
            resolve(v);
          };
          window.addEventListener('resize', onChange);
          window.screen.orientation?.addEventListener?.('change', onChange);
          disposers.push(() => done('closed'));
          show(container, uiScreen({
            title: t('rotateTitle'), testId: 'distance-rotate',
            body: [h('div', { class: 'va-illustration' }, rotateIllustration()), landscape ? t('rotateTooSmall') : t('rotateBody')],
            actions: [button(t('enterManually'), { variant: 'secondary', testId: 'distance-rotate-manual', onClick: () => done('manual') })],
          }));
        });
        if (outcome !== 'ok') return false;
      }
    };

    /**
     * Eye instructions (compact two-column layout so it fits a landscape phone).
     * @param {'left'|'right'} eye @returns {Promise<'ready'|'manual'>}
     */
    const eyeInstructions = (eye) => new Promise((resolve) => {
      const title = h('h1', { class: 'va-title', tabindex: '-1' }, t(eye === 'left' ? 'eyeTitleLeft' : 'eyeTitleRight'));
      const texts = [t(eye === 'left' ? 'eyeBodyLeft' : 'eyeBodyRight'), t('eyeBody2'), t('eyeBody3')]
        .map((p) => h('p', { class: 'va-text' }, p));
      show(container, h('section', { class: 'va-screen', 'data-testid': `distance-eye-${eye}`, style: { maxWidth: '900px', gap: '12px' } },
        title,
        h('div', { class: 'va-row', style: { alignItems: 'flex-start', gap: '16px' } },
          h('div', { class: 'va-illustration', style: { flex: '0 0 auto', marginInline: 'auto' } }, blindSpotIllustration(eye)),
          h('div', { class: 'va-stack', style: { flex: '1 1 280px' } }, ...texts,
            h('div', { class: 'va-actions' },
              button(t('ready'), { testId: 'distance-ready', onClick: () => resolve('ready') }),
              button(t('enterManually'), { variant: 'ghost', testId: 'distance-eye-manual', onClick: () => resolve('manual') }))))));
    });

    /** Camera iris sampling (opt-in). */
    /** @type {Record<'left'|'right', Array<{irisPx: number, rPx: number}>>} */
    const samples = { left: [], right: [] };
    /** @type {'left'|'right'|null} */
    let samplingEye = null;
    /** @type {Promise<FaceEngine|null>|null} */
    let enginePromise = null;
    const startCamera = () => {
      enginePromise = startFaceEngine({ fps: 12 }).then((engine) => {
        if (!engine) return null;
        if (closed) { engine.stop(); return null; }
        disposers.push(() => engine.stop());
        engine.onFrame((frame) => {
          if (!samplingEye || !frame.face || !isFrontalPose(frame.pose)) return;
          // Only the open (tested) eye: the other one is closed or covered during the run.
          const m = samplingEye === 'left' ? frame.left : frame.right;
          if (!m) return;
          samples[samplingEye].push({ irisPx: normalisePx(m.diameterPx, frame.longSidePx), rPx: normalisePx(m.offCenterPx, frame.longSidePx) });
        });
        return engine;
      }).catch(() => null);
    };

    /**
     * One trial. Resolves with the disc-centre offset (mm) at the response, null if missed, or 'resized'.
     * @param {{surface: HTMLElement, disc: HTMLElement, fixX: number, dir: 1|-1, cssPxPerMm: number, type: 'disappear'|'reappear', startMm: number, endMm: number, speed: number}} p
     * @returns {Promise<number|null|'resized'>}
     */
    const runTrial = async ({ surface, disc, fixX, dir, cssPxPerMm, type, startMm, endMm, speed }) => {
      const sign = type === 'disappear' ? 1 : -1;
      const place = (/** @type {number} */ off) => {
        const x = fixX + dir * off * cssPxPerMm;
        disc.style.transform = `translate(${x}px, 0)`;
        disc.dataset.offsetMm = off.toFixed(2);
      };
      place(startMm);
      disc.dataset.type = type;
      disc.style.visibility = 'visible';
      await delay(READY_MS, signal);
      return new Promise((resolve) => {
        const t0 = performance.now();
        let raf = 0;
        let settled = false;
        const finish = (/** @type {number|null|'resized'} */ v) => {
          if (settled) return;
          settled = true;
          cancelAnimationFrame(raf);
          surface.removeEventListener('pointerdown', onPointer);
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('resize', onResize);
          disc.style.visibility = 'hidden';
          delete disc.dataset.offsetMm;
          resolve(v);
        };
        const offsetAt = (/** @type {number} */ time) => startMm + sign * speed * Math.max(0, time - t0) / 1000;
        const respond = (/** @type {number} */ time) => {
          const now = performance.now();
          const tt = time > 0 && time <= now ? time : now;
          if (tt - t0 < MIN_RESPONSE_MS) return;
          const off = offsetAt(tt);
          finish(sign > 0 ? Math.min(off, endMm) : Math.max(off, endMm));
        };
        const onPointer = (/** @type {PointerEvent} */ e) => { e.preventDefault(); respond(e.timeStamp); };
        const onKey = (/** @type {KeyboardEvent} */ e) => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); respond(e.timeStamp); }
        };
        const onResize = () => finish('resized');
        const frame = () => {
          const off = offsetAt(performance.now());
          if (sign > 0 ? off >= endMm : off <= endMm) { finish(null); return; }
          place(off);
          raf = requestAnimationFrame(frame);
        };
        surface.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', onResize);
        disposers.push(() => finish(null));
        raf = requestAnimationFrame(frame);
      });
    };

    /**
     * Run the 8 trials of one eye on a full-width white surface.
     * @param {'left'|'right'} eye @param {number} estimateMm @param {number} progressBase
     * @returns {Promise<BlindSpotTrial[]|null>} null when the user chose manual entry (rotation)
     */
    const runEye = async (eye, estimateMm, progressBase) => {
      const schedule = blindSpotTrialSchedule();
      /** @type {BlindSpotTrial[]} */
      const trials = [];
      const cssPxPerMm = /** @type {number} */ (scr?.cssPxPerMm);
      const speed = blindSpotSpeedMmPerS();
      samples[eye] = [];
      for (let i = 0; i < schedule.length; i++) {
        if (!(await ensureFeasible())) return null;
        const lay = layoutFor(eye);
        const est = blindSpotRunningEstimate(trials, estimateMm);
        const sizePx = Math.max(6, offsetMmForAngle(est, BLIND_SPOT.discDeg) * cssPxPerMm);
        const fixPx = Math.max(6, offsetMmForAngle(est, BLIND_SPOT.fixationDeg) * cssPxPerMm);
        const top = container.getBoundingClientRect().top;
        const height = Math.max(220, window.innerHeight - Math.max(0, top) - 4);
        const disc = h('div', {
          'data-testid': 'blindspot-disc', 'aria-hidden': 'true',
          style: {
            position: 'absolute', left: `${-sizePx / 2}px`, top: `calc(50% - ${sizePx / 2}px)`, width: `${sizePx}px`, height: `${sizePx}px`,
            borderRadius: '50%', background: DISC_COLOR, visibility: 'hidden', willChange: 'transform',
          },
        });
        const fixation = h('div', {
          'data-testid': 'blindspot-fixation', 'aria-hidden': 'true',
          style: {
            position: 'absolute', left: `${lay.fixationXCssPx - fixPx / 2}px`, top: `calc(50% - ${fixPx / 2}px)`,
            width: `${fixPx}px`, height: `${fixPx}px`, background: '#000',
          },
        });
        const eyeName = t(eye === 'left' ? 'eyeShortLeft' : 'eyeShortRight');
        const surface = h('div', {
          class: 'va-test-surface', dir: 'ltr', tabindex: '0', role: 'application', 'aria-label': t('surfaceLabel'),
          'data-testid': 'blindspot-surface', 'data-eye': eye,
          style: { display: 'block', width: '100%', height: `${height}px`, borderRadius: '0', cursor: 'pointer', outline: 'none' },
        },
        h('div', { style: { position: 'absolute', top: '8px', insetInline: '0', textAlign: 'center', fontSize: '0.875rem', color: '#555', pointerEvents: 'none' }, 'data-testid': 'blindspot-counter' },
          t('counter', { eye: eyeName, n: i + 1, total: schedule.length })),
        fixation, disc,
        h('div', { style: { position: 'absolute', bottom: '8px', insetInline: '8px', textAlign: 'center', fontSize: '0.875rem', color: '#555', pointerEvents: 'none' } }, t('trialHint')));
        clear(container);
        container.appendChild(surface);
        surface.focus({ preventScroll: true });
        const type = schedule[i];
        const startMm = blindSpotStartOffsetMm(type, est, lay.maxTravelMm);
        const endMm = type === 'disappear' ? lay.maxTravelMm : Math.min(offsetMmForAngle(est, REAPPEAR_END_DEG), startMm);
        samplingEye = eye;
        const off = await runTrial({ surface, disc, fixX: lay.fixationXCssPx, dir: lay.direction, cssPxPerMm, type, startMm, endMm, speed });
        samplingEye = null;
        if (off === 'resized') { i--; continue; }
        trials.push({ type, offsetMm: off });
        ctx.onProgress?.(Math.min(0.95, progressBase + ((i + 1) / schedule.length) * 0.45));
        await delay(BETWEEN_MS, signal);
      }
      return trials;
    };

    /** @param {'too-few'|'unstable'|'eyes-differ'|string|null} reason */
    const repeatScreen = (reason) => choose(container, {
      title: t('repeatTitle'), testId: 'distance-repeat',
      paragraphs: [t(reason === 'unstable' ? 'repeatUnstable' : reason === 'eyes-differ' ? 'repeatEyes' : 'repeatTooFew')],
      options: [{ label: t('continue'), value: 'ok', testId: 'distance-repeat-continue' }],
    });
    const giveUp = () => choose(container, {
      title: t('giveUpTitle'), paragraphs: [t('giveUpBody')], testId: 'distance-give-up',
      options: [
        { label: t('tryAgain'), value: 'again', testId: 'distance-give-up-again' },
        { label: t('enterManually'), value: 'manual', variant: 'secondary', testId: 'distance-give-up-manual' },
      ],
    });

    /** @returns {Promise<{distanceMm: number, focalLengthPx?: number}|'manual'>} */
    const blindSpotProcedure = async () => {
      if (cameraSupported()) {
        const cam = await choose(container, {
          title: t('camTitle'), paragraphs: [t('camBody1'), t('camBody2')], testId: 'distance-camera-consent',
          options: [
            { label: t('camYes'), value: 'yes', testId: 'distance-camera-yes' },
            { label: t('camNo'), value: 'no', variant: 'secondary', testId: 'distance-camera-no' },
          ],
        });
        if (cam === 'yes') startCamera();
      }
      let pairAttempts = 0;
      for (;;) {
        /** @type {Partial<Record<'left'|'right', ReturnType<typeof evaluateBlindSpotRun>>>} */
        const runs = {};
        for (const eye of /** @type {const} */ (['left', 'right'])) {
          let tries = 0;
          for (;;) {
            if (!(await ensureFeasible())) return 'manual';
            if ((await eyeInstructions(eye)) === 'manual') return 'manual';
            const estimate = runs.left?.distanceMm || BLIND_SPOT.initialGuessMm;
            const trials = await runEye(eye, estimate, eye === 'left' ? 0 : 0.45);
            if (!trials) return 'manual';
            const run = evaluateBlindSpotRun(trials);
            if (run.ok) { runs[eye] = run; break; }
            tries++;
            if (tries >= 2) {
              if ((await giveUp()) === 'manual') return 'manual';
              tries = 0;
            } else {
              await repeatScreen(run.reason);
            }
          }
        }
        const both = combineBlindSpotEyes(/** @type {any} */ (runs.left), /** @type {any} */ (runs.right));
        if (both.ok) return { distanceMm: both.distanceMm, focalLengthPx: await focalFromSamples(both.distanceMm) };
        pairAttempts++;
        if (pairAttempts >= 2) {
          if ((await giveUp()) === 'manual') return 'manual';
          pairAttempts = 0;
        } else {
          await repeatScreen(both.reason);
        }
      }
    };

    /** @param {number} distanceMm @returns {Promise<number|undefined>} */
    const focalFromSamples = async (distanceMm) => {
      if (!enginePromise) return undefined;
      const engine = await Promise.race([enginePromise, delay(3000, signal).then(() => null)]);
      engine?.stop();
      const all = [...samples.left, ...samples.right];
      if (all.length < MIN_IRIS_SAMPLES) return undefined;
      const fs = all.map((smp) => focalLengthFromKnownDistance({ irisDiameterPx: smp.irisPx, distanceMm, offCenterPx: smp.rPx }))
        .filter(Number.isFinite);
      const f = median(fs);
      return fs.length >= MIN_IRIS_SAMPLES && isPlausibleFocalLength(f) ? Math.round(f * 10) / 10 : undefined;
    };

    /**
     * @param {number} distanceMm @param {'blindspot'|'camera'|'manual'} method @param {number} [focalLengthPx]
     * @returns {Promise<DistanceCalibration>}
     */
    const finish = async (distanceMm, method, focalLengthPx) => {
      ctx.onProgress?.(1);
      /** @type {DistanceCalibration} */
      const res = { distanceMm: Math.round(distanceMm), method, measuredAt: new Date().toISOString() };
      if (focalLengthPx !== undefined && isPlausibleFocalLength(focalLengthPx)) res.focalLengthPx = focalLengthPx;
      const paragraphs = [t('resultBody', { cm: Math.round(distanceMm / 10) })];
      if (res.focalLengthPx) paragraphs.push(t('resultCamera'));
      await choose(container, {
        title: t('resultTitle'), paragraphs, testId: 'distance-result',
        options: [{ label: t('continue'), value: 'ok', testId: 'distance-result-continue' }],
      });
      return res;
    };

    // ---------------------------------------------------------------------------------------------------------
    // Flow
    // ---------------------------------------------------------------------------------------------------------
    const hasFocal = isPlausibleFocalLength(ctx.distance?.focalLengthPx) && cameraSupported();
    /** @type {import('./calibration-ui.js').ChoiceOption[]} */
    const options = [];
    if (scr) options.push({ label: t('measure'), value: 'measure', testId: 'distance-measure' });
    if (hasFocal) options.push({ label: t('cameraQuick'), value: 'quick', variant: 'secondary', testId: 'distance-camera-quick' });
    options.push({ label: t('manual'), value: 'manual', variant: scr ? 'secondary' : 'primary', testId: 'distance-manual-choice' });
    let route = await choose(container, {
      title: t('title'), testId: 'distance-intro', illustration: blindSpotIllustration('left'),
      paragraphs: scr ? [t('intro1'), t('intro2')] : [t('noScreen')], options,
    });
    for (;;) {
      if (route === 'manual') return finish(await manualEntry(), 'manual');
      if (route === 'quick') {
        const mm = await quickCamera();
        if (mm !== null) return finish(mm, 'camera', ctx.distance?.focalLengthPx);
        route = await choose(container, {
          title: t('title'), paragraphs: [t('quickFailed')], testId: 'distance-quick-failed',
          options: options.filter((o) => o.value !== 'quick'),
        });
        continue;
      }
      const out = await blindSpotProcedure();
      if (out === 'manual') { route = 'manual'; continue; }
      return finish(out.distanceMm, 'blindspot', out.focalLengthPx);
    }
  });
}

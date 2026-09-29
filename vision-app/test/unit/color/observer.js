// Simulated observers for the colour-test procedure (test helper, not a test file).
// Model: the observer sees the Machado-2009-simulated colours (identity for a normal observer) and detects the
// ring by its chromaticity difference from the background in CIE u′v′ (luminance is masked by the plate's
// luminance noise, and u′v′ ignores luminance). Normal discrimination ellipse: θu = 50e-4, θv = 80e-4 (≈ half of
// the CCT normal limits, i.e. a typical normal observer), with a per-observer sensitivity factor.
// Detection probability F = 1 − exp(−v^β) with v = ellipse distance, β = 3.5 (same form as the procedure).
import { machadoMatrix, mat3Apply, linearRgbToUv } from '../../../public/app/js/engine/color-math.js';
import { axisColor, NEUTRAL_LINEAR, DIRECTIONS } from '../../../public/app/js/tests/color/color-plates.js';
import { RED_LUMINANCE, gauss } from '../../../public/app/js/tests/color/color-procedure.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * @param {{type: 'normal'|'protan'|'deutan'|'tritan', severity?: number, rng: () => number,
 *   thetaU?: number, thetaV?: number, beta?: number, lapse?: number, unsureProb?: number, individualSD?: number}} o
 */
export function createObserver({ type, severity = 0, rng, thetaU = 50e-4, thetaV = 80e-4, beta = 3.5, lapse = 0.03, unsureProb = 0.4, individualSD = 0.07 }) {
  const S = type === 'normal' ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : machadoMatrix(type, severity);
  const factor = 10 ** (individualSD * gauss(rng));
  const see = (rgb) => mat3Apply(S, rgb).map(clamp01);
  const bgUv = linearRgbToUv(see([NEUTRAL_LINEAR, NEUTRAL_LINEAR, NEUTRAL_LINEAR]));
  const randomDir = () => DIRECTIONS[Math.min(3, Math.floor(rng() * 4))];
  return {
    /** Visibility (ellipse distance in threshold units) of an axis stimulus at cone contrast c. */
    visibility(axis, c) {
      const uv = linearRgbToUv(see(axisColor(axis, c)));
      return Math.hypot((uv[0] - bgUv[0]) / thetaU, (uv[1] - bgUv[1]) / thetaV) / factor;
    },
    /** @param {import('../../../public/app/js/tests/color/color-procedure.js').ColorTrial} trial */
    answer(trial) {
      if (rng() < lapse) return randomDir();
      const F = trial.kind === 'catch' ? 1 : 1 - Math.exp(-(this.visibility(trial.axis, trial.c) ** beta));
      if (rng() < F) return trial.gap;
      return rng() < unsureProb ? 'unsure' : randomDir();
    },
    /** Grey/red luminance ratio this observer sets in the minimally-distinct-border match (with setting noise). */
    luminanceMatch() {
      const red = see([1, 0, 0]);
      const y = 0.2126729 * red[0] + 0.7151522 * red[1] + 0.072175 * red[2];
      return (y / RED_LUMINANCE) * 10 ** (0.05 * gauss(rng));
    },
  };
}

/**
 * Run one full simulated session.
 * @param {ReturnType<typeof createObserver>} observer
 * @param {ReturnType<typeof import('../../../public/app/js/tests/color/color-procedure.js').createColorProcedure>} proc
 */
export function runSession(observer, proc) {
  for (let t = proc.next(); t; t = proc.next()) proc.respond(t, observer.answer(t), 900);
  if (proc.needsLuminanceMatch()) {
    const a = observer.luminanceMatch(); const b = observer.luminanceMatch();
    proc.setLuminanceMatch(Math.sqrt(a * b));
  }
  return proc.result();
}

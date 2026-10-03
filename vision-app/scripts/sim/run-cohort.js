// @ts-check
/**
 * Glasses-free validation: run the synthetic cohort through the REAL procedures + engine and score against truth.
 *
 *   node scripts/sim/run-cohort.js                 # 20 repetitions per user, writes docs/validation/cohort-results.{json,md}
 *   node scripts/sim/run-cohort.js --reps 5        # faster
 *   node scripts/sim/run-cohort.js --fit           # print the defocus-model fit table and exit
 *
 * Internal research output (prescriptions appear here on purpose; never shown to users).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCohort } from '../../public/app/js/sim/cohort.js';
import { simulateUser } from '../../public/app/js/sim/pipeline.js';
import { evaluateRun } from '../../public/app/js/sim/evaluate.js';
import { summarize } from '../../public/app/js/sim/summary-stats.js';
import { DEFOCUS_MODEL, logMARForBlur } from '../../public/app/js/sim/eye-model.js';
import { computeProfile } from '../../public/app/js/engine/profile.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const argVal = (/** @type {string} */ k, /** @type {string} */ d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

if (args.includes('--fit')) {
  const P = DEFOCUS_MODEL.refPupilMm;
  console.log(`Defocus model k=${DEFOCUS_MODEL.k} z=${DEFOCUS_MODEL.deadZoneMmD} mm·D, reference pupil ${P} mm, floor −0.05`);
  let sse = 0;
  for (const [u, L, src] of DEFOCUS_MODEL.fitData) {
    const m = logMARForBlur(Number(u), P, -0.05);
    sse += (m - Number(L)) ** 2;
    console.log(`  ${String(u).padStart(4)} D  data ${Number(L).toFixed(2)}  model ${m.toFixed(2)}  (${src})`);
  }
  console.log(`  RMS ${Math.sqrt(sse / DEFOCUS_MODEL.fitData.length).toFixed(3)} logMAR`);
  for (const p of [3, 3.7, 4.5]) {
    console.log(`  P ${p} mm: ${[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8].map((b) => `${b}D→${logMARForBlur(b, p, -0.05).toFixed(2)}`).join('  ')}`);
  }
  process.exit(0);
}

const reps = Number(argVal('--reps', '20'));
const outDir = resolve(ROOT, argVal('--out', 'docs/validation'));
const t0 = Date.now();
const cohort = buildCohort();
/** @type {ReturnType<typeof evaluateRun>[]} */
const runs = [];
/** Engine verdict when an under-18 is (wrongly) marked as tested without glasses — must never be 'yes'. */
const minorForced = [];
for (const user of cohort) {
  for (let rep = 0; rep < reps; rep++) {
    const run = simulateUser(user, { rep });
    runs.push(evaluateRun(run));
    if (user.age < 18) {
      const p = computeProfile({ ...run.input, wearsCorrection: false });
      minorForced.push({ id: user.id, feasible: p.glassesFree?.feasible ?? null, reasons: p.glassesFree?.reasons ?? [], rec: p.viewing.recommendedDistanceMm });
    }
  }
}
const result = summarize(cohort, runs, { reps, minorForced });
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'cohort-results.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), reps, ...result.json }, null, 1)}\n`);
writeFileSync(resolve(outDir, 'cohort-results.md'), result.markdown);
console.log(result.console);
console.log(`\n${cohort.length} users × ${reps} reps in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${outDir}/cohort-results.{json,md}`);

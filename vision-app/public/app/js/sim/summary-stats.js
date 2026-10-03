// @ts-check
/**
 * Aggregation of evaluated simulation runs (evaluate.js) into the validation numbers, the property checks and a
 * Markdown report section. Validation-only code.
 */
import { allFiniteNumbers } from './util.js';

/** @typedef {ReturnType<typeof import('./evaluate.js').evaluateRun>} Eval */
/** @typedef {import('./cohort.js').SimUser} SimUser */

/** @param {number[]} a */
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
/** @param {number[]} a */
export const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0; };
/** @param {number[]} a @param {number} p */
export const quantile = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const i = p * (s.length - 1); const lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); };
/** Bland–Altman: bias and 95 % limits of agreement. @param {number[]} d */
export const loa = (d) => ({ n: d.length, bias: mean(d), lo: mean(d) - 1.96 * sd(d), hi: mean(d) + 1.96 * sd(d), sd: sd(d) });
/** @param {number} v @param {number} [dp] */
const f = (v, dp = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(dp));
/** @param {number} v */
const pct = (v) => `${Math.round(100 * v)}%`;
/** @template T @param {T[]} a @returns {T} */
const mode = (a) => { /** @type {Map<T, number>} */ const c = new Map(); for (const x of a) c.set(x, (c.get(x) || 0) + 1); return [...c.entries()].sort((x, y) => y[1] - x[1])[0][0]; };

/**
 * @param {SimUser[]} cohort @param {Eval[]} runs
 * @param {{reps: number, minorForced: Array<{id: string, feasible: string|null, reasons: string[], rec: number|null}>}} o
 */
export function summarize(cohort, runs, { reps, minorForced }) {
  const byUser = new Map(cohort.map((u) => [u.id, runs.filter((r) => r.id === u.id)]));
  // ---- (a) measurement accuracy
  const accDiff = { mono: /** @type {number[]} */ ([]), monoAll: /** @type {number[]} */ ([]), both: /** @type {number[]} */ ([]) };
  let floorLimited = 0; let unreliable = 0; let monoCount = 0;
  for (const r of runs) {
    for (const eye of /** @type {const} */ (['right', 'left'])) {
      const a = r.acc[eye];
      if (a.measured === null) continue;
      monoCount++;
      if (a.floorLimited) floorLimited++;
      if (!a.reliable) unreliable++;
      accDiff.monoAll.push(a.measured - a.truth);
      if (!a.floorLimited) accDiff.mono.push(a.measured - a.truth);
    }
    if (!r.acc.both.floorLimited) accDiff.both.push(r.acc.both.measured - r.acc.both.truth);
  }
  const farErrD = []; const nearErrD = [];
  let farDetected = 0; let farDetectable = 0; let farFalse = 0; let farNotExpected = 0;
  for (const r of runs) {
    const ft = r.focus.farTrue; const fm = r.focus.farMeasured;
    const measurable = ft !== null && ft <= 600 && ft >= 220 && Math.abs(r.cylR) < 0.5;
    if (measurable) { farDetectable++; if (fm !== null) { farDetected++; farErrD.push(1000 / fm - 1000 / ft); } }
    if ((ft === null || ft > 800) && Math.abs(r.cylR) < 0.5) { farNotExpected++; if (fm !== null) farFalse++; }
    const nt = r.focus.nearTrue; const nm = r.focus.nearMeasured;
    if (nt !== null && nt > 180 && nt < 380 && nm !== null && nm > 150 && Math.abs(r.cylR) < 0.5) nearErrD.push(1000 / nm - 1000 / nt);
  }
  // ---- verdicts by group (modal verdict per user)
  const groups = [...new Set(cohort.map((u) => u.group))];
  /** @type {Record<string, {users: number, yes: number, partial: number, no: number, none: number}>} */
  const byGroup = {};
  /** @type {Array<Record<string, any>>} */
  const perUser = [];
  for (const u of cohort) {
    const rs = /** @type {Eval[]} */ (byUser.get(u.id));
    const verdicts = rs.map((r) => r.feasible ?? 'n/a');
    const modal = mode(verdicts);
    const g = (byGroup[u.group] ||= { users: 0, yes: 0, partial: 0, no: 0, none: 0 });
    g.users++;
    if (modal === 'yes' || modal === 'partial' || modal === 'no') g[modal]++; else g.none++;
    const reasons = mode(rs.map((r) => r.reasons.join(',')));
    perUser.push({
      id: u.id, group: u.group, label: u.label, habitualMm: u.habitualMm,
      truthBoth: rs[0].acc.both.truth, measuredRight: quantile(rs.map((r) => r.acc.right.measured ?? NaN).filter(Number.isFinite), 0.5),
      truthRight: rs[0].acc.right.truth,
      farTrue: rs[0].focus.farTrue, farMeasured: quantile(rs.map((r) => r.focus.farMeasured ?? 9999), 0.5),
      nearTrue: rs[0].focus.nearTrue, nearMeasured: quantile(rs.map((r) => r.focus.nearMeasured ?? NaN).filter(Number.isFinite), 0.5),
      sharpFrom: rs[0].sharp.fromMm, sharpTo: rs[0].sharp.toMm,
      verdict: modal, verdictShare: verdicts.filter((v) => v === modal).length / rs.length, reasons,
      dRec: quantile(rs.map((r) => r.dEval), 0.5), fsMedian: quantile(rs.map((r) => r.baseFontPx), 0.5),
      fsP10: quantile(rs.map((r) => r.baseFontPx), 0.1), fsP90: quantile(rs.map((r) => r.baseFontPx), 0.9),
      reserveMedian: quantile(rs.map((r) => r.reserve), 0.5), reserveMin: Math.min(...rs.map((r) => r.reserve)),
      pass: rs.filter((r) => r.legibility === 'PASS').length / rs.length,
      baseReserve: rs[0].baseReserve, baseClass: rs[0].baseLegibility,
      cplHebrew: quantile(rs.map((r) => r.cpl.hebrew), 0.5), cplLatin: quantile(rs.map((r) => r.cpl.latin), 0.5),
      distanceOk: rs.filter((r) => r.distanceOk).length / rs.length,
      textAngle: quantile(rs.map((r) => (2 * Math.atan((r.baseFontPx * 0.58) / u.device.cssPxPerMm / (2 * r.dEval)) * 10800) / Math.PI), 0.5),
      topFlags: [...new Set(rs.flatMap((r) => r.flags))].filter((c) => rs.filter((r) => r.flags.includes(c)).length >= rs.length / 2),
    });
  }
  // ---- legibility before / after (run level)
  const cls = (/** @type {Eval[]} */ rs, /** @type {'legibility'|'baseLegibility'} */ k) => ({
    PASS: rs.filter((r) => r[k] === 'PASS').length / rs.length,
    READABLE: rs.filter((r) => r[k] === 'READABLE').length / rs.length,
    FAIL: rs.filter((r) => r[k] === 'FAIL').length / rs.length,
  });
  const gfRuns = runs.filter((r) => r.feasible !== null);
  const legib = {
    all: { before: cls(runs, 'baseLegibility'), after: cls(runs, 'legibility') },
    byVerdict: Object.fromEntries(['yes', 'partial', 'no'].map((v) => {
      const rs = gfRuns.filter((r) => r.feasible === v);
      return [v, { runs: rs.length, before: rs.length ? cls(rs, 'baseLegibility') : null, after: rs.length ? cls(rs, 'legibility') : null }];
    })),
  };
  const verdictRuns = { yes: gfRuns.filter((r) => r.feasible === 'yes').length, partial: gfRuns.filter((r) => r.feasible === 'partial').length, no: gfRuns.filter((r) => r.feasible === 'no').length };
  // ---- property checks
  const nanRuns = runs.filter((r) => !allFiniteNumbers({ fs: r.baseFontPx, reserve: r.reserve, d: r.dEval, gf: r.gf })).length;
  const yesNotPass = gfRuns.filter((r) => r.feasible === 'yes' && r.legibility !== 'PASS');
  const minorsYes = minorForced.filter((m) => m.feasible === 'yes').length + gfRuns.filter((r) => r.age < 18 && r.feasible === 'yes').length;
  const minorsNotNo = minorForced.filter((m) => m.feasible !== 'no').length;
  const minorsTooClose = runs.filter((r) => r.age < 18 && r.dRec !== null && r.dRec < 330).length;
  const strongMyopesYes = gfRuns.filter((r) => r.se <= -4 && r.feasible === 'yes').length;
  const distanceBad = runs.filter((r) => !r.distanceOk).length;
  const unstable = perUser.filter((p) => p.verdictShare < 0.8);
  /** Monotonic series: median text angle must not drop by > 10 % as the eye gets worse. */
  const series = {
    'adult myopia −0.5 → −8': ['myo-0.5-28', 'myo-1-30', 'myo-1.5-32', 'myo-2-35', 'myo-3-27', 'myo-4-38', 'myo-5-31', 'myo-6-36', 'myo-8-40'],
    'emmetropic presbyopes 45 → 75': ['presb-45', 'presb-50', 'presb-55', 'presb-60', 'presb-65', 'presb-75'],
    'hyperopia at 45 +0.5 → +3': ['hyp+0.5-45', 'hyp+1-45', 'hyp+2-45', 'hyp+3-45'],
    'astigmatism sph 0 ×90 0.75 → 2.5': ['ast0-0.75x90', 'ast0-1.5x90', 'ast0-2.5x90'],
  };
  const mono = Object.entries(series).map(([name, ids]) => {
    const angles = ids.map((id) => perUser.find((p) => p.id === id)?.textAngle ?? NaN);
    const violations = [];
    for (let i = 1; i < angles.length; i++) if (angles[i] < 0.9 * Math.max(...angles.slice(0, i))) violations.push(ids[i]);
    return { name, angles, violations };
  });
  // ---- flag sanity
  const flagRate = (/** @type {(r: Eval) => boolean} */ sel, /** @type {string} */ code) => {
    const rs = runs.filter(sel);
    return { n: rs.length, rate: rs.length ? rs.filter((r) => r.flags.includes(code)).length / rs.length : NaN };
  };
  const flagChecks = [
    { what: 'DISTANCE_FOCUS_LIMITED when far point 22–60 cm (no cyl)', expect: 'high', ...flagRate((r) => r.focus.farTrue !== null && r.focus.farTrue <= 600 && r.focus.farTrue >= 220 && Math.abs(r.cylR) < 0.5, 'DISTANCE_FOCUS_LIMITED') },
    { what: 'DISTANCE_FOCUS_LIMITED in emmetropes/hyperopes', expect: 'low', ...flagRate((r) => r.se >= 0 && Math.abs(r.cylR) < 0.5, 'DISTANCE_FOCUS_LIMITED') },
    { what: 'NEAR_FOCUS_FAR in presbyopes ≥ 55 y', expect: 'high', ...flagRate((r) => r.age >= 55 && r.se >= 0, 'NEAR_FOCUS_FAR') },
    { what: 'NEAR_FOCUS_FAR in under-40s (no cyl)', expect: 'low', ...flagRate((r) => r.age < 40 && Math.abs(r.cylR) < 0.5, 'NEAR_FOCUS_FAR') },
    { what: 'LINES_UNEVEN_* with cyl ≥ 1.5', expect: 'high', ...flagRate((r) => Math.abs(r.cylR) >= 1.5, 'LINES_UNEVEN_RIGHT') },
    { what: 'LINES_UNEVEN_* without cyl', expect: 'low', ...flagRate((r) => r.cylR === 0, 'LINES_UNEVEN_RIGHT') },
    { what: 'LOW_ACUITY_* or NEAR_ACUITY_REDUCED when true threshold at test distance > 0.3', expect: 'high', ...flagRate((r) => r.acc.right.truth > 0.35 && r.acc.left.truth > 0.35, 'ANY_ACUITY') },
    { what: 'LOW_ACUITY_* or NEAR_ACUITY_REDUCED when true threshold ≤ 0.1', expect: 'low', ...flagRate((r) => r.acc.right.truth <= 0.1 && r.acc.left.truth <= 0.1, 'ANY_ACUITY') },
  ];
  for (const c of flagChecks) {
    if (c.what.startsWith('LOW_ACUITY')) {
      const sel = c.expect === 'high' ? (/** @type {Eval} */ r) => r.acc.right.truth > 0.35 && r.acc.left.truth > 0.35 : (/** @type {Eval} */ r) => r.acc.right.truth <= 0.1 && r.acc.left.truth <= 0.1;
      const rs = runs.filter(sel);
      c.n = rs.length;
      c.rate = rs.filter((r) => r.flags.some((x) => x.startsWith('LOW_ACUITY') || x === 'NEAR_ACUITY_REDUCED')).length / Math.max(1, rs.length);
    }
    if (c.what.startsWith('LINES_UNEVEN')) {
      const sel = c.expect === 'high' ? (/** @type {Eval} */ r) => Math.abs(r.cylR) >= 1.5 : (/** @type {Eval} */ r) => r.cylR === 0;
      const rs = runs.filter(sel);
      c.n = rs.length;
      c.rate = rs.filter((r) => r.flags.some((x) => x.startsWith('LINES_UNEVEN'))).length / Math.max(1, rs.length);
    }
  }
  const checks = {
    nanRuns, yesRuns: verdictRuns.yes, yesNotPass: yesNotPass.length, yesNotPassIds: [...new Set(yesNotPass.map((r) => r.id))],
    minorsYes, minorsNotNo, minorsTooClose, strongMyopesYes, distanceBad,
    unstableUsers: unstable.map((p) => `${p.id} (${pct(p.verdictShare)})`), monotonic: mono, flags: flagChecks,
  };
  const acc = { mono: loa(accDiff.mono), monoAll: loa(accDiff.monoAll), both: loa(accDiff.both), floorLimitedShare: floorLimited / monoCount, unreliableShare: unreliable / monoCount };
  const focus = { far: loa(farErrD), farDetection: farDetected / Math.max(1, farDetectable), farFalseShare: farFalse / Math.max(1, farNotExpected), near: loa(nearErrD) };

  // ---- Markdown
  const L = [];
  L.push(`<!-- generated by scripts/sim/run-cohort.js (${reps} repetitions per user) — do not edit by hand -->`);
  L.push('## Coverage by prescription group (modal verdict per user)\n');
  L.push('| Group | Users | yes | partial | no | (no assessment) |');
  L.push('|---|---:|---:|---:|---:|---:|');
  for (const g of groups) { const x = byGroup[g]; L.push(`| ${g} | ${x.users} | ${x.yes} | ${x.partial} | ${x.no} | ${x.none} |`); }
  L.push(`\nRun-level verdicts (adults, ${gfRuns.length} runs): yes ${pct(verdictRuns.yes / gfRuns.length)}, partial ${pct(verdictRuns.partial / gfRuns.length)}, no ${pct(verdictRuns.no / gfRuns.length)}.`);
  L.push('\n## Measurement accuracy (measured − true, logMAR / D)\n');
  L.push('| Quantity | n | bias | 95 % LoA |');
  L.push('|---|---:|---:|---|');
  L.push(`| Monocular acuity (not floor-limited) | ${acc.mono.n} | ${f(acc.mono.bias, 3)} | ${f(acc.mono.lo)} … ${f(acc.mono.hi)} |`);
  L.push(`| Monocular acuity (all) | ${acc.monoAll.n} | ${f(acc.monoAll.bias, 3)} | ${f(acc.monoAll.lo)} … ${f(acc.monoAll.hi)} |`);
  L.push(`| Binocular acuity (extra run) | ${acc.both.n} | ${f(acc.both.bias, 3)} | ${f(acc.both.lo)} … ${f(acc.both.hi)} |`);
  L.push(`| Far point, dioptres (true far point 22–60 cm, detected) | ${focus.far.n} | ${f(focus.far.bias)} D | ${f(focus.far.lo)} … ${f(focus.far.hi)} D |`);
  L.push(`| Near point, dioptres (true 18–38 cm, above camera floor) | ${focus.near.n} | ${f(focus.near.bias)} D | ${f(focus.near.lo)} … ${f(focus.near.hi)} D |`);
  L.push(`\nFloor-limited monocular results: ${pct(acc.floorLimitedShare)}; flagged unreliable: ${pct(acc.unreliableShare)}. Far point detected when measurable: ${pct(focus.farDetection)}; spurious far point (true far point > 80 cm, no cyl): ${pct(focus.farFalseShare)}.`);
  L.push('\n## Legibility without glasses (run level; reserve ≥ 2 PASS, 1.4–2 READABLE, < 1.4 FAIL)\n');
  L.push('| Runs | Default 16 px at habitual distance | SeeTuned profile at recommended distance |');
  L.push('|---|---|---|');
  const lc = (/** @type {{PASS: number, READABLE: number, FAIL: number}|null} */ c) => (c ? `PASS ${pct(c.PASS)} · READABLE ${pct(c.READABLE)} · FAIL ${pct(c.FAIL)}` : '–');
  L.push(`| All (${runs.length}) | ${lc(legib.all.before)} | ${lc(legib.all.after)} |`);
  for (const v of ['yes', 'partial', 'no']) L.push(`| verdict ${v} (${legib.byVerdict[v].runs}) | ${lc(legib.byVerdict[v].before)} | ${lc(legib.byVerdict[v].after)} |`);
  L.push('\n## Per-user results (medians over repetitions)\n');
  L.push('| User | Rx, age | Hab. cm | True thr. @hab (R) | Measured (R) | Far pt true/meas cm | Near pt true/meas cm | Sharp (comf.) cm | Verdict (share) | Reasons | Rec. cm | Body px (p10–p90) | Chars/line he/la | Reserve med (min) | PASS | 16 px reserve |');
  L.push('|---|---|---:|---:|---:|---|---|---|---|---|---:|---|---|---|---:|---|');
  const cm = (/** @type {number|null} */ v) => (v === null ? '–' : v === Infinity || v >= 9999 ? '∞' : String(Math.round(v / 10)));
  for (const p of perUser) {
    L.push(`| ${p.id} | ${p.label} | ${cm(p.habitualMm)} | ${f(p.truthRight)} | ${f(p.measuredRight)} | ${cm(p.farTrue)} / ${cm(p.farMeasured)} | ${cm(p.nearTrue)} / ${cm(p.nearMeasured)} | ${cm(p.sharpFrom)}–${cm(p.sharpTo)} | ${p.verdict} (${pct(p.verdictShare)}) | ${p.reasons.replace(/,/g, ', ')} | ${cm(p.dRec)} | ${f(p.fsMedian, 1)} (${f(p.fsP10, 1)}–${f(p.fsP90, 1)}) | ${p.cplHebrew}/${p.cplLatin} | ${f(p.reserveMedian)} (${f(p.reserveMin)}) | ${pct(p.pass)} | ${f(p.baseReserve)} ${p.baseClass} |`);
  }
  L.push('\n## Property checks\n');
  L.push(`- Non-finite values in outputs: ${nanRuns} runs.`);
  L.push(`- 'yes' runs not reaching PASS legibility: ${yesNotPass.length} of ${verdictRuns.yes}${yesNotPass.length ? ` (${checks.yesNotPassIds.join(', ')})` : ''}.`);
  L.push(`- Under-18s: 'yes' verdicts ${minorsYes}; engine verdict ≠ 'no' when forced to glasses-free input: ${minorsNotNo}; recommended distance < 33 cm: ${minorsTooClose}.`);
  L.push(`- Myopia ≥ 4 D with 'yes': ${strongMyopesYes}. Runs with the evaluated distance outside 25–60 cm (33–60 cm under 18): ${distanceBad}.`);
  L.push(`- Users whose modal verdict holds in < 80 % of repetitions: ${unstable.length ? checks.unstableUsers.join(', ') : 'none'}.`);
  for (const m of mono) L.push(`- Monotonic text angle, ${m.name}: ${m.angles.map((a) => f(a, 1)).join(' → ')}′ — ${m.violations.length ? `violations: ${m.violations.join(', ')}` : 'OK'}.`);
  L.push('\n| Flag sanity check | runs | rate | expected |');
  L.push('|---|---:|---:|---|');
  for (const c of flagChecks) L.push(`| ${c.what} | ${c.n} | ${pct(c.rate)} | ${c.expect} |`);
  const markdown = `${L.join('\n')}\n`;
  const consoleOut = [
    `acuity mono bias ${f(acc.mono.bias, 3)} LoA ${f(acc.mono.lo)}…${f(acc.mono.hi)} | both ${f(acc.both.bias, 3)} | far ${f(focus.far.bias)} D LoA ${f(focus.far.lo)}…${f(focus.far.hi)} | near ${f(focus.near.bias)} D`,
    `verdicts: yes ${verdictRuns.yes} partial ${verdictRuns.partial} no ${verdictRuns.no}; legibility after ${lc(legib.all.after)} | before ${lc(legib.all.before)}`,
    `checks: NaN ${nanRuns}, yes¬PASS ${yesNotPass.length} ${checks.yesNotPassIds.join(' ')}, minorsYes ${minorsYes}, minorsNotNo ${minorsNotNo}, strongMyopesYes ${strongMyopesYes}, distanceBad ${distanceBad}, unstable ${unstable.length}`,
    ...groups.map((g) => `  ${g.padEnd(24)} yes ${byGroup[g].yes} partial ${byGroup[g].partial} no ${byGroup[g].no} none ${byGroup[g].none}`),
  ].join('\n');
  return { json: { acc, focus, byGroup, verdictRuns, legib, checks, perUser, minorForced: minorForced.slice(0, 20) }, markdown, console: consoleOut };
}

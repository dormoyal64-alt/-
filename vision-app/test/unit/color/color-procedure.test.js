import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createColorProcedure, classifyThresholds, longestIdenticalRun, nextGap, PROCEDURE,
} from '../../../public/app/js/tests/color/color-procedure.js';
import { mulberry32, CEILING_RATIO } from '../../../public/app/js/tests/color/color-plates.js';
import { createObserver, runSession } from './observer.js';

test('classification rules (spec item 30)', () => {
  assert.equal(classifyThresholds({ protan: 0.6, deutan: 0.9, tritan: 1 }).type, 'normal');
  assert.equal(classifyThresholds({ protan: 4, deutan: 2, tritan: 0.5 }).type, 'protan');
  assert.equal(classifyThresholds({ protan: 2, deutan: 4, tritan: 1.4 }).type, 'deutan');
  assert.equal(classifyThresholds({ protan: 0.8, deutan: 1.2, tritan: 3 }).type, 'tritan');
  assert.equal(classifyThresholds({ protan: 3, deutan: 3, tritan: 3 }).pattern, 'generalised');
  assert.equal(classifyThresholds({ protan: 3, deutan: 1.2, tritan: 2 }).type, 'unclassified');
  const tie = classifyThresholds({ protan: 2, deutan: 2.1, tritan: 0.5 });
  assert.equal(tie.typeUncertain, true);
  assert.equal(classifyThresholds({ protan: 2, deutan: 2.1, tritan: 0.5 }, { redLuminanceMatch: 0.6 }).type, 'protan');
  assert.equal(classifyThresholds({ protan: 2.1, deutan: 2, tritan: 0.5 }, { redLuminanceMatch: 1.1 }).type, 'deutan');
  // Severity = ln X / ln Xceil on the type's axis.
  const s = classifyThresholds({ protan: 4, deutan: 1.5, tritan: 0.5 }).severity;
  assert.ok(Math.abs(s - Math.log(4) / Math.log(CEILING_RATIO.protan)) < 1e-12);
  assert.equal(classifyThresholds({ protan: CEILING_RATIO.protan, deutan: 2, tritan: 0.5 }).severity, 1);
});

test('gap sequence never repeats 3×; identical-run helper', () => {
  const rng = mulberry32(3); const hist = [];
  for (let i = 0; i < 500; i++) hist.push(nextGap(rng, hist));
  for (let i = 2; i < hist.length; i++) assert.ok(!(hist[i] === hist[i - 1] && hist[i] === hist[i - 2]));
  assert.equal(longestIdenticalRun(['up', 'up', 'unsure', 'up', 'left', 'left', 'left']), 3);
});

test('procedure shape: 48 staircase trials + 3 catch trials, progress reaches 1', () => {
  const proc = createColorProcedure({ rng: mulberry32(1) });
  const obs = createObserver({ type: 'normal', rng: mulberry32(2) });
  let n = 0; let last = 0;
  for (let t = proc.next(); t; t = proc.next()) {
    assert.equal(proc.next(), t, 'next() is idempotent until answered');
    proc.respond(t, obs.answer(t), 800);
    n++;
    assert.ok(proc.progress() >= last - 1e-9); last = proc.progress();
  }
  assert.equal(n, 3 * PROCEDURE.trialsPerAxis + 3);
  assert.equal(proc.progress(), 1);
  const r = proc.result();
  assert.equal(r.details.catchTrials, 3);
  assert.deepEqual(Object.keys(r).sort(), ['confidence', 'details', 'reliable', 'severity', 'type']);
});

test('careless responding is flagged unreliable', () => {
  const proc = createColorProcedure({ rng: mulberry32(4) });
  for (let t = proc.next(); t; t = proc.next()) proc.respond(t, 'up', 150);
  const r = proc.result();
  assert.equal(r.reliable, false);
  assert.ok(r.details.reasons.includes('too-fast'));
  assert.ok(r.details.reasons.includes('identical-run'));
});

test('simulated observers: classification accuracy', (t) => {
  const N = 120;
  const cases = [
    ['normal', 0, 0.95],
    ['protan', 0.6, 0.6], ['protan', 1, 0.95],
    ['deutan', 0.6, 0.9], ['deutan', 1, 0.95],
    ['tritan', 1, 0.9],
  ];
  const report = [];
  for (const [type, severity, minAcc] of cases) {
    let ok = 0; const sev = [];
    for (let i = 0; i < N; i++) {
      const obs = createObserver({ type, severity, rng: mulberry32(1000 + i * 7919) });
      const r = runSession(obs, createColorProcedure({ rng: mulberry32(99 + i) }));
      if (r.type === type) ok++;
      sev.push(r.severity);
    }
    sev.sort((a, b) => a - b);
    const acc = ok / N;
    report.push(`${type}@${severity}: ${(acc * 100).toFixed(0)}% (median severity ${sev[N >> 1]})`);
    assert.ok(acc >= minAcc, `${type} ${severity}: accuracy ${acc}`);
    if (severity === 1 && type !== 'tritan') assert.ok(sev[N >> 1] >= 0.9, 'strong red–green => severity ≈ 1');
  }
  t.diagnostic(report.join(' | '));
});

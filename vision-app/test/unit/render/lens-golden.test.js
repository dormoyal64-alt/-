import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateLensGolden, GOLDEN_PATH, CASES } from '../../../scripts/android/lens-golden.js';

test('the Android lens golden vectors match the JavaScript pipeline (run scripts/android/lens-golden.js if not)', () => {
  const committed = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(generateLensGolden())));
});

test('every golden case exercises something different', () => {
  const g = generateLensGolden();
  assert.equal(g.cases.length, CASES.length);
  const outputs = new Set(g.cases.map((c) => c.output.join(',')));
  assert.equal(outputs.size, g.cases.length);
  // The neutral case must be the identity on opaque pixels.
  const neutral = g.cases[0];
  for (let i = 0; i < g.width * g.height; i++) {
    if (neutral.input[i * 4 + 3] !== 255) continue;
    for (let c = 0; c < 3; c++) assert.equal(neutral.output[i * 3 + c], neutral.input[i * 4 + c]);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileToCssVars, matrixToFeColorMatrixValues, uiFilterPrimitives } from '../../../public/app/js/render/apply-ui.js';
import { demoProfile } from '../../../public/app/js/core/demo-profile.js';
import { neutralFilterParams } from '../../../public/app/js/core/types.js';

test('profileToCssVars maps text params', () => {
  assert.deepEqual(profileToCssVars(demoProfile()), {
    '--va-font-scale': '1.5', '--va-font-weight': '500', '--va-line-height': '1.6',
    '--va-letter-spacing': '0.02em', '--va-word-spacing': '0.08em',
  });
  assert.deepEqual(profileToCssVars(null), {});
  const extreme = profileToCssVars({ text: { baseFontPx: 200, scale: 12.5, fontWeight: 1234, lineHeight: 9, letterSpacingEm: 3, wordSpacingEm: -4 } });
  assert.deepEqual(extreme, { '--va-font-scale': '4', '--va-font-weight': '900', '--va-line-height': '3', '--va-letter-spacing': '0.5em', '--va-word-spacing': '-0.1em' });
  assert.equal(profileToCssVars({ text: { baseFontPx: 20 } })['--va-font-scale'], '1.25');
});

test('matrixToFeColorMatrixValues builds a 4x5 matrix with untouched alpha', () => {
  const v = matrixToFeColorMatrixValues([1, 0, 0, -0.2, 1.1, 0.1, 0.1, -0.1, 1]).split(' ').map(Number);
  assert.equal(v.length, 20);
  assert.deepEqual(v, [1, 0, 0, 0, 0, -0.2, 1.1, 0.1, 0, 0, 0.1, -0.1, 1, 0, 0, 0, 0, 0, 1, 0]);
});

test('uiFilterPrimitives: neutral => none; matrix in linearRGB; tone in sRGB', () => {
  assert.deepEqual(uiFilterPrimitives(neutralFilterParams()), []);
  assert.deepEqual(uiFilterPrimitives(null), []);
  // zoom/sharpen alone do not need a UI filter
  assert.deepEqual(uiFilterPrimitives({ ...neutralFilterParams(), zoom: 2, sharpenAmount: 1 }), []);
  const prims = uiFilterPrimitives(demoProfile().ui); // contrast 1.1
  assert.equal(prims.length, 1);
  assert.equal(prims[0].tag, 'feComponentTransfer');
  assert.equal(prims[0].attrs['color-interpolation-filters'], 'sRGB');
  assert.deepEqual(prims[0].children.map((c) => [c.tag, c.attrs.slope, c.attrs.intercept]), [
    ['feFuncR', '1.1', '-0.05'], ['feFuncG', '1.1', '-0.05'], ['feFuncB', '1.1', '-0.05'],
  ]);
  const all = uiFilterPrimitives({ colorMatrix: [0.9, 0.1, 0, 0, 1, 0, 0, 0, 1], contrast: 1, brightness: 1, saturation: 0.5, warmth: 1, invert: true });
  assert.deepEqual(all.map((p) => p.tag), ['feColorMatrix', 'feComponentTransfer', 'feColorMatrix', 'feComponentTransfer']);
  assert.equal(all[0].attrs['color-interpolation-filters'], 'linearRGB');
  assert.deepEqual(all[1].children.map((c) => c.attrs.slope), ['1', '0.88', '0.5']);
  const sat = all[2].attrs.values.split(' ').map(Number);
  // Each row sums to 1 (greys stay grey)
  for (const row of [0, 5, 10]) assert.ok(Math.abs(sat[row] + sat[row + 1] + sat[row + 2] - 1) < 1e-6);
});

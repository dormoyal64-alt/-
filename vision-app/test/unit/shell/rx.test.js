import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRxNumber, validateRxField, validateRx, formatRxValue } from '../../../public/app/js/flows/rx.js';

test('parseRxNumber accepts common typing variants', () => {
  assert.equal(parseRxNumber(''), null);
  assert.equal(parseRxNumber('  '), null);
  assert.equal(parseRxNumber('+1.25'), 1.25);
  assert.equal(parseRxNumber('-0,50'), -0.5);
  assert.equal(parseRxNumber('−2.00'), -2);
  assert.equal(parseRxNumber('90°'), 90);
  assert.equal(parseRxNumber('.75'), 0.75);
  assert.ok(Number.isNaN(parseRxNumber('abc')));
  assert.ok(Number.isNaN(parseRxNumber('1.2.3')));
});

test('ranges and steps per field', () => {
  assert.deepEqual(validateRxField('sph', '-20'), { value: -20, error: null });
  assert.deepEqual(validateRxField('sph', '20.25'), { value: undefined, error: 'range' });
  assert.deepEqual(validateRxField('sph', '-1.30'), { value: undefined, error: 'step' });
  assert.deepEqual(validateRxField('cyl', '-8'), { value: -8, error: null });
  assert.deepEqual(validateRxField('cyl', '-8.25'), { value: undefined, error: 'range' });
  assert.deepEqual(validateRxField('axis', '180'), { value: 180, error: null });
  assert.deepEqual(validateRxField('axis', '181'), { value: undefined, error: 'range' });
  assert.deepEqual(validateRxField('axis', '12.5'), { value: undefined, error: 'step' });
  assert.deepEqual(validateRxField('add', '4'), { value: 4, error: null });
  assert.deepEqual(validateRxField('add', '-0.25'), { value: undefined, error: 'range' });
  assert.deepEqual(validateRxField('add', 'x'), { value: undefined, error: 'number' });
  assert.deepEqual(validateRxField('sph', '-0'), { value: 0, error: null });
});

test('validateRx: whole form, axis required with cylinder', () => {
  const ok = validateRx({ right: { sph: '-1.25', cyl: '-0.50', axis: '90', add: '' }, left: { sph: '+0.75' } });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.rx, { right: { sph: -1.25, cyl: -0.5, axis: 90 }, left: { sph: 0.75 } });
  const missingAxis = validateRx({ right: { cyl: '-1' } });
  assert.equal(missingAxis.valid, false);
  assert.equal(missingAxis.errors['right.axis'], 'axisRequired');
  const zeroCyl = validateRx({ left: { cyl: '0' } });
  assert.equal(zeroCyl.valid, true);
  const empty = validateRx({ right: {}, left: { sph: '' } });
  assert.equal(empty.empty, true);
  assert.equal(empty.valid, true);
  const bad = validateRx({ right: { sph: '30' }, left: { add: '5' } });
  assert.deepEqual(bad.errors, { 'right.sph': 'range', 'left.add': 'range' });
});

test('formatRxValue', () => {
  assert.equal(formatRxValue('sph', -1.25), '-1.25');
  assert.equal(formatRxValue('sph', 0.5), '+0.50');
  assert.equal(formatRxValue('cyl', 0), '0.00');
  assert.equal(formatRxValue('axis', 90), '90');
  assert.equal(formatRxValue('add', 2), '+2.00');
  assert.equal(formatRxValue('sph', undefined), '');
});

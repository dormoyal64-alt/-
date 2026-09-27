import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT, dirFor } from '../../../public/app/js/core/i18n.js';

test('makeT interpolates, falls back to English, then to the key', () => {
  const t = makeT({ he: { hi: 'שלום {name}' }, en: { hi: 'Hi {name}', only: 'English only' } }, 'he');
  assert.equal(t('hi', { name: 'דנה' }), 'שלום דנה');
  assert.equal(t('only'), 'English only');
  assert.equal(t('missing'), 'missing');
  assert.equal(t('hi'), 'שלום {name}');
});

test('dirFor', () => {
  assert.equal(dirFor('he'), 'rtl');
  assert.equal(dirFor('en'), 'ltr');
});

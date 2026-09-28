import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, splitZoom, classifyCameraError, magnifierPreset, fileStem } from '../../../public/app/js/viewers/viewer-math.js';
import { detectTextLang, splitParagraphs, splitSentences, structureText, pickVoice } from '../../../public/app/js/viewers/reader-text.js';
import { applyPixel, isNeutralParams } from '../../../public/app/js/render/filter-math.js';
import { demoProfile } from '../../../public/app/js/core/demo-profile.js';

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(75.9), '1:15');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(formatTime(Infinity), '0:00');
});

test('splitZoom prefers camera zoom, digital for the rest', () => {
  assert.deepEqual(splitZoom(3, null), { track: null, trackRatio: 1, digital: 3 });
  assert.deepEqual(splitZoom(3, { min: 1, max: 8, step: 0.1 }), { track: 3, trackRatio: 3, digital: 1 });
  const big = splitZoom(10, { min: 1, max: 5 });
  assert.equal(big.track, 5); assert.equal(big.digital, 2);
  const uvc = splitZoom(2, { min: 100, max: 500, step: 1 });
  assert.equal(uvc.track, 200); assert.equal(uvc.digital, 1);
  assert.equal(splitZoom(0.5, { min: 1, max: 4 }).track, 1);
});

test('classifyCameraError', () => {
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }), 'denied');
  assert.equal(classifyCameraError({ name: 'NotFoundError' }), 'nocamera');
  assert.equal(classifyCameraError({ name: 'OverconstrainedError' }), 'nocamera');
  assert.equal(classifyCameraError({ name: 'NotReadableError' }), 'busy');
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }, false), 'insecure');
  assert.equal(classifyCameraError(new Error('x')), 'other');
});

test('magnifier presets', () => {
  const y = magnifierPreset('yellow', null);
  assert.deepEqual(applyPixel(0, 0, 0, y).map((v) => Math.round(v * 255)), [255, 255, 0]); // black print -> yellow
  assert.deepEqual(applyPixel(1, 1, 1, y).map((v) => Math.round(v * 255)), [0, 0, 0]); // white paper -> black
  assert.deepEqual(applyPixel(0.9, 0.9, 0.9, magnifierPreset('inverted', null)).map((v) => Math.round(v * 255)), [0, 0, 0]);
  const hc = applyPixel(0.3, 0.3, 0.3, magnifierPreset('contrast', null));
  assert.ok(hc[0] < 0.1);
  const prof = magnifierPreset('profile', demoProfile().media);
  assert.equal(prof.zoom, 1);
  assert.equal(isNeutralParams(prof), false);
  assert.equal(isNeutralParams(magnifierPreset('profile', null)), true);
});

test('fileStem', () => {
  assert.equal(fileStem('IMG 0001.HEIC'), 'IMG-0001');
  assert.equal(fileStem('תמונה של סבתא.jpg'), 'תמונה-של-סבתא');
  assert.equal(fileStem('../../etc/passwd'), 'etc-passwd');
  assert.equal(fileStem(''), 'image');
});

test('detectTextLang', () => {
  assert.equal(detectTextLang('שלום עולם'), 'he');
  assert.equal(detectTextLang('Hello world'), 'en');
  assert.equal(detectTextLang('שלום, this is mostly English text'), 'en');
  assert.equal(detectTextLang('12345', 'he'), 'he');
});

test('splitParagraphs / splitSentences / structureText', () => {
  assert.deepEqual(splitParagraphs('a\n\n  b \r\nc'), ['a', 'b', 'c']);
  const en = splitSentences('Hello there. How are you? Fine!', 'en');
  assert.equal(en.length, 3);
  assert.equal(en.join(''), 'Hello there. How are you? Fine!');
  const he = splitSentences('שלום לכם. מה שלומכם? הכול טוב!', 'he');
  assert.equal(he.length, 3);
  const s = structureText('שלום לכם. מה נשמע?\nThis is English. Second sentence.');
  assert.equal(s.lang, 'he');
  assert.equal(s.paragraphs.length, 2);
  assert.deepEqual(s.paragraphs[0].map((x) => x.lang), ['he', 'he']);
  assert.deepEqual(s.paragraphs[1].map((x) => x.lang), ['en', 'en']);
  assert.equal(s.paragraphs[1][0].speak, 'This is English.');
});

test('pickVoice prefers exact locale, local voices, falls back to language prefix', () => {
  const voices = [
    { name: 'US remote', lang: 'en-US', localService: false },
    { name: 'US local', lang: 'en-US', localService: true },
    { name: 'GB', lang: 'en-GB', localService: true },
    { name: 'Hebrew legacy', lang: 'iw_IL', localService: true },
  ];
  assert.equal(pickVoice(voices, 'en').name, 'US local');
  assert.equal(pickVoice(voices, 'he').name, 'Hebrew legacy');
  assert.equal(pickVoice([{ name: 'GB', lang: 'en-GB' }], 'en').name, 'GB');
  assert.equal(pickVoice([{ name: 'GB', lang: 'en-GB' }], 'he'), null);
  assert.equal(pickVoice([], 'he'), null);
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAndroidRecipe, androidIntentUrl, androidAppLink, ANDROID_PACKAGE, RECIPE_VERSION,
} from '../../../public/app/js/engine/android-link.js';
import { buildSystemGuide, androidSettings } from '../../../public/app/js/engine/system-guide.js';
import { computeProfile } from '../../../public/app/js/engine/profile.js';
import { PERSONAS, eyesInput } from './fixtures.js';

/** Every key the Android app understands (android/core Recipe.kt). Anything else would be a leak or a typo. */
const KNOWN_KEYS = new Set(['v', 'lang', 'font', 'fontx', 'ds', 'dsmax', 'bold', 'contrast', 'cvd', 'cvdi', 'dim', 'dark', 'mag',
  'lm', 'lc', 'lb', 'ls', 'lsa', 'lss', 'lz', 'lw', 'linv']);

const NEUTRAL_SYSTEM = { textScale: 1, boldText: false, increaseContrast: false, colorFilter: null, reduceWhitePoint: false, darkMode: false, displayZoom: 1, magnificationShortcut: false };

describe('buildAndroidRecipe', () => {
  test('missing or empty profile gives a safe default recipe', () => {
    for (const p of [null, undefined, {}, { system: 'x', media: 7 }]) {
      const q = buildAndroidRecipe(/** @type {any} */ (p), 'he');
      assert.equal(q.toString(), 'v=1&lang=he&font=1');
    }
    assert.equal(buildAndroidRecipe(null, 'en').get('lang'), 'en');
    assert.equal(buildAndroidRecipe(null, /** @type {any} */ ('fr')).get('lang'), 'he');
  });

  test('system targets map to the same Android numbers as the written guide', () => {
    const system = { ...NEUTRAL_SYSTEM, textScale: 1.45, boldText: true, increaseContrast: true, contrastLevel: 'high', colorFilter: { type: 'deutan', intensity: 0.6 }, reduceWhitePoint: true, darkMode: true };
    const q = buildAndroidRecipe({ system }, 'he');
    // 1.45 × 16 = 23.2 dp > 23.0 (1.5 step) → the 1.8 step, like androidFontStep.
    assert.equal(q.get('font'), '1.8');
    assert.equal(q.get('bold'), '1');
    assert.equal(q.get('contrast'), 'high');
    assert.equal(q.get('cvd'), 'deutan');
    assert.equal(q.get('cvdi'), '0.6');
    assert.equal(q.get('dim'), '1');
    assert.equal(q.get('dark'), '1');
    assert.equal(q.has('ds'), false);
    assert.equal(q.has('fontx'), false);
    const sam = buildSystemGuide(system, 'samsung', 'en');
    assert.match(sam.find((s) => s.id === 'text-size')?.value || '', /180%/);
  });

  test('text beyond the largest font step adds display size, "largest" and magnification', () => {
    const q = buildAndroidRecipe({ system: { ...NEUTRAL_SYSTEM, textScale: 3 } }, 'en');
    assert.equal(q.get('font'), '2');
    assert.equal(q.get('fontx'), '1');
    const and = androidSettings({ ...NEUTRAL_SYSTEM, textScale: 3 });
    assert.equal(q.get('ds'), String(and.displaySteps));
    assert.equal(q.get('dsmax'), '1');
    assert.equal(q.get('mag'), '1');
    const guide = buildSystemGuide({ ...NEUTRAL_SYSTEM, textScale: 3 }, 'android', 'en');
    assert.ok(guide.some((s) => s.id === 'display-size'));
    assert.ok(guide.some((s) => s.id === 'zoom'));
  });

  test('medium contrast and a modest display zoom', () => {
    const q = buildAndroidRecipe({ system: { ...NEUTRAL_SYSTEM, increaseContrast: true, displayZoom: 1.2 } }, 'he');
    assert.equal(q.get('contrast'), 'medium');
    assert.equal(q.get('ds'), '2');
    assert.equal(q.has('dsmax'), false);
  });

  test('lens parameters come from profile.media; neutral values are left out', () => {
    const media = {
      colorMatrix: [1.1, -0.1, 0, 0.05, 0.95, 0, 0, 0, 1], contrast: 1.25, brightness: 1, saturation: 1.1,
      sharpenAmount: 0.8, sharpenSigmaPx: 1.2, zoom: 2, invert: false, warmth: 0,
    };
    const q = buildAndroidRecipe({ media }, 'he');
    assert.equal(q.get('lm'), '1.1,-0.1,0,0.05,0.95,0,0,0,1');
    assert.equal(q.get('lc'), '1.25');
    assert.equal(q.has('lb'), false);
    assert.equal(q.get('ls'), '1.1');
    assert.equal(q.get('lsa'), '0.8');
    assert.equal(q.get('lss'), '1.2');
    assert.equal(q.get('lz'), '2');
    assert.equal(q.has('lw'), false);
    assert.equal(q.has('linv'), false);
    const neutral = buildAndroidRecipe({ media: { colorMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], contrast: 1, brightness: 1, saturation: 1, sharpenAmount: 0, sharpenSigmaPx: 1, zoom: 1, invert: false, warmth: 0 } }, 'he');
    for (const k of ['lm', 'lc', 'lb', 'ls', 'lsa', 'lss', 'lz', 'lw', 'linv']) assert.equal(neutral.has(k), false, k);
  });

  test('malformed media is clamped, never NaN', () => {
    const q = buildAndroidRecipe({ media: /** @type {any} */ ({ colorMatrix: [NaN], contrast: 99, sharpenAmount: -3, zoom: 'big', warmth: 7, invert: 'yes' }) }, 'he');
    assert.equal(q.has('lm'), false);
    assert.equal(q.get('lc'), '5');
    assert.equal(q.has('lsa'), false);
    assert.equal(q.has('lz'), false);
    assert.equal(q.get('lw'), '1');
    assert.equal(q.has('linv'), false);
    assert.doesNotMatch(q.toString(), /NaN|Infinity|undefined|null/);
  });

  test('real profiles: only known keys, no eye measurements, valid numbers', () => {
    const profiles = [
      computeProfile(PERSONAS.youngNormal()),
      computeProfile(eyesInput(0.5, { age: 60, wearsCorrection: false })),
      computeProfile(eyesInput(1.0, { age: 40, wearsCorrection: false, color: { type: 'deutan', severity: 0.7, confidence: 0.9, reliable: true } })),
    ];
    for (const p of profiles) {
      const q = buildAndroidRecipe(p, 'he');
      assert.equal(q.get('v'), String(RECIPE_VERSION));
      for (const [k, v] of q) {
        assert.ok(KNOWN_KEYS.has(k), `unexpected key ${k}`);
        assert.doesNotMatch(v, /NaN|Infinity|undefined|null/, k);
      }
      const font = Number(q.get('font'));
      assert.ok(font >= 1 && font <= 2, String(font));
    }
    // The worse eyes get a larger font than the normal ones.
    assert.ok(Number(buildAndroidRecipe(profiles[2], 'he').get('font')) > Number(buildAndroidRecipe(profiles[0], 'he').get('font')));
  });
});

describe('androidIntentUrl', () => {
  const recipe = new URLSearchParams('v=1&lang=he&font=1.5&bold=1&lm=1,0,0,0,1,0,0,0,0.9');

  test('Chrome intent link with package and an encoded fallback', () => {
    const url = androidIntentUrl(recipe, 'https://example.com/app/#/guide?companion=missing');
    assert.ok(url.startsWith('intent://apply?v=1&lang=he&font=1.5&bold=1&lm=1%2C0'));
    assert.ok(url.endsWith(';end'));
    const frag = url.slice(url.indexOf('#Intent;') + 8, -';end'.length).split(';');
    assert.deepEqual(frag.slice(0, 2), ['scheme=seetuned', `package=${ANDROID_PACKAGE}`]);
    const fb = frag.find((f) => f.startsWith('S.browser_fallback_url='));
    assert.equal(decodeURIComponent(String(fb).split('=').slice(1).join('=')), 'https://example.com/app/#/guide?companion=missing');
    // Nothing in the fallback may break the intent syntax.
    assert.doesNotMatch(String(fb), /[#;]/);
  });

  test('a non-http fallback is dropped', () => {
    for (const fb of ['', 'javascript:alert(1)', 'file:///x', 'intent://x']) {
      assert.doesNotMatch(androidIntentUrl(recipe, fb), /browser_fallback_url/, fb);
    }
  });

  test('the plain app link round-trips the recipe', () => {
    const u = new URL(androidAppLink(recipe));
    assert.equal(u.protocol, 'seetuned:');
    assert.equal(u.host, 'apply');
    assert.equal(u.searchParams.get('lm'), '1,0,0,0,1,0,0,0,0.9');
    assert.equal(u.searchParams.get('font'), '1.5');
  });
});

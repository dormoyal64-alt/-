import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPlatform, buildSystemGuide, iosTextStep, androidFontStep, displaySizeSteps,
} from '../../../public/app/js/engine/system-guide.js';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  ipadLegacy: 'Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  pixelChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  pixelChromeFull: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0',
  samsungInternet: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  samsungInternetReduced: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  samsungChromeLegacy: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
  samsungTabChrome: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  linuxFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
};

describe('detectPlatform', () => {
  const table = [
    ['iphoneSafari', 5, 'ios'], ['iphoneChrome', 5, 'ios'],
    ['ipadDesktopMode', 5, 'ipados'], ['ipadLegacy', 5, 'ipados'],
    ['pixelChrome', 5, 'android'], ['pixelChromeFull', 5, 'android'], ['androidFirefox', 5, 'android'],
    ['samsungInternet', 5, 'samsung'], ['samsungInternetReduced', 5, 'samsung'],
    ['samsungChromeLegacy', 5, 'samsung'], ['samsungTabChrome', 10, 'samsung'],
    ['windowsChrome', 0, 'desktop'], ['macSafari', 0, 'desktop'], ['linuxFirefox', 0, 'desktop'], ['chromebook', 10, 'desktop'],
  ];
  for (const [name, touch, expected] of table) {
    test(`${name} (maxTouchPoints ${touch}) → ${expected}`, () => assert.equal(detectPlatform(UA[name], touch), expected));
  }
  test('a Mac with 1 touch point stays desktop; empty/garbage → other', () => {
    assert.equal(detectPlatform(UA.macSafari, 1), 'desktop');
    assert.equal(detectPlatform(UA.macSafari), 'desktop');
    assert.equal(detectPlatform(''), 'other');
    assert.equal(detectPlatform(/** @type {any} */ (undefined)), 'other');
    assert.equal(detectPlatform('Mozilla/5.0 (Mobile; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5'), 'other');
  });
  test('Samsung Chrome with the reduced UA is Android unless a UA-CH model is given', () => {
    assert.equal(detectPlatform(UA.pixelChrome, 5), 'android');
    assert.equal(detectPlatform(UA.pixelChrome, 5, 'SM-S921B'), 'samsung');
  });
});

describe('step tables (items 43–44)', () => {
  test('iOS Larger Text: smallest step ≥ fs, never below Large, AX5 cap', () => {
    const name = (fs) => iosTextStep(fs).name;
    assert.equal(name(12), 'Large');
    assert.equal(name(16), 'Large');
    assert.equal(name(17), 'Large');
    assert.equal(name(17.5), 'xLarge');
    assert.equal(name(23), 'xxxLarge');
    assert.equal(name(23.7), 'AX1');
    assert.equal(name(38.2), 'AX3');
    assert.equal(iosTextStep(53).exceeds, false);
    assert.deepEqual(iosTextStep(60), { index: 11, name: 'AX5', pt: 53, accessibility: true, exceeds: true });
  });
  test('Android font size: smallest step whose 16 sp dp ≥ fs, never below 1.0', () => {
    const sc = (fs) => androidFontStep(fs).scale;
    assert.equal(sc(12), 1.0);
    assert.equal(sc(16), 1.0);
    assert.equal(sc(16.5), 1.15);
    assert.equal(sc(23), 1.5);
    assert.equal(sc(23.7), 1.8);
    assert.equal(sc(28), 2.0);
    assert.equal(androidFontStep(39.1).exceeds, true);
  });
  test('display size steps (+12.5 % each)', () => {
    assert.equal(displaySizeSteps(1), 0);
    assert.equal(displaySizeSteps(1.1), 1);
    assert.equal(displaySizeSteps(1.26), 2);
    assert.equal(displaySizeSteps(1.4), 3);
  });
});

const T0 = { textScale: 1, boldText: false, increaseContrast: false, colorFilter: null, reduceWhitePoint: false, darkMode: false, displayZoom: 1, magnificationShortcut: false };
const ids = (g) => g.map((s) => s.id);
const sec = (g, id) => g.find((s) => s.id === id);
const joined = (s) => [s.title, s.why, s.value || '', ...s.steps].join('\n');

describe('buildSystemGuide', () => {
  test('default target: only the text-size section, not recommended, default value', () => {
    for (const lang of ['en', 'he']) {
      const ios = buildSystemGuide(T0, 'ios', lang);
      assert.deepEqual(ids(ios), ['text-size']);
      assert.equal(ios[0].recommended, false);
      assert.match(ios[0].value, /Large/);
      const and = buildSystemGuide(T0, 'android', lang);
      assert.deepEqual(ids(and), ['text-size']);
      assert.match(and[0].value, /2/);
      assert.match(and[0].value, /100%/);
    }
  });
  test('23.7 px + bold + medium contrast (en)', () => {
    const target = { ...T0, textScale: 23.7 / 16, boldText: true, increaseContrast: true, contrastLevel: 'medium' };
    const ios = buildSystemGuide(target, 'ios', 'en');
    assert.deepEqual(ids(ios), ['text-size', 'bold-text', 'contrast']);
    const text = sec(ios, 'text-size');
    assert.equal(text.recommended, true);
    assert.equal(text.value, 'Accessibility size AX1 — notch 8 of 12 (body text 28 pt)');
    assert.deepEqual(text.steps.slice(0, 6), ['Open Settings.', 'Tap "Accessibility".', 'Tap "Display & Text Size".', 'Tap "Larger Text".',
      'Turn on "Larger Accessibility Sizes".', 'Drag the slider toward the large A to notch 8 of 12, counting from the small A.']);
    assert.ok(sec(ios, 'bold-text').steps.includes('Turn on "Bold Text".'));
    assert.ok(sec(ios, 'contrast').steps.includes('Turn on "Increase Contrast".'));
    assert.ok(!sec(ios, 'contrast').steps.includes('Also turn on "Reduce Transparency".'));
    const and = buildSystemGuide(target, 'android', 'en');
    assert.deepEqual(ids(and), ['text-size', 'bold-text', 'contrast']);
    assert.equal(sec(and, 'text-size').value, 'Step 6 of 7 (180%)');
    assert.ok(sec(and, 'text-size').steps.includes('Tap "Display size and text".'));
    assert.equal(sec(and, 'contrast').value, 'Medium');
    assert.ok(sec(and, 'bold-text').steps.includes('Turn on "Bold text".'));
    const sam = buildSystemGuide(target, 'samsung', 'en');
    assert.ok(sec(sam, 'text-size').steps.includes('Tap "Font size and style".'));
    assert.ok(sec(sam, 'bold-text').steps.includes('Turn on "Bold font".'));
    assert.equal(sec(sam, 'contrast').recommended, false);
  });
  test('xxLarge standard step (fs 20 px) in Hebrew keeps quoted English menu names', () => {
    const g = buildSystemGuide({ ...T0, textScale: 20 / 16 }, 'ios', 'he');
    const text = sec(g, 'text-size');
    assert.equal(text.value, 'xxLarge – שנתה 6 מתוך 7 (טקסט גוף בגודל 21 נק׳)');
    assert.ok(text.steps.some((s) => s.includes('"Larger Text"')));
    assert.ok(!text.steps.some((s) => s.includes('Larger Accessibility Sizes')));
    assert.equal(text.why, 'לפי התוצאות שלכם, טקסט בגודל של כ-125% מהגודל הרגיל נוח לקריאה במרחק הצפייה הרגיל שלכם.');
    const and = buildSystemGuide({ ...T0, textScale: 20 / 16 }, 'android', 'he');
    assert.equal(sec(and, 'text-size').value, 'שלב 4 מתוך 7 (130%)');
  });
  test('high contrast: Reduce Transparency, Android High + High contrast/Outline text, Samsung High contrast fonts', () => {
    const target = { ...T0, increaseContrast: true, contrastLevel: 'high' };
    assert.ok(sec(buildSystemGuide(target, 'ios', 'en'), 'contrast').steps.includes('Also turn on "Reduce Transparency".'));
    const and = sec(buildSystemGuide(target, 'android', 'en'), 'contrast');
    assert.equal(and.value, 'High');
    assert.ok(and.steps.some((s) => s.includes('"High contrast text"') && s.includes('"Outline text"')));
    assert.ok(and.steps.includes('Tap "Color and motion".'));
    const sam = sec(buildSystemGuide(target, 'samsung', 'en'), 'contrast');
    assert.equal(sam.recommended, true);
    assert.ok(sam.steps.includes('Tap "Vision enhancements".'));
    assert.ok(sam.steps.includes('Turn on "High contrast fonts".'));
  });
  test('colour filter: exact option names, intensity, optional (opt-in)', () => {
    const target = { ...T0, colorFilter: { type: 'deutan', intensity: 0.9 } };
    const ios = sec(buildSystemGuide(target, 'ios', 'en'), 'color-filter');
    assert.equal(ios.recommended, false);
    assert.ok(ios.steps.includes('Choose "Green/Red Filter".'));
    assert.ok(ios.steps.some((s) => s.includes('about 90%')));
    const and = sec(buildSystemGuide(target, 'android', 'en'), 'color-filter');
    assert.ok(and.steps.includes('Choose "Red-green, green weak".'));
    assert.ok(and.steps.some((s) => s.includes('high (near the strong end)')));
    assert.ok(and.steps.includes('Tap "Color correction" and turn on "Use color correction".'));
    const pro = sec(buildSystemGuide({ ...T0, colorFilter: { type: 'protan', intensity: 0.2 } }, 'android', 'en'), 'color-filter');
    assert.ok(pro.steps.includes('Choose "Red-green, red weak".'));
    assert.ok(pro.steps.some((s) => s.includes('low (about a third')));
    const tri = sec(buildSystemGuide({ ...T0, colorFilter: { type: 'tritan', intensity: 0.5 } }, 'ios', 'he'), 'color-filter');
    assert.ok(tri.steps.includes('בחרו באפשרות "Blue/Yellow Filter".'));
    const sam = sec(buildSystemGuide(target, 'samsung', 'en'), 'color-filter');
    assert.ok(sam.steps.includes('Choose the green–red option.'));
  });
  test('text beyond AX5 / Android 2.0 → zoom, display size and magnification', () => {
    const target = { ...T0, textScale: 60 / 16, displayZoom: 60 / 28, magnificationShortcut: true };
    const ios = buildSystemGuide(target, 'ios', 'en');
    assert.ok(sec(ios, 'text-size').value.includes('AX5'));
    const zoom = sec(ios, 'zoom');
    assert.equal(zoom.value, 'Maximum zoom level 8×');
    assert.ok(zoom.steps.includes('Tap "Maximum Zoom Level" and set it to 8×.'));
    assert.ok(zoom.steps.some((s) => s.includes('"Magnifier"')));
    const and = buildSystemGuide(target, 'android', 'en');
    assert.deepEqual(ids(and), ['text-size', 'display-size', 'zoom']);
    assert.equal(sec(and, 'text-size').value, 'Step 7 of 7 (200%)');
    assert.equal(sec(and, 'display-size').value, 'Largest');
    assert.ok(sec(and, 'zoom').steps.includes('Tap "Magnification".'));
    const mild = buildSystemGuide({ ...T0, textScale: 30 / 16, displayZoom: 30 / 28 }, 'android', 'en');
    assert.equal(sec(mild, 'display-size').value, '1 step(s) above the default');
    assert.equal(sec(mild, 'zoom'), undefined);
  });
  test('white point / extra dim and dark mode', () => {
    const target = { ...T0, reduceWhitePoint: true, darkMode: true };
    const ios = buildSystemGuide(target, 'ios', 'en');
    assert.ok(sec(ios, 'white-point').steps.includes('Turn on "Reduce White Point".'));
    assert.equal(sec(ios, 'white-point').value, 'About 50%');
    assert.ok(sec(ios, 'dark-mode').steps.includes('Under "Appearance", choose "Dark".'));
    const and = buildSystemGuide(target, 'android', 'en');
    assert.ok(sec(and, 'white-point').steps.some((s) => s.includes('"Extra dim"')));
    assert.ok(sec(and, 'dark-mode').steps.includes('Turn on "Dark theme".'));
  });
  test('every section: id, title, one-sentence why, steps ending with the "menu names vary" note', () => {
    const full = { textScale: 2.5, boldText: true, increaseContrast: true, contrastLevel: 'high', colorFilter: { type: 'protan', intensity: 0.7 },
      reduceWhitePoint: true, darkMode: true, displayZoom: 1.45, magnificationShortcut: true };
    for (const platform of ['ios', 'ipados', 'android', 'samsung', 'desktop', 'other']) {
      for (const lang of ['en', 'he']) {
        const g = buildSystemGuide(full, platform, lang);
        assert.ok(g.length >= 1);
        assert.equal(new Set(ids(g)).size, g.length, 'unique ids');
        for (const s of g) {
          assert.match(s.id, /^[a-z-]+$/);
          assert.ok(s.title && s.why && s.steps.length >= 2, `${platform}/${lang}/${s.id}`);
          assert.equal(typeof s.recommended, 'boolean');
          assert.ok(!/\{\w+\}/.test(joined(s)), `unresolved placeholder in ${platform}/${lang}/${s.id}`);
          const last = s.steps.at(-1);
          assert.match(last, lang === 'en' ? /vary slightly/ : /להשתנות מעט/);
          if (lang === 'he') assert.match(s.why, /[א-ת]/);
        }
      }
    }
    assert.ok(ids(buildSystemGuide(full, 'ios', 'en')).length >= 7);
  });
  test('malformed targets do not throw', () => {
    for (const t of [undefined, null, {}, { textScale: NaN, colorFilter: { type: 'x' } }]) {
      const g = buildSystemGuide(/** @type {any} */ (t), 'android', 'en');
      assert.deepEqual(ids(g), ['text-size']);
    }
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProfile, technicalDetails, describeFlag, FLAG_CODES } from '../../../public/app/js/engine/summary.js';
import { computeProfile } from '../../../public/app/js/engine/profile.js';
import { buildSystemGuide } from '../../../public/app/js/engine/system-guide.js';
import { FLAG_STRINGS } from '../../../public/app/js/engine/strings/flag-strings.js';
import { SUMMARY_STRINGS } from '../../../public/app/js/engine/strings/summary-strings.js';
import { GUIDE_STRINGS } from '../../../public/app/js/engine/strings/guide-strings.js';
import { demoProfile } from '../../../public/app/js/core/demo-profile.js';
import { PERSONAS, baseInput, eyesInput, acuity, allStrings } from './fixtures.js';

/** Clinical notation and condition names that must never reach the default (non-technical) UI. */
const FORBIDDEN = [
  /snellen/i, /log ?mar/i, /\bdecimal\b/i, /dioptr|diopter/i, /\b(6|20)\/\d/, /\bacuity\b/i, /astigmat/i,
  /colou?r[- ]?blind/i, /glaucoma/i, /macula/i, /cataract/i, /amblyop/i, /presbyop/i, /myop/i, /hyperop/i,
  /anopia/i, /anomal/i, /\bprotan|\bdeutan|\btritan/i, /daltoni/i, /retina/i, /\bAMD\b/, /log ?CS/i, /diagnos/i,
  /סנלן/, /לוגמאר/, /דיופטר/, /אסטיגמט/, /עיוורון צבע/, /גלאוקומה/, /ברקית/, /מקולה|מקולרי/, /קטרקט/, /ירוד/,
  /פרסביופ/, /קוצר ראייה/, /רוחק ראייה/, /עין עצלה/, /רשתית/, /חדות ראייה/, /אבחנה|אבחון/,
];
const scan = (strings, where) => {
  for (const s of strings) for (const re of FORBIDDEN) assert.ok(!re.test(s), `${where}: forbidden ${re} in "${s}"`);
};

const PROFILES = () => [
  ...Object.entries(PERSONAS).map(([k, f]) => [k, computeProfile(f())]),
  ['demo', computeProfile(demoProfile().input)],
  ['empty', computeProfile(baseInput())],
  ['tritan', computeProfile(eyesInput(0.6, { age: 70, color: { type: 'tritan', severity: 0.7, reliable: true }, contrast: { logCS: 0.9, reliable: true } }))],
  ['unreliable', computeProfile(baseInput({ acuity: { right: acuity('right', 0.3, { reliable: false, floorLimited: true }) }, color: { type: 'deutan', severity: 0.5, reliable: false } }))],
];

describe('forbidden clinical terms in user-facing output (he + en)', () => {
  test('summaries, flag texts and guides of many profiles', () => {
    for (const [name, p] of PROFILES()) {
      for (const lang of ['he', 'en']) {
        scan(allStrings(summarizeProfile(p, lang)), `${name}/${lang}/summary`);
        for (const platform of ['ios', 'ipados', 'android', 'samsung', 'desktop', 'other']) {
          scan(allStrings(buildSystemGuide(p.system, platform, lang)), `${name}/${lang}/${platform}`);
        }
      }
    }
  });
  test('every flag code, and the raw user-facing dictionaries', () => {
    for (const code of FLAG_CODES) {
      for (const lang of ['he', 'en']) {
        for (const level of ['info', 'recommend', 'urgent']) {
          const d = describeFlag({ level, code, params: { score: 40, right: 50, left: 70, before: 80, after: 60, cm: 45, interval: '2–4', tests: 'acuity-right,contrast' } }, lang);
          scan([d.title, d.body], `${code}/${lang}`);
        }
      }
    }
    scan(allStrings(FLAG_STRINGS), 'FLAG_STRINGS');
    scan(allStrings(SUMMARY_STRINGS), 'SUMMARY_STRINGS');
    scan(allStrings(GUIDE_STRINGS), 'GUIDE_STRINGS');
  });
  test('the scanner itself catches clinical wording', () => {
    assert.throws(() => scan(['Your Snellen acuity is 6/12'], 'x'));
    assert.throws(() => scan(['יש לך אסטיגמטיזם'], 'x'));
  });
});

describe('describeFlag / FLAG_CODES', () => {
  test('every code has he + en wording; referral flags name the professional and a timeframe', () => {
    for (const code of FLAG_CODES) {
      for (const lang of ['he', 'en']) {
        const d = describeFlag({ level: 'recommend', code, params: { timeframe: 'routine', cm: 40, score: 50, right: 50, left: 70, before: 80, after: 60, interval: '1–3', tests: 'color' } }, lang);
        assert.ok(d.title && d.body, code);
        assert.notEqual(d.title, describeFlag({ level: 'info', code: 'NOT_A_CODE' }, lang).title, `${code} has its own wording`);
        assert.ok(!/\{\w+\}/.test(d.title + d.body), `${code}/${lang} placeholder`);
        assert.match(d.body, lang === 'en' ? /optometrist or ophthalmologist/ : /אופטומטריסט או רופא עיניים/);
      }
    }
    assert.match(describeFlag({ level: 'urgent', code: 'LOW_CONTRAST' }, 'en').advice, /1–2 weeks/);
    assert.equal(describeFlag({ level: 'info', code: 'COLOR_RED_GREEN' }, 'en').advice, null);
    assert.match(describeFlag({ level: 'recommend', code: 'LOW_ACUITY_LEFT', params: { score: 50 } }, 'en').title, /left eye/);
    assert.match(describeFlag({ level: 'info', code: 'UNRELIABLE', params: { tests: 'acuity-right,contrast' } }, 'he').text, /עין ימין/);
  });
  test('every code the engine emits for the test profiles is listed in FLAG_CODES', () => {
    for (const [name, p] of PROFILES()) for (const f of p.flags) assert.ok(FLAG_CODES.includes(f.code), `${name}: ${f.code}`);
  });
});

describe('summarizeProfile', () => {
  test('demo profile (en): scores, bands, text size, contrast, colour, flags, recommendations', () => {
    const s = summarizeProfile(computeProfile(demoProfile().input), 'en');
    assert.deepEqual(s.eyes.map((e) => [e.eye, e.score]), [['right', 50], ['left', 58]]);
    assert.equal(s.eyes[0].label, 'Fine detail is harder for you. We’ve enlarged text.');
    assert.equal(s.contrast.level, 'reduced');
    assert.equal(s.colour.filterRecommended, true);
    assert.match(s.colour.text, /reds and greens/);
    assert.equal(s.lineSharpness.text, 'Not checked.');
    assert.equal(s.viewingDistance, null);
    assert.ok(s.textSizePx > 30);
    assert.match(s.textSizeLabel, /% of the standard size/);
    assert.ok(s.flags.every((f) => f.title && f.body && f.code && f.level));
    assert.ok(s.recommendations.some((r) => /Reading glasses/.test(r)));
    assert.match(s.disclaimer, /not an eye examination/);
  });
  test('young normal (he): top band, standard text, no filter, exam reminder, focus range text', () => {
    const s = summarizeProfile(computeProfile(PERSONAS.youngNormal()), 'he');
    assert.ok(s.eyes.every((e) => e.score >= 83));
    assert.equal(s.eyes[0].label, 'אתם רואים היטב פרטים קטנים על המסך.');
    assert.equal(s.textSizeLabel, 'גודל הטקסט הרגיל מתאים לכם.');
    assert.equal(s.contrast.level, 'normal');
    assert.equal(s.colour.filterRecommended, false);
    assert.match(s.colour.text, /לעבודה או לנהיגה/);
    assert.equal(s.lineSharpness.text, 'קווים בכל הכיוונים נראו לכם חדים בערך באותה מידה.');
    assert.match(s.viewingDistance.text, /11 ס"מ/);
    assert.deepEqual(s.flags.map((f) => f.code), ['EXAM_REMINDER']);
    assert.match(s.flags[0].body, /5–10/);
  });
  test('low vision: magnifier recommendation, very-low band, consistent line result', () => {
    const s = summarizeProfile(computeProfile(PERSONAS.lowVision()), 'en');
    assert.ok(s.eyes.every((e) => e.score <= 25));
    assert.match(s.eyes[0].label, /Small text is difficult/); // score 25
    assert.match(s.eyes[1].label, /Magnification tools/); // score 21
    assert.ok(s.recommendations.some((r) => /zoom or magnifier/.test(r)));
    assert.match(s.lineSharpness.text, /Right eye/);
    assert.match(s.textSizeLabel, /40\d% of the standard size/);
    const worse = summarizeProfile(computeProfile(eyesInput(1.1)), 'en');
    assert.match(worse.textSizeLabel, /magnification is recommended/);
  });
  test('floor-limited score shows "+", unreliable eye is marked', () => {
    const s = summarizeProfile(computeProfile(baseInput({ acuity: { right: acuity('right', 0.0, { floorLimited: true }), left: acuity('left', 0.1, { reliable: false }) } })), 'en');
    assert.equal(s.eyes[0].scoreText, '83+');
    assert.match(s.eyes[1].label, /less certain/);
  });
  test('empty / malformed profiles do not throw', () => {
    for (const p of [undefined, {}, { input: null, flags: null }, computeProfile(baseInput())]) {
      for (const lang of ['he', 'en']) {
        const s = summarizeProfile(/** @type {any} */ (p), lang);
        assert.ok(Array.isArray(s.eyes) && Array.isArray(s.flags) && s.recommendations.length >= 1);
        assert.ok(Array.isArray(technicalDetails(/** @type {any} */ (p), lang)));
      }
    }
  });
});

describe('technicalDetails (hidden panel)', () => {
  test('labelled as a screen test, with clinical values', () => {
    const rows = technicalDetails(computeProfile(demoProfile().input), 'en');
    assert.equal(rows[0].value, 'Screen test at 40 cm, not a clinical measurement.');
    const right = rows.find((r) => r.label === 'Acuity — Right eye');
    assert.match(right.value, /logMAR 0\.40/);
    assert.match(right.value, /6\/15/);
    assert.ok(rows.some((r) => /logCS 1\.50/.test(r.value)));
    assert.match(technicalDetails(computeProfile(demoProfile().input), 'he')[0].value, /לא מדידה קלינית/);
  });
});

// @ts-check
/**
 * Pilot study — pure logic (no DOM, no storage): tester codes, passage counterbalancing, reading speed,
 * the per-session success rule, summary statistics, validation of untrusted session data, the portable
 * "results code" and CSV export. Shared by the tester session (session.js) and the founder's hub (hub.js).
 *
 * Privacy: a session holds an anonymous code, answers and reading measures only. Never names, e-mails or the
 * raw eye-test data (the app keeps that on the device).
 */

export const SCHEMA_VERSION = 1;
export const CONSENT_VERSION = 'pilot-consent-v1-2026-10';
/** Tester-code alphabet: no 0/O, 1/I/L. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_RE = /^T-[2-9A-HJKMNP-Z]{4}$/;
/** "Normal phone text" for the reference conditions. */
export const NORMAL_FONT_PX = 16;
export const CHARS_PER_STANDARD_WORD = 6;

/** Conditions in the order they are run. */
export const CONDITIONS = /** @type {const} */ (['withGlasses', 'withoutGlasses', 'seetuned']);
export const AGE_BANDS = /** @type {const} */ (['18-29', '30-39', '40-44', '45-54', '55-64', '65-74', '75+']);
export const CORRECTIONS = /** @type {const} */ (['none', 'distance', 'reading', 'multifocal', 'contacts']);
export const HOLDING = /** @type {const} */ (['close', 'normal', 'far', 'varies']);
export const COMFORT = /** @type {const} */ (['yes', 'partly', 'no']);
export const RX_FIELDS = /** @type {const} */ (['sph', 'cyl', 'axis', 'add']);
/** Accepted ranges for the optional prescription numbers (research only, never interpreted). */
/** @type {Readonly<Record<'sph'|'cyl'|'axis'|'add', [number, number]>>} */
export const RX_RANGES = Object.freeze({ sph: [-25, 25], cyl: [-10, 10], axis: [0, 180], add: [0, 4] });

/** The success rule (see docs/pilot/PILOT-PROTOCOL.md). */
export const SUCCESS_RULE = Object.freeze({
  clarityMin: 4,          // clarity rating with SeeTuned, 1..5
  vsGlassesMin: 0.85,     // SeeTuned speed >= 85 % of the with-glasses speed (when that condition exists)
  vsDefaultMin: 1.10,     // otherwise SeeTuned speed >= 110 % of the no-glasses default speed
  partialClarityMin: 3,
  partialVsGlassesMin: 0.70,
  partialVsDefaultMin: 1.0,
});

/**
 * @typedef {{passageId: string, wpm: number, ms: number, correct: boolean, clarity: number, effort: number,
 *   fontPx: number, distanceMm: number|null}} ConditionResult
 * @typedef {{sph: number|null, cyl: number|null, axis: number|null, add: number|null}} RxEye
 * @typedef {{ageBand: string|null, correction: string|null, rx: {right: RxEye, left: RxEye}|null,
 *   holding: string|null, deviceModel: string}} Background
 * @typedef {{baseFontPx: number|null, fontWeight: number|null, verdict: string|null, reasons: string[],
 *   recommendedDistanceMm: number|null, fromEarlierCheck: boolean}} ProfileSummary
 * @typedef {{v: 1, code: string, status: 'complete'|'stopped', consentVersion: string, lang: 'he'|'en',
 *   env: string|null, startedAt: string, finishedAt: string|null, background: Background,
 *   withGlassesSkipped: string|null,
 *   conditions: {withGlasses: ConditionResult|null, withoutGlasses: ConditionResult|null, seetuned: ConditionResult|null},
 *   profile: ProfileSummary|null, final: {comfortable: string|null, wouldUse: number|null, comment: string},
 *   appVersion: string, device: {screenW: number|null, screenH: number|null, dpr: number|null, ua: string}}} PilotSession
 * @typedef {{verdict: 'success'|'partial'|'notyet'|'incomplete', reasons: string[], baseline: 'glasses'|'default'|null,
 *   ratio: number|null, gainVsDefault: number|null, ratioVsGlasses: number|null}} Outcome
 */

/**
 * New anonymous tester code, e.g. "T-7KQ2". Avoids codes already in `taken`.
 * @param {() => number} [random] @param {Set<string>|string[]} [taken]
 */
export function newTesterCode(random = Math.random, taken = []) {
  const used = taken instanceof Set ? taken : new Set(taken);
  for (let attempt = 0; attempt < 1000; attempt++) {
    let s = 'T-';
    for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
    if (!used.has(s)) return s;
  }
  throw new Error('no free tester code');
}

/** FNV-1a 32-bit. @param {string} str */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const PERMUTATIONS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/**
 * Counterbalanced passage assignment: the tester code picks one of the 6 orders of the 3 passages
 * (a random code => each order equally likely), so no passage is tied to one condition.
 * @param {string} code
 * @returns {{withGlasses: number, withoutGlasses: number, seetuned: number}} passage index per condition
 */
export function assignPassages(code) {
  const p = PERMUTATIONS[hash32(String(code)) % PERMUTATIONS.length];
  return { withGlasses: p[0], withoutGlasses: p[1], seetuned: p[2] };
}

/** Standard-length words (characters incl. spaces / 6). @param {string} text */
export function standardWords(text) {
  return String(text).length / CHARS_PER_STANDARD_WORD;
}

/** Reading speed in standard words per minute, 1 decimal. @param {string} text @param {number} ms */
export function wordsPerMinute(text, ms) {
  if (!(ms > 0)) return 0;
  return Math.round((standardWords(text) / (ms / 60000)) * 10) / 10;
}

/** @param {number[]} xs */
export function median(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * The per-session success rule.
 * SUCCESS  = SeeTuned comprehension correct AND clarity >= 4 AND
 *            (with-glasses speed exists ? SeeTuned speed >= 0.85 x with-glasses speed : SeeTuned speed >= 1.10 x default speed).
 * PARTIAL  = not a success, but comprehension correct, clarity >= 3 and speed >= 0.70 x with-glasses (or >= 1.00 x default).
 * NOT YET  = everything else. INCOMPLETE = no SeeTuned reading or no reference reading.
 * @param {PilotSession} s
 * @returns {Outcome}
 */
export function evaluateSession(s) {
  const c = s?.conditions || /** @type {any} */ ({});
  const g = c.withGlasses || null;
  const d = c.withoutGlasses || null;
  const st = c.seetuned || null;
  const gainVsDefault = st && d && d.wpm > 0 ? st.wpm / d.wpm - 1 : null;
  const ratioVsGlasses = st && g && g.wpm > 0 ? st.wpm / g.wpm : null;
  if (!st || (!g && !d)) {
    const reasons = [];
    if (!d && !g) reasons.push('NO_REFERENCE');
    if (!st) reasons.push('NO_SEETUNED');
    return { verdict: 'incomplete', reasons, baseline: null, ratio: null, gainVsDefault, ratioVsGlasses };
  }
  const R = SUCCESS_RULE;
  const baseline = g ? 'glasses' : 'default';
  const ref = g || d;
  const ratio = ref.wpm > 0 ? st.wpm / ref.wpm : 0;
  const speedMin = g ? R.vsGlassesMin : R.vsDefaultMin;
  const reasons = [];
  if (!st.correct) reasons.push('WRONG_ANSWER');
  if (!(st.clarity >= R.clarityMin)) reasons.push('CLARITY_LOW');
  if (!(ratio >= speedMin)) reasons.push(g ? 'SLOWER_THAN_GLASSES' : 'NOT_FASTER_THAN_DEFAULT');
  if (!reasons.length) return { verdict: 'success', reasons, baseline, ratio, gainVsDefault, ratioVsGlasses };
  const partial = st.correct && st.clarity >= R.partialClarityMin && ratio >= (g ? R.partialVsGlassesMin : R.partialVsDefaultMin);
  return { verdict: partial ? 'partial' : 'notyet', reasons, baseline, ratio, gainVsDefault, ratioVsGlasses };
}

/**
 * Summary over sessions: n (evaluable sessions), successes, success rate, median speed gain vs the
 * no-glasses default, median SeeTuned/with-glasses speed ratio.
 * @param {PilotSession[]} sessions
 */
export function summarize(sessions) {
  const outcomes = sessions.map((s) => evaluateSession(s));
  const done = outcomes.filter((o) => o.verdict !== 'incomplete');
  const count = (/** @type {string} */ v) => done.filter((o) => o.verdict === v).length;
  const success = count('success');
  return {
    total: sessions.length,
    n: done.length,
    incomplete: outcomes.length - done.length,
    success,
    partial: count('partial'),
    notyet: count('notyet'),
    successRate: done.length ? success / done.length : null,
    medianGainVsDefault: median(done.map((o) => o.gainVsDefault ?? NaN)),
    medianRatioVsGlasses: median(done.map((o) => o.ratioVsGlasses ?? NaN)),
    nWithGlasses: done.filter((o) => o.ratioVsGlasses !== null).length,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Validation of untrusted data (imported results codes, documents synced from other devices).

/** @param {unknown} v @param {number} lo @param {number} hi */
function num(v, lo, hi) {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}
/** @param {unknown} v @param {number} lo @param {number} hi */
function int(v, lo, hi) {
  const n = num(v, lo, hi);
  return n !== null && Number.isInteger(n) ? n : null;
}
/** @param {unknown} v @param {readonly string[]} allowed */
function oneOf(v, allowed) {
  return typeof v === 'string' && allowed.includes(v) ? v : null;
}
/** @param {unknown} v @param {number} max */
function text(v, max) {
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : '';
}
/** @param {unknown} v */
function isoDate(v) {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** @param {any} c @returns {ConditionResult|null} */
function cleanCondition(c) {
  if (!c || typeof c !== 'object') return null;
  const passageId = typeof c.passageId === 'string' && /^(he|en)-[1-3]$/.test(c.passageId) ? c.passageId : null;
  const wpm = num(c.wpm, 0, 3000);
  const clarity = int(c.clarity, 1, 5);
  const effort = int(c.effort, 1, 5);
  const fontPx = num(c.fontPx, 4, 400);
  if (!passageId || wpm === null || clarity === null || effort === null || fontPx === null || typeof c.correct !== 'boolean') return null;
  return {
    passageId, wpm, ms: num(c.ms, 0, 3_600_000) ?? 0, correct: c.correct, clarity, effort, fontPx,
    distanceMm: num(c.distanceMm, 50, 3000),
  };
}

/** @param {any} e @returns {RxEye} */
function cleanRxEye(e) {
  const o = e && typeof e === 'object' ? e : {};
  return {
    sph: num(o.sph, ...RX_RANGES.sph), cyl: num(o.cyl, ...RX_RANGES.cyl),
    axis: int(o.axis, ...RX_RANGES.axis), add: num(o.add, ...RX_RANGES.add),
  };
}
/** @param {RxEye} e */
const rxEmpty = (e) => RX_FIELDS.every((f) => e[f] === null);

/**
 * Validate and normalise a session from an untrusted source. Unknown fields are dropped.
 * @param {unknown} raw
 * @returns {PilotSession|null}
 */
export function sanitizeSession(raw) {
  const s = /** @type {any} */ (raw);
  if (!s || typeof s !== 'object' || s.v !== SCHEMA_VERSION) return null;
  if (typeof s.code !== 'string' || !CODE_RE.test(s.code)) return null;
  const startedAt = isoDate(s.startedAt);
  if (!startedAt) return null;
  const b = s.background && typeof s.background === 'object' ? s.background : {};
  let rx = null;
  if (b.rx && typeof b.rx === 'object') {
    const right = cleanRxEye(b.rx.right);
    const left = cleanRxEye(b.rx.left);
    rx = rxEmpty(right) && rxEmpty(left) ? null : { right, left };
  }
  const c = s.conditions && typeof s.conditions === 'object' ? s.conditions : {};
  const p = s.profile && typeof s.profile === 'object' ? s.profile : null;
  const f = s.final && typeof s.final === 'object' ? s.final : {};
  const dev = s.device && typeof s.device === 'object' ? s.device : {};
  return {
    v: SCHEMA_VERSION,
    code: s.code,
    status: s.status === 'complete' ? 'complete' : 'stopped',
    consentVersion: text(s.consentVersion, 40),
    lang: s.lang === 'en' ? 'en' : 'he',
    env: oneOf(s.env, ['demo', 'server']),
    startedAt,
    finishedAt: isoDate(s.finishedAt),
    background: {
      ageBand: oneOf(b.ageBand, AGE_BANDS),
      correction: oneOf(b.correction, CORRECTIONS),
      rx,
      holding: oneOf(b.holding, HOLDING),
      deviceModel: text(b.deviceModel, 60),
    },
    withGlassesSkipped: oneOf(s.withGlassesSkipped, ['no-correction', 'not-with-me', 'skipped']),
    conditions: {
      withGlasses: cleanCondition(c.withGlasses),
      withoutGlasses: cleanCondition(c.withoutGlasses),
      seetuned: cleanCondition(c.seetuned),
    },
    profile: p ? {
      baseFontPx: num(p.baseFontPx, 4, 400),
      fontWeight: num(p.fontWeight, 100, 900),
      verdict: oneOf(p.verdict, ['yes', 'partial', 'no']),
      reasons: Array.isArray(p.reasons) ? p.reasons.filter((r) => typeof r === 'string' && /^[A-Z0-9_]{1,40}$/.test(r)).slice(0, 20) : [],
      recommendedDistanceMm: num(p.recommendedDistanceMm, 50, 3000),
      fromEarlierCheck: p.fromEarlierCheck === true,
    } : null,
    final: {
      comfortable: oneOf(f.comfortable, COMFORT),
      wouldUse: int(f.wouldUse, 1, 5),
      comment: text(f.comment, 500),
    },
    appVersion: text(s.appVersion, 20),
    device: {
      screenW: num(dev.screenW, 100, 10000), screenH: num(dev.screenH, 100, 10000),
      dpr: num(dev.dpr, 0.5, 10), ua: text(dev.ua, 40),
    },
  };
}

/** Stable fingerprint of a session's content (used to sync only when it changed). @param {PilotSession} s */
export function sessionFingerprint(s) {
  return hash32(JSON.stringify(s)).toString(36);
}

// ---------------------------------------------------------------------------------------------------------
// Results code: "STP1z." + base64url(deflate-raw(JSON)) when the browser can compress, else "STP1." + base64url(JSON).

const PREFIX = 'STP1.';
const PREFIX_Z = 'STP1z.';

/** @param {Uint8Array} bytes */
function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** @param {string} s */
function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** @param {Uint8Array} bytes @param {'CompressionStream'|'DecompressionStream'} kind */
async function pipe(bytes, kind) {
  const Ctor = /** @type {any} */ (globalThis)[kind];
  const stream = new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))]).stream().pipeThrough(new Ctor('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @param {PilotSession} session @returns {Promise<string>} */
export async function encodeResultsCode(session) {
  const bytes = new TextEncoder().encode(JSON.stringify(session));
  if (typeof (/** @type {any} */ (globalThis)).CompressionStream === 'function') {
    try { return PREFIX_Z + toBase64Url(await pipe(bytes, 'CompressionStream')); } catch { /* fall through */ }
  }
  return PREFIX + toBase64Url(bytes);
}

/**
 * Decode a results code pasted by the founder (may be embedded in a longer message, wrapped or spaced).
 * @param {string} input
 * @returns {Promise<PilotSession>}  rejects with Error('FORMAT'|'UNSUPPORTED'|'INVALID')
 */
export async function decodeResultsCode(input) {
  const compact = String(input || '').replace(/\s+/g, '');
  const m = compact.match(/STP1(z?)\.([A-Za-z0-9_-]{16,})/);
  if (!m) throw new Error('FORMAT');
  let bytes;
  try { bytes = fromBase64Url(m[2]); } catch { throw new Error('FORMAT'); }
  if (m[1] === 'z') {
    if (typeof (/** @type {any} */ (globalThis)).DecompressionStream !== 'function') throw new Error('UNSUPPORTED');
    try { bytes = await pipe(bytes, 'DecompressionStream'); } catch { throw new Error('FORMAT'); }
  }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('FORMAT'); }
  const clean = sanitizeSession(parsed);
  if (!clean) throw new Error('INVALID');
  return clean;
}

// ---------------------------------------------------------------------------------------------------------
// CSV export (UTF-8 with BOM so spreadsheet apps read Hebrew correctly).

export const CSV_COLUMNS = Object.freeze([
  'code', 'status', 'started_at', 'lang', 'env', 'age_band', 'correction', 'holding', 'device_model',
  'glasses_wpm', 'glasses_correct', 'glasses_clarity', 'glasses_effort', 'glasses_skipped',
  'default_wpm', 'default_correct', 'default_clarity', 'default_effort',
  'seetuned_wpm', 'seetuned_correct', 'seetuned_clarity', 'seetuned_effort', 'seetuned_font_px', 'seetuned_distance_mm',
  'gain_vs_default_pct', 'ratio_vs_glasses', 'outcome', 'outcome_reasons',
  'app_verdict', 'app_reasons', 'app_font_px', 'app_font_weight', 'app_distance_mm', 'app_profile_from_earlier_check',
  'comfortable', 'would_use', 'comment',
  'rx_r_sph', 'rx_r_cyl', 'rx_r_axis', 'rx_r_add', 'rx_l_sph', 'rx_l_cyl', 'rx_l_axis', 'rx_l_add',
  'screen_w', 'screen_h', 'dpr', 'browser', 'app_version', 'consent_version',
]);

/** Quote a CSV cell; neutralise spreadsheet formulas in free text. @param {unknown} v @param {boolean} [free] */
function cell(v, free = false) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
  if (free && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || free ? `"${s.replace(/"/g, '""')}"` : s;
}

/** @param {PilotSession[]} sessions @returns {string} */
export function sessionsToCsv(sessions) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const s of sessions) {
    const o = evaluateSession(s);
    const g = s.conditions.withGlasses; const d = s.conditions.withoutGlasses; const st = s.conditions.seetuned;
    const rx = s.background.rx;
    const p = s.profile;
    const vals = [
      cell(s.code), cell(s.status), cell(s.startedAt), cell(s.lang), cell(s.env), cell(s.background.ageBand),
      cell(s.background.correction), cell(s.background.holding), cell(s.background.deviceModel, true),
      cell(g?.wpm), cell(g ? (g.correct ? 1 : 0) : null), cell(g?.clarity), cell(g?.effort), cell(s.withGlassesSkipped),
      cell(d?.wpm), cell(d ? (d.correct ? 1 : 0) : null), cell(d?.clarity), cell(d?.effort),
      cell(st?.wpm), cell(st ? (st.correct ? 1 : 0) : null), cell(st?.clarity), cell(st?.effort), cell(st?.fontPx), cell(st?.distanceMm),
      cell(o.gainVsDefault === null ? null : o.gainVsDefault * 100), cell(o.ratioVsGlasses), cell(o.verdict), cell(o.reasons.join(' ')),
      cell(p?.verdict), cell(p?.reasons.join(' ')), cell(p?.baseFontPx), cell(p?.fontWeight), cell(p?.recommendedDistanceMm),
      cell(p ? (p.fromEarlierCheck ? 1 : 0) : null),
      cell(s.final.comfortable), cell(s.final.wouldUse), cell(s.final.comment, true),
      cell(rx?.right.sph), cell(rx?.right.cyl), cell(rx?.right.axis), cell(rx?.right.add),
      cell(rx?.left.sph), cell(rx?.left.cyl), cell(rx?.left.axis), cell(rx?.left.add),
      cell(s.device.screenW), cell(s.device.screenH), cell(s.device.dpr), cell(s.device.ua), cell(s.appVersion), cell(s.consentVersion),
    ];
    rows.push(vals.join(','));
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------------------------------------

/**
 * Coarse browser family ("Android · Chrome"); the full user-agent string is never stored.
 * @param {string} ua @param {number} [maxTouchPoints]
 */
export function uaFamily(ua, maxTouchPoints = 0) {
  const u = String(ua || '');
  const os = /iPhone|iPod/.test(u) ? 'iOS' : /iPad/.test(u) || (/Macintosh/.test(u) && maxTouchPoints > 1) ? 'iPadOS'
    : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'macOS'
      : /CrOS/.test(u) ? 'ChromeOS' : /Linux/.test(u) ? 'Linux' : 'Other';
  const browser = /SamsungBrowser/.test(u) ? 'Samsung Internet' : /EdgA?\//.test(u) ? 'Edge'
    : /FxiOS|Firefox\//.test(u) ? 'Firefox' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Other';
  return `${os} · ${browser}`;
}

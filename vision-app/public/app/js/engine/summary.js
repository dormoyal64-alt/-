// @ts-check
/**
 * RESULTS WORDING — pure (no DOM). Turns a VisionProfile into the functional, non-clinical text the results screen
 * shows (spec items 59–61, PRODUCT CLAIMS), plus the optional technical-details list (item 62).
 *   summarizeProfile(profile, lang)  → plain-language summary (no clinical notation, no condition names)
 *   technicalDetails(profile, lang)  → [{label, value}] with clinical values, for the hidden technical panel only
 *   describeFlag(flag, lang)         → {level, code, title, text, advice, body} for one ProfileFlag
 */
import { makeT } from '../core/i18n.js';
import { FLAG_STRINGS } from './strings/flag-strings.js';
import { SUMMARY_STRINGS, TECH_STRINGS } from './strings/summary-strings.js';
import { detailScore, deriveMetrics, PLATFORM_DEFAULT_PX } from './profile.js';
import { decimalFromLogMAR, snellen6, snellen20 } from '../tests/acuity/acuity-math.js';

/** @typedef {import('../core/types.js').Lang} Lang */
/** @typedef {import('../core/types.js').VisionProfile} VisionProfile */
/** @typedef {import('../core/types.js').ProfileFlag} ProfileFlag */

/**
 * @typedef {Object} FlagText
 * @property {ProfileFlag['level']} level
 * @property {string} code
 * @property {string} title
 * @property {string} text     the finding
 * @property {string|null} advice  professional-care sentence (null for info flags)
 * @property {string} body     text + advice
 */

/** Every stable ProfileFlag code engine/profile.js can emit (eye-specific codes listed with their suffix). */
export const FLAG_CODES = Object.freeze([
  'LOW_ACUITY_RIGHT', 'LOW_ACUITY_LEFT', 'LOW_ACUITY_BOTH', 'NEAR_ACUITY_REDUCED', 'ACUITY_DIFFERENCE',
  'ACUITY_WORSENED_RIGHT', 'ACUITY_WORSENED_LEFT', 'ACUITY_WORSENED_BOTH', 'LOW_CONTRAST', 'CONTRAST_WORSENED',
  'COLOR_RED_GREEN', 'COLOR_BLUE_YELLOW', 'COLOR_GENERAL', 'COLOR_CHANGED', 'LINES_UNEVEN_RIGHT', 'LINES_UNEVEN_LEFT',
  'NEAR_FOCUS_REDUCED', 'NEAR_FOCUS_FAR', 'FOCUS_RANGE_LIMITED', 'DISTANCE_FOCUS_LIMITED', 'UNRELIABLE',
  'DEFAULT_CALIBRATION', 'NO_ACUITY', 'RECHECK_AT_DISTANCE', 'EXAM_REMINDER',
]);

/** @param {unknown} lang @returns {Lang} */
const langOf = (lang) => (lang === 'en' ? 'en' : 'he');
/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** @param {string} s */
const tidy = (s) => s.replace(/\s+([.,)])/g, '$1').replace(/\s{2,}/g, ' ').trim();

/**
 * Plain-language wording for one engine flag.
 * @param {ProfileFlag} flag @param {Lang|string} lang
 * @returns {FlagText}
 */
export function describeFlag(flag, lang) {
  const t = makeT(FLAG_STRINGS, langOf(lang));
  const code = String(flag?.code || '');
  const m = /^(.*?)(?:_(RIGHT|LEFT|BOTH))?$/.exec(code);
  let base = m?.[1] || code;
  const eye = m?.[2] ? t(`eye.${m[2]}`) : '';
  const level = flag?.level === 'urgent' || flag?.level === 'recommend' ? flag.level : 'info';
  const params = /** @type {Record<string, string|number>} */ ({ ...(flag?.params || {}), eye });
  if (!Object.prototype.hasOwnProperty.call(FLAG_STRINGS.en, `${base}.title`)) base = 'GENERIC';
  if (base === 'UNRELIABLE') {
    params.tests = String(params.tests || '').split(',').filter(Boolean).map((k) => t(`test.${k}`)).join(', ');
  }
  let textKey = `${base}.text`;
  if (base === 'EXAM_REMINDER' && !params.interval) textKey = 'EXAM_REMINDER.textNoAge';
  const title = tidy(t(`${base}.title`, params));
  const text = tidy(t(textKey, params));
  const timeframe = params.timeframe === 'soon' || level === 'urgent' ? 'soon' : 'routine';
  const advice = level === 'info' ? null : t(`advice.${timeframe}`);
  return { level, code, title, text, advice, body: advice ? `${text} ${advice}` : text };
}

/** @param {number} score @returns {0|1|2|3|4} band index per item 61 */
function band(score) {
  if (score >= 83) return 4;
  if (score >= 67) return 3;
  if (score >= 50) return 2;
  if (score >= 25) return 1;
  return 0;
}

/**
 * @param {VisionProfile} profile @param {Lang|string} lang
 */
export function summarizeProfile(profile, lang) {
  const lg = langOf(lang);
  const t = makeT(SUMMARY_STRINGS, lg);
  const m = deriveMetrics(profile?.input);

  // Eyes: screen-detail score and plain label (items 60–61)
  const eyes = [];
  for (const eye of /** @type {const} */ (['right', 'left', 'both'])) {
    const e = m.eyes[eye];
    if (!e) continue;
    const score = /** @type {number} */ (detailScore(e.L));
    const scoreText = e.floorLimited && score < 100 ? `${score}+` : String(score);
    const label = e.reliable ? t(`band.${band(score)}`) : `${t(`band.${band(score)}`)} ${t('eye.uncertain')}`;
    eyes.push({ eye, name: t(`eye.${eye}`), score, scoreText, label, reliable: e.reliable });
  }

  // Text size
  const textSizePx = isNum(profile?.text?.baseFontPx) ? profile.text.baseFontPx : PLATFORM_DEFAULT_PX;
  const needPct = Math.round((m.fsNeeded / PLATFORM_DEFAULT_PX) * 100);
  const uiPct = Math.round((textSizePx / PLATFORM_DEFAULT_PX) * 100);
  const textSizeLabel = needPct <= 105 ? t('text.standard')
    : needPct > uiPct + 1 ? t('text.capped', { pct: needPct, uiPct }) : t('text.larger', { pct: needPct });

  // Contrast
  const cs = profile?.input?.contrast;
  /** @type {'normal'|'reduced'|'low'|'veryLow'|'unknown'} */
  let cLevel = 'unknown';
  let cText = t(cs ? 'contrast.unreliable' : 'contrast.unknown');
  if (m.contrastTier !== null) {
    cLevel = /** @type {const} */ (['normal', 'reduced', 'low', 'veryLow'])[m.contrastTier];
    cText = t(`contrast.${cLevel}`);
  }

  // Colour
  const col = m.color;
  const filterRecommended = !!profile?.system?.colorFilter;
  let colourText = t('colour.unknown');
  if (col && !col.reliable) colourText = t('colour.unreliable');
  else if (col) {
    if (col.type === 'normal') colourText = t('colour.normal');
    else if (col.type === 'unclassified') colourText = t('colour.general');
    else if (!filterRecommended) colourText = t('colour.mild');
    else colourText = t(col.type === 'tritan' ? 'colour.blueYellow' : 'colour.redGreen');
  }

  // Line sharpness
  const astig = profile?.input?.astigmatism;
  let linesText = t('lines.unknown');
  if (astig && (astig.right || astig.left)) {
    if (m.lines.consistent) linesText = t('lines.consistent', { eyes: m.lines.consistentEyes.map((e) => t(`eye.${e}`)).join(', ') });
    else if (m.lines.suspected) linesText = t('lines.slight');
    else linesText = t('lines.even');
  }

  // Viewing distance (focus range), "Text looks sharpest for you between X and Y cm"
  /** @type {{text: string, recommendedCm: number|null}|null} */
  let viewingDistance = null;
  if (m.focus) {
    const near = m.focus.nearMm !== null ? Math.round(m.focus.nearMm / 10) : null;
    const far = m.focus.farMm !== null ? Math.round(m.focus.farMm / 10) : null;
    const parts = [];
    if (near !== null && far !== null && far > near) parts.push(t('distance.range', { near, far }));
    else if (near !== null && far === null) parts.push(t('distance.rangeOpen', { near }));
    else if (far !== null) parts.push(t('distance.farOnly', { far }));
    const rec = profile?.viewing?.recommendedDistanceMm;
    const recCm = isNum(rec) ? Math.round(rec / 10) : null;
    if (recCm !== null) parts.push(t('distance.recommend', { cm: recCm }));
    if (parts.length) viewingDistance = { text: parts.join(' '), recommendedCm: recCm };
  }

  // Flags
  const flags = (Array.isArray(profile?.flags) ? profile.flags : []).map((f) => {
    const d = describeFlag(f, lg);
    return { level: d.level, code: d.code, title: d.title, body: d.body };
  });

  // Recommendations (what to do)
  const sys = profile?.system;
  const codes = new Set(flags.map((f) => f.code));
  const recommendations = [];
  recommendations.push(needPct > 105 ? t('rec.textSize', { pct: needPct }) : t('rec.textStandard'));
  if (sys?.boldText) recommendations.push(t('rec.bold'));
  if (sys?.increaseContrast) recommendations.push(t('rec.contrast'));
  if (sys?.magnificationShortcut) recommendations.push(t('rec.magnifier'));
  if (filterRecommended) recommendations.push(t('rec.colour'));
  if (sys?.reduceWhitePoint) recommendations.push(t('rec.dim'));
  const rec = profile?.viewing?.recommendedDistanceMm;
  if (isNum(rec) && Math.abs(rec - m.habitualMm) / m.habitualMm > 0.15) recommendations.push(t('rec.distance', { cm: Math.round(rec / 10) }));
  if (codes.has('NEAR_ACUITY_REDUCED') || codes.has('NEAR_FOCUS_FAR')) recommendations.push(t('rec.readingGlasses'));
  recommendations.push(t('rec.guide'));

  return {
    eyes,
    textSizePx,
    textSizeLabel,
    contrast: { level: cLevel, text: cText },
    colour: { text: colourText, filterRecommended },
    lineSharpness: { text: linesText },
    viewingDistance,
    flags,
    recommendations,
    disclaimer: t('disclaimer'),
  };
}

/** @param {number} v @param {number} [dp] */
const fx = (v, dp = 2) => (isNum(v) ? v.toFixed(dp) : '–');

/**
 * Clinical values for the optional, hidden "technical details" panel (item 62). Clearly labelled as a screen test.
 * @param {VisionProfile} profile @param {Lang|string} lang
 * @returns {Array<{label: string, value: string}>}
 */
export function technicalDetails(profile, lang) {
  const lg = langOf(lang);
  const t = makeT(TECH_STRINGS, lg);
  const ts = makeT(SUMMARY_STRINGS, lg);
  const input = profile?.input;
  const m = deriveMetrics(input);
  const cm = Math.round((m.testDistanceMm ?? m.habitualMm) / 10);
  /** @type {Array<{label: string, value: string}>} */
  const rows = [{ label: t('note'), value: t('noteValue', { cm }) }];

  for (const eye of /** @type {const} */ (['right', 'left', 'both'])) {
    const e = m.eyes[eye];
    if (!e) continue;
    const bits = [`logMAR ${fx(e.L)}`, `Snellen ${snellen6(e.L)} (${snellen20(e.L)})`, `decimal ${fx(decimalFromLogMAR(e.L))}`];
    if (e.distanceMm) bits.push(`@ ${Math.round(e.distanceMm)} mm`);
    if (e.floorLimited) bits.push(t('floor'));
    if (e.ceilingLimited) bits.push(t('ceiling'));
    if (!e.reliable) bits.push(t('unreliable'));
    rows.push({ label: t('acuity', { eye: ts(`eye.${eye}`) }), value: bits.join(' · ') });
  }
  const rd = input?.reading;
  if (rd && isNum(rd.criticalPrintSizeLogMAR)) {
    const bits = [`CPS logMAR ${fx(rd.criticalPrintSizeLogMAR)}`];
    if (isNum(rd.readingAcuityLogMAR)) bits.push(`RA ${fx(rd.readingAcuityLogMAR)}`);
    if (isNum(rd.maxReadingSpeedWpm)) bits.push(`MRS ${Math.round(rd.maxReadingSpeedWpm)} wpm`);
    if (isNum(rd.distanceMm)) bits.push(`@ ${Math.round(rd.distanceMm)} mm`);
    if (rd.reliable === false) bits.push(t('unreliable'));
    rows.push({ label: t('reading'), value: bits.join(' · ') });
  }
  const cs = input?.contrast;
  if (cs && isNum(cs.logCS)) rows.push({ label: t('contrast'), value: `logCS ${fx(cs.logCS)}${cs.reliable === false ? ` · ${t('unreliable')}` : ''}` });
  const col = input?.color;
  if (col && typeof col.type === 'string') {
    const bits = [`${col.type}`, `severity ${fx(col.severity)}`];
    if (isNum(col.confidence)) bits.push(`confidence ${fx(col.confidence)}`);
    if (col.reliable === false) bits.push(t('unreliable'));
    rows.push({ label: t('colour'), value: bits.join(' · ') });
  }
  for (const eye of /** @type {const} */ (['right', 'left'])) {
    const a = input?.astigmatism?.[eye];
    if (!a) continue;
    const value = a.suspected
      ? `axis ${isNum(a.axisDeg) ? `${Math.round(a.axisDeg)}°` : '–'} · ${a.consistent ? t('consistent') : t('inconsistent')}`
      : t('none');
    rows.push({ label: t('dial', { eye: ts(`eye.${eye}`) }), value });
  }
  if (m.focus) {
    const bits = [`near point ${m.focus.nearMm !== null ? `${Math.round(m.focus.nearMm)} mm` : '–'}`,
      `far point ${m.focus.farMm !== null ? `${Math.round(m.focus.farMm)} mm` : '> 650 mm'}`];
    if (m.focus.ampD !== null) bits.push(`amplitude ≈ ${fx(m.focus.ampD, 1)} D`);
    rows.push({ label: t('focus'), value: bits.join(' · ') });
  }
  if (isNum(profile?.viewing?.recommendedDistanceMm)) rows.push({ label: t('recDistance'), value: `${profile.viewing.recommendedDistanceMm} mm` });
  if (profile?.text) rows.push({ label: t('text'), value: `${fx(profile.text.baseFontPx, 1)} px · ×${fx(profile.text.scale)} · ${profile.text.fontWeight}` });
  const sc = input?.screen;
  if (sc) rows.push({ label: t('screen'), value: `${sc.method || '–'} · ${fx(sc.cssPxPerMm)} px/mm · dpr ${isNum(sc.dpr) ? sc.dpr : '–'}` });
  const dc = input?.distance;
  if (dc) rows.push({ label: t('distance'), value: `${dc.method || '–'} · ${isNum(dc.distanceMm) ? Math.round(dc.distanceMm) : '–'} mm` });
  const wc = input?.wearsCorrection;
  rows.push({ label: t('correction'), value: wc === true ? t('yes') : wc === false ? t('no') : t('unknown') });
  return rows;
}

// @ts-check
/**
 * SYSTEM SETTINGS GUIDE — pure (no DOM). Maps a platform-neutral SystemSettingsTarget (engine/profile.js) onto
 * concrete OS menus and values from docs/research/vision-science.md §12 (iOS/iPadOS 26, Android 15–16 AOSP/Pixel,
 * Samsung One UI 7–8) and the §12.4 mapping rules (items 43–48).
 *
 * The body text size the guide aims for is `fs = textScale × 16` CSS px (1 px_css = 1 iOS pt ≈ 1 Android dp).
 * Beyond the spec tables, two widely documented paths are used for dark mode (iOS Display & Brightness >
 * Appearance; Samsung Display > Dark); everything else is verbatim from §12.
 */
import { makeT } from '../core/i18n.js';
import { GUIDE_STRINGS } from './strings/guide-strings.js';

/** @typedef {import('../core/types.js').Platform} Platform */
/** @typedef {import('../core/types.js').Lang} Lang */
/** @typedef {import('../core/types.js').GuideSection} GuideSection */
/** @typedef {import('../core/types.js').SystemSettingsTarget} SystemSettingsTarget */

/** iOS Larger Text steps and Body size in pt (item 43). Index 3 (Large, 17 pt) is the default. */
export const IOS_TEXT_STEPS = Object.freeze([
  { name: 'xSmall', pt: 14 }, { name: 'Small', pt: 15 }, { name: 'Medium', pt: 16 }, { name: 'Large', pt: 17 },
  { name: 'xLarge', pt: 19 }, { name: 'xxLarge', pt: 21 }, { name: 'xxxLarge', pt: 23 },
  { name: 'AX1', pt: 28 }, { name: 'AX2', pt: 33 }, { name: 'AX3', pt: 40 }, { name: 'AX4', pt: 47 }, { name: 'AX5', pt: 53 },
]);
export const IOS_DEFAULT_STEP = 3;
/** Android font scale steps and the dp that 16 sp body text becomes (item 44). Index 1 (1.0) is the default. */
export const ANDROID_FONT_STEPS = Object.freeze([
  { scale: 0.85, dp16: 13.6 }, { scale: 1.0, dp16: 16.0 }, { scale: 1.15, dp16: 18.1 }, { scale: 1.3, dp16: 20.2 },
  { scale: 1.5, dp16: 23.0 }, { scale: 1.8, dp16: 26.0 }, { scale: 2.0, dp16: 28.0 },
]);
export const ANDROID_DEFAULT_STEP = 1;
/** Rough gain of one Android "Display size" / Samsung "Screen zoom" step (+10–15 %, §12.4 [U]). */
const DISPLAY_STEP_GAIN = 1.125;
/** Beyond this Display-size gain, magnification is added on Android/Samsung (display size alone rarely reaches it). */
const DISPLAY_ZOOM_REACH = 1.3;
const TOL = 0.01;

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * iOS Larger Text step for a body size (item 43): smallest step with Body ≥ fs, never below Large.
 * @param {number} fsPx
 * @returns {{index: number, name: string, pt: number, accessibility: boolean, exceeds: boolean}}
 */
export function iosTextStep(fsPx) {
  const fs = isNum(fsPx) ? fsPx : 16;
  let index = IOS_TEXT_STEPS.findIndex((s) => s.pt >= fs - TOL);
  const exceeds = index === -1;
  if (exceeds) index = IOS_TEXT_STEPS.length - 1;
  index = Math.max(index, IOS_DEFAULT_STEP);
  const s = IOS_TEXT_STEPS[index];
  return { index, name: s.name, pt: s.pt, accessibility: index >= 7, exceeds };
}

/**
 * Android font-size step for a body size (item 44): smallest step whose 16 sp → dp value is ≥ fs, never below 1.0.
 * @param {number} fsPx
 * @returns {{index: number, scale: number, dp: number, exceeds: boolean}}
 */
export function androidFontStep(fsPx) {
  const fs = isNum(fsPx) ? fsPx : 16;
  let index = ANDROID_FONT_STEPS.findIndex((s) => s.dp16 >= fs - TOL);
  const exceeds = index === -1;
  if (exceeds) index = ANDROID_FONT_STEPS.length - 1;
  index = Math.max(index, ANDROID_DEFAULT_STEP);
  const s = ANDROID_FONT_STEPS[index];
  return { index, scale: s.scale, dp: s.dp16, exceeds };
}

/** Number of Display size / Screen zoom steps for a gain (≥ 1). @param {number} zoom */
export function displaySizeSteps(zoom) {
  if (!isNum(zoom) || zoom <= 1 + TOL) return 0;
  return Math.max(1, Math.ceil(Math.log(zoom) / Math.log(DISPLAY_STEP_GAIN) - 1e-9));
}

/**
 * Detect the platform from the user agent (plus maxTouchPoints for iPadOS in desktop mode, and an optional UA-CH
 * model string, since Chrome's reduced UA hides the Samsung "SM-" model).
 * @param {string} userAgent @param {number} [maxTouchPoints] @param {string} [model]
 * @returns {Platform}
 */
export function detectPlatform(userAgent, maxTouchPoints = 0, model = '') {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const touch = isNum(maxTouchPoints) ? maxTouchPoints : 0;
  if (/\biPad\b/.test(ua)) return 'ipados';
  if (/\b(iPhone|iPod)\b/.test(ua)) return 'ios';
  if (/\bMacintosh\b/.test(ua) && touch > 1) return 'ipados'; // iPadOS 13+ "desktop" Safari UA
  if (/\bAndroid\b/i.test(ua)) {
    if (/SamsungBrowser\//i.test(ua) || /\bSM-[A-Z]\d/i.test(ua) || /^SM-[A-Z]\d/i.test(String(model || ''))) return 'samsung';
    return 'android';
  }
  if (/\b(Windows NT|Macintosh|Mac OS X|CrOS|X11|Linux x86_64)\b/.test(ua)) return 'desktop';
  return 'other';
}

/**
 * @param {SystemSettingsTarget & {contrastLevel?: 'medium'|'high'}} target
 * @param {Platform} platform
 * @param {Lang} lang
 * @returns {GuideSection[]}
 */
export function buildSystemGuide(target, platform, lang) {
  const t = makeT(GUIDE_STRINGS, lang === 'en' ? 'en' : 'he');
  const tg = normaliseTarget(target);
  const fs = tg.textScale * 16;
  const pct = Math.round(tg.textScale * 100);
  const note = (/** @type {string} */ p) => t(`note.${p}`);
  const colourWhy = tg.colorFilter ? t(tg.colorFilter.type === 'tritan' ? 'why.colour.blueYellow' : 'why.colour.redGreen') : '';
  const intensityPct = tg.colorFilter ? Math.round(tg.colorFilter.intensity * 100) : 0;
  /** @type {GuideSection[]} */
  const out = [];
  /** @param {string} id @param {string} why @param {string[]} steps @param {boolean} recommended @param {string} [value] @param {string} [os] */
  const add = (id, why, steps, recommended, value, os = platform) => {
    /** @type {GuideSection} */
    const s = { id, title: t(`title.${id}`), why, steps: [...steps, note(os)], recommended };
    if (value) s.value = value;
    out.push(s);
  };

  if (platform === 'ios' || platform === 'ipados') {
    const base = [t('ios.open'), t('ios.accessibility'), t('ios.displayText')];
    const step = iosTextStep(fs);
    const changed = step.index > IOS_DEFAULT_STEP;
    const pos = step.index + 1;
    const value = !changed ? t('ios.value.default', { name: step.name })
      : step.accessibility ? t('ios.value.ax', { name: step.name, pos, pt: step.pt }) : t('ios.value.std', { name: step.name, pos, pt: step.pt });
    const textSteps = [...base, t('ios.largerText')];
    if (step.accessibility) textSteps.push(t('ios.largerAx'));
    if (changed) textSteps.push(t('ios.slider', { pos, total: step.accessibility ? 12 : 7 }));
    const why = step.exceeds ? t('why.textMax', { pct }) : changed ? t('why.text', { pct }) : t('why.textDefault');
    add('text-size', why, textSteps, changed, value);
    if (tg.boldText) add('bold-text', t('why.bold'), [...base, t('ios.boldText')], true, t('value.on'));
    if (tg.increaseContrast) {
      const steps = [...base, t('ios.increaseContrast')];
      if (tg.contrastLevel === 'high') steps.push(t('ios.reduceTransparency'));
      add('contrast', t('why.contrast'), steps, true, t('value.on'));
    }
    if (tg.colorFilter) {
      add('color-filter', colourWhy, [...base, t('ios.colorFilters'), t('ios.choose', { option: t(`ios.option.${tg.colorFilter.type}`) }),
        t('ios.intensity', { pct: intensityPct })], false, `"${t(`ios.option.${tg.colorFilter.type}`)}" · ${t('value.intensity', { pct: intensityPct })}`);
    }
    if (tg.reduceWhitePoint) add('white-point', t('why.whitePoint'), [...base, t('ios.whitePoint'), t('ios.whitePointValue')], true, t('value.whitePoint'));
    if (tg.magnificationShortcut || step.exceeds) {
      add('zoom', t('why.zoom'), [t('ios.open'), t('ios.accessibility'), t('ios.zoomMenu'), t('ios.zoomMax'), t('ios.zoomUse'), t('ios.magnifier')], true, t('value.zoom'));
    }
    if (tg.darkMode) add('dark-mode', t('why.dark'), [t('ios.open'), t('ios.displayBrightness'), t('ios.dark')], true, t('value.dark'));
    return out;
  }

  if (platform === 'android' || platform === 'samsung') {
    const sam = platform === 'samsung';
    const step = androidFontStep(fs);
    const changed = step.index > ANDROID_DEFAULT_STEP;
    const stepPct = Math.round(step.scale * 100);
    const needsDisplay = tg.displayZoom > 1 + TOL || step.exceeds;
    const displayZoom = Math.max(tg.displayZoom, step.exceeds ? fs / step.dp : 1);
    const nDisplay = Math.max(1, displaySizeSteps(displayZoom));
    const displayMax = displayZoom > DISPLAY_ZOOM_REACH + TOL;
    const why = step.exceeds ? t('why.textMax', { pct }) : changed ? t('why.text', { pct }) : t('why.textDefault');
    const aBase = [t('and.open'), t('and.accessibility')];
    const sDisplay = [t('sam.open'), t('sam.display')];
    const sVision = [t('sam.open'), t('sam.accessibility'), t('sam.vision')];

    if (sam) {
      const steps = [...sDisplay, t('sam.fontStyle')];
      if (changed) steps.push(t('sam.fontSize', { pct: stepPct }));
      add('text-size', why, steps, changed, changed ? t('sam.value.size', { pct: stepPct }) : t('sam.value.default'));
    } else {
      const steps = [...aBase, t('and.displayText')];
      if (changed) steps.push(t('and.fontSize', { pos: step.index + 1, pct: stepPct }));
      add('text-size', why, steps, changed, changed ? t('and.value.step', { pos: step.index + 1, pct: stepPct }) : t('and.value.default'));
    }
    if (needsDisplay) {
      const value = displayMax ? t('and.value.displaySizeMax') : t('and.value.displaySize', { n: nDisplay });
      const steps = sam
        ? [...sDisplay, displayMax ? t('sam.screenZoomMax') : t('sam.screenZoom', { n: nDisplay })]
        : [...aBase, t('and.displayText'), displayMax ? t('and.displaySizeMax') : t('and.displaySize', { n: nDisplay })];
      add('display-size', t('why.displaySize'), steps, true, value);
    }
    if (tg.boldText) {
      add('bold-text', t('why.bold'), sam ? [...sDisplay, t('sam.fontStyle'), t('sam.boldFont')] : [...aBase, t('and.displayText'), t('and.boldText')], true, t('value.on'));
    }
    if (tg.increaseContrast) {
      const high = tg.contrastLevel === 'high';
      if (sam) {
        add('contrast', high ? t('why.contrast') : t('why.contrastOptional'), [...sVision, t('sam.highContrastFonts')], high, t('value.on'));
      } else {
        const level = t(high ? 'and.level.high' : 'and.level.medium');
        const steps = [...aBase, t('and.colorMotion'), t('and.colorContrast', { level })];
        if (high) steps.push(t('and.highContrastText'));
        add('contrast', t('why.contrast'), steps, true, level);
      }
    }
    if (tg.colorFilter) {
      const type = tg.colorFilter.type;
      if (sam) {
        add('color-filter', colourWhy, [...sVision, t('sam.colorCorrection'), t('sam.choose', { option: t(`sam.option.${type}`) }),
          t('sam.intensity', { pct: intensityPct })], false, `${t(`sam.option.${type}`)} · ${t('value.intensity', { pct: intensityPct })}`);
      } else {
        const s = tg.colorFilter.intensity;
        const lvl = s < 0.34 ? 'low' : s < 0.67 ? 'medium' : 'high';
        add('color-filter', colourWhy, [...aBase, t('and.colorMotion'), t('and.colorCorrection'), t('and.choose', { option: t(`and.option.${type}`) }),
          t('and.intensity', { level: t(`and.intensity.${lvl}`) })], false, `"${t(`and.option.${type}`)}" · ${t(`and.intensity.${lvl}`)}`);
      }
    }
    if (tg.reduceWhitePoint) {
      add('white-point', t('why.whitePoint'), sam ? [...sVision, t('sam.extraDim')] : [...aBase, t('and.extraDim')], true, t('value.on'));
    }
    if (tg.magnificationShortcut || displayMax) {
      add('zoom', t('why.zoom'), sam ? [...sVision, t('sam.magnification')] : [...aBase, t('and.magnification'), t('and.magShortcut')], true, t('value.on'));
    }
    if (tg.darkMode) {
      add('dark-mode', t('why.dark'), sam ? [...sDisplay, t('sam.dark')] : [...aBase, t('and.colorMotion'), t('and.darkTheme')], true, t('value.dark'));
    }
    return out;
  }

  // desktop / other: browser zoom only
  const changed = pct > 105;
  add('text-size', changed ? t('why.text', { pct }) : t('why.textDefault'), [t('desk.zoom', { pct }), t('desk.phone')], changed,
    t('desk.value', { pct }), 'desktop');
  return out;
}

/**
 * Coerce a possibly partial/malformed target into safe values.
 * @param {any} target
 * @returns {SystemSettingsTarget & {contrastLevel?: 'medium'|'high'}}
 */
function normaliseTarget(target) {
  const g = target && typeof target === 'object' ? target : {};
  const cf = g.colorFilter;
  const type = cf && (cf.type === 'protan' || cf.type === 'deutan' || cf.type === 'tritan') ? cf.type : null;
  return {
    textScale: isNum(g.textScale) ? Math.min(8, Math.max(1, g.textScale)) : 1,
    boldText: !!g.boldText,
    increaseContrast: !!g.increaseContrast,
    contrastLevel: g.contrastLevel === 'high' ? 'high' : 'medium',
    colorFilter: type ? { type, intensity: isNum(cf.intensity) ? Math.min(1, Math.max(0, cf.intensity)) : 0.5 } : null,
    reduceWhitePoint: !!g.reduceWhitePoint,
    darkMode: !!g.darkMode,
    displayZoom: isNum(g.displayZoom) ? Math.max(1, g.displayZoom) : 1,
    magnificationShortcut: !!g.magnificationShortcut,
  };
}

// @ts-check
/**
 * #/results — functional, plain-language results for the active profile; flags with eye-care advice;
 * technical values only behind FEATURES.showTechnicalValues (collapsed). Print-friendly via window.print().
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { getActiveProfile } from '../core/storage.js';
import { SCREEN_STRINGS } from './strings.js';
import { FLOW_STRINGS } from '../flows/strings.js';
import { brandName, FEATURES } from '../shell/brand.js';
import { formatDate, formatCm, formatFixed } from '../shell/format.js';
import { icon } from '../shell/icons.js';
import { linkButton, actionButton, card, emptyState, notice, pageHeader } from '../shell/components.js';
import { loadModule } from '../shell/modules.js';
import { eyeSummaries, textScalePercent, colorFinding, contrastBand, sortFlags, glassesFreeInfo } from './summary.js';
import { isMinor } from '../flows/onboarding-plan.js';
import { describeFlag } from './flag-messages.js';
import { RX_FIELDS, formatRxValue } from '../flows/rx.js';

/** @typedef {import('../core/types.js').ProfileFlag} ProfileFlag */
/** @typedef {import('../core/types.js').GlassesFreeAssessment} GlassesFreeAssessment */
/** @typedef {{title: string, body: string, tips: string[]}} GlassesFreeText */

/**
 * The engine's own glasses-free wording (engine/summary.js describeGlassesFree), when that export exists.
 * @param {GlassesFreeAssessment|null} assessment @param {import('../core/types.js').Lang} lang
 * @returns {Promise<GlassesFreeText|null>}
 */
async function engineGlassesFreeText(assessment, lang) {
  if (!assessment) return null;
  const res = await loadModule('engineSummary');
  const fn = res.ok ? res.mod.describeGlassesFree : null;
  if (typeof fn !== 'function') return null;
  try {
    const r = fn(assessment, lang);
    if (!r || typeof r !== 'object') return null;
    const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.trim() : '');
    const tips = Array.isArray(r.tips) ? r.tips.map(str).filter(Boolean) : [];
    if (!str(r.title) && !str(r.body)) return null;
    return { title: str(r.title), body: str(r.body), tips };
  } catch (err) {
    console.warn('describeGlassesFree failed', err);
    return null;
  }
}

/**
 * "Your screen without glasses": verdict in plain words, where to hold the phone, the sharp range, tips and, for
 * 'no', an honest "keep your glasses for long reading" message. Never shows clinical values.
 * @param {import('./summary.js').GlassesFreeInfo} info @param {GlassesFreeText|null} text
 * @param {(key: string, params?: Record<string, string|number>) => string} t @param {import('../core/types.js').Lang} lang
 */
function glassesFreeCard(info, text, t, lang) {
  const v = info.verdict || 'unknown';
  const cm = (/** @type {number} */ mm) => formatCm(mm, lang);
  /** @type {Array<Node|null>} */
  const children = [
    h('p', { class: `va-gf__verdict va-gf__verdict--${v}`, 'data-testid': 'gf-verdict', 'data-verdict': v },
      icon(v === 'no' ? 'info' : 'check', { size: 20 }), h('span', null, t(`gf.badge.${v}`))),
    text?.title ? h('p', { class: 'va-gf__headline' }, text.title) : null,
    h('p', { class: 'va-text' }, text?.body || t(`gf.text.${v}`)),
  ];
  if (info.distanceMm) {
    children.push(h('p', { class: 'va-gf__distance', 'data-testid': 'gf-distance' },
      icon('phone', { size: 28 }), h('span', null, t('gf.distance', { cm: cm(info.distanceMm) }))));
  }
  if (info.sharpFromMm && (info.sharpToMm || info.sharpToBeyond)) {
    children.push(h('p', { class: 'va-result-line', 'data-testid': 'gf-range' }, info.sharpToMm
      ? t('gf.range', { from: cm(info.sharpFromMm), to: cm(info.sharpToMm) })
      : t('gf.rangeBeyond', { from: cm(info.sharpFromMm) })));
  }
  if (v === 'no') children.push(notice('warning', t('gf.no'), { testId: 'gf-no', iconName: 'glasses' }));
  const tips = text?.tips?.length ? text.tips
    : ['gf.tip.guide', ...(info.distanceMm ? ['gf.tip.coach'] : []), 'gf.tip.light', 'gf.tip.breaks'].map((k) => t(k));
  children.push(h('h3', { class: 'va-gf__tips-title' }, t('gf.tipsTitle')),
    h('ul', { class: 'va-checklist va-gf__tips', 'data-testid': 'gf-tips' }, tips.map((x) => h('li', null, icon('sparkle', { size: 20 }), h('span', null, x)))),
    h('p', { class: 'va-hint', 'data-testid': 'gf-honest' }, t('gf.honest')));
  return card({ title: t('gf.title'), iconName: 'glasses', testId: 'results-glasses-free', className: `va-card--full va-gf va-gf--${v}`, children });
}

/**
 * Pilot study hook: a tester session (public/pilot/session.html) sets localStorage 'va.pilot.active' =
 * {code, returnUrl, startedAt} before opening the check; offer the way back. Same-origin pilot page only, < 24 h old.
 * @param {(key: string, params?: Record<string, string|number>) => string} t
 */
function pilotContinue(t) {
  /** @type {any} */
  let marker = null;
  try { marker = JSON.parse(localStorage.getItem('va.pilot.active') || 'null'); } catch { return null; }
  if (!marker || typeof marker.returnUrl !== 'string' || typeof marker.code !== 'string') return null;
  const started = Date.parse(marker.startedAt);
  if (!Number.isFinite(started) || Date.now() - started > 86_400_000) return null;
  let url;
  try { url = new URL(marker.returnUrl, location.href); } catch { return null; }
  if (url.origin !== location.origin || !url.pathname.endsWith('/pilot/session.html')) return null;
  return notice('info', t('pilot.continueBody', { code: marker.code.slice(0, 12) }), {
    title: t('pilot.continueTitle'), testId: 'results-pilot', iconName: 'forward',
    actions: [linkButton(t('pilot.continue'), url.href, { testId: 'results-pilot-continue', iconName: 'forward' })],
  });
}

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export async function mount(ctx) {
  const t = makeT(SCREEN_STRINGS, ctx.lang);
  const tf = makeT(FLOW_STRINGS, ctx.lang);
  const lang = ctx.lang;
  const profile = getActiveProfile();
  if (!profile) {
    return {
      el: h('div', { class: 'va-page', 'data-testid': 'screen-results' }, emptyState({
        iconName: 'results', title: t('results.none'), body: t('results.noneBody'), testId: 'results-empty',
        actions: [linkButton(t('results.start'), '#/onboarding')],
      })),
    };
  }

  // Prefer the engine's own flag wording when it offers one.
  /** @type {((flag: ProfileFlag, lang: string) => any)|null} */
  let engineDescribe = null;
  const eng = await loadModule('profile');
  if (eng.ok) engineDescribe = typeof eng.mod.describeFlag === 'function' ? eng.mod.describeFlag : typeof eng.mod.flagMessage === 'function' ? eng.mod.flagMessage : null;
  /** @param {ProfileFlag} f */
  const flagText = (f) => {
    const mine = describeFlag(f, lang);
    if (engineDescribe) {
      try {
        const r = engineDescribe(f, lang);
        const text = typeof r === 'string' ? r : r?.text || r?.message || r?.title;
        if (text) return { ...mine, text: String(text) };
      } catch { /* fall back to our wording */ }
    }
    return mine;
  };

  const input = profile.input || /** @type {any} */ ({});
  const distanceMm = input.distance?.distanceMm;
  const sections = [];

  const gfInfo = glassesFreeInfo(profile);
  const gfCard = gfInfo ? glassesFreeCard(gfInfo, await engineGlassesFreeText(gfInfo.assessment, lang), t, lang) : null;
  // Built with glasses: offer the glasses-free check to adults (never to children).
  const tryGlassesFree = !gfInfo && input.wearsCorrection === true && !isMinor(input.age)
    ? notice('info', t('gf.tryBody'), {
      title: t('gf.tryTitle'), testId: 'results-try-glasses-free', iconName: 'glasses',
      actions: [linkButton(t('gf.tryLink'), `#/onboarding?retest=${encodeURIComponent(profile.id)}`, { variant: 'secondary', iconName: 'retest' })],
    })
    : null;

  const flags = sortFlags(profile.flags || []);
  if (flags.length) {
    sections.push(card({
      title: t('results.flagsTitle'), iconName: 'info', testId: 'results-flags', className: 'va-card--full',
      children: h('ul', { class: 'va-flags' }, flags.map((f) => {
        const d = flagText(f);
        return h('li', { class: `va-flag va-flag--${d.level}`, 'data-testid': `flag-${f.code}` },
          icon(d.level === 'info' ? 'info' : 'warning', { size: 22 }),
          h('div', null, h('p', { class: 'va-flag__text' }, d.text), d.advice ? h('p', { class: 'va-flag__advice' }, d.advice) : null));
      })),
    }));
  }

  // Detail per eye
  const eyes = eyeSummaries(profile);
  sections.push(card({
    title: t('results.detailTitle'), iconName: 'eye', testId: 'results-detail',
    children: [
      h('p', { class: 'va-hint' }, t('results.detailLead')),
      h('div', { class: 'va-eyes' }, eyes.map((x) => h('div', { class: 'va-eye', 'data-testid': `eye-${x.eye}` },
        h('h3', { class: 'va-eye__name' }, t(x.eye === 'right' ? 'results.eyeRight' : 'results.eyeLeft')),
        x.score === null
          ? h('p', { class: 'va-muted' }, t('results.notMeasured'))
          : [
            h('div', { class: 'va-meter va-meter--score', role: 'img', 'aria-label': t('results.score', { score: x.score }) },
              h('span', { class: 'va-meter__bar' }, h('span', { class: 'va-meter__fill', style: { width: `${x.score}%` } }))),
            h('p', { class: 'va-eye__score' }, t('results.score', { score: x.score })),
            h('p', { class: 'va-eye__band' }, t(`detail.${x.band}`)),
            !x.reliable ? h('p', { class: 'va-hint' }, t('results.lessCertain')) : null,
            x.floorLimited ? h('p', { class: 'va-hint' }, t('results.floor')) : null,
          ],
        x.lines ? h('p', { class: 'va-eye__lines' }, h('strong', null, t('results.linesTitle') + ': '), t(`lines.${x.lines}`)) : null,
      ))),
    ],
  }));

  // Text & reading
  const pct = textScalePercent(profile.text?.scale);
  const textRows = [];
  if (pct) textRows.push(h('p', { class: 'va-result-line', 'data-testid': 'result-textsize' }, t('results.textSize', { pct, px: Math.round(profile.text.baseFontPx) })));
  if (input.reading?.maxReadingSpeedWpm) textRows.push(h('p', { class: 'va-result-line' }, t('results.readingSpeed', { wpm: Math.round(input.reading.maxReadingSpeedWpm) })));
  if (profile.viewing?.recommendedDistanceMm) textRows.push(h('p', { class: 'va-result-line' }, t('results.distance', { cm: formatCm(profile.viewing.recommendedDistanceMm, lang) })));
  if (textRows.length) sections.push(card({ title: t('results.textTitle'), iconName: 'reader', testId: 'results-text', children: textRows }));

  const cb = contrastBand(input.contrast?.logCS);
  sections.push(card({ title: t('results.contrastTitle'), iconName: 'sparkle', testId: 'results-contrast', children: h('p', { class: 'va-result-line' }, cb ? t(`contrast.${cb}`) : t('results.notMeasured')) }));

  const cf = colorFinding(input.color);
  sections.push(card({
    title: t('results.colorTitle'), iconName: 'photo', testId: 'results-color',
    children: [
      h('p', { class: 'va-result-line' }, cf ? `${t(`color.${cf.key}`)}${cf.degree ? ' ' + t(`degree.${cf.degree}`) : ''}` : t('results.notMeasured')),
      profile.system?.colorFilter ? h('p', { class: 'va-hint' }, t('results.colorFilter')) : null,
    ],
  }));

  if (input.focus && (input.focus.nearPointMm || input.focus.farPointMm)) {
    const parts = [];
    if (input.focus.nearPointMm) parts.push(t('results.focusNear', { cm: formatCm(input.focus.nearPointMm, lang) }));
    if (input.focus.farPointMm) parts.push(t('results.focusFar', { cm: formatCm(input.focus.farPointMm, lang) }));
    sections.push(card({ title: t('results.focusTitle'), iconName: 'magnifier', children: h('p', { class: 'va-result-line' }, parts.join(' ')) }));
  }

  if (input.rx && (input.rx.right || input.rx.left)) {
    sections.push(card({
      title: t('results.rxTitle'), iconName: 'receipt', testId: 'results-rx',
      children: h('div', { class: 'va-table-wrap' }, h('table', { class: 'va-table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, ''), ...RX_FIELDS.map((f) => h('th', { scope: 'col' }, tf(`rx.${f}`))))),
        h('tbody', null, /** @type {const} */ (['right', 'left']).map((eye) => h('tr', null,
          h('th', { scope: 'row' }, tf(`rx.${eye}`)),
          ...RX_FIELDS.map((f) => h('td', { dir: 'ltr' }, formatRxValue(f, input.rx?.[eye]?.[f]) || '–'))))))),
    }));
  }

  if (FEATURES.showTechnicalValues) {
    const tech = [];
    for (const x of eyes) {
      if (!x.acuity) continue;
      tech.push(h('p', null, h('strong', null, t(x.eye === 'right' ? 'results.eyeRight' : 'results.eyeLeft') + ': '),
        t('results.techAcuity', { logmar: formatFixed(x.acuity.logMAR, 2, lang), snellen: x.acuity.snellen6, decimal: formatFixed(x.acuity.decimal, 2, lang) })));
    }
    if (input.contrast) tech.push(h('p', null, t('results.techContrast', { cs: formatFixed(input.contrast.logCS, 2, lang) })));
    if (input.reading) tech.push(h('p', null, t('results.techReading', { cps: formatFixed(input.reading.criticalPrintSizeLogMAR, 2, lang) })));
    sections.push(h('details', { class: 'va-card va-details', 'data-testid': 'results-tech' },
      h('summary', null, t('results.techTitle', { cm: formatCm(distanceMm, lang) })), ...tech));
  }

  const el = h('div', { class: 'va-page va-page--wide va-results', 'data-testid': 'screen-results' },
    h('div', { class: 'va-print-head', 'aria-hidden': 'true' },
      h('p', { class: 'va-print-head__brand' }, brandName(lang)),
      h('p', null, t('results.printedOn', { date: formatDate(new Date(), lang) }))),
    pageHeader({
      title: t('results.title'),
      lead: [t('results.lead', { name: profile.name, date: formatDate(profile.updatedAt, lang) }),
        input.wearsCorrection === true ? ' ' + t('results.withGlasses') : input.wearsCorrection === false ? ' ' + t('results.withoutGlasses') : ''],
    }),
    ctx.route.query.fresh ? notice('success', t('results.fresh'), { role: 'status', testId: 'results-fresh' }) : null,
    pilotContinue(t),
    gfCard,
    tryGlassesFree,
    h('div', { class: 'va-grid-2 va-results__grid' }, ...sections),
    notice('info', t('results.disclaimer'), { testId: 'results-disclaimer' }),
    h('div', { class: 'va-actions va-actions--row va-no-print' },
      actionButton(t('results.print'), { variant: 'secondary', iconName: 'print', testId: 'results-print', onClick: () => window.print() }),
      linkButton(t('results.retest'), `#/onboarding?retest=${encodeURIComponent(profile.id)}`, { variant: 'secondary', iconName: 'retest' }),
      linkButton(t('results.adapt'), '#/guide', { iconName: 'phone' }),
    ),
  );
  return { el };
}

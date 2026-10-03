// @ts-check
/**
 * Pilot study — the guided tester session (public/pilot/session.html).
 * consent -> background -> practice -> (1) reading WITH glasses (optional) -> (2) reading WITHOUT glasses at normal
 * phone text -> (3) the SeeTuned check in the app (glasses off) -> back here -> (4) reading WITHOUT glasses with the
 * SeeTuned profile applied -> final questions -> summary + results code.
 * Progress is kept in localStorage (draft), so the round trip to the app and reloads are safe.
 */
import { h, clear } from '../../app/js/core/dom.js';
import { makeT, dirFor } from '../../app/js/core/i18n.js';
import { getActiveProfile, getProfile, deleteProfile, clearDraft as clearAppDraft } from '../../app/js/core/storage.js';
import { applyProfileToDocument } from '../../app/js/render/apply-ui.js';
import { APP_VERSION } from '../../app/js/shell/brand.js';
import { PASSAGES } from './passages.js';
import { PILOT_STRINGS } from './strings.js';
import * as core from './pilot-core.js';
import * as store from './pilot-store.js';
import { button, linkButton, choiceGroup, scale5, copyText, liveRegion } from './ui.js';

/** @typedef {import('./pilot-core.js').PilotSession} PilotSession */
/** @typedef {'withGlasses'|'withoutGlasses'|'seetuned'} Cond */
/** @typedef {{session: PilotSession, step: string, appStartedAt: number|null, profileId: string|null}} Draft */

const APP_PAGE = '../app/index.html';
const TOTAL_STEPS = 7;
/** @type {Record<string, number>} */
const STEP_NUMBER = { consent: 1, background: 2, practice: 3, withGlasses: 3, withoutGlasses: 4, app: 5, return: 5, seetuned: 6, final: 7 };

/** @param {string} name */
function meta(name) {
  return /** @type {HTMLMetaElement|null} */ (document.querySelector(`meta[name="${name}"]`))?.content || '';
}
const ENV = meta('va-pilot-env') === 'demo' ? 'demo' : 'server';
const HUB_URL = meta('va-pilot-hub') || 'hub.html';

const top = /** @type {HTMLElement} */ (document.getElementById('pilot-top'));
const main = /** @type {HTMLElement} */ (document.getElementById('pilot-root'));

/** @type {'he'|'en'} */
let lang = initialLang();
let t = makeT(PILOT_STRINGS, lang);
/** @type {Draft|null} */
let draft = null;
/** Current screen id ('consent', a step, or 'done'...) for the header. */
let current = 'consent';

function initialLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'he' || q === 'en') return q;
    const saved = localStorage.getItem('va.lang');
    if (saved === 'he' || saved === 'en') return saved;
  } catch { /* storage blocked */ }
  return 'he';
}

/** @param {'he'|'en'} l */
function setLang(l) {
  lang = l;
  t = makeT(PILOT_STRINGS, lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = dirFor(lang);
  document.title = `${t('pilot')} · SeeTuned`;
  try { localStorage.setItem('va.lang', lang); } catch { /* ignore */ }
}

function random01() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}
/** @param {number} n */
function randomToken(n) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += a[Math.floor(random01() * a.length)];
  return s;
}

function deviceInfo() {
  const w = Math.round(window.screen?.width || 0);
  const hgt = Math.round(window.screen?.height || 0);
  return {
    screenW: w >= 100 ? w : null, screenH: hgt >= 100 ? hgt : null,
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    ua: core.uaFamily(navigator.userAgent, navigator.maxTouchPoints || 0),
  };
}

/** @returns {PilotSession} */
function newSession() {
  const code = core.newTesterCode(random01, store.loadSessions().map((s) => s.code));
  return {
    v: 1, code, status: 'stopped', consentVersion: core.CONSENT_VERSION, lang, env: ENV,
    startedAt: new Date().toISOString(), finishedAt: null,
    background: { ageBand: null, correction: null, rx: null, holding: null, deviceModel: '' },
    withGlassesSkipped: null,
    conditions: { withGlasses: null, withoutGlasses: null, seetuned: null },
    profile: null,
    final: { comfortable: null, wouldUse: null, comment: '' },
    appVersion: APP_VERSION, device: deviceInfo(),
  };
}

function persist() {
  if (draft) store.saveDraft(draft);
}

/** @param {string} step */
function go(step) {
  if (!draft) return;
  draft.step = step;
  persist();
  render();
}

// ---------------------------------------------------------------------------------------------------------
// Frame: header (brand, progress, language, stop) and page mounting.

function renderTop() {
  clear(top);
  const n = STEP_NUMBER[current];
  const canSwitchLang = current === 'consent' || current === 'background';
  const other = /** @type {'he'|'en'} */ (t('lang.otherCode'));
  top.append(
    h('div', { class: 'p-top__brand' },
      h('img', { src: '../brand/logo-mark.svg', alt: 'SeeTuned', width: 32, height: 32 }),
      h('strong', null, t('pilot'))),
    h('div', { class: 'p-top__tools' },
      n ? h('span', { class: 'p-top__progress', 'data-testid': 'pilot-progress' }, t('progress', { n, total: TOTAL_STEPS })) : null,
      canSwitchLang ? button(t('lang.other'), {
        variant: 'ghost', testId: 'pilot-lang', className: 'p-btn--small',
        onClick: () => { setLang(other); if (draft) { draft.session.lang = lang; persist(); } render(); },
      }) : null,
      draft && current !== 'consent' ? button(t('stop'), { variant: 'ghost', testId: 'pilot-stop', className: 'p-btn--small', onClick: showStopPanel }) : null,
    ),
  );
  const btn = top.querySelector('[data-testid="pilot-lang"]');
  if (btn) { btn.setAttribute('lang', other); btn.setAttribute('dir', dirFor(other)); }
}

/** @param {string} id @param {string} title @param {...any} children */
function mount(id, title, ...children) {
  current = id;
  renderTop();
  clear(main);
  const h1 = h('h1', { class: 'p-title', tabindex: '-1' }, title);
  main.append(h('section', { class: 'p-screen', 'data-testid': `pilot-${id}` }, h1, ...children));
  window.scrollTo(0, 0);
  h1.focus({ preventScroll: true });
}

function render() {
  if (!draft) { renderConsent(); return; }
  const step = draft.step;
  if (step === 'background') renderBackground();
  else if (step === 'practice') renderPractice();
  else if (step === 'withGlasses' || step === 'withoutGlasses' || step === 'seetuned') renderCondition(step);
  else if (step === 'app') renderApp();
  else if (step === 'return') renderReturn();
  else if (step === 'final') renderFinal();
  else renderBackground();
}

// ---------------------------------------------------------------------------------------------------------
// Stop / withdraw (in-page confirmation; no window.confirm).

function showStopPanel() {
  if (!draft || main.querySelector('[data-testid="stop-panel"]')) return;
  const panel = h('div', { class: 'p-panel p-panel--warn', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'stop-title', 'data-testid': 'stop-panel' },
    h('h2', { id: 'stop-title' }, t('stop.title')),
    h('p', null, t('stop.body')),
    h('div', { class: 'p-actions' },
      button(t('stop.cancel'), { testId: 'stop-cancel', onClick: () => panel.remove() }),
      button(t('stop.save'), { variant: 'secondary', testId: 'stop-save', onClick: () => void stopAndSave() }),
      button(t('stop.delete'), { variant: 'danger', testId: 'stop-delete', onClick: withdraw }),
    ));
  main.prepend(panel);
  window.scrollTo(0, 0);
  /** @type {HTMLElement|null} */ (panel.querySelector('button'))?.focus();
}

function endSession() {
  store.clearDraft();
  store.clearMarker();
  applyProfileToDocument(null);
}

async function stopAndSave() {
  if (!draft) return;
  const s = draft.session;
  s.status = 'stopped';
  s.finishedAt = new Date().toISOString();
  const clean = core.sanitizeSession(s);
  const saved = clean ? store.saveSession(clean) : false;
  const profileId = draft.profileId;
  endSession();
  draft = null;
  mount('stopped', t('stopped.title'), h('p', { class: 'p-lead' }, t('stopped.body')),
    clean ? resultsCodeBlock(clean) : null,
    !saved ? h('p', { class: 'p-alert', role: 'alert' }, t('final.saveFailed')) : null,
    removeProfileBlock(profileId),
    endLinks());
}

function withdraw() {
  endSession();
  draft = null;
  mount('deleted', t('deleted.title'), h('p', { class: 'p-lead' }, t('deleted.body')), endLinks());
}

function endLinks() {
  return h('div', { class: 'p-actions' },
    linkButton(t('done.new'), 'session.html', { testId: 'pilot-new', variant: 'secondary' }),
    linkButton(t('done.hub'), HUB_URL, { testId: 'pilot-hub-link', variant: 'secondary' }));
}

// ---------------------------------------------------------------------------------------------------------
// 1. Consent

function renderConsent() {
  const status = h('p', { class: 'p-alert', role: 'alert', hidden: true, 'data-testid': 'consent-error' });
  /** @param {string} id @param {any} label */
  const check = (id, label) => h('label', { class: 'p-check', for: id },
    h('input', { type: 'checkbox', id, 'data-testid': id }), h('span', null, label));
  const legal = (/** @type {string} */ doc) => (lang === 'en' ? `../legal/en/${doc}.html` : `../legal/${doc}.html`);
  mount('consent', t('consent.title'),
    h('p', { class: 'p-lead' }, t('consent.lead')),
    h('ul', { class: 'p-list' },
      h('li', null, t('consent.what')),
      h('li', null, t('consent.measured')),
      h('li', null, t('consent.anon')),
      h('li', null, t('consent.time')),
      h('li', null, t('consent.stop')),
      h('li', null, h('strong', null, t('consent.medical')))),
    h('p', { class: 'p-note' }, t('consent.facilitator')),
    h('div', { class: 'p-checks' },
      check('consent-adult', t('consent.adult')),
      check('consent-agree', t('consent.agree')),
      check('consent-terms', [t('consent.terms'), ' (',
        h('a', { href: legal('terms'), target: '_blank', rel: 'noopener' }, t('consent.termsLink')), ', ',
        h('a', { href: legal('disclaimer'), target: '_blank', rel: 'noopener' }, t('consent.disclaimerLink')), ')'])),
    status,
    h('div', { class: 'p-actions' }, button(t('consent.start'), {
      testId: 'consent-start',
      onClick: () => {
        const ok = ['consent-adult', 'consent-agree', 'consent-terms'].every((id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).checked);
        if (!ok) { status.textContent = t('consent.missing'); status.hidden = false; return; }
        draft = { session: newSession(), step: 'background', appStartedAt: null, profileId: null };
        go('background');
      },
    })));
}

// ---------------------------------------------------------------------------------------------------------
// 2. Background

/** @param {string} raw @param {'sph'|'cyl'|'axis'|'add'} field @returns {number|null|undefined} undefined = invalid */
function parseRx(raw, field) {
  const s = String(raw || '').trim().replace(',', '.').replace(/^\+/, '');
  if (!s) return null;
  if (!/^-?\d{0,3}(\.\d{1,2})?$/.test(s)) return undefined;
  const n = Number(s);
  const [lo, hi] = core.RX_RANGES[field];
  if (!Number.isFinite(n) || n < lo || n > hi) return undefined;
  if (field === 'axis' && !Number.isInteger(n)) return undefined;
  return n;
}

function renderBackground() {
  if (!draft) return;
  const s = draft.session;
  const b = s.background;
  const error = h('p', { class: 'p-alert', role: 'alert', hidden: true, 'data-testid': 'bg-error' });
  const rxError = h('p', { class: 'p-alert', role: 'alert', hidden: true, 'data-testid': 'rx-error' }, t('rx.invalid'));
  /** @type {Record<string, HTMLInputElement>} */
  const rxInputs = {};
  const rxTable = h('div', { class: 'p-rx' }, ['right', 'left'].map((eye) => h('fieldset', { class: 'p-rx__eye' },
    h('legend', null, t(`rx.${eye}`)),
    core.RX_FIELDS.map((f) => {
      const id = `rx-${eye}-${f}`;
      const val = b.rx?.[eye]?.[f];
      const input = h('input', {
        id, type: 'text', inputmode: f === 'axis' ? 'numeric' : 'decimal', dir: 'ltr', autocomplete: 'off',
        maxlength: 6, value: val === null || val === undefined ? '' : String(val), 'data-testid': id,
      });
      rxInputs[id] = input;
      return h('label', { class: 'p-rx__field', for: id }, h('span', null, t(`rx.${f}`)), input);
    }))));
  const device = h('input', { id: 'bg-device', type: 'text', maxlength: 60, value: b.deviceModel || '', autocomplete: 'off', 'data-testid': 'bg-device', 'aria-describedby': 'bg-device-hint' });

  mount('background', t('bg.title'),
    h('p', { class: 'p-code', 'data-testid': 'tester-code' }, t('code.label', { code: s.code })),
    h('p', { class: 'p-lead' }, t('bg.lead')),
    choiceGroup({
      name: 'age', legend: t('bg.age'), value: b.ageBand, testId: 'bg-age', compact: true,
      options: core.AGE_BANDS.map((a) => ({ value: a, label: a === '75+' ? t('age.75+') : a })),
      onChange: (v) => { b.ageBand = v; error.hidden = true; persist(); },
    }),
    choiceGroup({
      name: 'correction', legend: t('bg.correction'), value: b.correction, testId: 'bg-correction',
      options: core.CORRECTIONS.map((c) => ({ value: c, label: t(`corr.${c}`) })),
      onChange: (v) => { b.correction = v; error.hidden = true; persist(); },
    }),
    h('details', { class: 'p-details', open: !!b.rx },
      h('summary', null, t('bg.rx')),
      h('p', { class: 'p-hint' }, t('bg.rxHint')),
      rxTable, rxError),
    choiceGroup({
      name: 'holding', legend: t('bg.holding'), value: b.holding, testId: 'bg-holding',
      options: core.HOLDING.map((x) => ({ value: x, label: t(`hold.${x}`) })),
      onChange: (v) => { b.holding = v; error.hidden = true; persist(); },
    }),
    h('div', { class: 'p-field' },
      h('label', { for: 'bg-device', class: 'p-legend' }, t('bg.device')),
      h('p', { class: 'p-hint', id: 'bg-device-hint' }, t('bg.deviceHint')),
      device),
    error,
    h('div', { class: 'p-actions' }, button(t('next'), {
      testId: 'bg-next',
      onClick: () => {
        error.hidden = true; rxError.hidden = true;
        /** @type {any} */
        const rx = { right: {}, left: {} };
        let rxOk = true; let any = false;
        for (const eye of ['right', 'left']) {
          for (const f of core.RX_FIELDS) {
            const v = parseRx(rxInputs[`rx-${eye}-${f}`].value, f);
            if (v === undefined) rxOk = false;
            rx[eye][f] = v ?? null;
            if (v !== null && v !== undefined) any = true;
          }
        }
        if (!rxOk) { rxError.hidden = false; rxError.scrollIntoView({ block: 'center' }); return; }
        const missing = [['bg-age', b.ageBand], ['bg-correction', b.correction], ['bg-holding', b.holding]].filter(([, v]) => !v);
        if (missing.length) {
          error.textContent = t('required');
          error.hidden = false;
          const first = /** @type {HTMLElement|null} */ (main.querySelector(`[data-testid="${missing[0][0]}"] input`));
          first?.focus();
          return;
        }
        b.rx = any ? rx : null;
        b.deviceModel = device.value.trim().slice(0, 60);
        go('practice');
      },
    })));
}

// ---------------------------------------------------------------------------------------------------------
// Reading task (practice and the three conditions)

/** @param {Cond} cond */
function passageFor(cond) {
  const s = /** @type {Draft} */ (draft).session;
  const idx = core.assignPassages(s.code)[cond];
  return PASSAGES[s.lang].passages[idx];
}

function howToList() {
  return h('ol', { class: 'p-list p-list--steps' }, h('li', null, t('read.how1')), h('li', null, t('read.how2')), h('li', null, t('read.how3')));
}

/**
 * Show Start -> passage -> Done. Resolves with the reading time in ms and the passage element's font size.
 * The instructions above (onStart hides them) are gone while reading, so the passage starts at the top of the screen.
 * @param {HTMLElement} area @param {string} text @param {boolean} tuned @param {() => void} [onStart]
 * @returns {Promise<{ms: number, fontPx: number}>}
 */
function readOnce(area, text, tuned, onStart) {
  return new Promise((resolve) => {
    const start = button(t('read.start'), {
      testId: 'read-start', className: 'p-btn--big',
      onClick: () => {
        onStart?.();
        clear(area);
        const passage = h('article', {
          class: `p-passage${tuned ? ' p-passage--tuned' : ''}`, 'data-testid': 'passage', 'aria-label': t('read.label'), lang: /** @type {Draft} */ (draft)?.session.lang || lang,
        }, h('p', null, text));
        let t0 = performance.now();
        const done = button(t('read.done'), {
          testId: 'read-done', className: 'p-btn--big',
          onClick: () => {
            const ms = Math.max(1, performance.now() - t0);
            const fontPx = parseFloat(getComputedStyle(passage).fontSize) || core.NORMAL_FONT_PX;
            resolve({ ms: Math.round(ms), fontPx: Math.round(fontPx * 10) / 10 });
          },
        });
        area.append(passage, h('div', { class: 'p-actions p-actions--done' }, done));
        requestAnimationFrame(() => { t0 = performance.now(); });
        window.scrollTo(0, 0);
      },
    });
    area.append(h('div', { class: 'p-actions' }, start));
  });
}

function renderPractice() {
  if (!draft) return;
  const s = draft.session;
  const next = () => {
    if (s.background.correction === 'none') { s.withGlassesSkipped = 'no-correction'; go('withoutGlasses'); } else go('withGlasses');
  };
  const area = h('div', { class: 'p-area' });
  const intro = h('div', { class: 'p-intro' }, h('p', { class: 'p-lead' }, t('practice.lead')), howToList());
  const skip = h('div', { class: 'p-actions p-actions--minor' }, button(t('practice.skip'), { variant: 'ghost', testId: 'practice-skip', onClick: next }));
  mount('practice', t('practice.title'), intro, area, skip);
  void readOnce(area, PASSAGES[s.lang].practice, false, () => { intro.hidden = true; skip.hidden = true; }).then(() => {
    clear(area);
    area.append(h('p', { class: 'p-success', role: 'status' }, t('practice.done')),
      h('div', { class: 'p-actions' }, button(t('next'), { testId: 'practice-next', onClick: next })));
  });
}

/** @param {Cond} cond */
function renderCondition(cond) {
  if (!draft) return;
  const d = draft;
  const s = d.session;
  const passage = passageFor(cond);
  const tuned = cond === 'seetuned';
  /** @type {any} */
  let profile = null;
  if (tuned) {
    profile = (d.profileId && getProfile(d.profileId)) || getActiveProfile();
    applyProfileToDocument(profile);
  } else {
    applyProfileToDocument(null);
  }
  const distanceMm = tuned ? (s.profile?.recommendedDistanceMm ?? null) : null;
  const intro = [];
  if (cond === 'withGlasses') intro.push(h('p', { class: 'p-lead' }, t(s.background.correction === 'contacts' ? 'cond.withGlasses.contacts' : 'cond.withGlasses.body')));
  if (cond === 'withoutGlasses') intro.push(h('p', { class: 'p-lead' }, t(s.background.correction === 'none' ? 'cond.withoutGlasses.bodyNone' : 'cond.withoutGlasses.body')));
  if (tuned) {
    intro.push(h('p', { class: 'p-lead' }, t('cond.seetuned.body')));
    if (s.profile?.verdict === 'no') intro.push(h('p', { class: 'p-note' }, t('cond.gfNo')));
  }
  if (tuned) {
    intro.push(h('p', { class: 'p-distance', 'data-testid': 'cond-distance' },
      distanceMm ? t('cond.distance', { cm: Math.round(distanceMm / 10) }) : t('cond.distanceUsual')));
  }

  const distanceLine = intro.find((el) => el.classList.contains('p-distance')) || null;
  const introBox = h('div', { class: 'p-intro' }, intro.filter((el) => el !== distanceLine), howToList());
  const skip = cond === 'withGlasses' ? h('div', { class: 'p-actions p-actions--minor' }, button(t('cond.withGlasses.skip'), {
    variant: 'ghost', testId: 'cond-skip',
    onClick: () => { s.withGlassesSkipped = 'not-with-me'; s.conditions.withGlasses = null; go('withoutGlasses'); },
  })) : null;
  const area = h('div', { class: 'p-area' });
  mount(cond, t(`cond.${cond}.title`), introBox, distanceLine, area, skip);

  void readOnce(area, passage.text, tuned, () => { introBox.hidden = true; if (skip) skip.hidden = true; }).then(({ ms, fontPx }) => {
    askQuestion(area, passage, (correct) => {
      askRatings(area, (clarity, effort) => {
        s.conditions[cond] = {
          passageId: passage.id, wpm: core.wordsPerMinute(passage.text, ms), ms, correct, clarity, effort,
          fontPx: tuned ? fontPx : core.NORMAL_FONT_PX, distanceMm,
        };
        if (cond === 'withGlasses') s.withGlassesSkipped = null;
        if (tuned) applyProfileToDocument(null);
        go(cond === 'withGlasses' ? 'withoutGlasses' : cond === 'withoutGlasses' ? 'app' : 'final');
      });
    });
  });
}

/**
 * @param {HTMLElement} area @param {import('./passages.js').Passage} passage @param {(correct: boolean) => void} done
 */
function askQuestion(area, passage, done) {
  clear(area);
  const qId = 'q-text';
  area.append(h('div', { class: 'p-question', 'data-testid': 'question' },
    h('h2', { class: 'p-h2', id: qId, tabindex: '-1' }, t('q.title')),
    h('p', { class: 'p-hint' }, t('q.lead')),
    h('p', { class: 'p-question__text' }, passage.question),
    h('div', { class: 'p-options', role: 'group', 'aria-labelledby': qId }, passage.options.map((opt, i) => button(opt, {
      variant: 'secondary', testId: `q-option-${i}`, className: 'p-option',
      onClick: () => done(i === passage.answer),
    })))));
  // Test hook (like the app's reading test): which option is right, for automated runs only.
  area.querySelector(`[data-testid="q-option-${passage.answer}"]`)?.setAttribute('data-correct', 'true');
  window.scrollTo(0, 0);
  /** @type {HTMLElement|null} */ (area.querySelector('h2'))?.focus({ preventScroll: true });
}

/** @param {HTMLElement} area @param {(clarity: number, effort: number) => void} done */
function askRatings(area, done) {
  clear(area);
  /** @type {number|null} */ let clarity = null;
  /** @type {number|null} */ let effort = null;
  const next = button(t('next'), { testId: 'rate-next', disabled: true, onClick: () => { if (clarity && effort) done(clarity, effort); } });
  const update = () => { next.disabled = !(clarity && effort); };
  area.append(h('div', { class: 'p-ratings', 'data-testid': 'ratings' },
    h('h2', { class: 'p-h2', tabindex: '-1' }, t('rate.title')),
    scale5({ name: 'clarity', legend: t('rate.clarity'), lo: t('rate.clarity.lo'), hi: t('rate.clarity.hi'), testId: 'rate-clarity', onChange: (v) => { clarity = v; update(); } }),
    scale5({ name: 'effort', legend: t('rate.effort'), lo: t('rate.effort.lo'), hi: t('rate.effort.hi'), testId: 'rate-effort', onChange: (v) => { effort = v; update(); } }),
    h('div', { class: 'p-actions' }, next)));
  window.scrollTo(0, 0);
  /** @type {HTMLElement|null} */ (area.querySelector('h2'))?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------------------------------------
// 3. The SeeTuned check in the app

/** Use the signed-in account, or create an anonymous pilot account (no e-mail typed by the tester). */
async function ensureAccount() {
  try {
    const me = await fetch('/api/me', { credentials: 'same-origin' });
    if (me.ok) return true;
  } catch { /* offline or no API */ }
  const code = /** @type {Draft} */ (draft).session.code.slice(2).toLowerCase();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `pilot-${code}-${randomToken(6)}@example.invalid`, password: randomToken(24), lang, acceptTerms: true }),
      });
      if (r.ok) return true;
      if (r.status !== 409) return false;
    } catch { return false; }
  }
  return false;
}

/** Set everything the app needs to send the tester back here. @param {string} hash */
function prepareAppVisit(hash) {
  const d = /** @type {Draft} */ (draft);
  if (!d.appStartedAt) {
    clearAppDraft('onboarding'); // never resume a previous tester's unfinished check
    d.appStartedAt = Date.now();
  }
  try {
    localStorage.setItem('va.lang', d.session.lang);
    // The tester accepted the terms and the "not a medical device" notice on the consent screen.
    localStorage.setItem('va.disclaimerAck', new Date().toISOString());
  } catch { /* storage blocked */ }
  store.setMarker({ code: d.session.code, returnUrl: new URL('session.html?resume=1', location.href).href, startedAt: new Date(d.appStartedAt).toISOString() });
  d.step = 'return';
  persist();
  location.href = `${APP_PAGE}${hash}`;
}

function renderApp() {
  if (!draft) return;
  applyProfileToDocument(null);
  const status = liveRegion('app-status');
  const fallback = h('div', { class: 'p-actions', hidden: true }, linkButton(t('app.openAnyway'), `${APP_PAGE}#/welcome`, {
    variant: 'secondary', testId: 'app-open-anyway',
    onClick: (e) => { e.preventDefault(); prepareAppVisit('#/welcome'); },
  }));
  const open = button(t('app.open'), {
    testId: 'app-open', className: 'p-btn--big',
    onClick: async () => {
      open.disabled = true;
      status.textContent = t('app.opening');
      const ok = await ensureAccount();
      if (ok) { prepareAppVisit('#/onboarding?new=1'); return; }
      open.disabled = false;
      status.textContent = '';
      fallback.hidden = false;
      fallback.prepend(h('p', { class: 'p-alert', role: 'alert' }, t('app.error')));
    },
  });
  mount('app', t('app.title'),
    h('p', { class: 'p-callout', 'data-testid': 'glasses-off' }, t('app.glassesOff')),
    h('ol', { class: 'p-list p-list--steps' },
      h('li', null, t('app.step1')),
      h('li', null, t('app.step2', { mode: t('app.mode') })),
      h('li', null, t('app.step3')),
      h('li', null, t('app.step4'))),
    h('div', { class: 'p-actions' }, open), status, fallback);
}

/** @param {any} p @param {boolean} fromEarlier @returns {import('./pilot-core.js').ProfileSummary} */
function summarizeProfile(p, fromEarlier) {
  const gf = p?.glassesFree && typeof p.glassesFree === 'object' ? p.glassesFree : null;
  const n = (/** @type {any} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    baseFontPx: n(p?.text?.baseFontPx) === null ? null : Math.round(p.text.baseFontPx * 10) / 10,
    fontWeight: n(p?.text?.fontWeight),
    verdict: gf && ['yes', 'partial', 'no'].includes(gf.feasible) ? gf.feasible : null,
    reasons: gf && Array.isArray(gf.reasons) ? gf.reasons.filter((r) => typeof r === 'string').slice(0, 20) : [],
    recommendedDistanceMm: n(gf?.recommendedDistanceMm) ?? n(p?.viewing?.recommendedDistanceMm),
    fromEarlierCheck: fromEarlier,
  };
}

function renderReturn() {
  if (!draft) return;
  const d = draft;
  const p = getActiveProfile();
  const fresh = !!p && !!d.appStartedAt && Date.parse(p.updatedAt) >= d.appStartedAt - 60_000;
  if (!fresh) {
    mount('return', t('ret.missing.title'),
      h('p', { class: 'p-lead' }, t('ret.missing.body')),
      h('div', { class: 'p-actions' },
        button(t('ret.backToApp'), { testId: 'ret-back', onClick: () => prepareAppVisit('#/onboarding') }),
        p ? button(t('ret.useExisting'), { variant: 'secondary', testId: 'ret-use-existing', onClick: () => useProfile(p, true) }) : null),
      p ? h('p', { class: 'p-hint' }, t('ret.useExistingHint')) : null);
    return;
  }
  const sum = summarizeProfile(p, false);
  const verdict = sum.verdict || 'unknown';
  mount('return', t('ret.title'),
    h('p', { class: 'p-lead' }, t('ret.found')),
    h('div', { class: 'p-card', 'data-testid': 'profile-summary', 'data-verdict': verdict },
      h('p', { class: `p-verdict p-verdict--${verdict}` }, t(`ret.verdict.${verdict}`)),
      sum.baseFontPx ? h('p', null, t('ret.size', { px: Math.round(sum.baseFontPx), x: (Math.round((sum.baseFontPx / core.NORMAL_FONT_PX) * 10) / 10).toLocaleString(lang === 'he' ? 'he-IL' : 'en-US') })) : null,
      sum.recommendedDistanceMm ? h('p', { class: 'p-distance' }, t('cond.distance', { cm: Math.round(sum.recommendedDistanceMm / 10) })) : null),
    h('div', { class: 'p-actions' }, button(t('ret.continue'), { testId: 'ret-continue', onClick: () => useProfile(p, false) })));
}

/** @param {any} p @param {boolean} fromEarlier */
function useProfile(p, fromEarlier) {
  if (!draft) return;
  draft.profileId = p.id;
  draft.session.profile = summarizeProfile(p, fromEarlier);
  store.clearMarker();
  go('seetuned');
}

// ---------------------------------------------------------------------------------------------------------
// 4. Final questions, summary

function renderFinal() {
  if (!draft) return;
  applyProfileToDocument(null);
  const s = draft.session;
  const f = s.final;
  const error = h('p', { class: 'p-alert', role: 'alert', hidden: true, 'data-testid': 'final-error' });
  const comment = h('textarea', { id: 'final-comment', rows: 3, maxlength: 500, 'data-testid': 'final-comment', 'aria-describedby': 'final-comment-hint' });
  comment.value = f.comment || '';
  mount('final', t('final.title'),
    choiceGroup({
      name: 'comfortable', legend: t('final.comfortable'), value: f.comfortable, testId: 'final-comfortable', compact: true,
      options: core.COMFORT.map((c) => ({ value: c, label: t(`comf.${c}`) })),
      onChange: (v) => { f.comfortable = v; error.hidden = true; persist(); },
    }),
    scale5({ name: 'wouldUse', legend: t('final.wouldUse'), lo: t('final.wouldUse.lo'), hi: t('final.wouldUse.hi'), value: f.wouldUse, testId: 'final-would-use', onChange: (v) => { f.wouldUse = v; error.hidden = true; persist(); } }),
    h('div', { class: 'p-field' },
      h('label', { for: 'final-comment', class: 'p-legend' }, t('final.comment')),
      h('p', { class: 'p-hint', id: 'final-comment-hint' }, t('final.commentHint')),
      comment),
    error,
    h('div', { class: 'p-actions' }, button(t('final.finish'), {
      testId: 'final-finish',
      onClick: () => {
        if (!f.comfortable || !f.wouldUse) { error.textContent = t('required'); error.hidden = false; return; }
        f.comment = comment.value.trim().slice(0, 500);
        finish();
      },
    })));
}

function finish() {
  if (!draft) return;
  const s = draft.session;
  s.status = 'complete';
  s.finishedAt = new Date().toISOString();
  const clean = core.sanitizeSession(s);
  const saved = clean ? store.saveSession(clean) : false;
  const profileId = draft.profileId;
  endSession();
  draft = null;
  renderDone(clean || s, saved, profileId);
}

/** @param {PilotSession} s */
function resultsTable(s) {
  const rows = core.CONDITIONS.map((c) => {
    const r = s.conditions[c];
    if (!r && c === 'withGlasses' && s.withGlassesSkipped !== 'not-with-me') return null;
    return h('tr', { 'data-testid': `done-row-${c}` },
      h('th', { scope: 'row' }, t(`short.${c}`)),
      r ? [
        h('td', { 'data-testid': `done-wpm-${c}` }, String(Math.round(r.wpm))),
        h('td', null, t(r.correct ? 'answer.correct' : 'answer.wrong')),
        h('td', null, `${r.clarity}/5`),
        h('td', null, `${r.effort}/5`),
      ] : h('td', { colspan: 4 }, t('skipped')));
  });
  return h('div', { class: 'p-table-wrap' }, h('table', { class: 'p-table' },
    h('thead', null, h('tr', null, ['col.reading', 'col.speed', 'col.answer', 'col.clarity', 'col.effort'].map((k) => h('th', { scope: 'col' }, t(k))))),
    h('tbody', null, rows)));
}

/** @param {PilotSession} s */
function outcomeBlock(s) {
  const o = core.evaluateSession(s);
  return h('div', { class: `p-outcome p-outcome--${o.verdict}`, 'data-testid': 'outcome', 'data-outcome': o.verdict },
    h('p', { class: 'p-outcome__head' }, h('span', null, t('outcome.title')), h('strong', null, t(`outcome.${o.verdict}`))),
    o.reasons.length ? h('ul', { class: 'p-list' }, o.reasons.map((r) => h('li', null, t(`reason.${r}`)))) : null,
    h('details', { class: 'p-details' }, h('summary', null, t('rule.title')), h('p', null, t('rule.body'))));
}

/** @param {PilotSession} s */
function resultsCodeBlock(s) {
  const area = h('textarea', { class: 'p-code-box', readonly: true, rows: 4, dir: 'ltr', 'data-testid': 'results-code', 'aria-labelledby': 'results-code-title' });
  area.value = '…';
  const status = liveRegion('results-code-status');
  void core.encodeResultsCode(s).then((code) => { area.value = code; });
  return h('div', { class: 'p-card' },
    h('h2', { class: 'p-h2', id: 'results-code-title' }, t('done.resultsCode')),
    h('p', { class: 'p-hint' }, t('done.resultsHint')),
    area,
    h('div', { class: 'p-actions' }, button(t('done.copy'), {
      variant: 'secondary', testId: 'results-copy',
      onClick: async () => { status.textContent = (await copyText(area.value, area)) ? t('done.copied') : t('done.copyFailed'); },
    })),
    status);
}

/** @param {string|null} profileId */
function removeProfileBlock(profileId) {
  if (!profileId || !getProfile(profileId)) return null;
  const status = liveRegion('remove-profile-status');
  const btn = button(t('done.removeProfile'), {
    variant: 'secondary', testId: 'remove-profile',
    onClick: () => { deleteProfile(profileId); btn.remove(); status.textContent = t('done.profileRemoved'); },
  });
  return h('div', { class: 'p-card' }, h('p', { class: 'p-hint' }, t('done.removeProfileHint')), h('div', { class: 'p-actions' }, btn), status);
}

/** @param {PilotSession} s @param {boolean} saved @param {string|null} profileId */
function renderDone(s, saved, profileId) {
  mount('done', t('done.title'),
    h('p', { class: 'p-lead' }, t('done.thanks')),
    !saved ? h('p', { class: 'p-alert', role: 'alert' }, t('final.saveFailed')) : null,
    h('p', { class: 'p-code', 'data-testid': 'done-code' }, t('done.code', { code: s.code })),
    resultsTable(s),
    outcomeBlock(s),
    resultsCodeBlock(s),
    removeProfileBlock(profileId),
    endLinks(),
    h('p', { class: 'p-hint' }, t('done.honest')));
}

// ---------------------------------------------------------------------------------------------------------
// Start-up

function renderResumePrompt() {
  const d = /** @type {Draft} */ (draft);
  mount('resume', t('resume.title'),
    h('p', { class: 'p-lead' }, t('resume.body', { code: d.session.code })),
    h('div', { class: 'p-actions' },
      button(t('resume.continue', { code: d.session.code }), { testId: 'resume-continue', onClick: () => render() }),
      button(t('resume.discard'), {
        variant: 'secondary', testId: 'resume-discard',
        onClick: () => { endSession(); draft = null; render(); },
      })));
}

function start() {
  const loaded = store.loadDraft();
  if (loaded && typeof loaded.session?.code === 'string' && core.CODE_RE.test(loaded.session.code)) {
    draft = /** @type {Draft} */ (loaded);
    setLang(draft.session.lang === 'en' ? 'en' : 'he');
    const resume = new URLSearchParams(location.search).has('resume');
    if (resume || draft.step === 'return') render(); else renderResumePrompt();
    return;
  }
  setLang(lang);
  renderConsent();
}

start();

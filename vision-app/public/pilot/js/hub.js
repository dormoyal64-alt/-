// @ts-check
/**
 * Pilot study hub for the founder: sessions table, summary statistics, import of results codes, CSV export,
 * delete (in-page confirmation) and — on the published demo launcher only — sync through the Artifact `db`
 * capability (collection "pilot", one document per tester code) and CSV through the `downloads` capability.
 * Used by scripts/demo/launcher.html (useClaude: true) and public/pilot/hub.html (useClaude: false).
 * Every value shown comes from untrusted storage: it is validated (sanitizeSession) and set with textContent.
 */
import { h, clear } from '../../app/js/core/dom.js';
import { makeT, dirFor } from '../../app/js/core/i18n.js';
import { PILOT_STRINGS } from './strings.js';
import * as core from './pilot-core.js';
import * as store from './pilot-store.js';
import { button, copyText, liveRegion } from './ui.js';

/** @typedef {import('./pilot-core.js').PilotSession} PilotSession */
/** @typedef {'local'|'synced'|'remote'} Where */

const HUB_LANG_KEY = 'seetuned-pilot.hubLang';
const COLLECTION = 'pilot';

/**
 * @param {HTMLElement} container
 * @param {{lang?: 'he'|'en'|null, sessionUrl?: string, useClaude?: boolean, showStart?: boolean, setDocumentLang?: boolean}} [opts]
 */
export async function mountHub(container, opts = {}) {
  const sessionUrl = opts.sessionUrl || 'session.html';
  const showStart = opts.showStart !== false;
  /** @type {'he'|'en'} */
  let lang = 'he';
  try {
    const saved = localStorage.getItem(HUB_LANG_KEY);
    if (saved === 'he' || saved === 'en') lang = saved;
  } catch { /* storage blocked */ }
  if (opts.lang === 'he' || opts.lang === 'en') lang = opts.lang;
  let t = makeT(PILOT_STRINGS, lang);

  const state = {
    /** @type {PilotSession[]} */ local: store.loadSessions(),
    /** @type {Map<string, PilotSession>|null} */ remote: null,
    /** @type {any} */ db: null,
    /** @type {any} */ downloads: null,
    /** 'none' = no shared database here; 'viewer' = this viewer cannot use it; 'admin' = syncing. */
    mode: /** @type {'none'|'viewer'|'admin'} */ ('none'),
    permissionKnown: false,
    sync: /** @type {'idle'|'syncing'|'error'|'quota'} */ ('idle'),
    syncing: false,
    again: false,
    retried: false,
    /** @type {string|null} */ pendingDelete: null,
  };

  // Stable regions (re-rendered independently so the import box keeps its text).
  const root = h('section', { class: 'ph', 'data-testid': 'pilot-hub', 'aria-labelledby': 'ph-title' });
  const syncLine = h('div', { class: 'ph-sync', 'data-testid': 'hub-sync', role: 'status', 'aria-live': 'polite' });
  const statsEl = h('div', { class: 'ph-stats', 'data-testid': 'hub-stats' });
  const confirmSlot = h('div');
  const tableEl = h('div', { 'data-testid': 'hub-table' });
  const message = liveRegion('hub-message');
  const importBox = h('textarea', { id: 'ph-import', rows: 3, dir: 'ltr', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'hub-import-text' });
  const csvBox = h('textarea', { class: 'p-code-box', rows: 6, readonly: true, dir: 'ltr', hidden: true, 'data-testid': 'hub-csv-text', 'aria-label': 'CSV' });

  /** @param {string} text @param {'ok'|'error'} [kind] */
  function say(text, kind = 'ok') {
    message.textContent = text;
    message.className = `p-status ${kind === 'error' ? 'ph-msg--error' : 'ph-msg--ok'}`;
  }

  /** @returns {Map<string, {session: PilotSession, where: Where}>} */
  function merged() {
    const synced = store.getSynced();
    /** @type {Map<string, {session: PilotSession, where: Where}>} */
    const all = new Map();
    for (const s of state.local) {
      const ok = state.mode === 'admin' && synced[s.code] === core.sessionFingerprint(s);
      all.set(s.code, { session: s, where: ok ? 'synced' : 'local' });
    }
    if (state.remote) for (const [code, s] of state.remote) if (!all.has(code)) all.set(code, { session: s, where: 'remote' });
    return all;
  }
  /** Newest first. */
  function rows() {
    return [...merged().values()].sort((a, b) => b.session.startedAt.localeCompare(a.session.startedAt));
  }

  const nf = (/** @type {number} */ n, /** @type {Intl.NumberFormatOptions} */ o = {}) => new Intl.NumberFormat(lang === 'he' ? 'he-IL' : 'en-US', o).format(n);
  const wpm = (/** @type {any} */ c) => (c ? nf(Math.round(c.wpm)) : '–');
  const mark = (/** @type {any} */ c) => (c ? (c.correct ? '✓' : '✗') : '–');

  function renderSync() {
    clear(syncLine);
    let text; let hint = null; let kind = 'local';
    if (state.mode === 'admin') {
      if (state.sync === 'syncing') { text = t('hub.sync.syncing'); kind = 'busy'; }
      else if (state.sync === 'error') { text = t('hub.sync.error'); kind = 'error'; }
      else if (state.sync === 'quota') { text = t('hub.sync.quota'); kind = 'error'; }
      else { text = t('hub.sync.synced', { n: state.remote ? state.remote.size : 0 }); kind = 'synced'; }
    } else if (state.mode === 'viewer') {
      text = t('hub.sync.viewer');
    } else {
      text = t('hub.sync.local');
      hint = t('hub.sync.localHint');
    }
    syncLine.dataset.mode = state.mode;
    syncLine.dataset.state = kind;
    syncLine.append(h('span', { class: `ph-dot ph-dot--${kind}`, 'aria-hidden': 'true' }), h('span', null, h('strong', null, text), hint ? ' ' + hint : ''));
  }

  function renderStats() {
    clear(statsEl);
    const sum = core.summarize(rows().map((r) => r.session));
    const tile = (/** @type {string} */ id, /** @type {string} */ label, /** @type {string} */ value, /** @type {string|null} */ sub) => h('div', { class: 'ph-stat', 'data-testid': `stat-${id}` },
      h('p', { class: 'ph-stat__value' }, value), h('p', { class: 'ph-stat__label' }, label), sub ? h('p', { class: 'ph-stat__sub' }, sub) : null);
    statsEl.append(
      tile('n', t('hub.stats.n'), nf(sum.n), sum.incomplete ? t('hub.stats.incomplete', { n: sum.incomplete }) : null),
      tile('success', t('hub.stats.success'), sum.successRate === null ? '–' : nf(sum.successRate, { style: 'percent' }),
        sum.n ? t('hub.stats.successOf', { s: sum.success, n: sum.n }) : null),
      tile('gain', t('hub.stats.gain'), sum.medianGainVsDefault === null ? '–' : nf(sum.medianGainVsDefault, { style: 'percent', signDisplay: 'exceptZero' }), null),
      tile('ratio', t('hub.stats.ratio'), sum.medianRatioVsGlasses === null ? '–' : `${nf(sum.medianRatioVsGlasses, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`,
        sum.nWithGlasses ? t('hub.stats.ratioOf', { n: sum.nWithGlasses }) : null),
    );
  }

  function renderTable() {
    clear(tableEl);
    const list = rows();
    if (!list.length) { tableEl.append(h('p', { class: 'p-note', 'data-testid': 'hub-empty' }, t('hub.empty'))); return; }
    const heads = ['th.code', 'th.date', 'th.age', 'th.correction', 'th.wpmDefault', 'th.wpmSeetuned', 'th.wpmGlasses', 'th.comprehension', 'th.clarity', 'th.appVerdict', 'th.outcome', 'th.where', 'th.actions'];
    const df = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
    tableEl.append(h('div', { class: 'p-table-wrap ph-table-wrap', tabindex: '0', role: 'region', 'aria-label': t('hub.title') }, h('table', { class: 'p-table ph-table' },
      h('thead', null, h('tr', null, heads.map((k) => h('th', { scope: 'col' }, t(k))))),
      h('tbody', null, list.map(({ session: s, where }) => {
        const c = s.conditions;
        const o = core.evaluateSession(s);
        const b = s.background;
        return h('tr', { 'data-testid': `hub-row-${s.code}`, 'data-outcome': o.verdict, 'data-where': where },
          h('th', { scope: 'row', dir: 'ltr' }, s.code),
          h('td', null, df.format(new Date(s.startedAt))),
          h('td', { dir: 'ltr' }, b.ageBand === '75+' ? '75+' : b.ageBand || '–'),
          h('td', null, b.correction ? t(`corr.${b.correction}`) : '–'),
          h('td', { 'data-testid': 'cell-wpm-default' }, wpm(c.withoutGlasses)),
          h('td', { 'data-testid': 'cell-wpm-seetuned' }, wpm(c.seetuned)),
          h('td', { 'data-testid': 'cell-wpm-glasses' }, c.withGlasses ? wpm(c.withGlasses) : s.withGlassesSkipped ? t('skipped') : '–'),
          h('td', { 'data-testid': 'cell-comprehension', dir: 'ltr' }, `${mark(c.withGlasses)} / ${mark(c.withoutGlasses)} / ${mark(c.seetuned)}`),
          h('td', { 'data-testid': 'cell-clarity', dir: 'ltr' }, `${c.withoutGlasses?.clarity ?? '–'} → ${c.seetuned?.clarity ?? '–'}`),
          h('td', null, s.profile?.verdict ? t(`verdict.${s.profile.verdict}`) : t('verdict.none'), s.profile?.fromEarlierCheck ? ' *' : ''),
          h('td', { 'data-testid': 'cell-outcome' }, h('span', { class: `ph-badge ph-badge--${o.verdict}`, title: o.reasons.map((r) => t(`reason.${r}`)).join('; ') }, t(`outcome.${o.verdict}`))),
          h('td', { 'data-testid': 'cell-where' }, h('span', { class: `ph-where ph-where--${where}` }, t(`where.${where}`))),
          h('td', null, button(t('hub.delete'), {
            variant: 'danger', className: 'p-btn--small', testId: `hub-delete-${s.code}`, ariaLabel: t('hub.deleteLabel', { code: s.code }),
            onClick: () => askDelete(s.code),
          })));
      })))));
  }

  function renderData() {
    renderSync();
    renderStats();
    renderTable();
  }

  /** @param {string} code */
  function askDelete(code) {
    state.pendingDelete = code;
    clear(confirmSlot);
    const panel = h('div', { class: 'p-panel p-panel--warn', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ph-del-title', 'data-testid': 'hub-delete-panel' },
      h('h3', { id: 'ph-del-title', class: 'p-h2' }, t('hub.delete.title', { code })),
      h('p', null, t('hub.delete.body')),
      h('div', { class: 'p-actions' },
        button(t('hub.delete.cancel'), { variant: 'secondary', testId: 'hub-delete-cancel', onClick: () => { state.pendingDelete = null; clear(confirmSlot); } }),
        button(t('hub.delete.confirm'), { variant: 'danger', testId: 'hub-delete-confirm', onClick: () => void doDelete(code) })));
    confirmSlot.append(panel);
    panel.scrollIntoView({ block: 'nearest' });
    /** @type {HTMLElement|null} */ (panel.querySelector('button'))?.focus();
  }

  /** @param {string} code */
  async function doDelete(code) {
    clear(confirmSlot);
    state.pendingDelete = null;
    store.deleteSession(code);
    state.local = store.loadSessions();
    state.remote?.delete(code);
    renderData();
    say(t('hub.deleted', { code }));
    if (state.db) {
      try { await state.db.doc(`${COLLECTION}/${code}`).delete(); } catch (err) { onSyncError(err); }
    }
  }

  async function doImport() {
    const text = importBox.value;
    if (!text.trim()) return;
    try {
      const s = await core.decodeResultsCode(text);
      const existing = merged().get(s.code)?.session;
      if (existing && core.sessionFingerprint(existing) === core.sessionFingerprint(s)) {
        say(t('hub.import.dup', { code: s.code }));
        return;
      }
      if (!store.saveSession(s)) { say(t('hub.import.err.STORAGE'), 'error'); return; }
      state.local = store.loadSessions();
      importBox.value = '';
      renderData();
      say(t(existing ? 'hub.import.updated' : 'hub.import.ok', { code: s.code }));
      void syncUp();
    } catch (err) {
      const code = err instanceof Error && ['FORMAT', 'UNSUPPORTED', 'INVALID'].includes(err.message) ? err.message : 'FORMAT';
      say(t(`hub.import.err.${code}`), 'error');
    }
  }

  function csvData() {
    const list = rows().map((r) => r.session).reverse();
    return { list, csv: core.sessionsToCsv(list), filename: `seetuned-pilot-${new Date().toISOString().slice(0, 10)}.csv` };
  }

  async function doDownload() {
    const { list, csv, filename } = csvData();
    if (!list.length) { say(t('hub.export.none'), 'error'); return; }
    if (state.downloads) {
      try {
        await state.downloads.save({ filename, data: csv });
        say(t('hub.export.saved'));
      } catch (err) {
        const code = /** @type {any} */ (err)?.code;
        say(t(code === 'declined' ? 'hub.export.declined' : 'hub.export.failed'), code === 'declined' ? 'ok' : 'error');
      }
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = h('a', { href: url, download: filename, hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      say(t('hub.export.saved'));
    } catch {
      say(t('hub.export.failed'), 'error');
    }
  }

  async function doCopyCsv() {
    const { list, csv } = csvData();
    if (!list.length) { say(t('hub.export.none'), 'error'); return; }
    csvBox.value = csv;
    if (await copyText(csv, null)) { csvBox.hidden = true; say(t('hub.export.copied')); return; }
    csvBox.hidden = false;
    await copyText(csv, csvBox);
    say(t('hub.export.copyFailed'), 'error');
  }

  // --- Shared database (published launcher only) -----------------------------------------------------------

  /** @param {unknown} err */
  function onSyncError(err) {
    const code = /** @type {any} */ (err)?.code;
    if (code === 'invalid_argument' && !state.permissionKnown) {
      // A well-formed write was refused: this viewer cannot write the pilot list. Stay local for this visit.
      state.mode = 'viewer';
      state.db = null;
    } else if (code === 'quota_exceeded') {
      state.sync = 'quota';
    } else {
      state.sync = 'error';
      if (code === 'unavailable' && !state.retried) {
        state.retried = true;
        setTimeout(() => void syncUp(), 1500 + Math.random() * 1500);
      }
    }
    renderData();
  }

  /** Write each local session to pilot/<code> once, and again only when it changed. One write at a time. */
  async function syncUp() {
    if (!state.db || state.mode !== 'admin') return;
    if (state.syncing) { state.again = true; return; }
    state.syncing = true;
    const synced = store.getSynced();
    const todo = state.local.filter((s) => synced[s.code] !== core.sessionFingerprint(s));
    if (todo.length) { state.sync = 'syncing'; renderSync(); }
    try {
      for (const s of todo) {
        await state.db.doc(`${COLLECTION}/${s.code}`).set(JSON.parse(JSON.stringify(s)));
        synced[s.code] = core.sessionFingerprint(s);
        store.setSynced(synced);
      }
      state.sync = 'idle';
      renderData();
    } catch (err) {
      onSyncError(err);
    } finally {
      state.syncing = false;
      if (state.again) { state.again = false; void syncUp(); }
    }
  }

  async function connectClaude() {
    const c = /** @type {any} */ (window).claude;
    if (!c || typeof c.use !== 'function') return;
    const get = (/** @type {string} */ name) => Promise.resolve().then(() => c.use(name)).catch(() => null);
    const [db, downloads, user] = await Promise.all([get('db'), get('downloads'), get('user')]);
    state.downloads = downloads || null;
    if (!db) { renderData(); return; }
    /** canEdit() = the `admin` level the pilot rules require; null when the platform says nothing. */
    let canEdit = null;
    try { canEdit = user ? await user.canEdit() : null; } catch { canEdit = null; }
    state.permissionKnown = canEdit !== null;
    if (canEdit === false) { state.mode = 'viewer'; renderData(); return; }
    state.db = db;
    state.mode = 'admin';
    renderData();
    db.collection(COLLECTION).onSnapshot((/** @type {any} */ snap) => {
      /** @type {Map<string, PilotSession>} */
      const m = new Map();
      for (const d of snap.docs) {
        if (!d.exists) continue;
        const s = core.sanitizeSession(d.data());
        if (s && s.code === d.id) m.set(d.id, s);
      }
      state.remote = m;
      renderData();
    }, (/** @type {any} */ err) => onSyncError(err));
    void syncUp();
  }

  // --- Static frame ----------------------------------------------------------------------------------------

  function buildFrame() {
    clear(container);
    clear(root);
    root.setAttribute('lang', lang);
    root.setAttribute('dir', dirFor(lang));
    if (opts.setDocumentLang) {
      document.documentElement.lang = lang;
      document.documentElement.dir = dirFor(lang);
      document.title = `${t('hub.title')} · SeeTuned`;
    }
    const other = lang === 'he' ? 'en' : 'he';
    const start = (/** @type {'he'|'en'} */ l, /** @type {string} */ key, /** @type {string} */ testId, /** @type {string} */ variant) => h('a', {
      class: `p-btn p-btn--${variant}`, href: `${sessionUrl}?lang=${l}`, lang: l, dir: dirFor(l), 'data-testid': testId,
      on: { click: () => { try { localStorage.setItem('va.lang', l); } catch { /* ignore */ } } },
    }, t(key));
    root.append(
      h('div', { class: 'ph-head' },
        h('h2', { id: 'ph-title', class: 'ph-title' }, t('hub.title')),
        button(t('lang.other'), {
          variant: 'ghost', className: 'p-btn--small', testId: 'hub-lang',
          onClick: () => {
            lang = other; t = makeT(PILOT_STRINGS, lang);
            try { localStorage.setItem(HUB_LANG_KEY, lang); } catch { /* ignore */ }
            buildFrame();
            renderData();
          },
        })),
      h('p', { class: 'ph-lead' }, t('hub.lead')),
      showStart ? h('div', { class: 'p-actions' },
        start(lang, lang === 'he' ? 'hub.startHe' : 'hub.startEn', 'hub-start', 'primary'),
        start(other, other === 'he' ? 'hub.startHe' : 'hub.startEn', 'hub-start-other', 'secondary')) : null,
      syncLine,
      statsEl,
      confirmSlot,
      tableEl,
      message,
      h('div', { class: 'ph-tools' },
        h('section', { class: 'ph-box', 'aria-labelledby': 'ph-import-title' },
          h('h3', { id: 'ph-import-title', class: 'p-h2' }, t('hub.import.title')),
          h('label', { for: 'ph-import', class: 'p-hint' }, t('hub.import.label')),
          importBox,
          h('div', { class: 'p-actions' }, button(t('hub.import.add'), { testId: 'hub-import-add', onClick: () => void doImport() }))),
        h('section', { class: 'ph-box', 'aria-labelledby': 'ph-export-title' },
          h('h3', { id: 'ph-export-title', class: 'p-h2' }, t('hub.export.title')),
          h('div', { class: 'p-actions' },
            button(t('hub.export.download'), { variant: 'secondary', testId: 'hub-csv-download', onClick: () => void doDownload() }),
            button(t('hub.export.copy'), { variant: 'secondary', testId: 'hub-csv-copy', onClick: () => void doCopyCsv() })),
          csvBox)),
      h('details', { class: 'p-details ph-rules' },
        h('summary', null, t('hub.rule.title')),
        h('p', null, h('strong', null, t('rule.title') + ': '), t('rule.body')),
        h('p', null, t('hub.rule.speed')),
        h('p', null, t('hub.rule.gain')),
        h('p', null, t('hub.rule.honest'))),
    );
    container.append(root);
  }

  buildFrame();
  renderData();

  const reload = () => { state.local = store.loadSessions(); renderData(); void syncUp(); };
  store.onSessionsChanged(reload);
  window.addEventListener('pageshow', (e) => { if (e.persisted) reload(); });

  if (opts.useClaude) await connectClaude();
}

// @ts-check
/**
 * Pilot study — on-device storage (localStorage, same origin as the app).
 * Finished sessions live under a key WITHOUT the app's "va." prefix, so the app's "delete my data on this
 * device" does not silently wipe study data; the hub has its own delete. The active-session marker uses the
 * "va." prefix because the app's results screen reads it.
 */
import { sanitizeSession } from './pilot-core.js';

/** @typedef {import('./pilot-core.js').PilotSession} PilotSession */

export const SESSIONS_KEY = 'seetuned-pilot.sessions.v1';
export const DRAFT_KEY = 'seetuned-pilot.draft.v1';
export const SYNCED_KEY = 'seetuned-pilot.synced.v1';
/** Read by public/app/js/screens/results.js ("Continue the pilot session"). Keep the shape {code, returnUrl, startedAt}. */
export const MARKER_KEY = 'va.pilot.active';
export const CHANGE_EVENT = 'seetuned-pilot:changed';

/** @returns {Storage|null} */
function store() {
  try { return window.localStorage; } catch { return null; }
}
/** @param {string} key */
function readJson(key) {
  try {
    const raw = store()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
/** @param {string} key @param {unknown} value @returns {boolean} */
function writeJson(key, value) {
  try {
    store()?.setItem(key, JSON.stringify(value));
    return !!store();
  } catch { return false; }
}
/** @param {string} key */
function remove(key) {
  try { store()?.removeItem(key); } catch { /* storage blocked */ }
}

/** @returns {PilotSession[]} valid sessions saved on this device, oldest first */
export function loadSessions() {
  const arr = readJson(SESSIONS_KEY);
  if (!Array.isArray(arr)) return [];
  /** @type {PilotSession[]} */
  const out = [];
  for (const raw of arr) {
    const s = sanitizeSession(raw);
    if (s && !out.some((x) => x.code === s.code)) out.push(s);
  }
  return out;
}

/** @param {PilotSession[]} list */
function writeSessions(list) {
  const ok = writeJson(SESSIONS_KEY, list);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  return ok;
}

/** Insert or replace by code. @param {PilotSession} session @returns {boolean} saved */
export function saveSession(session) {
  const list = loadSessions().filter((s) => s.code !== session.code);
  list.push(session);
  return writeSessions(list);
}

/** @param {string} code */
export function deleteSession(code) {
  writeSessions(loadSessions().filter((s) => s.code !== code));
  const synced = getSynced();
  if (code in synced) { delete synced[code]; setSynced(synced); }
}

/** @returns {Record<string, string>} code -> fingerprint last written to the shared database */
export function getSynced() {
  const m = readJson(SYNCED_KEY);
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}
/** @param {Record<string, string>} map */
export function setSynced(map) {
  writeJson(SYNCED_KEY, map);
}

/** @returns {any} the in-progress session draft, or null */
export function loadDraft() {
  const d = readJson(DRAFT_KEY);
  return d && typeof d === 'object' && d.session && typeof d.step === 'string' ? d : null;
}
/** @param {unknown} draft */
export function saveDraft(draft) {
  writeJson(DRAFT_KEY, draft);
}
export function clearDraft() {
  remove(DRAFT_KEY);
}

/** @param {{code: string, returnUrl: string, startedAt: string}} marker */
export function setMarker(marker) {
  writeJson(MARKER_KEY, marker);
}
/** @returns {{code: string, returnUrl: string, startedAt: string}|null} */
export function getMarker() {
  const m = readJson(MARKER_KEY);
  return m && typeof m.code === 'string' && typeof m.returnUrl === 'string' ? m : null;
}
export function clearMarker() {
  remove(MARKER_KEY);
}

/** @param {() => void} cb @returns {() => void} unsubscribe */
export function onSessionsChanged(cb) {
  const onStorage = (/** @type {StorageEvent} */ e) => { if (e.key === SESSIONS_KEY || e.key === null) cb(); };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(CHANGE_EVENT, cb); window.removeEventListener('storage', onStorage); };
}

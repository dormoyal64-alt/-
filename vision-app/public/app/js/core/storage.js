// @ts-check
/**
 * On-device storage for vision profiles and onboarding drafts.
 * Eye-test data is health-related: it is kept ONLY on this device (never sent to the server).
 */

/** @typedef {import('./types.js').VisionProfile} VisionProfile */

const PROFILES_KEY = 'va.profiles.v1';
const ACTIVE_KEY = 'va.activeProfile.v1';
const DRAFT_PREFIX = 'va.draft.';
const CHANGE_EVENT = 'va:profiles-changed';

/** @returns {Storage|null} */
function store() {
  try { return window.localStorage; } catch { return null; }
}

/** @returns {VisionProfile[]} */
export function listProfiles() {
  const raw = store()?.getItem(PROFILES_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((p) => p && p.version === 1 && typeof p.id === 'string') : [];
  } catch {
    return [];
  }
}

/** @param {VisionProfile[]} profiles */
function writeProfiles(profiles) {
  store()?.setItem(PROFILES_KEY, JSON.stringify(profiles));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** @param {string} id @returns {VisionProfile|null} */
export function getProfile(id) {
  return listProfiles().find((p) => p.id === id) ?? null;
}

/** Insert or replace by id. @param {VisionProfile} profile */
export function saveProfile(profile) {
  const all = listProfiles();
  const i = all.findIndex((p) => p.id === profile.id);
  if (i >= 0) all[i] = profile; else all.push(profile);
  writeProfiles(all);
  if (!getActiveProfileId()) setActiveProfileId(profile.id);
}

/** @param {string} id */
export function deleteProfile(id) {
  const remaining = listProfiles().filter((p) => p.id !== id);
  writeProfiles(remaining);
  if (getActiveProfileId() === id) setActiveProfileId(remaining[0]?.id ?? null);
}

/** @returns {string|null} */
export function getActiveProfileId() {
  return store()?.getItem(ACTIVE_KEY) ?? null;
}

/** @param {string|null} id */
export function setActiveProfileId(id) {
  if (id) store()?.setItem(ACTIVE_KEY, id); else store()?.removeItem(ACTIVE_KEY);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** @returns {VisionProfile|null} */
export function getActiveProfile() {
  const id = getActiveProfileId();
  const all = listProfiles();
  return (id && all.find((p) => p.id === id)) || all[0] || null;
}

/** Subscribe to profile changes. @param {() => void} cb @returns {() => void} */
export function onProfilesChanged(cb) {
  window.addEventListener(CHANGE_EVENT, cb);
  const onStorage = (/** @type {StorageEvent} */ e) => { if (e.key === PROFILES_KEY || e.key === ACTIVE_KEY) cb(); };
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(CHANGE_EVENT, cb); window.removeEventListener('storage', onStorage); };
}

/** @param {string} key @param {unknown} data */
export function saveDraft(key, data) {
  store()?.setItem(DRAFT_PREFIX + key, JSON.stringify(data));
}

/** @template T @param {string} key @returns {T|null} */
export function loadDraft(key) {
  const raw = store()?.getItem(DRAFT_PREFIX + key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** @param {string} key */
export function clearDraft(key) {
  store()?.removeItem(DRAFT_PREFIX + key);
}

/** Remove every piece of on-device data owned by the app (used by "delete my data"). */
export function clearAllLocalData() {
  const s = store();
  if (!s) return;
  const keys = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith('va.')) keys.push(k);
  }
  keys.forEach((k) => s.removeItem(k));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** RFC4122 v4 id. @returns {string} */
export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

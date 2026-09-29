// @ts-check
/**
 * Guide "done" ticks, persisted per profile and platform on this device (pure helpers + storage).
 */

const KEY = 'va.guide.done.v1';

/** @returns {Record<string, Record<string, string[]>>} */
function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

/** @param {string} profileId @param {string} platform @returns {Set<string>} */
export function loadGuideDone(profileId, platform) {
  const ids = readAll()[profileId]?.[platform];
  return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []);
}

/** @param {string} profileId @param {string} platform @param {Set<string>} done */
export function saveGuideDone(profileId, platform, done) {
  const all = readAll();
  all[profileId] = { ...(all[profileId] || {}), [platform]: [...done] };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

/**
 * Progress over the RECOMMENDED sections (optional ones don't count against the user).
 * @param {Array<{id: string, recommended: boolean}>} sections @param {Set<string>} done
 */
export function guideProgress(sections, done) {
  const rec = sections.filter((s) => s.recommended);
  const pool = rec.length ? rec : sections;
  const n = pool.filter((s) => done.has(s.id)).length;
  return { done: n, total: pool.length, percent: pool.length ? Math.round((n / pool.length) * 100) : 0 };
}

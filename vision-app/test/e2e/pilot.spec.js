// @ts-check
/**
 * Pilot study kit (public/pilot): a complete simulated tester session on a phone (consent -> background -> practice ->
 * with glasses -> without glasses -> the SeeTuned app, whose results screen must offer "Continue the pilot session"
 * -> without glasses with the profile applied -> final questions -> saved), then the founder's hub (table, metrics,
 * import of a results code, CSV export, delete) and the stop / withdraw paths.
 *
 * Runs against the real server started by playwright.config.js (CSP enforced). The app check itself is replaced by
 * seeding a profile exactly as onboarding saves one (the check has its own suites).
 * PILOT_DEMO=1 + a config whose baseURL serves a static demo build (node scripts/build-demo.js <dir>) runs the same
 * flow on the demo (in-browser API) and checks the launcher hub with a mocked Artifact runtime (db sync, downloads).
 * PILOT_SHOTS=<dir> saves a screenshot of every screen.
 */
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { collectErrors } from './helpers.js';

const DEMO = process.env.PILOT_DEMO === '1';
const SHOTS = process.env.PILOT_SHOTS || '';
const SESSIONS_KEY = 'seetuned-pilot.sessions.v1';
const HUB = DEMO ? '/' : '/pilot/hub.html';

test.beforeEach(({ page: _page }, testInfo) => { test.skip(testInfo.project.name !== 'phone', 'phone viewport only'); });

/** @param {import('@playwright/test').Page} page @param {string} name */
async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Mocked Artifact runtime for the demo launcher: in-memory db (persisted in sessionStorage), downloads, user. */
function mockClaudeRuntime() {
  const KEY = 'mock.claude.db';
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || '{"docs":{},"writes":[]}'); } catch { return { docs: {}, writes: [] }; } };
  const save = (s) => sessionStorage.setItem(KEY, JSON.stringify(s));
  /** @type {Array<(snap: any) => void>} */
  const listeners = [];
  const snap = () => {
    const docs = Object.entries(load().docs).map(([id, data]) => ({ id, exists: true, data: () => data, metadata: { fromCache: false, hasPendingWrites: false } }));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const notify = () => listeners.forEach((fn) => setTimeout(() => fn(snap()), 0));
  const db = Object.freeze({
    doc(path) {
      const [col, id] = path.split('/');
      if (col !== 'pilot' || !id) throw new TypeError('bad path ' + path);
      return {
        id, path,
        async set(data) { const s = load(); s.docs[id] = JSON.parse(JSON.stringify(data)); s.writes.push(id); save(s); notify(); },
        async delete() { const s = load(); delete s.docs[id]; save(s); notify(); },
      };
    },
    collection(path) {
      return { path, onSnapshot(next) { listeners.push(next); setTimeout(() => next(snap()), 0); return () => {}; } };
    },
  });
  const downloads = Object.freeze({ async save({ filename, data }) { /** @type {any} */ (window).__savedDownload = { filename, data: String(data) }; return { status: 'saved' }; } });
  const user = Object.freeze({ async canEdit() { return true; }, async isOwner() { return true; } });
  /** @type {any} */ (window).claude = Object.freeze({ use: async (name) => ({ db, downloads, user })[name] ?? null });
}

/** @param {import('@playwright/test').Page} page */
async function readSessions(page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), SESSIONS_KEY);
}

/**
 * One reading: Start -> wait -> Done -> answer -> ratings.
 * @param {import('@playwright/test').Page} page @param {{waitMs: number, correct: boolean, clarity: number, effort: number, name: string}} o
 */
async function readPassage(page, o) {
  await page.getByTestId('read-start').click();
  await expect(page.getByTestId('passage')).toBeVisible();
  const fontPx = await page.getByTestId('passage').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await shot(page, `${o.name}-2-passage`);
  await page.waitForTimeout(o.waitMs);
  await page.getByTestId('read-done').click();
  await expect(page.getByTestId('question')).toBeVisible();
  await expect(page.getByTestId('passage')).toHaveCount(0);
  await shot(page, `${o.name}-3-question`);
  await page.locator(o.correct ? '[data-testid^="q-option-"][data-correct="true"]' : '[data-testid^="q-option-"]:not([data-correct])').first().click();
  await expect(page.getByTestId('ratings')).toBeVisible();
  await expect(page.getByTestId('rate-next')).toBeDisabled();
  await page.getByTestId(`rate-clarity-${o.clarity}`).check();
  await page.getByTestId(`rate-effort-${o.effort}`).check();
  await shot(page, `${o.name}-4-ratings`);
  await page.getByTestId('rate-next').click();
  return fontPx;
}

/**
 * The whole tester session. Returns the tester code.
 * @param {import('@playwright/test').Page} page @param {'he'|'en'} lang
 */
async function runSession(page, lang) {
  const p = (/** @type {string} */ n) => `${lang}-${n}`;
  await page.goto(`/pilot/session.html?lang=${lang}`);
  await expect(page.getByTestId('pilot-consent')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
  await shot(page, p('01-consent'));
  await page.getByTestId('consent-start').click();
  await expect(page.getByTestId('consent-error')).toBeVisible();
  for (const id of ['consent-adult', 'consent-agree', 'consent-terms']) await page.getByTestId(id).check();
  await page.getByTestId('consent-start').click();

  // Background
  await expect(page.getByTestId('pilot-background')).toBeVisible();
  const code = (await page.getByTestId('tester-code').textContent())?.match(/T-[2-9A-Z]{4}/)?.[0];
  expect(code).toBeTruthy();
  await page.getByTestId('bg-next').click();
  await expect(page.getByTestId('bg-error')).toBeVisible();
  await page.getByTestId('bg-age-45-54').check();
  await page.getByTestId('bg-correction-multifocal').check();
  await page.locator('details.p-details > summary').first().click();
  await page.getByTestId('rx-right-sph').fill('+1,25');
  await page.getByTestId('rx-right-add').fill('2');
  await page.getByTestId('rx-left-axis').fill('400');
  await page.getByTestId('bg-holding-normal').check();
  await page.getByTestId('bg-device').fill('Pixel 7 (test)');
  await shot(page, p('02-background'));
  await page.getByTestId('bg-next').click();
  await expect(page.getByTestId('rx-error')).toBeVisible();
  await page.getByTestId('rx-left-axis').fill('');
  await page.getByTestId('bg-next').click();

  // Practice
  await expect(page.getByTestId('pilot-practice')).toBeVisible();
  await shot(page, p('03-practice'));
  await page.getByTestId('read-start').click();
  await page.getByTestId('read-done').click();
  await page.getByTestId('practice-next').click();

  // (1) With glasses, normal text
  await expect(page.getByTestId('pilot-withGlasses')).toBeVisible();
  await shot(page, p('04-cond1-1-intro'));
  const f1 = await readPassage(page, { waitMs: 4000, correct: true, clarity: 5, effort: 1, name: p('04-cond1') });
  expect(f1).toBe(16);

  // (2) Without glasses, normal text
  await expect(page.getByTestId('pilot-withoutGlasses')).toBeVisible();
  await shot(page, p('05-cond2-1-intro'));
  const f2 = await readPassage(page, { waitMs: 5500, correct: false, clarity: 2, effort: 4, name: p('05-cond2') });
  expect(f2).toBe(16);

  // (3) The SeeTuned check in the app
  await expect(page.getByTestId('pilot-app')).toBeVisible();
  await expect(page.getByTestId('glasses-off')).toBeVisible();
  await shot(page, p('06-app-intro'));
  await page.getByTestId('app-open').click();
  await page.waitForURL(/\/app\/index\.html#\/onboarding/);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  const marker = await page.evaluate(() => JSON.parse(localStorage.getItem('va.pilot.active') || 'null'));
  expect(marker?.code).toBe(code);
  expect(marker?.returnUrl).toMatch(/\/pilot\/session\.html\?resume=1$/);
  // Stand-in for the full check: save a glasses-free profile exactly as onboarding does.
  const profile = await page.evaluate(async () => {
    const storage = await import('/app/js/core/storage.js');
    const demo = await import('/app/js/core/demo-profile.js');
    /** @type {any} */
    let prof;
    try {
      const engine = await import('/app/js/engine/profile.js');
      prof = engine.computeProfile({ ...demo.demoProfile().input, wearsCorrection: false }, { id: storage.newId(), name: 'Pilot', now: Date.now() });
    } catch {
      prof = { ...demo.demoProfile(), id: storage.newId(), name: 'Pilot' };
    }
    prof = { ...prof, updatedAt: new Date().toISOString() };
    storage.saveProfile(prof);
    storage.setActiveProfileId(prof.id);
    return prof;
  });
  await page.evaluate(() => { location.hash = '#/results?fresh=1'; });
  const cont = page.getByTestId('results-pilot-continue');
  await expect(cont).toBeVisible();
  await expect(page.getByTestId('results-pilot')).toContainText(String(code));
  await shot(page, p('07-app-results-continue'));
  await cont.click();

  // Back in the session
  await page.waitForURL(/\/pilot\/session\.html\?resume=1/);
  await expect(page.getByTestId('pilot-return')).toBeVisible();
  await expect(page.getByTestId('profile-summary')).toBeVisible();
  await shot(page, p('08-return'));
  await page.getByTestId('ret-continue').click();

  // (4) Without glasses, SeeTuned profile applied
  await expect(page.getByTestId('pilot-seetuned')).toBeVisible();
  const distanceMm = profile.glassesFree?.recommendedDistanceMm ?? profile.viewing?.recommendedDistanceMm ?? null;
  if (distanceMm) await expect(page.getByTestId('cond-distance')).toContainText(String(Math.round(distanceMm / 10)));
  await shot(page, p('09-cond4-1-intro'));
  const f4 = await readPassage(page, { waitMs: 4500, correct: true, clarity: 4, effort: 2, name: p('09-cond4') });
  const expectedPx = Math.min(Math.max(profile.text.baseFontPx, 12), 64);
  expect(Math.abs(f4 - expectedPx)).toBeLessThan(0.75);

  // Final questions
  await expect(page.getByTestId('pilot-final')).toBeVisible();
  // The profile is no longer applied once the SeeTuned reading is over.
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--va-font-scale'))).toBe('');
  await page.getByTestId('final-finish').click();
  await expect(page.getByTestId('final-error')).toBeVisible();
  await page.getByTestId('final-comfortable-yes').check();
  await page.getByTestId('final-would-use-4').check();
  await page.getByTestId('final-comment').fill('=SUM(1) "quoted", ok');
  await shot(page, p('10-final'));
  await page.getByTestId('final-finish').click();

  // Done: summary, outcome, results code
  await expect(page.getByTestId('pilot-done')).toBeVisible();
  await expect(page.getByTestId('done-code')).toContainText(String(code));
  await expect(page.getByTestId('results-code')).toHaveValue(/^STP1z?\.[A-Za-z0-9_-]{40,}$/);
  await page.getByTestId('results-copy').click();
  await expect(page.getByTestId('results-code-status')).not.toBeEmpty();
  await shot(page, p('11-done'));

  const [saved] = (await readSessions(page)).filter((s) => s.code === code);
  expect(saved.status).toBe('complete');
  expect(saved.lang).toBe(lang);
  expect(saved.background).toMatchObject({ ageBand: '45-54', correction: 'multifocal', holding: 'normal', deviceModel: 'Pixel 7 (test)' });
  expect(saved.background.rx.right).toEqual({ sph: 1.25, cyl: null, axis: null, add: 2 });
  for (const c of ['withGlasses', 'withoutGlasses', 'seetuned']) {
    const r = saved.conditions[c];
    expect(r.passageId).toMatch(new RegExp(`^${lang}-[1-3]$`));
    const passageChars = await page.evaluate(async (id) => (await import('/pilot/js/passages.js')).passageById(id)?.text.length, r.passageId);
    expect(r.wpm).toBeCloseTo((passageChars / 6) / (r.ms / 60000), 0);
  }
  const ids = new Set(['withGlasses', 'withoutGlasses', 'seetuned'].map((c) => saved.conditions[c].passageId));
  expect(ids.size).toBe(3);
  expect(saved.conditions.withGlasses).toMatchObject({ correct: true, clarity: 5, effort: 1, fontPx: 16, distanceMm: null });
  expect(saved.conditions.withoutGlasses).toMatchObject({ correct: false, clarity: 2, effort: 4, fontPx: 16 });
  expect(saved.conditions.seetuned).toMatchObject({ correct: true, clarity: 4, effort: 2 });
  expect(saved.profile).toMatchObject({ baseFontPx: Math.round(profile.text.baseFontPx * 10) / 10, fromEarlierCheck: false });
  expect(saved.profile).not.toHaveProperty('input');
  expect(saved.final).toEqual({ comfortable: 'yes', wouldUse: 4, comment: '=SUM(1) "quoted", ok' });
  expect(saved.consentVersion).toMatch(/^pilot-consent-/);
  expect(saved.device.ua).toMatch(/Android/);
  expect(JSON.stringify(saved)).not.toMatch(/@example\.invalid|password/i);
  // The results code decodes to exactly the saved session.
  const decoded = await page.evaluate(async (rc) => (await import('/pilot/js/pilot-core.js')).decodeResultsCode(rc), await page.getByTestId('results-code').inputValue());
  expect(decoded).toEqual(saved);
  // The session is closed: no draft, no marker.
  expect(await page.evaluate(() => [localStorage.getItem('seetuned-pilot.draft.v1'), localStorage.getItem('va.pilot.active')])).toEqual([null, null]);
  return { code: /** @type {string} */ (code), saved };
}

test.describe('pilot study kit', () => {
  test.setTimeout(240_000);

  test('complete Hebrew tester session, then the hub: metrics, import, CSV, delete', async ({ page }) => {
    const errors = collectErrors(page);
    if (DEMO) await page.addInitScript(mockClaudeRuntime);
    const { code, saved } = await runSession(page, 'he');

    // Hub
    await page.goto(HUB);
    const row = page.getByTestId(`hub-row-${code}`);
    await expect(row).toBeVisible();
    const outcome = await page.evaluate(async (s) => (await import('/pilot/js/pilot-core.js')).evaluateSession(s), saved);
    await expect(row).toHaveAttribute('data-outcome', outcome.verdict);
    await expect(row.getByTestId('cell-wpm-default')).toHaveText(new Intl.NumberFormat('he-IL').format(Math.round(saved.conditions.withoutGlasses.wpm)));
    await expect(row.getByTestId('cell-wpm-seetuned')).toHaveText(new Intl.NumberFormat('he-IL').format(Math.round(saved.conditions.seetuned.wpm)));
    await expect(row.getByTestId('cell-wpm-glasses')).toHaveText(new Intl.NumberFormat('he-IL').format(Math.round(saved.conditions.withGlasses.wpm)));
    await expect(row.getByTestId('cell-comprehension')).toHaveText('✓ / ✗ / ✓');
    await expect(row.getByTestId('cell-clarity')).toHaveText('2 → 4');
    await expect(page.getByTestId('stat-n')).toContainText('1');
    const gain = saved.conditions.seetuned.wpm / saved.conditions.withoutGlasses.wpm - 1;
    await expect(page.getByTestId('stat-gain')).toContainText(new Intl.NumberFormat('he-IL', { style: 'percent', signDisplay: 'exceptZero' }).format(gain));
    if (DEMO) {
      await expect(page.getByTestId('hub-sync')).toHaveAttribute('data-mode', 'admin');
      await expect(row).toHaveAttribute('data-where', 'synced');
      const mock = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock.claude.db') || '{}'));
      expect(mock.docs[code]).toEqual(saved);
      expect(mock.writes.filter((w) => w === code)).toHaveLength(1);
    } else {
      await expect(page.getByTestId('hub-sync')).toHaveAttribute('data-mode', 'none');
      await expect(row).toHaveAttribute('data-where', 'local');
    }
    await shot(page, 'he-12-hub');

    // Import a results code from a "remote tester" (no glasses reading, English).
    const remote = { ...saved, code: 'T-ABCD', lang: 'en', withGlassesSkipped: 'not-with-me', conditions: { ...saved.conditions, withGlasses: null } };
    const rc = await page.evaluate(async (s) => (await import('/pilot/js/pilot-core.js')).encodeResultsCode(s), remote);
    await page.getByTestId('hub-import-text').fill('not a code');
    await page.getByTestId('hub-import-add').click();
    await expect(page.getByTestId('hub-message')).toHaveClass(/ph-msg--error/);
    await page.getByTestId('hub-import-text').fill(`Hi! my results:\n${rc.slice(0, 50)}\n${rc.slice(50)}`);
    await page.getByTestId('hub-import-add').click();
    await expect(page.getByTestId('hub-row-T-ABCD')).toBeVisible();
    await expect(page.getByTestId('hub-message')).toContainText('T-ABCD');
    await page.getByTestId('hub-import-text').fill(rc);
    await page.getByTestId('hub-import-add').click();
    await expect(page.getByTestId('hub-message')).toContainText('T-ABCD');
    expect((await readSessions(page)).map((s) => s.code).sort()).toEqual([code, 'T-ABCD'].sort());
    await expect(page.getByTestId('stat-n')).toContainText('2');

    // CSV
    let csv;
    if (DEMO) {
      await page.getByTestId('hub-csv-download').click();
      await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__savedDownload?.filename)).toMatch(/^seetuned-pilot-\d{4}-\d{2}-\d{2}\.csv$/);
      csv = await page.evaluate(() => /** @type {any} */ (window).__savedDownload.data);
    } else {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('hub-csv-download').click()]);
      expect(download.suggestedFilename()).toMatch(/^seetuned-pilot-\d{4}-\d{2}-\d{2}\.csv$/);
      csv = await readFile(/** @type {string} */ (await download.path()), 'utf8');
    }
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    const header = lines[0].split(',');
    expect(header.slice(0, 3)).toEqual(['code', 'status', 'started_at']);
    expect(lines).toHaveLength(3);
    const mine = lines.find((l) => l.startsWith(`${code},`)) || '';
    const col = (/** @type {string} */ name) => mine.split(',')[header.indexOf(name)];
    expect(Number(col('default_wpm'))).toBeCloseTo(saved.conditions.withoutGlasses.wpm, 1);
    expect(Number(col('seetuned_wpm'))).toBeCloseTo(saved.conditions.seetuned.wpm, 1);
    expect(col('outcome')).toBe(outcome.verdict);
    expect(mine).toContain('"\'=SUM(1) ""quoted"", ok"');
    expect(lines.find((l) => l.startsWith('T-ABCD,'))).toContain('not-with-me');

    // Delete (in-page confirmation)
    await page.getByTestId('hub-delete-T-ABCD').click();
    await expect(page.getByTestId('hub-delete-panel')).toBeVisible();
    await shot(page, 'he-13-hub-delete');
    await page.getByTestId('hub-delete-cancel').click();
    await expect(page.getByTestId('hub-row-T-ABCD')).toBeVisible();
    await page.getByTestId('hub-delete-T-ABCD').click();
    await page.getByTestId('hub-delete-confirm').click();
    await expect(page.getByTestId('hub-row-T-ABCD')).toHaveCount(0);
    expect((await readSessions(page)).map((s) => s.code)).toEqual([code]);
    if (DEMO) {
      const mock = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock.claude.db') || '{}'));
      expect(Object.keys(mock.docs)).toEqual([code]);
      // Reload: nothing changed, so nothing is written again; a session synced from another device shows up.
      await page.evaluate((s) => {
        const m = JSON.parse(sessionStorage.getItem('mock.claude.db') || '{}');
        m.docs['T-ZZ99'] = { ...s, code: 'T-ZZ99' };
        sessionStorage.setItem('mock.claude.db', JSON.stringify(m));
      }, saved);
      await page.reload();
      await expect(page.getByTestId('hub-row-T-ZZ99')).toHaveAttribute('data-where', 'remote');
      await expect(page.getByTestId(`hub-row-${code}`)).toHaveAttribute('data-where', 'synced');
      const after = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock.claude.db') || '{}'));
      expect(after.writes.filter((w) => w === code)).toHaveLength(1);
    }
    await page.getByTestId('hub-lang').click();
    await expect(page.getByTestId('pilot-hub')).toHaveAttribute('lang', 'en');
    await shot(page, 'en-12-hub');
    expect(errors).toEqual([]);
  });

  test('complete English tester session', async ({ page }) => {
    const errors = collectErrors(page);
    await runSession(page, 'en');
    expect(errors).toEqual([]);
  });

  test('stop: keep what was measured, or withdraw and delete', async ({ page }) => {
    const errors = collectErrors(page);
    const begin = async () => {
      await page.goto('/pilot/session.html?lang=he');
      for (const id of ['consent-adult', 'consent-agree', 'consent-terms']) await page.getByTestId(id).check();
      await page.getByTestId('consent-start').click();
      await page.getByTestId('bg-age-18-29').check();
      await page.getByTestId('bg-correction-none').check();
      await page.getByTestId('bg-holding-close').check();
      await page.getByTestId('bg-next').click();
      await page.getByTestId('practice-skip').click();
      // No correction: straight to "without glasses".
      await expect(page.getByTestId('pilot-withoutGlasses')).toBeVisible();
    };
    await begin();
    // A reload keeps the step (draft), after asking.
    await page.reload();
    await expect(page.getByTestId('pilot-resume')).toBeVisible();
    await page.getByTestId('resume-continue').click();
    await expect(page.getByTestId('pilot-withoutGlasses')).toBeVisible();
    await page.getByTestId('pilot-stop').click();
    await expect(page.getByTestId('stop-panel')).toBeVisible();
    await shot(page, 'he-14-stop');
    await page.getByTestId('stop-delete').click();
    await expect(page.getByTestId('pilot-deleted')).toBeVisible();
    expect(await readSessions(page)).toEqual([]);

    await begin();
    await page.getByTestId('pilot-stop').click();
    await page.getByTestId('stop-save').click();
    await expect(page.getByTestId('pilot-stopped')).toBeVisible();
    const list = await readSessions(page);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'stopped', withGlassesSkipped: 'no-correction' });
    await page.goto(HUB);
    await expect(page.getByTestId(`hub-row-${list[0].code}`)).toHaveAttribute('data-outcome', 'incomplete');
    await expect(page.getByTestId('stat-n')).toContainText('0');
    expect(errors).toEqual([]);
  });
});

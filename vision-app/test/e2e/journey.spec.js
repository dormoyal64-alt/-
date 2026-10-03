// @ts-check
/**
 * A10 — full customer journey in Hebrew, against the real server (mock payments):
 * landing -> register -> onboarding (glasses-free mode: mode choice -> basics -> "take your glasses off" -> every
 * measurement step incl. the REQUIRED focus range via the manual ruler path, scripted observer) -> results with the
 * "your screen without glasses" card (no clinical notation) -> home (distance chip) -> guide -> reader (distance coach)
 * -> settings (adapt UI) -> paywall -> mock checkout -> active -> cancel -> logout -> login.
 */
import { test, expect } from '@playwright/test';
import { collectErrors, uniqueEmail, PASSWORD, autopilot, waitForApp, apiRegister, seedProfile, gotoRoute } from './helpers.js';

const HE = {
  startFree: 'התחילו חודש חינם',
  // Glasses-free plan: the focus range comes right after the detail checks.
  stepTitles: [
    'כיול גודל המסך', 'מרחק הצפייה שלכם', 'פרטים קטנים – עין ימין', 'פרטים קטנים – עין שמאל', 'טווח המיקוד',
    'קריאה', 'ניגודיות', 'צבעים', 'חדות קווים – עין ימין', 'חדות קווים – עין שמאל',
  ],
  glassesOff: 'הורדת המשקפיים',
  statusActive: 'פעיל',
  statusCanceled: 'בוטל',
  mockPay: 'תשלום (מצב בדיקה)',
};

// BUG-01: the app picks its language from navigator.language only, so a visitor coming from the HEBREW landing page
// with an English-locale browser (e.g. the Pixel 7 profile, en-US) lands in an ENGLISH app. Kept as an expected failure.
test('BUG-01: Hebrew landing CTA opens the app in Hebrew even on an en-US browser', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: HE.startFree }).first().click();
  await waitForApp(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'he', { timeout: 3000 });
});

const CLINICAL = [/\d+\s*\/\s*\d+/, /logMAR/i, /דיופטר/, /dioptr|diopter/i, /snellen/i, /\b(6|20)\s*\/\s*\d{1,3}\b/];

for (const lang of /** @type {const} */ (['he', 'en'])) {
  test(`results screen shows no clinical notation (${lang})`, async ({ page }) => {
    await page.addInitScript((l) => { localStorage.setItem('va.lang', l); }, lang);
    await page.goto('/app/');
    await waitForApp(page);
    await apiRegister(page, { lang });
    await seedProfile(page);
    await page.reload();
    await waitForApp(page);
    await gotoRoute(page, '/results');
    await expect(page.getByTestId('result-textsize')).toBeVisible();
    const text = await page.locator('main').innerText();
    for (const re of CLINICAL) expect(text, String(re)).not.toMatch(re);
  });

  // BUG-05: the home summary prints the screen-detail score as "50/100" (home.js:77). A low score such as 20
  // renders as "20/100", indistinguishable from a Snellen acuity fraction — the results screen correctly says "50 מתוך 100".
  test(`BUG-05: home summary shows no Snellen-like "N/100" notation (${lang})`, async ({ page }) => {
    await page.addInitScript((l) => { localStorage.setItem('va.lang', l); }, lang);
    await page.goto('/app/');
    await waitForApp(page);
    await apiRegister(page, { lang });
    await seedProfile(page);
    await page.reload();
    await waitForApp(page);
    await gotoRoute(page, '/home');
    await expect(page.getByTestId('home-summary')).toBeVisible();
    const text = await page.locator('main').innerText();
    for (const re of CLINICAL) expect(text, String(re)).not.toMatch(re);
  });
}

test.describe('Hebrew-locale device', () => {
test.use({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });

test('full Hebrew customer journey: landing → onboarding → results → tools → subscribe → cancel → re-login', async ({ page }, testInfo) => {
  test.setTimeout(12 * 60_000);
  const errors = collectErrors(page);
  const email = uniqueEmail(`journey-${testInfo.project.name}`);

  await test.step('landing page shows live prices from /api/plans', async () => {
    const plansRes = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/plans');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const plans = await (await plansRes).json();
    expect(plans.plans.map((p) => p.id)).toEqual(['monthly', 'quarterly', 'yearly']);
    for (const p of plans.plans) {
      const expected = (p.price / 100).toFixed(2);
      await expect(page.locator(`[data-plan="${p.id}"] [data-field="price"]`)).toContainText(expected);
    }
    await expect(page.locator('[data-field="trial-days"]').first()).toHaveText(String(plans.trialDays));
  });

  await test.step('"start free month" → register (terms + disclaimer)', async () => {
    await page.getByRole('link', { name: HE.startFree }).first().click();
    await expect(page).toHaveURL(/\/app\/\?lang=he#\/register$/);
    await waitForApp(page);
    await expect(page.getByTestId('screen-register')).toBeVisible();
    // Submitting without consents must be refused client-side.
    await page.getByTestId('register-email').fill(email);
    await page.getByTestId('register-password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('form-alert')).toBeVisible();
    await page.getByTestId('register-terms').check();
    await page.getByTestId('register-disclaimer').check();
    await expect(page.getByTestId('register-lang-he')).toBeChecked();
    await page.getByTestId('register-submit').click();
    await expect(page).toHaveURL(/#\/onboarding/);
  });

  await test.step('onboarding mode: "without glasses" is recommended and preselected', async () => {
    await page.getByTestId('intro-start').click();
    await expect(page.getByTestId('onboarding-mode')).toBeVisible();
    await expect(page.getByTestId('mode-none')).toBeChecked();
    await expect(page.getByTestId('mode-wear')).not.toBeChecked();
    await expect(page.getByTestId('mode-recommended')).toBeVisible();
    await page.getByTestId('mode-continue').click();
    const mode = await page.evaluate(() => JSON.parse(localStorage.getItem('va.draft.onboarding') || '{}').mode);
    expect(mode).toBe('none');
  });

  await test.step('onboarding basics: name, age, glare; skip prescription', async () => {
    await expect(page.getByTestId('onboarding-basics')).toBeVisible();
    await expect(page.locator('[data-testid^="basics-glasses"]')).toHaveCount(0);
    await page.getByTestId('basics-name').fill('דנה');
    await page.getByTestId('basics-age').fill('52');
    await expect(page.getByTestId('minor-note')).toBeHidden();
    await expect(page.getByTestId('glasses-note')).toBeHidden();
    await page.getByTestId('basics-glare-high').check();
    await page.getByTestId('basics-hasrx').check();
    await page.getByTestId('basics-continue').click();
    await expect(page.getByTestId('onboarding-rx')).toBeVisible();
    await page.getByTestId('rx-skip').click();
  });

  await test.step('screen calibration: card slider matched twice, then confirmed', async () => {
    await expect(page.getByTestId('stage-title')).toHaveText(HE.stepTitles[0]);
    await page.getByTestId('screen-have-card').click();
    for (const n of [1, 2]) {
      await expect(page.getByTestId('screen-match-card')).toBeVisible();
      await expect(page.getByTestId('match-step')).toContainText(String(n));
      const slider = page.getByTestId('size-slider');
      const mid = await slider.evaluate((el) => {
        const i = /** @type {HTMLInputElement} */ (el);
        return Math.round((Number(i.min) + Number(i.max)) / 2);
      });
      await slider.fill(String(mid));
      await expect(slider).toHaveValue(String(mid));
      await page.getByTestId('match-done').click();
    }
    await expect(page.getByTestId('screen-confirm')).toBeVisible();
    await page.getByTestId('confirm-yes').click();
  });

  await test.step('"take your glasses off" before the viewing distance and the eye checks', async () => {
    await expect(page.getByTestId('glasses-off')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('stage-title')).toHaveText(HE.glassesOff);
    await expect(page.getByTestId('glasses-off')).toContainText('עדשות מגע');
    await page.getByTestId('glasses-off-continue').click();
    const off = await page.evaluate(() => JSON.parse(localStorage.getItem('va.draft.onboarding') || '{}').glassesOffDone);
    expect(off).toBe(true);
  });

  await test.step('distance: manual entry of 40 cm (400 mm)', async () => {
    await expect(page.getByTestId('stage-title')).toHaveText(HE.stepTitles[1]);
    await page.getByTestId('distance-manual-choice').click();
    await page.getByTestId('distance-manual-input').fill('40');
    await page.getByTestId('distance-manual-continue').click();
    await expect(page.getByTestId('distance-result')).toContainText('40');
    await page.getByTestId('distance-result-continue').click();
    await expect(page.getByTestId('stage-title')).not.toHaveText(HE.stepTitles[1], { timeout: 15_000 });
    const draftDistance = await page.evaluate(() => {
      const raw = localStorage.getItem('va.draft.onboarding');
      return raw ? JSON.parse(raw)?.results?.distance?.distanceMm : null;
    });
    expect(draftDistance).toBe(400);
  });

  await test.step('acuity R/L, focus range (required, ruler path), reading, contrast, colour, line sharpness', async () => {
    const focusSeen = [];
    const titles = await autopilot(page, {
      untilHash: /#\/results/,
      // The focus range is REQUIRED without glasses (no skip), and without a camera it uses the manual ruler path.
      onScreen: async (ids) => {
        const has = (/** @type {string} */ id) => ids.split(' ').includes(id);
        if (has('optional-focus')) throw new Error('the focus range must not be optional in glasses-free mode');
        if (has('focus-intro')) {
          await expect(page.getByTestId('focus-skip')).toHaveCount(0);
          focusSeen.push('intro');
          await page.getByTestId('focus-start').click();
          return true;
        }
        if (has('focus-camera-consent')) { await page.getByTestId('focus-camera-no').click(); return true; }
        if (has('focus-manual-near-screen')) {
          await expect(page.getByTestId('focus-no-camera')).toBeVisible();
          focusSeen.push('near');
          await page.getByTestId('focus-manual-near').fill('25');
          await page.getByTestId('focus-manual-near-continue').click();
          return true;
        }
        if (has('focus-manual-far-screen')) {
          // "It never gets blurry within my arm's reach"
          await expect(page.getByTestId('focus-manual-far-sharp')).toContainText('מרחק יד');
          focusSeen.push('far');
          await page.getByTestId('focus-manual-far-sharp').click();
          return true;
        }
        if (has('focus-result')) {
          await expect(page.getByTestId('focus-result')).toContainText('בלי משקפיים');
          focusSeen.push('result');
          await page.getByTestId('focus-result-continue').click();
          return true;
        }
        return false;
      },
    });
    expect(focusSeen).toEqual(['intro', 'near', 'far', 'result']);
    // Every measurement step was visited, in plan order.
    const seen = HE.stepTitles.slice(2).map((s) => titles.indexOf(s));
    expect(seen.every((i) => i >= 0), `titles seen: ${titles.join(' | ')}`).toBe(true);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  await test.step('results: "your screen without glasses" card, functional scores and NO clinical notation', async () => {
    await expect(page.getByTestId('screen-results')).toBeVisible();
    const gf = page.getByTestId('results-glasses-free');
    await expect(gf).toBeVisible();
    await expect(page.getByTestId('gf-verdict')).toBeVisible();
    await expect(page.getByTestId('gf-distance')).toContainText('החזיקו את הטלפון');
    await expect(page.getByTestId('gf-distance')).toContainText('ס״מ');
    await expect(page.getByTestId('gf-honest')).toBeVisible();
    expect(await page.getByTestId('gf-tips').locator('li').count()).toBeGreaterThan(0);
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('va.profiles.v1') || '[]'));
    const dana = (Array.isArray(saved) ? saved : []).find((x) => x && x.name === 'דנה');
    expect(dana?.input?.wearsCorrection).toBe(false);
    expect(dana?.input?.focus?.nearPointMm).toBe(250);
    expect(dana?.input?.focus?.farPointMm ?? null).toBe(null);
    await expect(page.getByTestId('result-textsize')).toBeVisible();
    await expect(page.getByTestId('results-disclaimer')).toBeVisible();
    await expect(page.getByTestId('results-tech')).toHaveCount(0);
    const text = await page.locator('main').innerText();
    expect(text).toContain('דנה');
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/); // Snellen 6/x, 20/x
    expect(text).not.toMatch(/logMAR/i);
    expect(text).not.toMatch(/דיופטר/);
    expect(text).not.toMatch(/diopter|dioptre/i);
    // Scores are stored on-device only.
    const stored = await page.evaluate(() => localStorage.getItem('va.profiles.v1'));
    expect(stored).toContain('"name":"דנה"');
  });

  await test.step('home shows the profile summary and tools', async () => {
    await page.locator('a[href="#/home"]').first().click();
    await expect(page.getByTestId('screen-home')).toBeVisible();
    await expect(page.getByTestId('home-summary')).toBeVisible();
    await expect(page.getByTestId('home-distance-chip')).toContainText('ס״מ');
    await expect(page.getByTestId('home-gf-verdict')).toBeVisible();
    for (const id of ['qa-photo', 'qa-video', 'qa-magnifier', 'qa-reader', 'qa-guide']) await expect(page.getByTestId(id)).toBeVisible();
  });

  await test.step('guide shows sections for the detected platform', async () => {
    await page.getByTestId('qa-guide').click();
    await expect(page.getByTestId('screen-guide')).toBeVisible();
    const expected = await page.evaluate(async () => {
      const m = await import('/app/js/engine/system-guide.js');
      return m.detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    });
    expect(expected).toBe(testInfo.project.name === 'phone' ? 'android' : 'desktop');
    await expect(page.getByTestId(`platform-${expected}`)).toBeChecked();
    expect(await page.locator('[data-testid^="guide-section-"]').count()).toBeGreaterThan(0);
  });

  await test.step('reader viewer renders pasted text', async () => {
    await page.evaluate(() => { location.hash = '#/home'; });
    await page.getByTestId('qa-reader').click();
    await expect(page.getByTestId('reader')).toBeVisible();
    // Distance coach: a small, dismissible reminder; no camera without a tap (none here: manual distance, no focal length).
    await expect(page.getByTestId('coach-text')).toContainText('ס״מ');
    await expect(page.getByTestId('coach-camera')).toHaveCount(0);
    const sample = 'שלום עולם. זהו טקסט לבדיקה של הקורא.';
    await page.getByTestId('reader-input').fill(sample);
    await page.getByTestId('reader-show').click();
    await expect(page.getByTestId('reader-surface')).toContainText('שלום עולם');
    const before = await page.getByTestId('reader-surface').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await page.getByTestId('reader-larger').click();
    await expect.poll(() => page.getByTestId('reader-surface').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(before);
    await page.getByTestId('coach-dismiss').click();
    await expect(page.getByTestId('distance-coach')).toHaveCount(0);
  });

  await test.step('settings: toggling "adapt this app" changes --va-font-scale on :root', async () => {
    await page.evaluate(() => { location.hash = '#/settings'; });
    await expect(page.getByTestId('screen-settings')).toBeVisible();
    const readScale = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--va-font-scale'));
    const sw = page.getByTestId('settings-adapt');
    await expect(sw).toBeChecked();
    const on = await readScale();
    expect(on).not.toBe('');
    await sw.click();
    await expect(sw).not.toBeChecked();
    await expect.poll(readScale).not.toBe(on);
    await sw.click();
    await expect(sw).toBeChecked();
    await expect.poll(readScale).toBe(on);
  });

  await test.step('paywall shows 3 plans; monthly → mock hosted page → paid', async () => {
    await page.evaluate(() => { location.hash = '#/paywall'; });
    await expect(page.getByTestId('screen-paywall')).toBeVisible();
    await expect(page.locator('[data-testid^="plan-card-"]')).toHaveCount(3);
    for (const id of ['monthly', 'quarterly', 'yearly']) await expect(page.getByTestId(`plan-card-${id}`)).toBeVisible();
    await page.getByTestId('plan-monthly').click();
    await expect(page).toHaveURL(/\/api\/billing\/mock\/checkout\/mock_cs_/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HE.mockPay);
    await page.getByRole('button', { name: HE.mockPay }).click();
    await expect(page).toHaveURL(/\/app\/#\/account/);
    await expect(page.getByTestId('checkout-success')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('account-status')).toHaveText(HE.statusActive);
  });

  await test.step('cancel: one click, status canceled but access kept', async () => {
    await page.getByTestId('account-cancel').click();
    await expect(page.getByTestId('cancel-dialog')).toBeVisible();
    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByTestId('account-status')).toHaveText(HE.statusCanceled);
    await expect(page.getByTestId('account-when')).toContainText('הגישה נשמרת עד');
    const me = await page.evaluate(async () => (await fetch('/api/me')).json());
    expect(me.entitlement.hasAccess).toBe(true);
    expect(me.entitlement.status).toBe('canceled');
  });

  await test.step('logout, then log in again', async () => {
    await page.getByTestId('account-logout').click();
    await expect(page).toHaveURL(/#\/welcome/);
    await expect(page.getByTestId('screen-welcome')).toBeVisible();
    const me = await page.evaluate(async () => (await fetch('/api/me')).status);
    expect(me).toBe(401);
    await page.getByTestId('welcome-login').click();
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/#\/home/);
    await expect(page.getByTestId('home-summary')).toBeVisible();
  });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('under 18: "without glasses" is replaced by the eye-care professional\'s advice (no glasses-off step)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/app/');
  await waitForApp(page);
  await apiRegister(page, { lang: 'he' });
  await page.reload();
  await waitForApp(page);
  await gotoRoute(page, '/onboarding');
  await page.getByTestId('intro-start').click();
  await expect(page.getByTestId('mode-none')).toBeChecked();
  await page.getByTestId('mode-continue').click();
  await page.getByTestId('basics-name').fill('נועה');
  await page.getByTestId('basics-age').fill('12');
  await expect(page.getByTestId('minor-note')).toBeVisible();
  await expect(page.getByTestId('minor-note')).toContainText('איש המקצוע');
  await page.getByTestId('basics-continue').click();
  await expect(page.getByTestId('stage-title')).toHaveText(HE.stepTitles[0]);
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('va.draft.onboarding') || '{}'));
  expect(draft.mode).toBe('wear');
  expect(draft.glassesOffDone).toBe(false);
  expect(errors, errors.join('\n')).toEqual([]);
});
});

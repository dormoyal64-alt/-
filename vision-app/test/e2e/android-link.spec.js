// @ts-check
/**
 * "Adapt my whole phone" on Android / Samsung: the card that hands the profile's display values to the
 * SeeTuned Android app (engine/android-link.js), and the notice shown when the app is not installed.
 */
import { test, expect } from '@playwright/test';
import { apiRegister, seedProfile, waitForApp, gotoRoute, collectErrors } from './helpers.js';

test('Android guide links to the SeeTuned Android app with the profile recipe', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/app/?lang=he');
  await waitForApp(page);
  await apiRegister(page, { lang: 'he' });
  await seedProfile(page);
  await page.reload();
  await waitForApp(page);
  await gotoRoute(page, '/guide');
  await page.getByTestId('platform-samsung').check();

  const card = page.getByTestId('guide-companion');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('guide-companion-missing')).toHaveCount(0);
  const href = String(await page.getByTestId('guide-companion-open').getAttribute('href'));
  expect(href.startsWith('intent://apply?v=1&lang=he&')).toBe(true);
  expect(href).toContain('#Intent;scheme=seetuned;package=com.seetuned.companion;S.browser_fallback_url=');
  expect(href.endsWith(';end')).toBe(true);

  // The link carries exactly what the engine builds for the active profile, and comes back to this guide without the app.
  const expected = await page.evaluate(async () => {
    const storage = await import('/app/js/core/storage.js');
    const link = await import('/app/js/engine/android-link.js');
    return link.buildAndroidRecipe(storage.getActiveProfile(), 'he').toString();
  });
  expect(href.slice('intent://apply?'.length, href.indexOf('#Intent;'))).toBe(expected);
  const fallback = decodeURIComponent(href.split('S.browser_fallback_url=')[1].replace(/;end$/, ''));
  expect(new URL(fallback).origin).toBe(new URL(page.url()).origin);
  expect(new URL(fallback).hash).toBe('#/guide?companion=missing');

  // The manual steps are still there under the card.
  expect(await page.locator('[data-testid^="guide-section-"]').count()).toBeGreaterThan(0);

  // iPhone has no such app: no card.
  await page.getByTestId('platform-ios').check();
  await expect(card).toHaveCount(0);
  await page.getByTestId('platform-android').check();
  await expect(page.getByTestId('guide-companion')).toBeVisible();
  expect(errors).toEqual([]);
});

test('without the app installed, the guide says so (pilot only for now)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/app/?lang=en');
  await waitForApp(page);
  await apiRegister(page, { lang: 'en' });
  await seedProfile(page);
  await page.evaluate(() => { try { localStorage.setItem('va.guide.platform', 'samsung'); } catch { /* ignore */ } });
  await page.reload();
  await waitForApp(page);
  await page.evaluate(() => { location.hash = '#/guide?companion=missing'; });
  await expect(page.locator('html')).toHaveAttribute('data-route', '/guide');
  const missing = page.getByTestId('guide-companion-missing');
  await expect(missing).toBeVisible();
  await expect(missing).toContainText('isn’t installed');
  await expect(missing).toContainText('pilot testers');
  await expect(page.getByTestId('guide-companion-get')).toHaveCount(0);
  expect(errors).toEqual([]);
});

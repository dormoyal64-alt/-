// @ts-check
/**
 * Result contracts of the real test views, driven through the dev harness (bug hunt A14):
 * the acuity view must pass the procedure's ceilingLimited / sd / ci95 / reasons through to the engine.
 * cssPxPerMm=40 pretends the screen is ~10 mm wide, so the largest letter that fits is below the observer's threshold.
 */
import { test, expect } from '@playwright/test';

test.beforeEach(({ page: _page }, testInfo) => { test.skip(testInfo.project.name !== 'phone', 'phone viewport only'); });

/** @type {Record<string, string>} */
const WRONG = { up: 'down', down: 'up', left: 'right', right: 'left' };

test('acuity result carries ceilingLimited, sd, ci95 and reasons (never-resolving observer)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app/dev/harness.html?src=js/tests/acuity/acuity-view.js&fn=runAcuityTest&eye=right&lang=en&cssPxPerMm=40');
  const status = page.getByTestId('harness-result');
  for (let i = 0; i < 400; i++) {
    if ((await status.getAttribute('data-status')) === 'done') break;
    const snap = await page.evaluate(() => {
      const c = /** @type {HTMLElement|null} */ (document.querySelector('[data-testid="acuity-canvas"]'));
      const pad = document.querySelector('.va-pad');
      const btn = /** @type {HTMLElement|null} */ (document.querySelector('[data-testid="instruction-primary"]'));
      return { o: c?.dataset.orientation || null, ready: !!pad && !pad.classList.contains('is-disabled'), btn: !!btn && btn.offsetParent !== null };
    });
    if (snap.o && snap.ready) await page.getByTestId(`pad-${WRONG[snap.o]}`).click();
    else if (snap.btn) await page.getByTestId('instruction-primary').click();
    else await page.waitForTimeout(100);
  }
  await expect(status).toHaveAttribute('data-status', 'done');
  const r = JSON.parse(String(await status.textContent()));
  expect(r.ceilingLimited).toBe(true);
  expect(typeof r.sd).toBe('number');
  expect(Array.isArray(r.ci95) && r.ci95.length === 2 && r.ci95[0] <= r.logMAR && r.logMAR <= r.ci95[1]).toBe(true);
  expect(Array.isArray(r.reasons)).toBe(true);
  expect(r.reliable).toBe(r.reasons.length === 0);
  expect(errors).toEqual([]);
});

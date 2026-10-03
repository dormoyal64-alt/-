// @ts-check
/**
 * Reader layout at large profile text sizes (bug found by the glasses-free simulation): the reader must never
 * scroll horizontally on 320–412 px phones for profile text up to 64 px — long words wrap, the controls wrap.
 */
import { test, expect } from '@playwright/test';
import { apiRegister, gotoRoute, waitForApp } from './helpers.js';

const LONG = 'https://www.example.com/a/very/long/path/without/any/spaces/at/all/to/force/wrapping '
  + 'אנטידיסאסטבלישמנטריאניזם supercalifragilisticexpialidocious '
  + 'שלום עולם. זהו טקסט ארוך לבדיקת גלישה בקורא. Hello world, this is a long reader text.';

test.describe('reader layout at large text', () => {
  test.beforeEach(({ page: _page }, testInfo) => { test.skip(testInfo.project.name !== 'phone', 'viewport loop runs once (phone project)'); });

  for (const px of [44, 64]) {
    test(`no horizontal scroll at ${px} px text, 320–412 px wide`, async ({ page }) => {
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto('/app/?lang=he');
      await waitForApp(page);
      await apiRegister(page);
      await page.evaluate(async ({ px }) => {
        const storage = await import('/app/js/core/storage.js');
        const demo = await import('/app/js/core/demo-profile.js');
        const engine = await import('/app/js/engine/profile.js');
        const p = engine.computeProfile(demo.demoProfile().input, { id: storage.newId(), name: 'Big', now: Date.now() });
        p.text = { ...p.text, baseFontPx: px, scale: px / 16 };
        storage.saveProfile(p);
        storage.setActiveProfileId(p.id);
        localStorage.setItem('va.disclaimerAck', new Date().toISOString());
        localStorage.setItem('va.coachDismissed', `${p.id}:${p.updatedAt}`);
      }, { px });
      await page.reload();
      await waitForApp(page);
      await gotoRoute(page, '/viewer/reader');
      await page.getByTestId('reader-input').fill(LONG);
      const overflow = () => page.evaluate(() => {
        const de = document.documentElement;
        const wide = [...document.querySelectorAll('[data-testid="reader"] *')]
          .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1 || el.getBoundingClientRect().left < -1)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
        return { doc: de.scrollWidth, vw: de.clientWidth, wide: wide.slice(0, 5) };
      });
      for (const width of [320, 360, 393, 412]) {
        await page.setViewportSize({ width, height: 800 });
        let o = await overflow();
        expect(o.doc, `editor @${width}px: ${o.wide.join(', ')}`).toBeLessThanOrEqual(o.vw);
        await page.getByTestId('reader-show').click();
        await expect(page.getByTestId('reader-reading')).toBeVisible();
        expect(await page.getByTestId('reader-surface').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(px);
        o = await overflow();
        expect(o.doc, `reading @${width}px: ${o.wide.join(', ')}`).toBeLessThanOrEqual(o.vw);
        expect(o.wide, `reading @${width}px`).toEqual([]);
        // a sticky toolbar must never cover more than a third of the screen (it would hide the text)
        const bar = await page.locator('.va-reader__toolbar').evaluate((el) => ({ pos: getComputedStyle(el).position, h: el.getBoundingClientRect().height, vh: innerHeight }));
        expect(bar.pos === 'static' || bar.h <= bar.vh / 3, JSON.stringify(bar)).toBe(true);
        if (px === 64 && width === 320) await page.screenshot({ path: test.info().outputPath('reader-64px-320.png'), fullPage: true });
        await page.getByTestId('reader-edit').click();
        await expect(page.getByTestId('reader-input')).toBeVisible();
      }
    });
  }
});

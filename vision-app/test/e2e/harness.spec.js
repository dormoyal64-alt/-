// @ts-check
import { test, expect } from '@playwright/test';

test('harness mounts a view, shared UI kit works, result is reported', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app/dev/harness.html?src=dev/sample-view.js&fn=runSample&eye=left&lang=he');
  await expect(page.getByTestId('cover-eye-left')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'כסו את העין הימנית' })).toBeVisible();
  await page.getByTestId('instruction-primary').click();
  await page.getByTestId('pad-up').click();
  await expect(page.getByTestId('harness-result')).toHaveAttribute('data-status', 'done');
  const result = JSON.parse(await page.getByTestId('harness-result').textContent());
  expect(result).toEqual({ answer: 'up', eye: 'left' });
  expect(await page.getByTestId('harness-stage').evaluate((el) => el.childElementCount)).toBe(0);
  expect(errors).toEqual([]);
});

test('harness abort triggers cleanup and AbortError', async ({ page }) => {
  await page.goto('/app/dev/harness.html?src=dev/sample-view.js&fn=runSample&eye=right&lang=en');
  await page.getByTestId('instruction-primary').click();
  await expect(page.getByTestId('pad-left')).toBeVisible();
  await page.getByTestId('harness-abort').click();
  await expect(page.getByTestId('harness-result')).toHaveAttribute('data-status', 'aborted');
  expect(await page.getByTestId('harness-stage').evaluate((el) => el.childElementCount)).toBe(0);
});

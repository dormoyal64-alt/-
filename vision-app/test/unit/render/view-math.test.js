import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitScale, sourceUvAt, outputPointOfUv, clampView, zoomAtPoint, panByPixels, imageRect, isSafeMediaUrl, identityView,
} from '../../../public/app/js/render/view-math.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);

test('fitScale contain / cover', () => {
  assert.equal(fitScale(2000, 1000, 400, 800), 0.2);
  assert.equal(fitScale(2000, 1000, 400, 800, 'cover'), 0.8);
  assert.equal(fitScale(0, 1000, 400, 800), 0);
});

test('centre maps to centre; image corners map to the fitted rectangle', () => {
  const v = identityView();
  assert.deepEqual(sourceUvAt(200, 400, v, 2000, 1000, 400, 800), [0.5, 0.5]);
  const r = imageRect(v, 2000, 1000, 400, 800);
  near(r.x, 0); near(r.y, 300); near(r.w, 400); near(r.h, 200);
  const [x, y] = outputPointOfUv(1, 1, v, 2000, 1000, 400, 800);
  near(x, 400); near(y, 500);
});

test('zoomAtPoint keeps the anchor fixed', () => {
  const v = { zoom: 1.3, panX: 0.05, panY: -0.02 };
  const before = sourceUvAt(120, 610, v, 1600, 1200, 390, 700);
  const z = zoomAtPoint(v, 3.1, 120, 610, 1600, 1200, 390, 700);
  const after = sourceUvAt(120, 610, z, 1600, 1200, 390, 700);
  near(after[0], before[0]); near(after[1], before[1]);
  assert.equal(z.zoom, 3.1);
});

test('panByPixels: content follows the finger', () => {
  const v = { zoom: 2, panX: 0, panY: 0 };
  const uv0 = sourceUvAt(100, 100, v, 1000, 1000, 400, 400);
  const p = panByPixels(v, 30, -20, 1000, 1000, 400, 400);
  const uv1 = sourceUvAt(130, 80, p, 1000, 1000, 400, 400);
  near(uv1[0], uv0[0]); near(uv1[1], uv0[1]);
});

test('clampView: zoom range, centred when smaller, edges stay out when larger', () => {
  const c0 = clampView({ zoom: 1, panX: 0.3, panY: -0.3 }, 1000, 1000, 400, 400);
  assert.equal(c0.zoom, 1); near(c0.panX, 0); near(c0.panY, 0);
  assert.equal(clampView({ zoom: 50, panX: 0, panY: 0 }, 1000, 1000, 400, 400, { maxZoom: 8 }).zoom, 8);
  assert.equal(clampView({ zoom: 0.2, panX: 0, panY: 0 }, 1000, 1000, 400, 400).zoom, 1);
  const c = clampView({ zoom: 2, panX: 1, panY: -1 }, 1000, 1000, 400, 400);
  near(c.panX, 0.25); near(c.panY, -0.25);
  // wide image in tall viewport at zoom 2: vertical extent smaller than viewport -> centred
  const w = clampView({ zoom: 2, panX: 0, panY: 0.4 }, 2000, 1000, 400, 800);
  near(w.panY, 0);
  const cover = clampView({ zoom: 1, panX: 0.4, panY: 0.4 }, 2000, 1000, 400, 800, { fit: 'cover' });
  near(cover.panY, 0); near(cover.panX, 0.5 - 200 / (0.8 * 2000));
});

test('isSafeMediaUrl: only same-origin, blob of this origin, data', () => {
  const o = 'https://app.example';
  assert.equal(isSafeMediaUrl('blob:https://app.example/123-abc', o), true);
  assert.equal(isSafeMediaUrl('blob:https://evil.example/123-abc', o), false);
  assert.equal(isSafeMediaUrl('https://app.example/img/a.png', o), true);
  assert.equal(isSafeMediaUrl('/img/a.png', o), true);
  assert.equal(isSafeMediaUrl('https://cdn.example/a.png', o), false);
  assert.equal(isSafeMediaUrl('data:image/png;base64,AAAA', o), true);
  assert.equal(isSafeMediaUrl('javascript:alert(1)', o), false);
  assert.equal(isSafeMediaUrl('', o), false);
});

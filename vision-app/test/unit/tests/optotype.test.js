import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tumblingERects, surroundRects, layoutTumblingE } from '../../../public/app/js/tests/acuity/optotype.js';
import { nextOrientation, mulberry32, DIRECTIONS } from '../../../public/app/js/tests/acuity/random.js';

/** Rasterise rectangles on a 5×5 cell grid (1 cell = 1 stroke) to check the letter shape. */
function cells(rects, s, x0 = 0, y0 = 0) {
  const g = Array.from({ length: 5 }, () => Array(5).fill('.'));
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const cx = x0 + (c + 0.5) * s; const cy = y0 + (r + 0.5) * s;
    if (rects.some((q) => cx > q.x && cx < q.x + q.w && cy > q.y && cy < q.y + q.h)) g[r][c] = '#';
  }
  return g.map((row) => row.join('')).join('\n');
}

test('Tumbling E shapes: 5×5 strokes, 3 bars, 1-stroke gaps, open side = orientation', () => {
  assert.equal(cells(tumblingERects(0, 0, 1, 'right'), 1), '#####\n#....\n#####\n#....\n#####');
  assert.equal(cells(tumblingERects(0, 0, 1, 'left'), 1), '#####\n....#\n#####\n....#\n#####');
  assert.equal(cells(tumblingERects(0, 0, 1, 'down'), 1), '#####\n#.#.#\n#.#.#\n#.#.#\n#.#.#');
  assert.equal(cells(tumblingERects(0, 0, 1, 'up'), 1), '#.#.#\n#.#.#\n#.#.#\n#.#.#\n#####');
  // non-integer stroke keeps exact geometry
  const s = 2.37;
  assert.equal(cells(tumblingERects(10, 20, s, 'right'), s, 10, 20), '#####\n#....\n#####\n#....\n#####');
  const rects = tumblingERects(10, 20, s, 'up');
  const maxX = Math.max(...rects.map((r) => r.x + r.w)); const maxY = Math.max(...rects.map((r) => r.y + r.h));
  assert.ok(Math.abs(maxX - (10 + 5 * s)) < 1e-9 && Math.abs(maxY - (20 + 5 * s)) < 1e-9);
});

test('surround bars: 1 stroke thick, 5 long, 2.5 strokes edge-to-edge gap', () => {
  const s = 3;
  const [top, bottom, left, right] = surroundRects(100, 100, s);
  assert.deepEqual(top, { x: 100, y: 100 - 2.5 * s - s, w: 5 * s, h: s });
  assert.equal(bottom.y - (100 + 5 * s), 2.5 * s);
  assert.equal(100 - (left.x + left.w), 2.5 * s);
  assert.equal(right.x - (100 + 5 * s), 2.5 * s);
  assert.equal(left.h, 5 * s);
});

test('layout snaps only the position to whole device pixels, never the stroke', () => {
  const lay = layoutTumblingE({ devW: 945, devH: 945, strokeDevPx: 2.4, orientation: 'left' });
  assert.equal(lay.stroke, 2.4);
  assert.ok(Number.isInteger(lay.x0) && Number.isInteger(lay.y0));
  assert.ok(Math.abs(lay.x0 + 2.5 * 2.4 - 472.5) <= 0.5);
  assert.equal(lay.rects.length, 8);
  const snapped = layoutTumblingE({ devW: 900, devH: 900, strokeDevPx: 37.6, orientation: 'up', surround: false, snapStroke: true });
  assert.equal(snapped.stroke, 38);
  assert.equal(snapped.rects.length, 4);
});

test('orientation sequence never repeats one direction three times in a row and covers all four', () => {
  const rng = mulberry32(42);
  const hist = [];
  for (let i = 0; i < 2000; i++) hist.push(nextOrientation(rng, hist));
  for (let i = 2; i < hist.length; i++) assert.ok(!(hist[i] === hist[i - 1] && hist[i] === hist[i - 2]));
  for (const d of DIRECTIONS) {
    const f = hist.filter((x) => x === d).length / hist.length;
    assert.ok(f > 0.2 && f < 0.3, `${d} frequency ${f}`);
  }
});

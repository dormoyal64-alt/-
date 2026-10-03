// @ts-check
/**
 * Image check for the glasses-free validation: renders the REAL app reader with a simulated user's profile, then blurs
 * the screenshot with that user's point-spread function (eye-model.js psfKernel) scaled to the viewing distance and
 * the screen's px/mm — "default 16 px at the habitual distance" vs "SeeTuned profile at the recommended distance",
 * both WITHOUT glasses. Panels are scaled by the visual angle (a screen held farther away looks smaller).
 *
 *   node scripts/sim/render-views.js            # starts the real server on :4111, writes docs/validation/images/*.png
 *
 * The convolution runs in the page (FFT on linear-light RGB). Internal research images.
 */
/* global Image, document, window, location, HTMLElement, getComputedStyle -- functions passed to page.evaluate run in the browser */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildCohort } from '../../public/app/js/sim/cohort.js';
import { simulateUser } from '../../public/app/js/sim/pipeline.js';
import { evaluateRun } from '../../public/app/js/sim/evaluate.js';
import { eyeState, psfKernel } from '../../public/app/js/sim/eye-model.js';
import { neutralFilterParams } from '../../public/app/js/core/types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'docs/validation/images');
const PORT = 4111;
const BASE = `http://127.0.0.1:${PORT}`;
const DPR = 2;
const CROP_CSS_H = 380;
// Users whose profile hits the 64 px UI cap are not shown: the reader layout overflows horizontally at that size
// (reported as a UI issue; see docs/validation/SIMULATION-REPORT.md).
const USERS = process.env.SIM_USERS ? process.env.SIM_USERS.split(',') : ['myo-1-30', 'myo-3-27', 'myo-4-38', 'myo-6-36', 'presb-45', 'presb-55', 'ast0-1.5x90', 'myo-2-55'];
const TEXT_HE = 'בבוקר יצאנו לטייל ליד הים. הרוח הייתה נעימה והשמים היו בהירים. ' +
  'ישבנו על החול, שתינו קפה חם וקראנו עיתון. אחר כך הלכנו לאורך החוף ואספנו צדפים קטנים. ' +
  'בצהריים אכלנו סלט טרי ולחם חם במסעדה קטנה ליד הנמל, וחזרנו הביתה לפני השקיעה.';

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const dataDir = resolve(ROOT, `.tmp-sim-render-${process.pid}`);
  mkdirSync(dataDir, { recursive: true });
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', DATA_DIR: dataDir, SESSION_SECRET: 'sim-render-secret-0123456789abcdefghijklmn', PAYMENT_PROVIDER: 'mock' },
  });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return { child, dataDir }; } catch { /* not up yet */ }
    await sleep(100);
  }
  child.kill();
  throw new Error('server did not start');
}

/**
 * Runs in the page: blur an RGBA screenshot (base64 PNG) with a PSF via FFT in linear light; returns a canvas.
 * Kept self-contained because Playwright serialises it.
 * @param {{png: string, kernel: number[], ksize: number, cropH: number}} o
 */
function pageBlur({ png, kernel, ksize, cropH }) {
  return new Promise((resolveP) => {
    const img = new Image();
    img.onload = () => {
      const W = img.width;
      const H = Math.min(img.height, cropH);
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
      g.drawImage(img, 0, 0);
      const id = g.getImageData(0, 0, W, H);
      const r = (ksize - 1) / 2;
      let N = 1; while (N < W + 2 * r) N <<= 1;
      let M = 1; while (M < H + 2 * r) M <<= 1;
      /** In-place radix-2 FFT of `n` complex values at stride `s` from offset `o`. */
      const fft1 = (/** @type {Float64Array} */ re, /** @type {Float64Array} */ im, o, s, n, inv) => {
        for (let i = 1, j = 0; i < n; i++) {
          let bit = n >> 1;
          for (; j & bit; bit >>= 1) j ^= bit;
          j ^= bit;
          if (i < j) { const a = o + i * s; const b = o + j * s; let t = re[a]; re[a] = re[b]; re[b] = t; t = im[a]; im[a] = im[b]; im[b] = t; }
        }
        for (let len = 2; len <= n; len <<= 1) {
          const ang = (2 * Math.PI) / len * (inv ? 1 : -1);
          const wr = Math.cos(ang); const wi = Math.sin(ang);
          for (let i = 0; i < n; i += len) {
            let cr = 1; let ci = 0;
            for (let k = 0; k < len / 2; k++) {
              const a = o + (i + k) * s; const b = o + (i + k + len / 2) * s;
              const xr = re[b] * cr - im[b] * ci; const xi = re[b] * ci + im[b] * cr;
              re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
              const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
            }
          }
        }
      };
      const fft2 = (/** @type {Float64Array} */ re, /** @type {Float64Array} */ im, inv) => {
        for (let y = 0; y < M; y++) fft1(re, im, y * N, 1, N, inv);
        for (let x = 0; x < N; x++) fft1(re, im, x, N, M, inv);
      };
      const kr = new Float64Array(N * M); const ki = new Float64Array(N * M);
      for (let y = 0; y < ksize; y++) for (let x = 0; x < ksize; x++) {
        const yy = (y - r + M) % M; const xx = (x - r + N) % N;
        kr[yy * N + xx] = kernel[y * ksize + x];
      }
      fft2(kr, ki, false);
      const lin = (/** @type {number} */ v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const srgb = (/** @type {number} */ v) => { const c = Math.max(0, Math.min(1, v)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); };
      const LUT = new Float64Array(256); for (let i = 0; i < 256; i++) LUT[i] = lin(i);
      for (let ch = 0; ch < 3; ch++) {
        const re = new Float64Array(N * M); const im = new Float64Array(N * M);
        for (let y = 0; y < M; y++) {
          const sy = Math.min(H - 1, Math.max(0, y < H + r ? y : y - M)); // clamp-to-edge padding (wraps above)
          for (let x = 0; x < N; x++) {
            const sx = Math.min(W - 1, Math.max(0, x < W + r ? x : x - N));
            re[y * N + x] = LUT[id.data[(sy * W + sx) * 4 + ch]];
          }
        }
        fft2(re, im, false);
        for (let i = 0; i < N * M; i++) { const a = re[i]; const b = im[i]; re[i] = a * kr[i] - b * ki[i]; im[i] = a * ki[i] + b * kr[i]; }
        fft2(re, im, true);
        const scale = 1 / (N * M);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) id.data[(y * W + x) * 4 + ch] = srgb(re[y * N + x] * scale);
      }
      g.putImageData(id, 0, 0);
      /** @type {any} */ (window).__panels = (/** @type {any} */ (window).__panels || []);
      /** @type {any} */ (window).__panels.push(cv);
      resolveP(/** @type {any} */ (window).__panels.length - 1);
    };
    img.src = `data:image/png;base64,${png}`;
  });
}

/**
 * Runs in the page: compose panels side by side, each scaled by its visual-angle factor, with captions.
 * @param {{panels: Array<{index: number, scale: number, caption: string[]}>, title: string, outScale: number}} o
 */
function pageCompose({ panels, title, outScale }) {
  const cvs = /** @type {any} */ (window).__panels;
  const gap = 24; const head = 70; const foot = 110;
  const ws = panels.map((p) => Math.round(cvs[p.index].width * p.scale * outScale));
  const hs = panels.map((p) => Math.round(cvs[p.index].height * p.scale * outScale));
  const W = ws.reduce((a, b) => a + b, 0) + gap * (panels.length + 1);
  const H = Math.max(...hs) + head + foot;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#111'; g.font = 'bold 20px sans-serif'; g.fillText(title, gap, 32);
  let x = gap;
  panels.forEach((p, i) => {
    const y = head + Math.round((Math.max(...hs) - hs[i]) / 2);
    g.imageSmoothingQuality = 'high';
    g.drawImage(cvs[p.index], x, y, ws[i], hs[i]);
    g.strokeStyle = '#888'; g.strokeRect(x - 0.5, y - 0.5, ws[i] + 1, hs[i] + 1);
    g.fillStyle = '#111'; g.font = '15px sans-serif';
    p.caption.forEach((line, k) => g.fillText(line, x, head + Math.max(...hs) + 24 + k * 20));
    x += ws[i] + gap;
  });
  return out.toDataURL('image/png').split(',')[1];
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith('.png')) rmSync(join(OUT, f));
  const { child, dataDir } = await startServer();
  const browser = await chromium.launch();
  try {
    const cohort = buildCohort();
    for (const id of USERS) {
      const user = /** @type {import('../../public/app/js/sim/cohort.js').SimUser} */ (cohort.find((u) => u.id === id));
      const run = simulateUser(user, { rep: 0 });
      const ev = evaluateRun(run);
      const profile = run.profile;
      const baseline = {
        ...profile, id: `${profile.id}-default`,
        text: { baseFontPx: 16, scale: 1, fontWeight: 400, lineHeight: 1.5, letterSpacingEm: 0, wordSpacingEm: 0 },
        ui: neutralFilterParams(),
      };
      const ctx = await browser.newContext({ viewport: { width: user.device.widthCssPx, height: user.device.heightCssPx }, deviceScaleFactor: DPR, locale: 'he-IL' });
      const page = await ctx.newPage();
      const shots = [];
      await page.goto(`${BASE}/app/?lang=he`);
      await page.waitForSelector('#app[data-state="ready"]', { timeout: 20000 });
      const email = `sim-${id.replace(/[^a-z0-9]/gi, '')}-${Date.now()}@example.com`;
      await page.evaluate(async ({ email }) => {
        const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email, password: 'Correct-Horse-Battery-9', lang: 'he', acceptTerms: true }) });
        if (r.status !== 201) throw new Error(`register ${r.status}`);
      }, { email });
      for (const p of [baseline, profile]) {
        await page.evaluate(async ({ p }) => {
          const url = '/app/js/core/storage.js'; // served by the app (browser context)
          const storage = await import(url);
          storage.saveProfile(p);
          storage.setActiveProfileId(p.id);
          localStorage.setItem('va.disclaimerAck', new Date().toISOString());
          localStorage.setItem('va.coachDismissed', `${p.id}:${p.updatedAt}`);
        }, { p });
        await page.reload();
        await page.waitForSelector('#app[data-state="ready"]', { timeout: 20000 });
        await page.evaluate(() => { location.hash = '#/viewer/reader'; });
        await page.waitForSelector('html[data-route="/viewer/reader"]', { timeout: 20000 });
        await page.waitForSelector('[data-testid="reader-input"]', { timeout: 20000 });
        await page.fill('[data-testid="reader-input"]', TEXT_HE);
        await page.click('[data-testid="reader-show"]');
        await page.waitForSelector('[data-testid="reader-reading"]:not([hidden])');
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
        await sleep(300);
        const geo = await page.evaluate(() => {
          const el = /** @type {HTMLElement} */ (document.querySelector('[data-testid="reader-surface"]'));
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height, sw: el.scrollWidth, docW: document.documentElement.scrollWidth, fs: getComputedStyle(el).fontSize };
        });
        if (process.env.SIM_DEBUG) {
          console.log(id, p.text.baseFontPx, JSON.stringify(geo));
          await page.screenshot({ path: join(process.env.SIM_DEBUG, `${id}-${p.text.baseFontPx}.png`) });
        }
        // The reading surface itself (the controls above it are UI chrome).
        // Full-page capture clipped to the surface's document box, so sticky viewer chrome stays where it belongs.
        const box = await page.evaluate(() => {
          const b = /** @type {HTMLElement} */ (document.querySelector('[data-testid="reader-surface"]')).getBoundingClientRect();
          const d = document.documentElement.getBoundingClientRect(); // document origin (RTL pages may scroll negatively)
          return { x: b.x - d.x, y: b.y - d.y, width: b.width, height: b.height };
        });
        shots.push((await page.screenshot({ type: 'png', fullPage: true, clip: { ...box, height: Math.min(box.height, CROP_CSS_H) } })).toString('base64'));
      }
      // Blur each screenshot with the PSF of the better eye at its viewing distance, comfortable accommodation.
      const blurFor = (/** @type {number} */ dMm) => {
        const eyes = [run.eyes.right, run.eyes.left];
        const st = eyes.map((e) => ({ e, s: eyeState(e, dMm, { mode: 'comfortable' }) })).sort((a, b) => a.s.logMAR - b.s.logMAR)[0];
        const pxPerArcmin = dMm * Math.tan(Math.PI / 10800) * user.device.cssPxPerMm * DPR;
        return { st, k: psfKernel({ residualD: st.s.residualD, axisDeg: st.e.axisDeg, pupilMm: st.e.pupilMm, pxPerArcmin, maxRadiusPx: 120 }) };
      };
      const dh = user.habitualMm;
      const dr = ev.dEval;
      const panels = [];
      for (const [i, d] of /** @type {Array<[number, number]>} */ ([[0, dh], [1, dr]])) {
        const { k } = blurFor(d);
        const index = await page.evaluate(pageBlur, { png: shots[i], kernel: Array.from(k.data), ksize: k.size, cropH: CROP_CSS_H * DPR });
        panels.push({ index, d });
      }
      const dMin = Math.min(dh, dr);
      const verdict = profile.glassesFree?.feasible ?? '–';
      const b64 = await page.evaluate(pageCompose, {
        title: `${user.label} — without glasses (simulated)`,
        outScale: 0.6,
        panels: [
          { index: panels[0].index, scale: dMin / dh, caption: ['Default 16 px, usual distance', `${Math.round(dh / 10)} cm · reserve ${ev.baseReserve.toFixed(1)}× (${ev.baseLegibility})`] },
          { index: panels[1].index, scale: dMin / dr, caption: [`SeeTuned ${profile.text.baseFontPx} px, ${Math.round(dr / 10)} cm`, `reserve ${ev.reserve.toFixed(1)}× (${ev.legibility}) · verdict ${verdict}`] },
        ],
      });
      const file = join(OUT, `${id}.png`);
      writeFileSync(file, Buffer.from(b64, 'base64'));
      console.log(`${file}  ${(statSync(file).size / 1024).toFixed(0)} KB`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    child.kill();
    rmSync(dataDir, { recursive: true, force: true });
  }
  const total = readdirSync(OUT).filter((f) => f.endsWith('.png')).reduce((s, f) => s + statSync(join(OUT, f)).size, 0);
  console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

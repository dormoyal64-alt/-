// Copies self-hosted third-party browser assets into public/app/vendor.
// Runs automatically after `npm install` (postinstall). Idempotent.
import { mkdir, copyFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mpSrc = join(root, 'node_modules/@mediapipe/tasks-vision');
const mpDst = join(root, 'public/app/vendor/mediapipe');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  if (!(await exists(mpSrc))) {
    console.warn('[vendor] @mediapipe/tasks-vision not installed; camera distance feature will be unavailable.');
    return;
  }
  await mkdir(join(mpDst, 'wasm'), { recursive: true });
  await copyFile(join(mpSrc, 'vision_bundle.mjs'), join(mpDst, 'vision_bundle.mjs'));
  for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm',
    'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
    await copyFile(join(mpSrc, 'wasm', f), join(mpDst, 'wasm', f));
  }
  const modelPath = join(mpDst, 'face_landmarker.task');
  if (!(await exists(modelPath))) {
    try {
      const res = await fetch(MODEL_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(modelPath, Buffer.from(await res.arrayBuffer()));
      console.log('[vendor] downloaded face_landmarker.task');
    } catch (err) {
      console.warn(`[vendor] could not download face landmarker model (${err.message}); camera distance feature will fall back to manual methods.`);
    }
  }
  console.log('[vendor] MediaPipe assets ready in public/app/vendor/mediapipe');
}

main().catch((err) => { console.error('[vendor] failed:', err); process.exitCode = 0; });

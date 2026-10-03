// The service worker must precache every shipped app module, so a first offline start (or an offline retest)
// never hits a module that was never fetched — and must not ship the research simulator (A14 bug hunt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../../../public/app/', import.meta.url));
const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
const block = sw.slice(sw.indexOf('const PRECACHE = ['), sw.indexOf('];', sw.indexOf('const PRECACHE = [')));
const precache = new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));

/** @param {string} dir @returns {string[]} */
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [relative(APP, p).split('\\').join('/')];
});

test('sw precache lists every app module and stylesheet (no simulator)', () => {
  const shipped = [...walk(join(APP, 'js')), ...walk(join(APP, 'css'))]
    .filter((p) => /\.(js|css)$/.test(p) && !p.startsWith('js/sim/') && p !== 'js/core/demo-profile.js'); // demo profile: harness/tests only
  const missing = shipped.filter((p) => !precache.has(p));
  assert.deepEqual(missing, [], 'add these to PRECACHE in public/app/sw.js');
  for (const p of precache) {
    if (p === './') continue;
    assert.ok(existsSync(join(APP, p)), `precached path exists: ${p}`);
    assert.ok(!p.startsWith('js/sim/') && !p.startsWith('dev/'), `not shipped: ${p}`);
  }
});

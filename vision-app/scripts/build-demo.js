// Builds a static, server-less DEMO of SeeTuned (app + marketing site + legal pages) with relative links,
// so it can be hosted anywhere static (e.g. an Artifact preview link) and opened on a phone.
// The API is replaced by scripts/demo/demo-api.js (in-browser, localStorage). Camera features and offline
// caching are not part of the demo. Usage: node scripts/build-demo.js [outDir]   (default: dist-demo/)
import { cp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { dirname, join, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const out = resolve(process.argv[2] || join(root, 'dist-demo'));

/** Map an absolute site path to its location in the demo layout. */
function mapPath(path) {
  if (path === '/') return 'site/index.html';
  if (path === '/en/' || path === '/en') return 'site/en/index.html';
  if (path === '/app/' || path === '/app') return 'app/index.html';
  return path.slice(1);
}

/** Rewrite absolute href/src attributes in an HTML file located at `fileRel` (demo-relative, posix). */
function rewriteHtml(html, fileRel) {
  return html.replace(/\b(href|src)="(\/(?!\/)[^"]*)"/g, (_m, attr, url) => {
    const hashAt = url.indexOf('#');
    const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
    const hash = hashAt >= 0 ? url.slice(hashAt) : '';
    const qAt = beforeHash.indexOf('?');
    const path = qAt >= 0 ? beforeHash.slice(0, qAt) : beforeHash;
    const query = qAt >= 0 ? beforeHash.slice(qAt) : '';
    const target = mapPath(path);
    const rel = posix.relative(posix.dirname(fileRel), target) || posix.basename(target);
    return `${attr}="${rel}${query}${hash}"`;
  });
}

async function listHtml(dir, base = '') {
  const found = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) found.push(...await listHtml(join(dir, e.name), rel));
    else if (e.name.endsWith('.html')) found.push(rel);
  }
  return found;
}

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  // App (without dev harness, self-hosted camera model and service worker).
  await cp(join(pub, 'app'), join(out, 'app'), {
    recursive: true,
    filter: (src) => !/[\\/]app[\\/](vendor|dev)([\\/]|$)/.test(src) && !/[\\/]app[\\/]sw\.js$/.test(src),
  });
  await cp(join(root, 'scripts/demo/demo-api.js'), join(out, 'app/js/demo-api.js'));

  const indexPath = join(out, 'app/index.html');
  let index = await readFile(indexPath, 'utf8');
  if (!index.includes('<link rel="modulepreload"')) throw new Error('app/index.html layout changed: cannot inject the demo API');
  index = index.replace('<link rel="modulepreload"', '<script src="js/demo-api.js"></script>\n  <link rel="modulepreload"');
  await writeFile(indexPath, index);

  await writeFile(join(out, 'app/js/shell/sw-client.js'),
    '// DEMO: service workers are not available in static previews.\n'
    + 'export function registerServiceWorker() {}\nexport function applyUpdate() {}\n');

  const brandPath = join(out, 'app/js/shell/brand.js');
  const brand = await readFile(brandPath, 'utf8');
  if (!brand.includes('`/legal/')) throw new Error('brand.js legalUrl changed: cannot relativise legal links');
  await writeFile(brandPath, brand.replaceAll('`/legal/', '`../legal/'));

  // Marketing site, brand assets and legal pages.
  await mkdir(join(out, 'site/en'), { recursive: true });
  await cp(join(pub, 'index.html'), join(out, 'site/index.html'));
  await cp(join(pub, 'en/index.html'), join(out, 'site/en/index.html'));
  for (const d of ['assets', 'brand', 'legal']) await cp(join(pub, d), join(out, d), { recursive: true });

  for (const rel of [...(await listHtml(join(out, 'site'))).map((f) => `site/${f}`), ...(await listHtml(join(out, 'legal'))).map((f) => `legal/${f}`)]) {
    const p = join(out, rel);
    await writeFile(p, rewriteHtml(await readFile(p, 'utf8'), rel));
  }

  await cp(join(root, 'scripts/demo/launcher.html'), join(out, 'index.html'));
  console.log(`[demo] built ${out}`);
}

main().catch((err) => { console.error('[demo] failed:', err); process.exitCode = 1; });

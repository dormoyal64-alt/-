// @ts-check
/**
 * Static files from public/: landing (/), /legal/*, the PWA (/app/*).
 * Caching: HTML, sw.js and the manifest are `no-cache` (always revalidated); /app/vendor/** is
 * cached for a day (ETag-revalidated); everything else gets a short max-age plus ETag revalidation.
 */
import express from 'express';
import { extname, posix, relative, sep } from 'node:path';

const MIME_OVERRIDES = {
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export const CACHE_NO_CACHE = 'no-cache';
export const CACHE_IMMUTABLE = 'public, max-age=86400'; // vendor paths are not versioned: 1 day + ETag revalidation
export const CACHE_SHORT = 'public, max-age=300';

/** @param {string} p */
function safeDecode(p) {
  try { return decodeURIComponent(p); } catch { return p; }
}

/**
 * @param {{publicDir: string, isProduction: boolean}} opts
 * @returns {import('express').Router}
 */
export function staticRoutes({ publicDir, isProduction }) {
  const router = express.Router();

  if (isProduction) {
    // The dev harness must not exist in production. Normalise first so %-encoding, "//" or
    // "/./" tricks cannot reach it through the static handler.
    router.use((req, res, next) => {
      const p = posix.normalize(safeDecode(req.path)).toLowerCase();
      if (p === '/app/dev' || p.startsWith('/app/dev/')) {
        res.status(404).type('text/plain; charset=utf-8').send('Not found');
        return;
      }
      next();
    });
  }

  router.use(express.static(publicDir, {
    index: 'index.html',
    extensions: ['html'],
    dotfiles: 'ignore',
    etag: true,
    lastModified: true,
    cacheControl: false, // set below
    redirect: true,
    fallthrough: true,
    setHeaders(res, filePath) {
      const rel = relative(publicDir, filePath).split(sep).join('/');
      const ext = extname(filePath).toLowerCase();
      const mime = MIME_OVERRIDES[/** @type {keyof typeof MIME_OVERRIDES} */ (ext)];
      if (mime) res.setHeader('Content-Type', mime);
      if (ext === '.html' || ext === '.webmanifest' || rel === 'app/sw.js') {
        res.setHeader('Cache-Control', CACHE_NO_CACHE);
      } else if (rel.startsWith('app/vendor/')) {
        res.setHeader('Cache-Control', CACHE_IMMUTABLE);
      } else {
        res.setHeader('Cache-Control', CACHE_SHORT);
      }
      if (rel === 'app/sw.js') res.setHeader('Service-Worker-Allowed', '/app/');
    },
  }));

  return router;
}

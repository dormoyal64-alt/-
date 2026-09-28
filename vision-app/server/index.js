// @ts-check
/**
 * Server entry point: `node server/index.js` (npm start sets NODE_ENV=production).
 * Configuration comes from environment variables; see server/.env.example.
 */
import { loadConfig, ConfigError } from './config.js';
import { createApp } from './app.js';

/** @type {import('./config.js').Config} */
let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[config] ${err.message}\nSee server/.env.example for every variable.`);
    process.exit(1);
  }
  throw err;
}

if (config.sessionSecretGenerated) {
  console.warn('[config] SESSION_SECRET not set: using a random per-process secret (development only).');
}
if (config.isProduction && config.mailProvider === 'console') {
  console.warn('[config] MAIL_PROVIDER=console in production: password-reset e-mails will NOT be delivered.');
}

let app;
try {
  app = createApp(config);
} catch (err) {
  console.error('[startup] failed to initialise:', err instanceof Error ? err.message : err);
  process.exit(1);
}

const server = app.listen(config.port, config.host);
server.keepAliveTimeout = 65_000; // longer than typical load-balancer idle timeouts
server.headersTimeout = 66_000;

server.on('listening', () => {
  app.locals.services.renewals.start(config.renewalIntervalMinutes * 60_000);
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : config.port;
  console.log(`[server] ${config.nodeEnv} listening on http://${config.host}:${port} (payments: ${config.paymentProvider}, data: ${config.dataDir})`);
});
server.on('error', (err) => {
  const e = /** @type {NodeJS.ErrnoException} */ (err);
  console.error(e.code === 'EADDRINUSE' ? `[server] port ${config.port} is already in use` : `[server] ${e.message}`);
  process.exit(1);
});

let shuttingDown = false;
/** @param {string} signal */
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, shutting down`);
  const force = setTimeout(() => {
    console.error('[server] forced exit after 10s');
    process.exit(1);
  }, 10_000);
  force.unref();
  server.close(() => {
    try { app.locals.close(); } catch (err) { console.error('[server] close error:', err); }
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

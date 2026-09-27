// @ts-check
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4173);
const USE_STATIC = process.env.E2E_STATIC === '1';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], permissions: ['camera'] } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: ['camera'] } },
  ],
  webServer: USE_STATIC
    ? { command: `node scripts/static-server.js ${PORT}`, url: `http://127.0.0.1:${PORT}/app/dev/harness.html`, reuseExistingServer: true }
    : {
        command: 'node --disable-warning=ExperimentalWarning server/index.js',
        url: `http://127.0.0.1:${PORT}/api/health`,
        reuseExistingServer: false,
        env: { PORT: String(PORT), NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', DATA_DIR: 'test-results/e2e-data', SESSION_SECRET: 'e2e-secret-not-for-production-000000000000' },
      },
});

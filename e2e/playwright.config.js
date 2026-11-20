import { defineConfig } from '@playwright/test';

// Browser tests for SWAG Config GUI.
//
// harness/server.mjs starts the real backend (serving the built frontend)
// against a throwaway SWAG-like folder, with a stand-in for the Docker
// socket proxy that runs a real `nginx -t` on the generated configs. So the
// tests click through the actual UI and check what nginx really accepts.
//
// Run locally: npm run build (in the repo root), then in e2e/:
//   npm ci && npx playwright install chromium && npm test
export default defineConfig({
  testDir: './tests',
  // The tests share one server and one config folder, so run them in order
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'node harness/server.mjs',
    url: 'http://127.0.0.1:3100/api/instances',
    timeout: 60_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

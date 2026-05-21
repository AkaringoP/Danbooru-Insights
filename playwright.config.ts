import {defineConfig, devices} from '@playwright/test';

/**
 * Playwright configuration for visual / behavioural regression tests.
 *
 * Tests live in `test/e2e/`. Each spec drives a stand-alone harness HTML
 * page from `test/e2e/harness/` that mounts a single widget or app in
 * isolation; API responses are mocked through fixtures (see
 * `test/e2e/helpers/intercept.ts`). The dev server (`npm run dev`) is
 * reused as the static host since Vite already maps the repo root for
 * us — no separate web server needed.
 *
 * Snapshots go in `test/e2e/snapshots/` and are committed alongside the
 * tests; intentional visual changes are accepted by running
 * `npx playwright test --update-snapshots`.
 */
export default defineConfig({
  testDir: './test/e2e',
  snapshotDir: './test/e2e/snapshots',
  // Run tests sequentially locally for stable screenshots; parallel runs
  // can introduce GPU/font contention on the same machine.
  fullyParallel: false,
  workers: 1,
  // Surface flaky tests immediately — no silent retries during development.
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: {
    // Tolerance for tiny anti-alias / sub-pixel rounding diffs. 0.1%
    // covers font-cache jitter between runs without masking real changes.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

import {expect, test} from '@playwright/test';

/**
 * Visual regression baseline for UserAnalyticsApp.renderDashboard
 * (src/apps/user-analytics-app.ts).
 *
 * Scope: the zero-uploads early-exit branch (lines 751-774). That branch
 * is a self-contained ~30 LOC sub-flow that paints a header + empty-state
 * message + footer without touching fetchDashboardData or any of the
 * nine widget renderers — so it produces a deterministic screenshot
 * without needing Dexie seed data or API intercept gymnastics. The
 * full-data render is left to T-18 (pie) / T-19 (grass) where each
 * widget has its own baseline.
 */
test.describe('UserAnalyticsApp.renderDashboard', () => {
  test('zero-uploads view matches baseline screenshot', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 800});

    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/test/e2e/harness/user-analytics-dashboard.html');

    await expect(page.locator('body')).toHaveAttribute(
      'data-harness-ready',
      'user-analytics-dashboard',
      {timeout: 10_000},
    );

    const harnessError = await page
      .locator('body')
      .getAttribute('data-harness-error');
    expect(
      harnessError,
      `harness failed to mount dashboard: ${harnessError}`,
    ).toBeNull();

    const content = page.locator('#danbooru-grass-modal-content');
    await expect(content).toBeVisible();

    // Structural sanity — cheap pre-screenshot guard.
    await expect(content.locator('h2')).toContainText('Analytics Dashboard');
    await expect(content).toContainText('No uploads to analyze');
    await expect(content.locator('.di-dashboard-footer')).toHaveCount(1);

    await expect(content).toHaveScreenshot('user-analytics-zero-uploads.png');

    const ourErrors = consoleErrors.filter(
      e => e.includes('/src/') || e.includes('user-analytics'),
    );
    expect(
      ourErrors,
      `harness produced console errors: ${ourErrors.join(' | ')}`,
    ).toEqual([]);
  });
});

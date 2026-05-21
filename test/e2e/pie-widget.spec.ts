import {expect, test} from '@playwright/test';

/**
 * Visual regression baseline for renderPieWidget
 * (src/apps/user-analytics-charts.ts).
 *
 * Captures the SVG pie chart geometry that the T-23 decomposition will
 * have to preserve. The harness pre-loads deterministic copyright-tab
 * distribution data (three slices, fixed counts) so the chart paints
 * synchronously without needing an AnalyticsDataManager fetch.
 */
test.describe('renderPieWidget', () => {
  test('initial copyright-tab SVG matches baseline screenshot', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1024, height: 600});

    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/test/e2e/harness/pie-widget.html');

    await expect(page.locator('body')).toHaveAttribute(
      'data-harness-ready',
      'pie-widget',
      {timeout: 10_000},
    );

    const harnessError = await page
      .locator('body')
      .getAttribute('data-harness-error');
    expect(
      harnessError,
      `harness failed to mount pie widget: ${harnessError}`,
    ).toBeNull();

    const host = page.locator('#pie-host');
    await expect(host).toBeVisible();

    // Structural sanity — eleven tabs and one .pie-content holding the
    // d3-rendered SVG.
    await expect(host.locator('.di-pie-tab')).toHaveCount(11);
    await expect(host.locator('.pie-content svg')).toHaveCount(1);

    await expect(host).toHaveScreenshot('pie-widget-copyright.png');

    const ourErrors = consoleErrors.filter(
      e => e.includes('/src/') || e.includes('pie-widget'),
    );
    expect(
      ourErrors,
      `harness produced console errors: ${ourErrors.join(' | ')}`,
    ).toEqual([]);
  });
});

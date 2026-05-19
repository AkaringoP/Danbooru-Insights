import {expect, test} from '@playwright/test';

/**
 * Visual regression baseline for GraphRenderer.injectSkeleton +
 * GraphRenderer.renderGraph (src/ui/graph-renderer.ts).
 *
 * The CalHeatmap dependency is a window-global loaded via @require in
 * production. JSDOM has no equivalent — test/graph-renderer.test.ts
 * stubs it out for fast smoke coverage. The Playwright spec below
 * exercises the *real* CalHeatmap library so the T-24 decomposition
 * cannot quietly break the SVG output.
 *
 * Fixture seeds 2024 (a fixed past year) so the heatmap is anchored
 * deterministically, and every 3rd day carries a varying value to
 * exercise all four threshold buckets.
 */
test.describe('GraphRenderer.renderGraph', () => {
  test('initial 2024 heatmap matches baseline screenshot', async ({page}) => {
    await page.setViewportSize({width: 1200, height: 400});

    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/test/e2e/harness/grass-renderer.html');

    await expect(page.locator('body')).toHaveAttribute(
      'data-harness-ready',
      'grass-renderer',
      {timeout: 15_000},
    );

    const harnessError = await page
      .locator('body')
      .getAttribute('data-harness-error');
    expect(
      harnessError,
      `harness failed to mount graph-renderer: ${harnessError}`,
    ).toBeNull();

    const container = page.locator('#danbooru-grass-container');
    await expect(container).toBeVisible();

    // Structural assertions — CalHeatmap renders per-month groups as
    // .ch-domain. Twelve months → twelve groups.
    await expect(container.locator('.ch-domain')).toHaveCount(12);
    await expect(container.locator('h2')).toContainText('contributions in');

    await expect(container).toHaveScreenshot('grass-renderer-2024.png');

    const ourErrors = consoleErrors.filter(
      e => e.includes('/src/') || e.includes('graph-renderer'),
    );
    expect(
      ourErrors,
      `harness produced console errors: ${ourErrors.join(' | ')}`,
    ).toEqual([]);
  });
});

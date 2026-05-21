import {expect, test} from '@playwright/test';

/**
 * Visual regression baseline for createSettingsPopover
 * (src/ui/settings-popover.ts).
 *
 * Captured before the T-21 decomposition so that the structural extraction
 * can be verified to be a no-op visually. When section helpers
 * (buildThemeSection, buildSyncSection, etc.) are extracted, this snapshot
 * must continue to match — if it doesn't, the decomposition changed
 * observable output and needs review, not a snapshot update.
 *
 * The harness mounts the popover in isolation: no Danbooru page, no
 * GrassApp, no graph. Auto-tune (the only db-touching path) is gated
 * behind a click that this spec never performs.
 */
test.describe('createSettingsPopover', () => {
  test('initial render matches baseline screenshot', async ({page}) => {
    // Pin viewport so anchor coords + popover width produce identical
    // pixels across machines.
    await page.setViewportSize({width: 1024, height: 768});

    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/test/e2e/harness/settings-popover.html');

    await expect(page.locator('body')).toHaveAttribute(
      'data-harness-ready',
      'settings-popover',
      {timeout: 10_000},
    );

    const harnessError = await page
      .locator('body')
      .getAttribute('data-harness-error');
    expect(
      harnessError,
      `harness failed to mount popover: ${harnessError}`,
    ).toBeNull();

    const popover = page.locator('#danbooru-grass-settings-popover');
    await expect(popover).toBeVisible();

    // Structural sanity (cheap pre-screenshot guard — catches obvious
    // breakage before relying on pixel diffs).
    await expect(popover.locator('.theme-icon')).toHaveCount(12);
    await expect(popover.locator('select.popover-select')).toHaveCount(1);
    await expect(popover.locator('input.threshold-input')).toHaveCount(4);

    // Capture popover only — full-page screenshots would also bake in
    // anti-alias differences from the harness chrome.
    await expect(popover).toHaveScreenshot('settings-popover-initial.png');

    const ourErrors = consoleErrors.filter(
      e => e.includes('/src/') || e.includes('settings-popover'),
    );
    expect(
      ourErrors,
      `harness produced console errors: ${ourErrors.join(' | ')}`,
    ).toEqual([]);
  });
});

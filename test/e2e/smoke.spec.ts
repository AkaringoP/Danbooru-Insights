import {expect, test} from '@playwright/test';
import {
  interceptCountsApi,
  interceptPostsApi,
  interceptRelatedTagApi,
  interceptTagImplicationsApi,
  loadFixture,
} from './helpers/intercept';

/**
 * Infrastructure smoke tests. These do NOT assert visual output; they
 * confirm that:
 *   1. The dev server serves each harness HTML page.
 *   2. The harness import of `src/main.ts` does not throw.
 *   3. The fixture / intercept helpers behave (interceptCountsApi is
 *      installed and called by the page's data-layer code).
 *
 * Visual / behavioural assertions come in Phase 5b (T-16~T-19) once each
 * function under test has its own dedicated spec.
 */

const HARNESSES = [
  {name: 'grass', url: '/test/e2e/harness/grass.html'},
  {name: 'user-analytics', url: '/test/e2e/harness/user-analytics.html'},
  {name: 'tag-analytics', url: '/test/e2e/harness/tag-analytics.html'},
] as const;

for (const harness of HARNESSES) {
  test(`harness loads: ${harness.name}`, async ({page}) => {
    // Install default fixture interceptions so any API call the app makes
    // during mount gets a deterministic response instead of a network error.
    await interceptCountsApi(page, 10);
    await interceptPostsApi(page, loadFixture('posts-sample') as unknown[]);
    await interceptRelatedTagApi(page, []);
    await interceptTagImplicationsApi(page, []);

    // Surface unexpected console errors instead of swallowing them.
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(harness.url);

    // The harness sets data-harness-ready after the dynamic import returns
    // (success or failure). Wait for that signal before assertions.
    await expect(page.locator('body')).toHaveAttribute(
      'data-harness-ready',
      harness.name,
      {timeout: 10_000},
    );

    // If the dynamic import threw, the harness records the error on body.
    // Surface it as a test failure with the captured message.
    const harnessError = await page
      .locator('body')
      .getAttribute('data-harness-error');
    expect(
      harnessError,
      `harness ${harness.name} failed to import main.ts: ${harnessError}`,
    ).toBeNull();

    // CDN / image / cross-origin noise is fine; only fail on real script
    // errors that mention our own modules.
    const ourErrors = consoleErrors.filter(
      e => e.includes('/src/') || e.includes('main.ts'),
    );
    expect(
      ourErrors,
      `harness ${harness.name} produced console errors: ${ourErrors.join(' | ')}`,
    ).toEqual([]);
  });
}

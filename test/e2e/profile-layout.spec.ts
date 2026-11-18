import {expect, test, type Page} from '@playwright/test';

/**
 * The statistics table of a profile page keeps Danbooru's own layout once
 * the contribution graph sits beside it (ensureGrassWrapper in
 * src/ui/graph-renderer.ts).
 *
 * Danbooru sizes the label column as 15% of the table. Wrapped into a
 * flex row the table used to shrink to 60% of the page, and the column
 * with it: the labels moved left and the long ones broke into two lines.
 * No screenshot here, only geometry, so the spec needs no per-platform
 * baseline.
 */

interface StatsGeometry {
  rowWidth: number;
  sectionWidth: number;
  rows: Array<{
    label: string;
    labelLeft: number;
    labelWidth: number;
    valueLeft: number;
    height: number;
  }>;
}

async function openHarness(page: Page, query = ''): Promise<void> {
  await page.goto(`/test/e2e/harness/profile-layout.html${query}`);
  await expect(page.locator('body')).toHaveAttribute(
    'data-harness-ready',
    'profile-layout',
    {timeout: 15_000},
  );
  expect(
    await page.locator('body').getAttribute('data-harness-error'),
  ).toBeNull();
  await expect(page.locator('#danbooru-grass-container')).toBeVisible();
}

function measure(page: Page): Promise<StatsGeometry> {
  return page.evaluate(() =>
    (
      window as unknown as {__diMeasureStats: () => StatsGeometry}
    ).__diMeasureStats(),
  );
}

function measuredBefore(page: Page): Promise<StatsGeometry> {
  return page.evaluate(
    () =>
      (window as unknown as {__diStatsBefore: StatsGeometry}).__diStatsBefore,
  );
}

function expectSameRows(after: StatsGeometry, before: StatsGeometry): void {
  expect(after.rows.length).toBe(before.rows.length);
  expect(after.rows.length).toBeGreaterThan(0);
  for (let i = 0; i < before.rows.length; i++) {
    const a = after.rows[i];
    const b = before.rows[i];
    expect(Math.abs(a.labelLeft - b.labelLeft), `${b.label} left`).toBeLessThan(
      1,
    );
    expect(
      Math.abs(a.labelWidth - b.labelWidth),
      `${b.label} width`,
    ).toBeLessThan(1);
    expect(
      Math.abs(a.valueLeft - b.valueLeft),
      `${b.label} value left`,
    ).toBeLessThan(1);
    expect(Math.abs(a.height - b.height), `${b.label} height`).toBeLessThan(1);
  }
}

for (const box of ['content', 'border'] as const) {
  test.describe(`profile statistics layout (${box}-box cells)`, () => {
    const query = box === 'border' ? '?box=border' : '';

    test('the table keeps its geometry beside the graph', async ({page}) => {
      await page.setViewportSize({width: 1366, height: 900});
      await openHarness(page, query);

      const before = await measuredBefore(page);
      const after = await measure(page);
      expectSameRows(after, before);

      // The graph sits beside the section, on the same row.
      expect(after.sectionWidth).toBeLessThanOrEqual(after.rowWidth * 0.6 + 1);
      const graph = await page
        .locator('#danbooru-grass-container')
        .boundingBox();
      const section = await page
        .locator('#danbooru-grass-wrapper > :first-child')
        .boundingBox();
      expect(graph!.x).toBeGreaterThanOrEqual(section!.x + section!.width);
      expect(Math.abs(graph!.y - section!.y)).toBeLessThan(1);
    });

    test('the label column follows the window width', async ({page}) => {
      await page.setViewportSize({width: 1366, height: 900});
      await openHarness(page, query);
      const before = await measuredBefore(page);
      const ratio = before.rows[0].labelWidth / before.sectionWidth;

      await page.setViewportSize({width: 1100, height: 900});
      await expect
        .poll(async () => {
          const now = await measure(page);
          return Math.abs(now.rows[0].labelWidth - ratio * now.rowWidth);
        })
        .toBeLessThan(1);
    });
  });
}

test('on a narrow screen the stacked table keeps its geometry too', async ({
  page,
}) => {
  await page.setViewportSize({width: 600, height: 900});
  await openHarness(page);

  expectSameRows(await measure(page), await measuredBefore(page));
});

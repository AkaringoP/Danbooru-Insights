// @vitest-environment jsdom
/**
 * Every date on the tag dashboard is a UTC day, like its months (T-305
 * follow-up). The header and the status label used the browser's calendar,
 * and the latest post's date was cut from `created_at`, which Danbooru
 * gives in the viewer's account time zone.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Database} from '../src/core/database';
import type {RateLimitedFetch} from '../src/core/rate-limiter';
import type {SettingsManager} from '../src/core/settings';
import type {DanbooruPost, TagAnalyticsMeta} from '../src/types';

vi.mock('d3', () => ({}));

import {TagAnalyticsApp} from '../src/apps/tag-analytics-app';

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
  document.body.innerHTML = '';
});

/** Seoul, checking the switch took effect (else the test proves nothing). */
function inSeoul(): void {
  process.env.TZ = 'Asia/Seoul';
  expect(new Date('2026-11-13T20:00:00Z').getDate()).toBe(14);
}

type Internals = {
  buildDashboardHeader(meta: TagAnalyticsMeta, c: string, l: string): string;
  buildMainGrid(meta: TagAnalyticsMeta): string;
};

function makeApp() {
  const app = new TagAnalyticsApp(
    {} as unknown as Database,
    {} as unknown as SettingsManager,
    'touhou',
    {fetch: vi.fn()} as unknown as RateLimitedFetch,
  );
  return {app, internals: app as unknown as Internals};
}

// 20:00 UTC on Nov 13 is 05:00 on Nov 14 in Seoul.
const LATE_UTC = '2026-11-13T15:00:00-05:00';

describe('tag dashboard dates', () => {
  it('shows the created and updated dates as UTC days', () => {
    inSeoul();
    const {internals} = makeApp();
    const html = internals.buildDashboardHeader(
      {
        name: 'touhou',
        created_at: LATE_UTC,
        updatedAt: Date.parse(LATE_UTC),
      } as TagAnalyticsMeta,
      '#000',
      'Copyright',
    );
    expect(html).toContain('Created: 2026-11-13');
    expect(html).toMatch(/Updated: 2026-11-13\b/);
  });

  it('shows the latest post date as its UTC day, not the account time zone', () => {
    const {internals} = makeApp();
    // 22:00 in New York is 03:00 the next day in UTC.
    const latestPost = {
      id: 1,
      created_at: '2026-11-13T22:00:00-05:00',
      rating: 'g',
    } as DanbooruPost;
    const html = internals.buildMainGrid({
      name: 'touhou',
      historyData: [],
      latestPost,
    } as unknown as TagAnalyticsMeta);
    expect(html).toContain('di-nsfw-monitor-sublabel">2026-11-14<');
  });

  it('shows the status label next to the button as a UTC day', () => {
    inSeoul();
    document.body.innerHTML = '<span id="tag-analytics-status"></span>';
    const {app} = makeApp();
    app._showUpdatedStatus(Date.parse(LATE_UTC));
    expect(document.getElementById('tag-analytics-status')?.textContent).toBe(
      'Updated: 2026-11-13',
    );
  });
});

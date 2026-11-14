/**
 * Milestone posts of a tag page (T-304): the month comes from the UTC
 * history, the post from its place in that month, with a page size that
 * keeps the page number within every account's page limit, three lookups
 * at a time.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Database} from '../src/core/database';
import type {RateLimitedFetch} from '../src/core/rate-limiter';
import type {HistoryEntry} from '../src/types';

vi.mock('d3', () => ({}));

import {
  TagAnalyticsDataService,
  milestoneLookup,
} from '../src/apps/tag-analytics-data';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 50 posts in February, then a very large March. */
const history: HistoryEntry[] = [
  {date: '2024-02-01', count: 50, cumulative: 50},
  {date: '2024-03-01', count: 300_000, cumulative: 300_050},
];

describe('milestoneLookup', () => {
  it.each([
    // offset into March, limit, page, index
    [1, 1, 1, 0],
    [200, 1, 200, 0],
    [1000, 1, 1000, 0], // live-checked: limit=1&page=1000
    [1500, 2, 750, 1], // live-checked: limit=2&page=750
    [7000, 7, 1000, 6], // live-checked: limit=7&page=1000
    [200_000, 200, 1000, 199],
  ])('offset %i → limit %i, page %i, row %i', (offset, limit, page, index) => {
    const l = milestoneLookup('touhou', history, 50 + offset)!;
    expect({limit: l.limit, page: l.page, index: l.index}).toEqual({
      limit,
      page,
      index,
    });
    // The row really is the offset-th post of the month.
    expect((l.page - 1) * l.limit + l.index + 1).toBe(offset);
  });

  it('starts the month at its UTC instant, in id order, deleted posts included', () => {
    expect(milestoneLookup('touhou', history, 51)?.query).toBe(
      'touhou status:any date:>=2024-03-01T00:00:00Z order:id',
    );
  });

  it('counts from the first month for an early milestone', () => {
    const l = milestoneLookup('touhou', history, 1)!;
    expect(l.query).toContain('date:>=2024-02-01T00:00:00Z');
    expect(l).toMatchObject({milestone: 1, limit: 1, page: 1, index: 0});
  });

  it('gives up past the page limit and past the history', () => {
    expect(milestoneLookup('touhou', history, 50 + 200_001)).toBeNull();
    expect(milestoneLookup('touhou', history, 400_000)).toBeNull();
    expect(milestoneLookup('touhou', [], 1)).toBeNull();
  });
});

describe('fetchMilestones', () => {
  function makeService(serve: (url: string) => Promise<Response>) {
    const rl = {fetch: vi.fn(serve)};
    const service = new TagAnalyticsDataService(
      {} as unknown as Database,
      rl as unknown as RateLimitedFetch,
      'touhou',
    );
    vi.spyOn(service, 'backfillUploaderNames').mockImplementation(
      async items => items,
    );
    return {service, rl};
  }

  /** A page whose rows are posts numbered by their place in the month. */
  function pageReply(url: string, status = 200): Response {
    const q = new URLSearchParams(url.split('?')[1]);
    const limit = Number(q.get('limit'));
    const page = Number(q.get('page'));
    const rows = Array.from({length: limit}, (_, i) => ({
      id: (page - 1) * limit + i + 1,
      created_at: '2024-03-15T00:00:00Z',
    }));
    return {
      ok: status === 200,
      status,
      json: async () => rows,
    } as unknown as Response;
  }

  it('fetches three at a time and picks the right row', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const {service} = makeService(async url => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return pageReply(url);
    });

    const targets = [1, 100, 1000, 1500, 7000, 10_000];
    const result = await service.fetchMilestones(
      'touhou',
      history,
      targets.map(t => 50 + t),
    );

    expect(maxInFlight).toBe(3);
    // The fake numbers posts by their place in March.
    expect(result.map(m => [m.milestone, m.post.id])).toEqual(
      targets.map(t => [50 + t, t]),
    );
  });

  it('leaves out a milestone whose page failed, instead of reading the error', async () => {
    const {service} = makeService(async url =>
      url.includes('page=750') ? pageReply(url, 500) : pageReply(url),
    );

    const result = await service.fetchMilestones('touhou', history, [
      51,
      50 + 1500,
    ]);

    expect(result.map(m => m.milestone)).toEqual([51]);
  });
});

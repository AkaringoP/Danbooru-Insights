// @vitest-environment jsdom
/**
 * Related-tag pies of a tag page count their exact values only when their
 * tab is opened (T-307). They used to send up to 10 counts per pie in the
 * background on every analysis, whether or not the tab was looked at.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Database} from '../src/core/database';
import type {RateLimitedFetch} from '../src/core/rate-limiter';
import type {SettingsManager} from '../src/core/settings';
import type {TagAnalyticsMeta} from '../src/types';

vi.mock('d3', () => ({}));

import {TagAnalyticsApp} from '../src/apps/tag-analytics-app';
import {TagAnalyticsDataService} from '../src/apps/tag-analytics-data';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const reply = (status: number, body: unknown) =>
  ({ok: status === 200, status, json: async () => body}) as Response;

function makeService(
  serve: (url: string) => Response,
  db: Partial<Database> = {},
) {
  const rl = {fetch: vi.fn(async (url: string) => serve(url))};
  const service = new TagAnalyticsDataService(
    db as Database,
    rl as unknown as RateLimitedFetch,
    'touhou',
  );
  const urls = () => rl.fetch.mock.calls.map(c => c[0] as string);
  return {service, urls};
}

describe('fetchRelatedTagDistribution', () => {
  it('gives the approximation without sending any count', async () => {
    const {service, urls} = makeService(() =>
      reply(200, {
        related_tags: [
          {tag: {name: 'hakurei_reimu'}, frequency: 0.3},
          {tag: {name: 'kirisame_marisa'}, frequency: 0.2},
        ],
      }),
    );
    vi.spyOn(service, 'getTopLevelFlags').mockResolvedValue(
      new Map([
        ['hakurei_reimu', true],
        ['kirisame_marisa', true],
      ]),
    );

    const approx = await service.fetchRelatedTagDistribution('touhou', 4, 1000);

    expect(approx).toMatchObject({hakurei_reimu: 300, kirisame_marisa: 200});
    expect(urls().filter(u => u.startsWith('/counts/'))).toEqual([]);
  });
});

describe('fetchExactRelatedCounts', () => {
  it('counts every slice but "others", and keeps the approximation of a failed one', async () => {
    const {service, urls} = makeService(url => {
      const tags = decodeURIComponent(url.split('tags=')[1] ?? '');
      if (tags === 'touhou kirisame_marisa') return reply(500, {});
      return reply(200, {counts: {posts: 321}});
    });

    const result = await service.fetchExactRelatedCounts('touhou', {
      hakurei_reimu: 300,
      kirisame_marisa: 200,
      others: 50,
    });

    expect(result).toEqual({
      counts: {hakurei_reimu: 321, kirisame_marisa: 200, others: 50},
      complete: false,
    });
    // The failed count was asked again once (`fetchCountWithRetry`).
    expect(urls()).toHaveLength(3);
  });

  it('a count that comes back on its retry completes the pie', async () => {
    let failures = 1;
    const {service} = makeService(() =>
      failures-- > 0 ? reply(500, {}) : reply(200, {counts: {posts: 7}}),
    );

    expect(
      await service.fetchExactRelatedCounts('touhou', {hakurei_reimu: 300}),
    ).toEqual({counts: {hakurei_reimu: 7}, complete: true});
  });
});

describe('patchCachedReport', () => {
  function makeDb(record: unknown) {
    const put = vi.fn(async () => undefined);
    return {
      db: {
        tag_analytics: {get: vi.fn(async () => record), put},
      } as unknown as Database,
      put,
    };
  }

  it('merges into the cached report and keeps its age', async () => {
    const record = {
      tagName: 'touhou',
      updatedAt: 1234,
      data: {historyBasis: 'utc', characterCounts: {a: 1}, post_count: 9},
    };
    const {db, put} = makeDb(record);
    const {service} = makeService(() => reply(200, {}), db);

    await service.patchCachedReport({characterCounts: {a: 2}});

    expect(put).toHaveBeenCalledWith({
      tagName: 'touhou',
      updatedAt: 1234,
      data: {historyBasis: 'utc', characterCounts: {a: 2}, post_count: 9},
    });
  });

  it('writes nothing without a current report', async () => {
    for (const record of [undefined, {tagName: 'touhou', data: {}}]) {
      const {db, put} = makeDb(record);
      const {service} = makeService(() => reply(200, {}), db);
      await service.patchCachedReport({characterCounts: {a: 2}});
      expect(put).not.toHaveBeenCalled();
    }
  });
});

describe('opening a related-tag tab', () => {
  type Internals = {_wirePieTabHandlers(meta: TagAnalyticsMeta): void};

  function setUp(meta: Partial<TagAnalyticsMeta>, complete = true) {
    document.body.innerHTML = `
      <button class="di-pie-tab" data-type="copyright">Copy</button>
      <button class="di-pie-tab" data-type="character">Char</button>
      <button class="di-pie-tab active" data-type="status">Status</button>`;
    const app = new TagAnalyticsApp(
      {} as unknown as Database,
      {} as unknown as SettingsManager,
      'touhou',
      {fetch: vi.fn()} as unknown as RateLimitedFetch,
    );
    const render = vi
      .spyOn(app.chartRenderer, 'renderPieChart')
      .mockImplementation(() => {});
    const exact = vi
      .spyOn(app.dataService, 'fetchExactRelatedCounts')
      .mockImplementation(async (_tag, approx) => ({
        counts: Object.fromEntries(
          Object.keys(approx).map(k => [k, approx[k] + 1]),
        ),
        complete,
      }));
    const patch = vi
      .spyOn(app.dataService, 'patchCachedReport')
      .mockResolvedValue();
    const full = {
      characterCounts: {hakurei_reimu: 300},
      copyrightCounts: {touhou_project: 900},
      ...meta,
    } as TagAnalyticsMeta;
    (app as unknown as Internals)._wirePieTabHandlers(full);
    const click = async (type: string) => {
      (document.querySelector(`[data-type="${type}"]`) as HTMLElement).click();
      await new Promise(r => setTimeout(r, 0));
    };
    return {meta: full, render, exact, patch, click};
  }

  it('counts the pie once, on its first open, and keeps the result', async () => {
    const {meta, render, exact, patch, click} = setUp({relatedCountsExact: {}});

    await click('status');
    expect(exact).not.toHaveBeenCalled();

    await click('character');
    expect(exact).toHaveBeenCalledTimes(1);
    expect(meta.characterCounts).toEqual({hakurei_reimu: 301});
    expect(meta.relatedCountsExact).toEqual({character: true});
    expect(patch).toHaveBeenCalledWith({
      characterCounts: {hakurei_reimu: 301},
      relatedCountsExact: {character: true},
    });
    // The open tab is redrawn with the exact counts.
    expect(render).toHaveBeenLastCalledWith('character', meta);

    await click('status');
    await click('character');
    expect(exact).toHaveBeenCalledTimes(1);
  });

  it('counts nothing for a pie that is already exact', async () => {
    const {exact, click} = setUp({
      relatedCountsExact: {copyright: true, character: true},
    });
    await click('copyright');
    await click('character');
    expect(exact).not.toHaveBeenCalled();
  });

  it('treats a report without the mark as approximate', async () => {
    const {exact, click} = setUp({});
    await click('copyright');
    expect(exact).toHaveBeenCalledTimes(1);
  });

  it('tries again on the next open when a count failed', async () => {
    const {meta, exact, patch, click} = setUp({relatedCountsExact: {}}, false);

    await click('copyright');
    await click('status');
    await click('copyright');

    expect(exact).toHaveBeenCalledTimes(2);
    expect(meta.relatedCountsExact).toEqual({});
    expect(patch).not.toHaveBeenCalled();
  });
});

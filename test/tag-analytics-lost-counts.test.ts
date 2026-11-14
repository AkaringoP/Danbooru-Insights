// @vitest-environment jsdom
/**
 * Tag-page counts that could not be had are unknown, never 0 (T-308).
 * Through v9.11 `fetchCountWithRetry` read any failure as 0, and the 0 was
 * drawn and saved with the report for a day: a 422 (an anonymous viewer's
 * three-tag commentary searches), a 429 twice, or Danbooru's `null`.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Database} from '../src/core/database';
import type {RateLimitedFetch} from '../src/core/rate-limiter';
import type {SettingsManager} from '../src/core/settings';
import type {TagAnalyticsMeta, TagCountMap} from '../src/types';
import {TagAnalyticsApp} from '../src/apps/tag-analytics-app';
import {
  TagAnalyticsChartRenderer,
  buildPieSlices,
} from '../src/apps/tag-analytics-charts';
import {
  TagAnalyticsDataService,
  keepKnownCounts,
} from '../src/apps/tag-analytics-data';

afterEach(() => {
  vi.restoreAllMocks();
  delete document.body.dataset.currentUserLevel;
  document.body.innerHTML = '';
});

const reply = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

const anonymous = () => {
  document.body.dataset.currentUserLevel = '0';
};

/**
 * Count replies by search: a number or `null` (Danbooru's unfinished
 * count), or a function of the attempt number. Unlisted searches count 7.
 */
type Serve = Record<string, number | null | ((attempt: number) => Response)>;

function makeService(
  serve: Serve = {},
  db: Partial<Database> = {},
  report: unknown = [
    {is_deleted: false, posts: 100},
    {is_deleted: true, posts: 5},
  ],
) {
  const attempts = new Map<string, number>();
  const rl = {
    fetch: vi.fn(async (url: string) => {
      if (url.startsWith('/reports/')) return reply(200, report);
      const tags = decodeURIComponent(url.split('tags=')[1] ?? '');
      const attempt = (attempts.get(tags) ?? 0) + 1;
      attempts.set(tags, attempt);
      const s = serve[tags];
      if (typeof s === 'function') return s(attempt);
      return reply(200, {counts: {posts: s === undefined ? 7 : s}});
    }),
  };
  const service = new TagAnalyticsDataService(
    db as Database,
    rl as unknown as RateLimitedFetch,
    'touhou',
  );
  const asked = () =>
    rl.fetch.mock.calls
      .map(c => c[0] as string)
      .filter(u => u.startsWith('/counts/'))
      .map(u => decodeURIComponent(u.split('tags=')[1]));
  return {service, asked};
}

const FAILURES: Array<[string, () => Response, number]> = [
  ['a 422', () => reply(422, {}), 1],
  ['a null count', () => reply(200, {counts: {posts: null}}), 1],
  ['a 429 twice', () => reply(429, {}), 2],
  ['a 500 twice', () => reply(500, {}), 2],
];

describe('fetchCountWithRetry', () => {
  it.each(FAILURES)(
    'gives null, not 0, for %s (%i request)',
    async (_label, fail, requests) => {
      const {service, asked} = makeService({'touhou translated': fail});
      expect(await service.fetchCountWithRetry('touhou translated')).toBeNull();
      expect(asked()).toHaveLength(requests);
    },
  );

  it('takes the count when the retry after a 429 succeeds', async () => {
    const {service, asked} = makeService({
      'touhou translated': attempt =>
        attempt === 1 ? reply(429, {}) : reply(200, {counts: {posts: 12}}),
    });
    expect(await service.fetchCountWithRetry('touhou translated')).toBe(12);
    expect(asked()).toHaveLength(2);
  });

  it("does not send a search over the viewer's tag limit", async () => {
    anonymous();
    const {service, asked} = makeService();
    expect(
      await service.fetchCountWithRetry('touhou has:commentary commentary'),
    ).toBeNull();
    expect(asked()).toEqual([]);
  });
});

describe('fetchCommentaryCounts', () => {
  it('gives a lost count as null', async () => {
    const {service} = makeService({
      'touhou has:commentary commentary_request': () => reply(500, {}),
    });
    expect(await service.fetchCommentaryCounts('touhou')).toEqual({
      total: 7,
      translated: 7,
      requested: null,
    });
  });

  it('asks nothing for an anonymous viewer: the breakdowns need 3 tags', async () => {
    anonymous();
    const {service, asked} = makeService();
    expect(await service.fetchCommentaryCounts('touhou')).toEqual({
      total: null,
      translated: null,
      requested: null,
    });
    expect(asked()).toEqual([]);
  });
});

describe('fetchTranslationCounts', () => {
  it('gives no Untagged when one of its six terms is lost', async () => {
    const {service} = makeService({'touhou english_text translated': null});
    expect(await service.fetchTranslationCounts('touhou')).toEqual({
      translated: 7,
      requested: 7,
      untagged: null,
    });
  });

  it('counts Translated and Requested for an anonymous viewer, and none of the six', async () => {
    anonymous();
    const {service, asked} = makeService();
    expect(await service.fetchTranslationCounts('touhou')).toEqual({
      translated: 7,
      requested: 7,
      untagged: null,
    });
    expect(asked().sort()).toEqual([
      'touhou translated',
      'touhou translation_request',
    ]);
  });
});

describe('fetchStatusCounts', () => {
  it('gives pending as null, and active with it', async () => {
    const {service} = makeService({
      'touhou status:pending': () => reply(500, {}),
    });
    expect(await service.fetchStatusCounts('touhou')).toEqual({
      active: null, // 100 not deleted − pending (lost) − 7 flagged
      appealed: 7,
      banned: 7,
      deleted: 5,
      flagged: 7,
      pending: null,
    });
  });
});

describe('saving a report with a lost count', () => {
  function makeDb(previous?: Partial<TagAnalyticsMeta>) {
    const put = vi.fn(async (_record: {data: TagAnalyticsMeta}) => undefined);
    const db = {
      tag_analytics: {
        get: vi.fn(async () =>
          previous
            ? {tagName: 'touhou', updatedAt: 1, data: previous}
            : undefined,
        ),
        put,
      },
    } as unknown as Database;
    const saved = () => put.mock.calls[0][0].data;
    return {db, saved};
  }

  const report = (commentaryCounts: TagCountMap) =>
    ({name: 'touhou', commentaryCounts}) as TagAnalyticsMeta;

  it.each(FAILURES)('does not save %s as 0', async (_label, fail) => {
    const {db, saved} = makeDb();
    const {service} = makeService(
      {'touhou has:commentary commentary': fail},
      db,
    );
    const meta = report(await service.fetchCommentaryCounts('touhou'));

    await service.saveToCache(meta);

    expect(saved().commentaryCounts).toEqual({
      total: 7,
      translated: null,
      requested: 7,
    });
  });

  it("keeps the previous report's whole pie, and still shows the run's own", async () => {
    const whole = {total: 50, translated: 20, requested: 10};
    const {db, saved} = makeDb({commentaryCounts: whole});
    const {service} = makeService(
      {'touhou has:commentary commentary': () => reply(422, {})},
      db,
    );
    const meta = report(await service.fetchCommentaryCounts('touhou'));

    await service.saveToCache(meta);

    expect(saved().commentaryCounts).toEqual(whole);
    expect(meta.commentaryCounts?.translated).toBeNull();
  });

  it('saves the new pie when the previous one is not whole either', async () => {
    const {db, saved} = makeDb({
      commentaryCounts: {total: 50, translated: 20, requested: null},
    });
    const {service} = makeService({}, db);
    const fresh = {total: 9, translated: null, requested: 3};

    await service.saveToCache(report(fresh));

    expect(saved().commentaryCounts).toEqual(fresh);
  });

  it('replaces the previous pie with a whole new one', async () => {
    const {db, saved} = makeDb({
      commentaryCounts: {total: 50, translated: 20, requested: 10},
    });
    const {service} = makeService({}, db);
    const fresh = {total: 60, translated: 25, requested: 12};

    await service.saveToCache(report(fresh));

    expect(saved().commentaryCounts).toEqual(fresh);
  });

  it('keeps each pie on its own', () => {
    const previous = {
      statusCounts: {active: 90, deleted: 4},
      ratingCounts: {g: 80, e: 14},
    } as unknown as TagAnalyticsMeta;
    const data = {
      statusCounts: {active: null, deleted: 5},
      ratingCounts: {g: 81, e: 15},
    } as unknown as TagAnalyticsMeta;

    const kept = keepKnownCounts(data, previous);

    expect(kept.statusCounts).toBe(previous.statusCounts);
    expect(kept.ratingCounts).toBe(data.ratingCounts);
    expect(data.statusCounts.active).toBeNull();
    // Nothing lost: the same object, not a copy.
    const whole = {...data, statusCounts: {active: 91, deleted: 5}};
    expect(keepKnownCounts(whole, previous)).toBe(whole);
  });
});

describe('the pie of a report with unknown counts', () => {
  const meta = (fields: Partial<TagAnalyticsMeta>) =>
    ({name: 'touhou', ...fields}) as TagAnalyticsMeta;

  it('lists an unknown slice after the known ones, with no count', () => {
    const slices = buildPieSlices(
      'status',
      meta({statusCounts: {active: null, deleted: 5, pending: 0, flagged: 9}}),
    );
    expect(slices).toEqual([
      {key: 'flagged', name: 'Flagged', count: 9, locked: false},
      {key: 'deleted', name: 'Deleted', count: 5, locked: false},
      {key: 'active', name: 'Active', count: null, locked: false},
    ]);
  });

  it('leaves Untagged commentary unknown when a part is', () => {
    const slices = buildPieSlices(
      'commentary',
      meta({commentaryCounts: {total: 50, translated: null, requested: 10}}),
    );
    expect(slices?.map(s => [s.name, s.count])).toEqual([
      ['Requested', 10],
      ['Commentary', null],
      ['Untagged', null],
    ]);
  });

  it('marks the slices an anonymous viewer cannot count as locked', () => {
    anonymous();
    const commentary = buildPieSlices(
      'commentary',
      meta({
        commentaryCounts: {total: null, translated: null, requested: null},
      }),
    );
    expect(commentary?.every(s => s.locked)).toBe(true);

    const translation = buildPieSlices(
      'translation',
      meta({translationCounts: {translated: 4, requested: 2, untagged: null}}),
    );
    expect(translation?.map(s => [s.name, s.locked])).toEqual([
      ['Translated', false],
      ['Requested', false],
      ['Untagged', true],
    ]);
  });

  it('shows counts a saved report has to an anonymous viewer', () => {
    anonymous();
    const slices = buildPieSlices(
      'commentary',
      meta({commentaryCounts: {total: 60, translated: 20, requested: 10}}),
    );
    expect(slices?.map(s => [s.name, s.count, s.locked])).toEqual([
      ['Untagged', 30, false],
      ['Commentary', 20, false],
      ['Requested', 10, false],
    ]);
  });

  function renderPie(type: string, data: Partial<TagAnalyticsMeta>) {
    document.body.innerHTML = `
      <div id="status-pie-chart-wrapper">
        <div id="status-pie-chart"></div>
        <div id="status-pie-legend"></div>
      </div>
      <div id="status-pie-loading">Loading data...</div>`;
    new TagAnalyticsChartRenderer().renderPieChart(type, meta(data));
    const legend = [
      ...document.querySelectorAll<HTMLElement>('#status-pie-legend a'),
    ];
    return {
      legend: legend.map(a => a.textContent),
      titles: legend.map(a => a.title),
      paths: document.querySelectorAll('#status-pie-chart path').length,
      loading: document.getElementById('status-pie-loading')!,
      wrapper: document.getElementById('status-pie-chart-wrapper')!,
    };
  }

  it('draws the known slices and lists the unknown one with "—"', () => {
    const {legend, titles, paths} = renderPie('status', {
      statusCounts: {active: null, deleted: 5, flagged: 9},
    });
    expect(legend).toEqual(['Flagged (9)', 'Deleted (5)', 'Active (—)']);
    expect(titles[2]).toMatch(/^Unknown:/);
    expect(paths).toBe(2);
  });

  it('lists a locked slice with a lock', () => {
    anonymous();
    const {legend, titles} = renderPie('translation', {
      translationCounts: {translated: 4, requested: 2, untagged: null},
    });
    expect(legend).toEqual([
      'Translated (4)',
      'Requested (2)',
      'Untagged (🔒)',
    ]);
    expect(titles[2]).toMatch(/^Locked:/);
  });

  it('says a pie is locked when every slice is', () => {
    anonymous();
    const {loading, wrapper} = renderPie('commentary', {
      commentaryCounts: {total: null, translated: null, requested: null},
    });
    expect(loading.textContent).toMatch(/Locked/);
    expect(wrapper.style.opacity).toBe('0');
  });

  it('says the counts could not be loaded when every slice is lost', () => {
    const {loading} = renderPie('rating', {
      ratingCounts: {g: null, s: null, q: null, e: null},
    });
    expect(loading.textContent).toBe('Could not load the rating counts.');
  });
});

describe('refreshing the status and rating counts of a cached report', () => {
  type Internals = {
    _refreshCountOverlays(meta: TagAnalyticsMeta): Promise<void>;
  };

  function setUp(freshStatus: TagCountMap, freshRating: TagCountMap) {
    const app = new TagAnalyticsApp(
      {} as unknown as Database,
      {} as unknown as SettingsManager,
      'touhou',
      {fetch: vi.fn()} as unknown as RateLimitedFetch,
    );
    vi.spyOn(app, 'injectAnalyticsButton').mockImplementation(() => {});
    const ds = app.dataService;
    vi.spyOn(ds, 'fetchStatusCounts').mockResolvedValue(freshStatus);
    vi.spyOn(ds, 'fetchRatingCounts').mockResolvedValue(freshRating);
    const mark = vi.spyOn(ds, 'markCountsRefreshed');
    const cached = {
      name: 'touhou',
      updatedAt: 0,
      countsUpdatedAt: 0,
      historyData: [],
      statusCounts: {active: 90, deleted: 4},
      ratingCounts: {g: 80, e: 14},
    } as unknown as TagAnalyticsMeta;
    const refresh = () =>
      (app as unknown as Internals)._refreshCountOverlays(cached);
    return {cached, mark, refresh};
  }

  it('keeps a whole cached pie over a fresh one that lost a count, and asks again next time', async () => {
    const {cached, mark, refresh} = setUp(
      {active: null, deleted: 5},
      {g: 81, e: 15},
    );
    const before = cached.statusCounts;

    await refresh();

    expect(cached.statusCounts).toBe(before);
    expect(cached.ratingCounts).toEqual({g: 81, e: 15});
    expect(mark).not.toHaveBeenCalled();
  });

  it('takes both and stamps the refresh when both are whole', async () => {
    const {cached, mark, refresh} = setUp(
      {active: 91, deleted: 5},
      {g: 81, e: 15},
    );

    await refresh();

    expect(cached.statusCounts).toEqual({active: 91, deleted: 5});
    expect(mark).toHaveBeenCalledTimes(1);
  });
});

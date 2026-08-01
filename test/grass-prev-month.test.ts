import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {resolvePrevDecemberTotal} from '../src/core/grass-prev-month';
import type {DataManager} from '../src/core/data-manager';
import type {TargetUser} from '../src/types';

const USER: TargetUser = {
  name: 'fixture_user',
  normalizedName: 'fixture_user',
  id: '42',
  created_at: '2020-01-01T00:00:00Z',
  joinDate: new Date('2020-01-01T00:00:00Z'),
  level_string: 'Member',
};

/** DataManager stub exposing only what the resolver reaches for. */
function makeDataManager(
  overrides: {
    yearComplete?: boolean;
    dailySum?: number;
    remoteCount?: () => Promise<number>;
    fetch?: (
      url: string,
    ) => Promise<{ok: boolean; status: number; json: () => Promise<unknown>}>;
  } = {},
) {
  const dm = {
    checkYearCompletion: vi.fn(async () => overrides.yearComplete ?? false),
    sumDailyCounts: vi.fn(async () => overrides.dailySum ?? 0),
    fetchRemoteCount: vi.fn(overrides.remoteCount ?? (async () => 0)),
    rateLimiter: {
      fetch: vi.fn(
        overrides.fetch ??
          (async () => ({ok: true, status: 200, json: async () => []})),
      ),
    },
  };
  return dm as unknown as DataManager & typeof dm;
}

/** A page of `n` rows, as the list endpoints return them. */
const page = (n: number) => Array.from({length: n}, (_, i) => ({id: i}));

beforeEach(() => {
  vi.stubGlobal(
    'localStorage',
    (() => {
      const store = new Map<string, string>();
      return {
        getItem: vi.fn((k: string) => store.get(k) ?? null),
        setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
        removeItem: vi.fn((k: string) => void store.delete(k)),
      };
    })(),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resolvePrevDecemberTotal — tier 1: completed year in the DB', () => {
  it('sums the cached daily rows and never touches the network', async () => {
    const dm = makeDataManager({yearComplete: true, dailySum: 438});

    const total = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'uploads',
      year: 2025,
    });

    expect(total).toBe(438);
    expect(dm.sumDailyCounts).toHaveBeenCalledWith(
      'uploads',
      '42',
      '2025-12-01',
      '2025-12-31',
    );
    expect(dm.fetchRemoteCount).not.toHaveBeenCalled();
    expect(dm.rateLimiter.fetch).not.toHaveBeenCalled();
  });

  it('treats a row-less completed December as a real zero', async () => {
    // The distinction matters: 0 feeds a "new" badge, null hides the delta.
    const dm = makeDataManager({yearComplete: true, dailySum: 0});
    const total = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'uploads',
      year: 2025,
    });
    expect(total).toBe(0);
    expect(dm.fetchRemoteCount).not.toHaveBeenCalled();
  });

  it('ignores partial rows from a year that was never completed', async () => {
    // An interrupted sync leaves rows that look like a quiet month. Trusting
    // them would produce a confident wrong delta, so the resolver refetches.
    const dm = makeDataManager({
      yearComplete: false,
      dailySum: 5,
      remoteCount: async () => 438,
    });

    const total = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'uploads',
      year: 2025,
    });

    expect(total).toBe(438);
    expect(dm.sumDailyCounts).not.toHaveBeenCalled();
  });
});

describe('resolvePrevDecemberTotal — tier 2: localStorage memo', () => {
  it('reuses a memoised total instead of refetching', async () => {
    const dm = makeDataManager({remoteCount: async () => 438});

    const first = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'uploads',
      year: 2025,
    });
    const second = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'uploads',
      year: 2025,
    });

    expect([first, second]).toEqual([438, 438]);
    expect(dm.fetchRemoteCount).toHaveBeenCalledTimes(1);
  });

  it('keys the memo by user, metric and year', async () => {
    const dm = makeDataManager({remoteCount: async () => 7});
    await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'uploads',
      year: 2025,
    });
    expect(vi.mocked(localStorage.setItem)).toHaveBeenCalledWith(
      'di.grass.dec.42.uploads.2025',
      '7',
    );
  });
});

describe('resolvePrevDecemberTotal — tier 3: network', () => {
  it('uploads: a single count query over an exclusive December range', async () => {
    const dm = makeDataManager({remoteCount: async () => 438});

    const total = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'uploads',
      year: 2025,
    });

    expect(total).toBe(438);
    // `date:A...B` excludes B, so December ends at Jan 1.
    expect(dm.fetchRemoteCount).toHaveBeenCalledWith(
      'user:fixture_user date:2025-12-01...2026-01-01',
    );
  });

  it('approvals: counts rows and stops on the first short page', async () => {
    const fetch = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => page(120),
    }));
    const dm = makeDataManager({fetch});

    const total = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'approvals',
      year: 2025,
    });

    expect(total).toBe(120);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = fetch.mock.calls[0][0] as string;
    expect(url).toContain('/post_approvals.json');
    expect(url).toContain('search%5Buser_id%5D=42');
    expect(url).toContain('2025-12-01...2026-01-01');
  });

  it('notes: uses the updater_id endpoint and accumulates full pages', async () => {
    let call = 0;
    const fetch = vi.fn(async (_url: string) => {
      call++;
      return {
        ok: true,
        status: 200,
        json: async () => page(call === 1 ? 1000 : 30),
      };
    });
    const dm = makeDataManager({fetch});

    const total = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'notes',
      year: 2025,
    });

    expect(total).toBe(1030);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0] as string).toContain('/note_versions.json');
    expect(fetch.mock.calls[0][0] as string).toContain(
      'search%5Bupdater_id%5D=42',
    );
  });

  it('gives up rather than reporting a truncated count past the page cap', async () => {
    // Three full pages means there is more we are not going to fetch; a
    // partial total would render a plausible but wrong percentage.
    const fetch = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => page(1000),
    }));
    const dm = makeDataManager({fetch});

    const total = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'approvals',
      year: 2025,
    });

    expect(total).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
    // Nothing memoised — the answer was never established.
    expect(vi.mocked(localStorage.setItem)).not.toHaveBeenCalled();
  });

  it('does not memoise a failed lookup', async () => {
    const dm = makeDataManager({
      remoteCount: async () => {
        throw new Error('HTTP 500');
      },
    });

    const total = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'uploads',
      year: 2025,
    });

    expect(total).toBeNull();
    expect(vi.mocked(localStorage.setItem)).not.toHaveBeenCalled();
    // A later hover gets another chance.
    expect(vi.mocked(localStorage.getItem)).toHaveBeenCalled();
  });

  it('returns null for an HTTP error during the page walk', async () => {
    const dm = makeDataManager({
      fetch: async () => ({ok: false, status: 503, json: async () => []}),
    });

    const total = await resolvePrevDecemberTotal({
      dataManager: dm,
      user: USER,
      metric: 'approvals',
      year: 2025,
    });

    expect(total).toBeNull();
  });
});

/**
 * Limiter simulation: the real RateLimitedFetch against a model of
 * Danbooru's server-side limits (test/helpers/server-bucket.ts).
 *
 * Re-creates the 2026-11-12 audit's section 3.3 experiment as a standing
 * test (TASK.md T-201). Each scenario drives the limiter with the request
 * shapes the app really produces, under fake timers, and records what the
 * server saw. The "G-1 cap" checks hold since T-202 (6 req/s, burst 1);
 * the "current behaviour" checks still reproduce the audit's findings and
 * are flipped by T-203 (per-action lanes).
 *
 * The edge (Cloudflare) rule is unknown; the B-edge scenarios try two
 * assumptions, as the audit did.
 */
import {describe, it, expect, vi, beforeAll, afterAll} from 'vitest';
import {RateLimitedFetch} from '../src/core/rate-limiter';
import {CONFIG} from '../src/config';
import {
  SYNC_PAGE_MAX_ATTEMPTS,
  classifySyncFetchError,
  syncRetryDelayMs,
} from '../src/core/analytics-data-manager';
import {
  DanbooruBucket,
  SimServer,
  maxInWindow,
  type ServerLogEntry,
  type SimServerOptions,
} from './helpers/server-bucket';

type Driver = (rl: RateLimitedFetch) => Promise<number>;

interface SimResult {
  log: ServerLogEntry[];
  /** ms from start until each driver finished. */
  durations: Record<string, number>;
  /** Pages / counts each driver lost for good. */
  lost: Record<string, number>;
  total429: number;
  max1s: number;
  max10s: number;
}

/** Simulated-time cap; a scenario still running after this is a bug. */
const MAX_SIM_MS = 900_000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const range = (n: number) => Array.from({length: n}, (_, i) => i);

/** Deterministic Math.random for the limiter's jitter. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Drivers — request shapes copied from the app. Each returns what it lost.
// ---------------------------------------------------------------------------

/**
 * Full sync (AnalyticsDataManager.createSyncPageWorker): 5 workers started
 * 200 ms apart, 400 ms between pages, up to SYNC_PAGE_MAX_ATTEMPTS per page
 * with syncRetryDelayMs. A worker that exhausts a page's retries stops.
 */
function syncDriver(pages: number): Driver {
  return async rl => {
    let next = 1;
    let fetched = 0;
    const worker = async (id: number) => {
      if (id > 0) await sleep(id * 200);
      while (next <= pages) {
        const page = next++;
        let attempts = 0;
        let ok = false;
        while (attempts < SYNC_PAGE_MAX_ATTEMPTS) {
          const resp = await rl.fetch(`/posts.json?sync=1&page=${page}`);
          if (resp.ok) {
            ok = true;
            break;
          }
          attempts++;
          const kind = classifySyncFetchError(new Error(`HTTP ${resp.status}`));
          if (kind === 'fatal' || attempts >= SYNC_PAGE_MAX_ATTEMPTS) break;
          await sleep(
            syncRetryDelayMs(kind, attempts, rl.backoffRemainingMs()),
          );
        }
        if (!ok) return;
        fetched++;
        if (next <= pages) await sleep(400);
      }
    };
    await Promise.all(range(5).map(worker));
    return pages - fetched;
  };
}

/**
 * Grass year load without cache (DataManager.fetchAllPages): batches of 5
 * pages in parallel, each retried after 1 / 2 / 4 s on 429 or 5xx. A page
 * that still fails rejects the batch, which fails the year load.
 */
function grassDriver(pages: number): Driver {
  return async rl => {
    let fetched = 0;
    for (let first = 1; first <= pages; first += 5) {
      const batch = range(5)
        .map(i => first + i)
        .filter(p => p <= pages);
      const results = await Promise.all(
        batch.map(async page => {
          const backoff = [1000, 2000, 4000];
          for (let attempt = 0; ; attempt++) {
            const resp = await rl.fetch(`/posts.json?grass=1&page=${page}`);
            if (resp.status !== 429 && resp.status < 500) return true;
            if (attempt >= backoff.length) return false;
            await sleep(backoff[attempt]);
          }
        }),
      );
      fetched += results.filter(Boolean).length;
      if (results.some(ok => !ok)) break;
    }
    return pages - fetched;
  };
}

/**
 * Dashboard distribution counts (countBatch through mapConcurrent): `n`
 * counts, `concurrency` at a time, a 429 retried once.
 */
function dashboardCountsDriver(n: number, concurrency = 6): Driver {
  return async rl => {
    let index = 0;
    let lost = 0;
    const worker = async () => {
      while (index < n) {
        const i = index++;
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          const resp = await rl.fetch(`/counts/posts.json?tags=user:x+q${i}`);
          ok = resp.ok;
        }
        if (!ok) lost++;
      }
    };
    await Promise.all(range(concurrency).map(worker));
    return lost;
  };
}

/**
 * Tag page monthly history (TagAnalyticsDataService.fetchMonthlyCounts):
 * one count per month, all queued at once, no retry.
 */
function tagHistoryDriver(months: number): Driver {
  return async rl => {
    const responses = await Promise.all(
      range(months).map(i => rl.fetch(`/counts/posts.json?tags=t+m${i}`)),
    );
    return responses.filter(r => !r.ok).length;
  };
}

/** Tag page rankings (fetchRankingsAndResolve): 4 reports in parallel. */
function rankingDriver(): Driver {
  return async rl => {
    const responses = await Promise.all(
      range(4).map(i => rl.fetch(`/reports/posts.json?ranking=${i}`)),
    );
    return responses.filter(r => !r.ok).length;
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function simulate(
  drivers: Record<string, Driver>,
  serverOptions: SimServerOptions = {},
): Promise<SimResult> {
  const server = new SimServer(serverOptions);
  vi.stubGlobal('fetch', server.fetch);
  const random = vi.spyOn(Math, 'random').mockImplementation(seededRandom(7));
  try {
    // Same construction as src/main.ts.
    const rl = CONFIG.RATE_LIMITER;
    const limiter = new RateLimitedFetch(
      rl.concurrency,
      rl.jitter,
      rl.rps,
      rl.burst,
    );
    const start = Date.now();
    const durations: Record<string, number> = {};
    const lost: Record<string, number> = {};
    let settled = false;
    const all = Promise.all(
      Object.entries(drivers).map(async ([name, drive]) => {
        lost[name] = await drive(limiter);
        durations[name] = Date.now() - start;
      }),
    ).then(() => {
      settled = true;
    });
    while (!settled && Date.now() - start < MAX_SIM_MS) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    if (!settled) throw new Error('simulation did not finish');
    await all;
    const times = server.log.map(e => e.t);
    return {
      log: server.log,
      durations,
      lost,
      total429: server.log.filter(e => e.status === 429).length,
      max1s: maxInWindow(times, 1000),
      max10s: maxInWindow(times, 10_000),
    };
  } finally {
    random.mockRestore();
    vi.unstubAllGlobals();
  }
}

const SYNC_PAGES = 230; // a 46k-post account
const GRASS_PAGES = 100; // a 20k-upload year
const HISTORY_MONTHS = 250; // a tag page's first visit, 2005 to now

/**
 * Scenarios, named as in the audit's table 3.3. Two of the audit's are
 * folded into others: D (edge "100 per 10 s") only differs from B when B
 * reaches 100 requests in some 10 s window, which B.max10s shows directly;
 * H (tag history alone) is T without the 4 rankings, which run on their
 * own queue and do not change the history numbers.
 *
 * Wall time: the long scenarios (B, C, T) take a few seconds each because
 * the limiter re-arms a timer on every refused dispatch, tens of thousands
 * of timers per run (audit DA-13). T-203 removes that.
 */
const results: Record<string, SimResult> = {};

beforeAll(async () => {
  // Only what the limiter uses; faking performance/hrtime as well would
  // hide how long a scenario really takes.
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
    ],
  });
  vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
  const syncAndGrass = () => ({
    sync: syncDriver(SYNC_PAGES),
    grass: grassDriver(GRASS_PAGES),
  });
  results.A = await simulate({sync: syncDriver(SYNC_PAGES)});
  results.B = await simulate(syncAndGrass());
  results.C = await simulate(syncAndGrass(), {
    edge: {windowMs: 1000, max: 10},
  });
  results.E = await simulate({
    sync: syncDriver(SYNC_PAGES),
    counts: dashboardCountsDriver(150),
  });
  results.T = await simulate({
    ranking: rankingDriver(),
    history: tagHistoryDriver(HISTORY_MONTHS),
  });
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The server model itself
// ---------------------------------------------------------------------------

describe('DanbooruBucket (rate_limit.rb)', () => {
  const count = {action: 'counts:posts', rate: 1, burst: 15};
  const pointsOf = (header: string): number =>
    JSON.parse(header).limits['ip/127.0.0.0/24'];

  it('admits a full burst, then limits', () => {
    const b = new DanbooruBucket(count);
    const limited = range(16).map(() => b.hit(0).limited);
    expect(limited.slice(0, 15).every(l => !l)).toBe(true);
    expect(limited[15]).toBe(true);
  });

  it('charges a second of debt per request while limited, down to -30', () => {
    const b = new DanbooruBucket(count);
    range(55).forEach(() => b.hit(0));
    expect(pointsOf(b.hit(0).header)).toBe(-30);
    // 30 s of regeneration only brings it back to 0: still limited.
    expect(b.hit(30_000).limited).toBe(true);
  });

  it('regenerates at `rate` points per second', () => {
    const b = new DanbooruBucket(count);
    range(15).forEach(() => b.hit(0));
    expect(b.hit(500).limited).toBe(true);
    expect(b.hit(3000).limited).toBe(false);
  });
});

describe('maxInWindow', () => {
  it('counts the busiest window', () => {
    expect(maxInWindow([0, 100, 999, 1000, 1500], 1000)).toBe(3);
    expect(maxInWindow([], 1000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenarios. The harness checks hold for any limiter; the "current
// behaviour" checks reproduce the audit's findings and are flipped by
// T-203.
// ---------------------------------------------------------------------------

describe('limiter simulation — harness', () => {
  it('A: a lone 46k-post sync fetches every page without a 429', () => {
    expect(results.A.lost.sync).toBe(0);
    expect(results.A.log).toHaveLength(SYNC_PAGES);
    expect(results.A.total429).toBe(0);
    // audit: 43 s, at most 7 per second, 55 per 10 s.
    expect(results.A.durations.sync).toBeLessThan(50_000);
    expect(results.A.max1s).toBeLessThanOrEqual(7);
  });

  it('B: sync and Grass together still finish without loss', () => {
    expect(results.B.lost).toEqual({sync: 0, grass: 0});
    expect(results.B.total429).toBe(0);
  });

  it('T: the 4 rankings all arrive', () => {
    expect(results.T.lost.ranking).toBe(0);
  });
});

describe('limiter simulation — G-1 cap (6 req/s, burst 1)', () => {
  it('one tab never sends more than 7 per 1 s or 61 per 10 s', () => {
    // 1 stored token + 6 per second; the 0–50 ms jitter after a token is
    // taken cannot fit an 8th request into any 1 s window.
    for (const [name, r] of Object.entries(results)) {
      expect(r.max1s, name).toBeLessThanOrEqual(7);
      expect(r.max10s, name).toBeLessThanOrEqual(61);
    }
  });

  it('B: overlapping Grass and sync sit exactly at the cap, without 429s', () => {
    // Before G-1 (9 req/s, burst 9): 16 per 1 s, 98 per 10 s.
    expect(results.B.max1s).toBe(7);
    expect(results.B.max10s).toBe(61);
    // The cost: sync 46 s -> ~58 s, Grass 21 s -> ~33 s for this load.
    expect(results.B.durations.sync).toBeLessThan(65_000);
  });

  it('C: the "10 per 1 s" edge assumption draws no 429', () => {
    // Before G-1: 4 x 429 (audit: 5).
    expect(results.C.total429).toBe(0);
    expect(results.C.durations).toEqual(results.B.durations);
  });
});

describe('limiter simulation — current behaviour (pre-T-203)', () => {
  it('E: count 429s stall the whole queue, and counts are lost', () => {
    // audit: 101 x 429, sync 250 s, 33 counts lost; after G-1 about 53 x
    // 429 and 26 lost. A count 429 pauses the general queue, so the sync
    // waits too. T-203's count lane: no 429, sync near A, nothing lost.
    expect(results.E.total429).toBeGreaterThan(25);
    expect(results.E.lost.counts).toBeGreaterThan(0);
    expect(results.E.durations.sync).toBeGreaterThan(
      4 * results.A.durations.sync,
    );
  });

  it('T: a tag page first visit loses a large share of its months', () => {
    // audit H: 59 of 250 lost (its model retried). fetchMonthlyCounts does
    // not retry, as here. T-203's lane: 0 lost (it still takes ~4 min).
    expect(results.T.lost.history).toBeGreaterThan(HISTORY_MONTHS / 4);
    expect(results.T.total429).toBeGreaterThan(HISTORY_MONTHS / 4);
  });

  it('T: the 3 s report cooldown makes 4 rankings take 9 s or more', () => {
    // The server allows a burst of 15. T-203 drops the fixed cooldown: < 4 s.
    expect(results.T.durations.ranking).toBeGreaterThanOrEqual(9000);
  });
});

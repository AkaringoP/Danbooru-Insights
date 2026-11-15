/**
 * Limiter simulation: the real RateLimitedFetch against a model of
 * Danbooru's server-side limits (test/helpers/server-bucket.ts).
 *
 * Re-creates the 2026-11-12 audit's section 3.3 experiment as a standing
 * test (TASK.md T-201). Each scenario drives the limiter with the request
 * shapes the app really produces, under fake timers, and records what the
 * server saw. Each group of checks notes what the audit measured before
 * the change it pins: the cap since T-202 (6 req/s, burst 1; 4.5 req/s
 * since T-213), the "per-action lanes" since T-203.
 *
 * The edge (Cloudflare) rule is not public; scenario C tries the audit's
 * "10 per second" assumption, B.max10s covers its "100 per 10 s" one, and
 * F tries the "50 per 10 s" that the live 429s of 2026-11-13 point at.
 */
import {describe, it, expect, vi, beforeAll, afterAll} from 'vitest';
import {RateLimitedFetch} from '../src/core/rate-limiter';
import {CONFIG} from '../src/config';
import {SYNC_WORKERS} from '../src/core/analytics-data-manager';
import {
  SYNC_PAGE_MAX_ATTEMPTS,
  classifySyncFetchError,
  syncRetryDelayMs,
} from '../src/core/fetch-retry';
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
 * Full sync (AnalyticsDataManager.createSyncPageWorker): SYNC_WORKERS started
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
    await Promise.all(range(SYNC_WORKERS).map(worker));
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
 * Wall time is well under a second. Before the limiter kept a single
 * wakeup per queue (audit DA-13) every refused dispatch armed its own
 * timer, tens of thousands per run, and this file took ~50 s.
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
  results.F = await simulate(syncAndGrass(), {
    edge: {windowMs: 10_000, max: 50},
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
// Scenarios. The harness checks hold for any limiter; the others pin what
// T-202 and T-203 fixed, with the audit's "before" numbers in comments.
// ---------------------------------------------------------------------------

describe('limiter simulation — harness', () => {
  it('A: a lone 46k-post sync fetches every page without a 429', () => {
    expect(results.A.lost.sync).toBe(0);
    expect(results.A.log).toHaveLength(SYNC_PAGES);
    expect(results.A.total429).toBe(0);
    // audit (6 req/s): 43 s, at most 7 per second, 55 per 10 s. At the
    // 4.5 req/s cap (T-213): ~51 s, because this model answers a page in
    // 500 ms and the 5 workers run into the cap. Live pages take about
    // 1 s, so the real sync is paced by its workers and is slower.
    expect(results.A.durations.sync).toBeLessThan(60_000);
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

describe('limiter simulation — the cap (4.5 req/s, burst 1)', () => {
  it('one tab never sends more than 6 per 1 s or 47 per 10 s', () => {
    // 1 stored token + 4.5 per second. The point of 4.5 (T-213): stay
    // under the "about 50 per 10 s" the live 429s suggest. At 6 req/s
    // (G-1) the bounds were 7 and 61.
    for (const [name, r] of Object.entries(results)) {
      expect(r.max1s, name).toBeLessThanOrEqual(6);
      expect(r.max10s, name).toBeLessThanOrEqual(47);
    }
  });

  it('B: overlapping Grass and sync sit at the cap, without 429s', () => {
    // History: 9 req/s burst 9 gave 16 per 1 s and 98 per 10 s; 6 req/s
    // burst 1 gave 7 and 61.
    expect(results.B.max1s).toBe(5);
    expect(results.B.max10s).toBe(46);
    // The cost for this load: sync ~51 s alone -> ~74 s, Grass ~44 s
    // (at 6 req/s: ~65 s and ~33 s).
    expect(results.B.durations.sync).toBeLessThan(80_000);
    expect(results.B.durations.grass).toBeLessThan(50_000);
  });

  it('C: the "10 per 1 s" edge assumption draws no 429', () => {
    // Before G-1: 4 x 429 (audit: 5).
    expect(results.C.total429).toBe(0);
    expect(results.C.durations).toEqual(results.B.durations);
  });

  it('F: a "50 per 10 s" edge rule draws no 429 either', () => {
    // The rule the live 429s point at (two of them came with exactly 49
    // requests in the 10 s before). 6 req/s could send 61 in 10 s.
    expect(results.F.total429).toBe(0);
    expect(results.F.lost).toEqual({sync: 0, grass: 0});
    expect(results.F.durations).toEqual(results.B.durations);
  });
});

describe('limiter simulation — per-action lanes (T-203)', () => {
  it('E: counts wait in their own lane; the sync is not held up', () => {
    // Before the lanes (one shared queue, a count 429 paused everything):
    // audit 101 x 429, sync 250 s, 33 counts lost; after G-1 54 x 429,
    // sync 196 s, 26 lost.
    expect(results.E.total429).toBe(0);
    expect(results.E.lost).toEqual({sync: 0, counts: 0});
    // Each count also takes a token from the shared bucket (about 1 of
    // the 4.5 per second), so the sync gives up that much: ~51 s -> ~70 s.
    expect(results.E.durations.sync).toBeLessThan(
      1.4 * results.A.durations.sync,
    );
  });

  it('T: a tag page first visit loses no month', () => {
    // Before: 117 of 250 months lost, each one a 429.
    expect(results.T.lost.history).toBe(0);
    expect(results.T.total429).toBe(0);
  });

  it('T: but 250 counts still take ~4 min at the server limit of 1/s', () => {
    // 14 from the burst (one point kept in reserve), then 1/s. Only fewer
    // requests helps: the monthly history moves to /reports in Phase 3.
    expect(results.T.durations.history).toBeGreaterThan(230_000);
  });

  it('T: the 4 rankings no longer wait 3 s apart', () => {
    // Before: a fixed 3 s cooldown, 13.6 s for 4 reports (server burst 15).
    expect(results.T.durations.ranking).toBeLessThan(4000);
  });
});

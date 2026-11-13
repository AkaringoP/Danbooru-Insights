import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
  RateLimitedFetch,
  backoffFromResponse,
  parseRetryAfterMs,
  parseXRateLimitWaitMs,
} from '../src/core/rate-limiter';
import {CONFIG} from '../src/config';

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({})});
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('RateLimitedFetch', () => {
  describe('getRequestCount()', () => {
    it('starts at 0', () => {
      const rl = new RateLimitedFetch();
      expect(rl.getRequestCount()).toBe(0);
    });
  });

  describe('refillTokens()', () => {
    it('does not refill when elapsed time < refillRate', () => {
      const rl = new RateLimitedFetch(6, [0, 0], 5); // refillRate = 200ms
      rl.tokens = 0;
      rl.lastRefill = Date.now() - 100; // 100ms < 200ms
      rl.refillTokens();
      expect(rl.tokens).toBe(0);
    });

    it('refills tokens proportional to elapsed time', () => {
      const rl = new RateLimitedFetch(6, [0, 0], 5); // rateLimit=5, refillRate=200ms
      rl.tokens = 0;
      rl.lastRefill = Date.now() - 600; // 600ms / 200ms = 3 tokens
      rl.refillTokens();
      expect(rl.tokens).toBe(3);
    });

    it('caps tokens at rateLimit', () => {
      const rl = new RateLimitedFetch(6, [0, 0], 5); // rateLimit=5
      rl.tokens = 0;
      rl.lastRefill = Date.now() - 5000; // way more than needed
      rl.refillTokens();
      expect(rl.tokens).toBe(5); // capped at rateLimit
    });
  });

  describe('updateLimits()', () => {
    it('updates rateLimit, refillRate, and maxConcurrency', () => {
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      rl.updateLimits(2, 2);
      expect(rl.rateLimit).toBe(2);
      expect(rl.refillRate).toBe(500); // 1000 / 2
      expect(rl.maxConcurrency).toBe(2);
    });

    it('clamps existing tokens to new rateLimit', () => {
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      expect(rl.tokens).toBe(6);
      rl.updateLimits(2, 2);
      expect(rl.tokens).toBe(2); // clamped from 6 to 2
    });
  });

  describe('explicit burst (decision G-1)', () => {
    it('starts with `burst` tokens and never refills past it', () => {
      const rl = new RateLimitedFetch(8, [0, 0], 6, 1);
      expect(rl.tokens).toBe(1);
      rl.tokens = 0;
      rl.lastRefill = Date.now() - 5000;
      rl.refillTokens();
      expect(rl.tokens).toBe(1);
    });

    it('sends one request at once, then one per 1/rps', async () => {
      const rl = new RateLimitedFetch(8, [0, 0], 6, 1);
      for (let i = 0; i < 10; i++) void rl.fetch(`/posts.json?page=${i}`);
      await vi.advanceTimersByTimeAsync(0);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      // The burst token plus 6 per second: at most 7 by the 1 s mark.
      await vi.advanceTimersByTimeAsync(1000);
      const sent = vi.mocked(global.fetch).mock.calls.length;
      expect(sent).toBeGreaterThanOrEqual(6);
      expect(sent).toBeLessThanOrEqual(7);
    });

    it('keeps the burst when tabs split the rate', () => {
      const rl = new RateLimitedFetch(8, [0, 0], 6, 1);
      rl.updateLimits(3, 4);
      expect(rl.refillRate).toBeCloseTo(1000 / 3);
      rl.tokens = 0;
      rl.lastRefill = Date.now() - 5000;
      rl.refillTokens();
      expect(rl.tokens).toBe(1);
    });

    it('is the configured default the app builds with', () => {
      expect(CONFIG.RATE_LIMITER).toMatchObject({rps: 6, burst: 1});
    });
  });

  describe('single wakeup (audit DA-13)', () => {
    // Every refused dispatch used to arm its own timer: 49 here.
    it('keeps one timer however many requests wait for a token', async () => {
      const rl = new RateLimitedFetch(8, [0, 0], 6, 1);
      for (let i = 0; i < 50; i++) void rl.fetch(`/posts.json?page=${i}`);
      await vi.advanceTimersByTimeAsync(0);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
    });

    it('keeps one timer through a 429 pause, then resumes', async () => {
      const rl = new RateLimitedFetch(8, [0, 0], 6, 1);
      rl.setBackoff(Date.now() + 10_000);
      for (let i = 0; i < 50; i++) void rl.fetch(`/posts.json?page=${i}`);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      expect(global.fetch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(global.fetch).toHaveBeenCalled();
    });

    it('moves the wakeup earlier when a sooner one is needed', async () => {
      const rl = new RateLimitedFetch(8, [0, 0], 6, 1);
      rl.setBackoff(Date.now() + 10_000);
      void rl.fetch('/posts.json?page=1');
      await vi.advanceTimersByTimeAsync(0);
      // Another tab's pause ends sooner: our own pause is cut short.
      rl.backoffUntil = Date.now() + 1000;
      void rl.fetch('/posts.json?page=2');
      await vi.advanceTimersByTimeAsync(1001);
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('setBackoff()', () => {
    it('sets backoffUntil to the given timestamp', () => {
      const rl = new RateLimitedFetch();
      const future = Date.now() + 5000;
      rl.setBackoff(future);
      expect(rl.backoffUntil).toBe(future);
    });

    it('only updates if the new timestamp is later', () => {
      const rl = new RateLimitedFetch();
      const t1 = Date.now() + 5000;
      const t2 = Date.now() + 3000;
      rl.setBackoff(t1);
      rl.setBackoff(t2);
      expect(rl.backoffUntil).toBe(t1); // t1 > t2, so t1 kept
    });
  });

  describe('429 triggers global backoff', () => {
    it('calls onBackoff callback on 429 response', async () => {
      global.fetch = vi.fn().mockResolvedValue({status: 429, ok: false});
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      const backoffSpy = vi.fn();
      rl.onBackoff = backoffSpy;

      const p = rl.fetch('/posts.json');
      await vi.runAllTimersAsync();
      await p;

      expect(backoffSpy).toHaveBeenCalledOnce();
      expect(backoffSpy.mock.calls[0][0]).toBeGreaterThan(Date.now());
    });
  });

  describe('fetch() routing', () => {
    it('routes /reports/ URLs through the reports lane', async () => {
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      const p = rl.fetch('/reports/something');
      await vi.runAllTimersAsync();
      await p;
      expect(global.fetch).toHaveBeenCalledWith(
        '/reports/something',
        undefined,
      );
      expect(rl.getRequestCount()).toBe(1);
    });

    it('routes general URLs to the token bucket queue', async () => {
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      const p = rl.fetch('/posts.json');
      await vi.runAllTimersAsync();
      await p;
      expect(global.fetch).toHaveBeenCalledWith('/posts.json', undefined);
      expect(rl.getRequestCount()).toBe(1);
    });
  });
});

// Danbooru sends no Retry-After; it attaches its token-bucket state as an
// `X-Rate-Limit` JSON header. These pin how a 429's pause follows it.
describe('server-driven 429 backoff', () => {
  const xRateLimit = (points: Record<string, number>, rate = 1, cost = 1) =>
    JSON.stringify({
      action: 'posts:index',
      rate,
      burst: 10,
      cost,
      minimum_points: -30,
      enabled: true,
      limits: points,
    });
  const withHeaders = (h: Record<string, string>) => ({
    headers: new Headers(h),
  });

  describe('parseXRateLimitWaitMs', () => {
    it('waits (cost - lowest points) / rate', () => {
      expect(
        parseXRateLimitWaitMs(xRateLimit({'user/1': -4, 'ip/1.2.3.0/24': 3})),
      ).toBe(5000);
      expect(parseXRateLimitWaitMs(xRateLimit({'user/1': -30}, 2))).toBe(
        15_500,
      );
    });

    it('is 0 when the bucket already has enough points', () => {
      expect(parseXRateLimitWaitMs(xRateLimit({'user/1': 4}))).toBe(0);
    });

    it('rejects missing, malformed or unusable headers', () => {
      expect(parseXRateLimitWaitMs(null)).toBeNull();
      expect(parseXRateLimitWaitMs('not json')).toBeNull();
      expect(parseXRateLimitWaitMs(xRateLimit({}))).toBeNull();
      expect(parseXRateLimitWaitMs(xRateLimit({a: -3}, 0))).toBeNull();
      expect(parseXRateLimitWaitMs('{"rate":1,"limits":null}')).toBeNull();
    });
  });

  describe('parseRetryAfterMs', () => {
    it('reads delay-seconds and HTTP-dates', () => {
      const now = Date.parse('2026-10-29T00:00:00Z');
      expect(parseRetryAfterMs('12', now)).toBe(12_000);
      expect(parseRetryAfterMs('Thu, 29 Oct 2026 00:00:20 GMT', now)).toBe(
        20_000,
      );
      expect(parseRetryAfterMs('soon', now)).toBeNull();
      expect(parseRetryAfterMs(null, now)).toBeNull();
    });
  });

  describe('backoffFromResponse', () => {
    it('prefers X-Rate-Limit, with a safety margin', () => {
      const r = backoffFromResponse(
        withHeaders({
          'X-Rate-Limit': xRateLimit({'user/1': -30}),
          'Retry-After': '2',
        }),
        0,
      );
      expect(r).toEqual({ms: 31_500, source: 'x-rate-limit'});
    });

    it('falls back to Retry-After, then to the configured default', () => {
      expect(backoffFromResponse(withHeaders({'Retry-After': '8'}), 0)).toEqual(
        {ms: 8000, source: 'retry-after'},
      );
      expect(backoffFromResponse(withHeaders({}), 0)).toEqual({
        ms: CONFIG.BACKOFF_DURATION_MS,
        source: 'default',
      });
      // Header-less test doubles must not throw.
      expect(backoffFromResponse({} as Response, 0).source).toBe('default');
    });

    it('clamps server waits to [1 s, MAX_BACKOFF_MS]', () => {
      expect(backoffFromResponse(withHeaders({'Retry-After': '0'}), 0).ms).toBe(
        1000,
      );
      expect(
        backoffFromResponse(withHeaders({'Retry-After': '86400'}), 0).ms,
      ).toBe(CONFIG.MAX_BACKOFF_MS);
    });
  });

  it('a header-less 429 pauses everything for the server wait and broadcasts it', async () => {
    // The edge in front of Danbooru: no X-Rate-Limit, maybe a Retry-After.
    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers({'Retry-After': '8'}),
    });
    const rl = new RateLimitedFetch(1, [0, 0], 10);
    const onBackoff = vi.fn();
    rl.onBackoff = onBackoff;
    const start = Date.now();

    await rl.fetch('/posts.json');

    expect(rl.backoffUntil - start).toBe(8000);
    expect(onBackoff).toHaveBeenCalledWith(rl.backoffUntil);
    expect(rl.backoffRemainingMs()).toBe(8000);
    vi.advanceTimersByTime(8000);
    expect(rl.backoffRemainingMs()).toBe(0);
  });

  it('logs how many requests left in the windows before an edge 429 and the busiest ones it let through (T-208, T-209)', async () => {
    // The edge's rule is unknown; these counts, gathered over a few 429s,
    // are how to infer its window and limit: the refused request's windows
    // bound it from above, the busiest accepted ones from below.
    const ok = {ok: true, status: 200, headers: new Headers()};
    const refused = {ok: false, status: 429, headers: new Headers()};
    global.fetch = vi.fn().mockResolvedValue(ok);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rl = new RateLimitedFetch(10, [0, 0], 100, 10);
    rl.updateLimits(100, 10, 2);
    const send = (n: number) =>
      Promise.all(Array.from({length: n}, () => rl.fetch('/posts.json')));

    await send(1); // t = 0: older than 60 s by the 429
    vi.advanceTimersByTime(40_000);
    await send(3); // t = 40 s
    vi.advanceTimersByTime(20_000);
    await send(2); // t = 60 s
    vi.advanceTimersByTime(8_000);
    await send(1); // t = 68 s
    vi.advanceTimersByTime(500);
    vi.mocked(global.fetch).mockResolvedValueOnce(refused as never);
    await send(1); // t = 68.5 s → 429

    const call = warn.mock.calls.find(c =>
      String(c[0]).includes('429 received, pausing requests'),
    );
    expect(call?.[1]).toMatchObject({
      sent1s: 2,
      sent10s: 4,
      sent60s: 7,
      sent120s: 8,
      // Best accepted: t = 40 s (3 in 10 s), t = 68 s (6 in 60 s, 7 in 120 s).
      peakOk10s: 3,
      peakOk60s: 6,
      peakOk120s: 7,
      inFlight: 1,
      laneInFlight: {},
      rps: 100,
      tabs: 2,
    });
    // The 429 is counted and the next run-up is measured from scratch.
    expect(rl.trafficSummary()).toEqual({
      edge429s: 1,
      peakOk: {sent1s: 0, sent10s: 0, sent60s: 0, sent120s: 0},
    });
  });
});

// Danbooru limits counts, reports and related tags with their own buckets
// and sends the bucket on every reply. Their requests wait in their own
// lane, sized from that header, and a 429 there holds only that lane.
describe('per-action lanes', () => {
  const header = (action: string, points: number, rate = 1, burst = 15) =>
    JSON.stringify({
      action,
      rate,
      burst,
      cost: 1,
      minimum_points: -30,
      enabled: true,
      limits: {'ip/1.2.3.0/24': points},
    });
  /** fetch double answering by path; anything unlisted is a plain 200. */
  function serve(
    routes: Record<string, {status: number; header?: string}>,
  ): string[] {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      calls.push(url);
      const path = Object.keys(routes).find(p => url.startsWith(p));
      const r = path ? routes[path] : {status: 200};
      return {
        status: r.status,
        ok: r.status < 400,
        headers: new Headers(r.header ? {'X-Rate-Limit': r.header} : {}),
      };
    }) as unknown as typeof fetch;
    return calls;
  }

  it('a 429 with X-Rate-Limit got past the edge: it raises the accepted peak, not the edge count (T-209)', async () => {
    serve({'/counts/': {status: 429, header: header('counts:posts', -9)}});
    const rl = new RateLimitedFetch(8, [0, 0], 10);

    await rl.fetch('/counts/posts.json?tags=a');

    expect(rl.trafficSummary()).toEqual({
      edge429s: 0,
      peakOk: {sent1s: 1, sent10s: 1, sent60s: 1, sent120s: 1},
    });
  });

  it('a 429 with X-Rate-Limit holds only its lane, and is not broadcast', async () => {
    const calls = serve({
      '/counts/': {status: 429, header: header('counts:posts', -9)},
    });
    const rl = new RateLimitedFetch(8, [0, 0], 10);
    const onBackoff = vi.fn();
    rl.onBackoff = onBackoff;

    await rl.fetch('/counts/posts.json?tags=a');
    expect(onBackoff).not.toHaveBeenCalled();
    expect(rl.backoffRemainingMs()).toBe(0);

    // General traffic goes straight through...
    await rl.fetch('/posts.json?page=1');
    // ...while the next count waits until the bucket holds 2 points:
    // from -9 at 1 point/s, 11 s.
    void rl.fetch('/counts/posts.json?tags=b');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.filter(u => u.includes('tags=b'))).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1100);
    expect(calls.filter(u => u.includes('tags=b'))).toHaveLength(1);
  });

  it('re-syncs a lane from the header of a successful reply', async () => {
    // Another tab has spent the shared bucket: the server says 0 points.
    const calls = serve({
      '/counts/': {status: 200, header: header('counts:posts', 0)},
    });
    const rl = new RateLimitedFetch(8, [0, 0], 10);
    await rl.fetch('/counts/posts.json?tags=a');
    void rl.fetch('/counts/posts.json?tags=b');
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toHaveLength(2);
  });

  it('a lane that must wait does not hold up requests queued after it', async () => {
    const calls = serve({
      '/counts/': {status: 200, header: header('counts:posts', -5)},
    });
    const rl = new RateLimitedFetch(8, [0, 0], 10);
    await rl.fetch('/counts/posts.json?tags=a');
    void rl.fetch('/counts/posts.json?tags=b');
    void rl.fetch('/posts.json?page=1');
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toEqual(['/counts/posts.json?tags=a', '/posts.json?page=1']);
  });

  it('sends reports together instead of 3 s apart', async () => {
    const calls = serve({});
    const rl = new RateLimitedFetch(8, [0, 0], 10);
    for (let i = 0; i < 4; i++) void rl.fetch(`/reports/posts.json?g=${i}`);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(4);
  });

  it('caps a lane at 2 requests in flight until a reply calibrates it', async () => {
    const release: Array<() => void> = [];
    let sent = 0;
    global.fetch = vi.fn(
      () =>
        new Promise(resolve => {
          sent++;
          release.push(() =>
            resolve({status: 200, ok: true, headers: new Headers()}),
          );
        }),
    ) as unknown as typeof fetch;
    const rl = new RateLimitedFetch(8, [0, 0], 10);
    for (let i = 0; i < 5; i++) void rl.fetch(`/counts/posts.json?tags=${i}`);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toBe(2);
    release.splice(0).forEach(r => r());
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toBe(4);
  });

  it('learns a lane for a path that turns out to be rate-limited', async () => {
    const calls = serve({
      '/artists.json': {status: 429, header: header('artists:index', -3)},
    });
    const rl = new RateLimitedFetch(8, [0, 0], 10);
    const onBackoff = vi.fn();
    rl.onBackoff = onBackoff;
    await rl.fetch('/artists.json?page=1');
    expect(onBackoff).not.toHaveBeenCalled();
    void rl.fetch('/artists.json?page=2');
    await rl.fetch('/posts.json');
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.filter(u => u.startsWith('/artists.json'))).toHaveLength(1);
    expect(calls).toContain('/posts.json');
  });

  it('keeps one lane when several replies reveal the same limited path', async () => {
    // Two requests leave before either reply. Each reply used to create a
    // fresh lane and replace the last one, so the older, stale header (14
    // points) wiped out what the newer one had said (0 points).
    const reply: Array<(points: number) => void> = [];
    global.fetch = vi.fn(
      () =>
        new Promise(resolve => {
          reply.push(points =>
            resolve({
              status: 200,
              ok: true,
              headers: new Headers({
                'X-Rate-Limit': header('artists:index', points),
              }),
            }),
          );
        }),
    ) as unknown as typeof fetch;
    const rl = new RateLimitedFetch(8, [0, 0], 10);
    void rl.fetch('/artists.json?page=1');
    await vi.advanceTimersByTimeAsync(100);
    void rl.fetch('/artists.json?page=2');
    await vi.advanceTimersByTimeAsync(0);
    expect(reply).toHaveLength(2);

    reply[1](0); // the newer request's reply: the bucket is empty
    await vi.advanceTimersByTimeAsync(0);
    reply[0](14); // the older request's reply arrives late
    await vi.advanceTimersByTimeAsync(0);

    void rl.fetch('/artists.json?page=3');
    await vi.advanceTimersByTimeAsync(1500);
    expect(reply).toHaveLength(2); // still waiting for 2 points
    await vi.advanceTimersByTimeAsync(600);
    expect(reply).toHaveLength(3);
  });
});

// After a pause the backlog used to leave as one burst (full bucket + every
// queued dispatch timer firing together), drawing the next 429 within a
// second or two. These pin the slow start and the adaptive throttle.
describe('post-429 recovery', () => {
  /** fetch double whose responses resolve only when the test says so. */
  function controllableFetch(status = 200) {
    const state = {inFlight: 0, peak: 0, release: [] as Array<() => void>};
    global.fetch = vi.fn(
      () =>
        new Promise(resolve => {
          state.inFlight++;
          state.peak = Math.max(state.peak, state.inFlight);
          state.release.push(() => {
            state.inFlight--;
            resolve({status, ok: status < 400});
          });
        }),
    ) as unknown as typeof fetch;
    const releaseAll = () => {
      const pending = state.release.splice(0);
      pending.forEach(r => r());
    };
    return {state, releaseAll};
  }

  it('resumes a backlog with one token and two in flight, then widens', async () => {
    const {state, releaseAll} = controllableFetch();
    const rl = new RateLimitedFetch(8, [0, 0], 9);
    rl.setBackoff(Date.now() + 5000);
    const all = Array.from({length: 12}, () => rl.fetch('/posts.json'));

    // Pause over, inside the 5 s slow-start window.
    await vi.advanceTimersByTimeAsync(5000 + 2000);
    expect(state.peak).toBe(2);
    expect(state.inFlight).toBe(2);

    // Slow start over: completions refill the in-flight set past two.
    await vi.advanceTimersByTimeAsync(4000);
    releaseAll();
    await vi.advanceTimersByTimeAsync(50);
    expect(state.inFlight).toBeGreaterThan(2);

    for (let i = 0; i < 10 && state.release.length > 0; i++) {
      releaseAll();
      await vi.advanceTimersByTimeAsync(500);
    }
    await Promise.all(all);
  });

  it('a pause broadcast by another tab slows the restart but keeps full rate', () => {
    const rl = new RateLimitedFetch(8, [0, 0], 9);
    rl.setBackoff(Date.now() + 5000);
    expect(rl.tokens).toBe(0);
    expect(rl.getThrottle()).toBe(1);
  });

  it('halves the rate once per 429 episode, down to a quarter', async () => {
    global.fetch = vi.fn().mockResolvedValue({status: 429, ok: false});
    const rl = new RateLimitedFetch(8, [0, 0], 9);

    // Three requests in flight together all come back 429: one episode.
    await Promise.all([rl.fetch('/a'), rl.fetch('/b'), rl.fetch('/c')]);
    expect(rl.getThrottle()).toBe(0.5);

    // A 429 after the pause (and slow start) is a new episode.
    await vi.advanceTimersByTimeAsync(10_000);
    const p = rl.fetch('/d');
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(rl.getThrottle()).toBe(0.25);

    await vi.advanceTimersByTimeAsync(10_000);
    const q = rl.fetch('/e');
    await vi.advanceTimersByTimeAsync(2000);
    await q;
    expect(rl.getThrottle()).toBe(0.25);
  });

  /** Rate limiter plus helpers to send one request and to draw one 429. */
  function adaptiveLimiter() {
    const rl = new RateLimitedFetch(8, [0, 0], 9);
    const send = async (status: number) => {
      global.fetch = vi.fn().mockResolvedValue({status, ok: status < 400});
      const p = rl.fetch('/x');
      await vi.advanceTimersByTimeAsync(1000);
      await p;
    };
    const quiet = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      await send(200); // recovery is lazy: it runs on a dispatch
    };
    return {rl, send, quiet};
  }

  // Replays the 46k-post diagnostic run: 0.5 held without a 429, but each
  // recovery to 0.56–0.75 drew another 429 within seconds.
  it('recovers only to one step below the rate that drew the 429', async () => {
    const {rl, send, quiet} = adaptiveLimiter();
    await send(429); // at 1.0
    expect(rl.getThrottle()).toBe(0.5);

    await quiet(20_000);
    expect(rl.getThrottle()).toBe(0.75);
    await quiet(20_000);
    expect(rl.getThrottle()).toBe(0.75); // ceiling, not 1.0
  });

  it('a 429 at the ceiling lowers it to where the rate settles', async () => {
    const {rl, send, quiet} = adaptiveLimiter();
    await send(429); // at 1.0 → ceiling 0.75
    await quiet(20_000); // 0.75
    await vi.advanceTimersByTimeAsync(10_000); // past pause + slow start
    await send(429); // at 0.75 → 0.375, ceiling 0.5
    expect(rl.getThrottle()).toBe(0.375);

    for (let i = 0; i < 4; i++) await quiet(20_000);
    expect(rl.getThrottle()).toBe(0.5);
  });

  it('the ceiling rises a step per two quiet minutes', async () => {
    const {rl, send, quiet} = adaptiveLimiter();
    await send(429); // throttle 0.5, ceiling 0.75
    await quiet(20_000);
    expect(rl.getThrottle()).toBe(0.75);

    await quiet(100_000); // 2 min since the 429: ceiling → 1.0
    await quiet(20_000);
    expect(rl.getThrottle()).toBe(1);
  });

  // Replays the latest run: a 429 at 46.3 s (rate), then another 0.3 s after
  // the 5 s pause ended. Treating the second as a rate problem pinned the
  // throttle and its ceiling at the 25 % floor for the rest of the load.
  it('a 429 right after a pause doubles the pause and keeps the rate', async () => {
    const {rl, send} = adaptiveLimiter();
    await send(429); // steady sending at 1.0
    expect(rl.getThrottle()).toBe(0.5);

    await vi.advanceTimersByTimeAsync(4100); // pause over, slow start
    await send(429);
    expect(rl.getThrottle()).toBe(0.5); // untouched
    expect(rl.backoffUntil - Date.now()).toBe(10_000 - 1000);

    await vi.advanceTimersByTimeAsync(9100); // second pause over
    await send(429);
    expect(rl.backoffUntil - Date.now()).toBe(20_000 - 1000);
    expect(rl.getThrottle()).toBe(0.5);
  });

  it('a later 429 while sending normally resets the pause and cuts the rate', async () => {
    const {rl, send} = adaptiveLimiter();
    await send(429);
    await vi.advanceTimersByTimeAsync(4100);
    await send(429); // resume: 10 s pause

    await vi.advanceTimersByTimeAsync(9000 + 5000 + 100); // pause + slow start
    await send(429);
    expect(rl.backoffUntil - Date.now()).toBe(5000 - 1000);
    expect(rl.getThrottle()).toBe(0.25);
  });

  it('a server-provided wait is used as is right after a pause', async () => {
    const {rl, send} = adaptiveLimiter();
    await send(429);
    await vi.advanceTimersByTimeAsync(4100);

    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers({'Retry-After': '3'}),
    });
    const p = rl.fetch('/x');
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(rl.backoffUntil - Date.now()).toBe(3000);
    expect(rl.getThrottle()).toBe(0.5);
  });

  it('refills more slowly while throttled', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({status: 429, ok: false});
    const rl = new RateLimitedFetch(6, [0, 0], 5); // 200 ms/token at full rate
    await rl.fetch('/a');
    await vi.advanceTimersByTimeAsync(10_000); // past pause + slow start

    rl.tokens = 0;
    rl.lastRefill = Date.now() - 600;
    rl.refillTokens();
    // 400 ms/token at half rate → 1 token, not 3.
    expect(rl.tokens).toBe(1);
  });
});

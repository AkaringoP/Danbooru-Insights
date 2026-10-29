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
    it('routes /reports/ URLs to the report queue', async () => {
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

  it('a 429 pauses the limiter for the server wait and broadcasts it', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers({'X-Rate-Limit': xRateLimit({'user/1': -9})}),
    });
    const rl = new RateLimitedFetch(1, [0, 0], 10);
    const onBackoff = vi.fn();
    rl.onBackoff = onBackoff;
    const start = Date.now();

    await rl.fetch('/posts.json');

    // (1 - -9) / 1 s + 0.5 s margin
    expect(rl.backoffUntil - start).toBe(10_500);
    expect(onBackoff).toHaveBeenCalledWith(rl.backoffUntil);
    expect(rl.backoffRemainingMs()).toBe(10_500);
    vi.advanceTimersByTime(10_500);
    expect(rl.backoffRemainingMs()).toBe(0);
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

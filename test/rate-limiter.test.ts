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

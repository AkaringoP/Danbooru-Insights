/**
 * Danbooru's server-side rate limiting, modelled for limiter simulations
 * (test/rate-limiter-sim.test.ts).
 *
 * Source: danbooru/danbooru, `production` branch b3a5240 (2026-11-11).
 * - {@link DanbooruBucket} is `RateLimit.create_or_update!` in
 *   app/models/rate_limit.rb, one key (the user, IP subnet and session keys
 *   all see the same traffic from one tab, so one bucket stands for all).
 * - The per-action limits are the `rate_limit_for_*` policies; every other
 *   read has none (`ApplicationPolicy#rate_limit_for_read` → `{}`).
 * - The edge (Cloudflare) limit is NOT in the repository. {@link EdgeRule}
 *   is an assumption to test against, not a known rule.
 */

/** One `rate_limit_for_*` policy. Rate is points per second. */
export interface BucketConfig {
  action: string;
  rate: number;
  burst: number;
  cost?: number;
  minimumPoints?: number;
}

/** Danbooru's per-action read limits (production b3a5240). */
const DANBOORU_READ_LIMITS: Array<{
  pathPrefix: string;
  bucket: BucketConfig;
}> = [
  // app/policies/post_query_policy.rb — since 2026-11-05.
  {
    pathPrefix: '/counts/posts.json',
    bucket: {action: 'counts:posts', rate: 1, burst: 15},
  },
  // app/policies/report_policy.rb
  {
    pathPrefix: '/reports/',
    bucket: {action: 'reports:show', rate: 1 / 3, burst: 15},
  },
  // app/policies/related_tag_query_policy.rb
  {
    pathPrefix: '/related_tag.json',
    bucket: {action: 'related_tag:show', rate: 1, burst: 30},
  },
];

/** Token bucket with Danbooru's upsert arithmetic, including the penalty. */
export class DanbooruBucket {
  private points: number | null = null;
  private updatedAt = 0;

  constructor(readonly config: BucketConfig) {}

  /**
   * Charges one request arriving at `nowMs`.
   * @return whether it is limited, and the `X-Rate-Limit` header the
   *   controller attaches before deciding (so on 200s and 429s alike).
   */
  hit(nowMs: number): {limited: boolean; header: string} {
    const {action, rate, burst} = this.config;
    const cost = this.config.cost ?? 1;
    const minimum = this.config.minimumPoints ?? -30;
    let limited: boolean;
    if (this.points === null) {
      // INSERT branch: points = max(burst - cost, minimum_points).
      this.points = Math.max(burst - cost, minimum);
      limited = this.points < 0;
    } else {
      // ON CONFLICT branch. While limited, a request costs `rate` (one
      // second of regeneration) instead of `cost`, down to the minimum.
      const raw = this.points + rate * ((nowMs - this.updatedAt) / 1000);
      const capped = Math.min(burst, raw);
      limited = capped - cost < 0;
      this.points =
        raw < 0
          ? Math.max(minimum, capped - rate)
          : Math.max(minimum, capped - cost);
    }
    this.updatedAt = nowMs;
    const header = JSON.stringify({
      action,
      rate,
      burst,
      cost,
      minimum_points: minimum,
      enabled: true,
      limits: {'ip/127.0.0.0/24': this.points},
    });
    return {limited, header};
  }
}

/** Assumed edge rule: at most `max` accepted requests per `windowMs`. */
export interface EdgeRule {
  windowMs: number;
  max: number;
}

/** One request as the server saw it. */
export interface ServerLogEntry {
  t: number;
  url: string;
  status: number;
}

export interface SimServerOptions {
  /** Assumed edge limit; omitted = none. */
  edge?: EdgeRule;
  /** Server time per request, by URL. */
  latencyMs?: (url: string) => number;
}

/** Default server times, roughly the audit's live measurements. */
function defaultLatencyMs(url: string): number {
  if (url.startsWith('/reports/')) return 1000;
  if (url.startsWith('/counts/')) return 150;
  return 500;
}

/**
 * Fake Danbooru for `global.fetch`. The limit decision happens when the
 * request arrives (as in Rails, before the action runs); the reply comes
 * after the endpoint's latency.
 */
export class SimServer {
  readonly log: ServerLogEntry[] = [];
  private readonly buckets = new Map<string, DanbooruBucket>();
  private readonly edgeAccepted: number[] = [];

  constructor(private readonly options: SimServerOptions = {}) {
    for (const {pathPrefix, bucket} of DANBOORU_READ_LIMITS) {
      this.buckets.set(pathPrefix, new DanbooruBucket(bucket));
    }
  }

  readonly fetch = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input);
    const now = Date.now();
    const {status, headers} = this.decide(url, now);
    this.log.push({t: now, url, status});
    const latency = (this.options.latencyMs ?? defaultLatencyMs)(url);
    const body = status === 200 ? '[]' : '<html>Too Many Requests</html>';
    return new Promise(resolve =>
      setTimeout(
        () => resolve(new Response(body, {status, headers})),
        status === 200 ? latency : 50,
      ),
    );
  };

  private decide(
    url: string,
    now: number,
  ): {status: number; headers: Record<string, string>} {
    if (this.options.edge && this.edgeBlocks(now, this.options.edge)) {
      // Cloudflare-style 429: HTML, no X-Rate-Limit.
      return {status: 429, headers: {}};
    }
    for (const [prefix, bucket] of this.buckets) {
      if (!url.startsWith(prefix)) continue;
      const {limited, header} = bucket.hit(now);
      return {
        status: limited ? 429 : 200,
        headers: {'x-rate-limit': header},
      };
    }
    return {status: 200, headers: {}};
  }

  private edgeBlocks(now: number, rule: EdgeRule): boolean {
    while (
      this.edgeAccepted.length > 0 &&
      this.edgeAccepted[0] <= now - rule.windowMs
    ) {
      this.edgeAccepted.shift();
    }
    if (this.edgeAccepted.length >= rule.max) return true;
    this.edgeAccepted.push(now);
    return false;
  }
}

/** Most entries whose `t` falls in any window of `windowMs`. */
export function maxInWindow(times: number[], windowMs: number): number {
  const sorted = [...times].sort((a, b) => a - b);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi] - sorted[lo] >= windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

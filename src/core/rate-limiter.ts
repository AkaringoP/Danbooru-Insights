import {CONFIG} from '../config';
import {createLogger} from './logger';

const log = createLogger('RateLimiter');

/* --- 429 wait derivation --- */

/** Where a 429 pause length came from; logged so diagnostics show it. */
type BackoffSource = 'x-rate-limit' | 'retry-after' | 'default';

/** Lower bound on any 429 pause: never hammer straight back. */
const MIN_BACKOFF_MS = 1000;
/**
 * Slack added to a wait computed from `X-Rate-Limit`. Landing even slightly
 * early is expensive: Danbooru charges every request made while limited
 * another second of debt.
 */
const RATE_LIMIT_MARGIN_MS = 500;

/**
 * Wait (ms) until Danbooru's token bucket admits another request, from the
 * `X-Rate-Limit` header it attaches to every rate-limited action.
 *
 * The header is the server-side RateLimiter as JSON:
 * `{"action","rate","burst","cost","minimum_points","enabled",
 *   "limits": {"<key>": <points>, ...}}` — one key per user / IP subnet /
 * session. Points regenerate at `rate` per second and a request is allowed
 * once points ≥ `cost`, so the binding key (lowest points) needs
 * `(cost - points) / rate` seconds. While limited, each further request
 * costs another `rate` points (down to `minimum_points`, -30 by default),
 * which is why a fixed short pause kept the account limited.
 *
 * @return null when the header is absent or unusable.
 */
export function parseXRateLimitWaitMs(raw: string | null): number | null {
  if (!raw) return null;
  let data: {rate?: unknown; cost?: unknown; limits?: unknown};
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return null;
  }
  const rate = Number(data.rate);
  const cost = data.cost === undefined ? 1 : Number(data.cost);
  if (!(rate > 0) || !Number.isFinite(cost)) return null;
  if (typeof data.limits !== 'object' || data.limits === null) return null;
  const points = Object.values(data.limits).map(Number).filter(Number.isFinite);
  if (points.length === 0) return null;
  const lowest = Math.min(...points);
  return Math.max(0, ((cost - lowest) / rate) * 1000);
}

/**
 * Standard `Retry-After`: delay-seconds or an HTTP-date. Danbooru's app does
 * not send it, but an edge proxy's 429 may.
 *
 * @return null when the header is absent or unparseable.
 */
export function parseRetryAfterMs(
  raw: string | null,
  now: number,
): number | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * How long to pause all requests after a 429, following the server's own
 * wait when it tells us one. Falls back to `CONFIG.BACKOFF_DURATION_MS`.
 * Server-derived waits are clamped to [1 s, `CONFIG.MAX_BACKOFF_MS`].
 */
export function backoffFromResponse(
  response: Pick<Response, 'headers'>,
  now: number,
): {ms: number; source: BackoffSource} {
  // Test doubles and some polyfills hand back a Response without headers.
  const header = (name: string): string | null =>
    response.headers?.get?.(name) ?? null;
  const clamp = (ms: number) =>
    Math.min(CONFIG.MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, ms));

  const fromLimiter = parseXRateLimitWaitMs(header('x-rate-limit'));
  if (fromLimiter !== null) {
    return {
      ms: clamp(fromLimiter + RATE_LIMIT_MARGIN_MS),
      source: 'x-rate-limit',
    };
  }
  const fromRetryAfter = parseRetryAfterMs(header('retry-after'), now);
  if (fromRetryAfter !== null) {
    return {ms: clamp(fromRetryAfter), source: 'retry-after'};
  }
  return {ms: CONFIG.BACKOFF_DURATION_MS, source: 'default'};
}

/* --- Post-429 recovery tuning --- */

/**
 * How long after a pause ends the limiter stays in slow start: a one-token
 * bucket and at most `SLOW_START_CONCURRENCY` requests in flight.
 *
 * Without it the pause itself caused the next 429. The bucket refilled to
 * its full burst while paused and every queued request's dispatch timer
 * fired together, so ~8 requests left in the same instant the pause ended.
 * Danbooru's edge limiter answered with another 429 within a second or two,
 * and a 46k-post dashboard load spent three quarters of its time paused.
 */
const SLOW_START_MS = 5000;
const SLOW_START_CONCURRENCY = 2;

/**
 * Adaptive rate. Each 429 that arrives outside a pause halves the request
 * rate (and concurrency) down to `MIN_THROTTLE` of the configured value;
 * every `THROTTLE_RECOVERY_MS` without a 429 gives back `THROTTLE_STEP`.
 * The edge limiter's real budget is unknown and evidently below the 9 req/s
 * we configure, so the limiter finds a sustainable rate instead of
 * re-hitting the same wall every few seconds.
 */
const MIN_THROTTLE = 0.25;
const THROTTLE_RECOVERY_MS = 20_000;
const THROTTLE_STEP = 0.25;

/* --- Helper: Rate Limited Fetch --- */

/** Internal task queued for rate-limited dispatch. */
interface QueueTask {
  url: string;
  options?: RequestInit;
  resolve: (value: Response) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Helper: Rate Limited Fetch
 * Implements strict rate limiting using a Token Bucket algorithm and dedicated queues.
 * Supports dynamic limit updates (for cross-tab coordination) and global backoff.
 */
export class RateLimitedFetch {
  maxConcurrency: number;
  startDelayRange: [number, number];
  rateLimit: number;
  refillRate: number;
  tokens: number;
  lastRefill: number;
  queue: QueueTask[];
  activeWorkers: number;
  requestCounter: number;
  reportQueue: QueueTask[];
  isProcessingReport: boolean;

  /** Timestamp until which all requests should be paused (global backoff). */
  backoffUntil: number;
  /** Called when a 429 response triggers global backoff. */
  onBackoff: ((until: number) => void) | null;

  /** Slow-start window end (ms epoch); see SLOW_START_MS. */
  private slowStartUntil = 0;
  /** Fraction of the configured rate/concurrency in use; see MIN_THROTTLE. */
  private throttle = 1;
  /** Last 429 seen by this tab (ms epoch). */
  private lastRateLimitedAt = 0;
  /** Last throttle cut or step-up (ms epoch). */
  private lastThrottleChangeAt = 0;

  /**
   * @param {number} maxConcurrency Maximum concurrent requests (for general queue).
   * @param {Array<number>} startDelayRange Random delay range before request [min, max] ms.
   * @param {number} requestsPerSecond Rate limit for general requests (default: 5).
   */
  constructor(
    maxConcurrency: number = 6,
    startDelayRange: [number, number] = [50, 150],
    requestsPerSecond: number = 6,
  ) {
    this.maxConcurrency = maxConcurrency;
    this.startDelayRange = startDelayRange;

    // Token Bucket for General Requests
    this.rateLimit = requestsPerSecond; // Max tokens (burst)
    this.refillRate = 1000 / requestsPerSecond; // ms per token
    this.tokens = requestsPerSecond;
    this.lastRefill = Date.now();

    this.queue = [];
    this.activeWorkers = 0;
    this.requestCounter = 0;

    // Dedicated Worker for Reports (Strict cooldown)
    this.reportQueue = [];
    this.isProcessingReport = false;

    // Global backoff
    this.backoffUntil = 0;
    this.onBackoff = null;
  }

  getRequestCount(): number {
    return this.requestCounter;
  }

  /**
   * Dynamically update rate limits (e.g., when tab count changes).
   * Takes effect on the next queue processing cycle.
   */
  updateLimits(requestsPerSecond: number, maxConcurrency: number): void {
    this.rateLimit = requestsPerSecond;
    this.refillRate = 1000 / requestsPerSecond;
    this.maxConcurrency = maxConcurrency;
    // Clamp existing tokens to new burst limit
    this.tokens = Math.min(this.tokens, this.rateLimit);
  }

  /**
   * Set global backoff — pause all request processing until the given timestamp.
   * Only updates if the new timestamp is later than the current backoff.
   */
  setBackoff(until: number): void {
    if (until <= this.backoffUntil) return;
    this.backoffUntil = until;
    // Resume gently: an empty bucket plus a narrow slow-start window, so the
    // backlog that queued up during the pause does not leave as one burst the
    // moment it ends. Applies to pauses broadcast by other tabs too — they
    // share this tab's IP/user budget.
    this.tokens = 0;
    this.slowStartUntil = until + SLOW_START_MS;
  }

  /** Current fraction of the configured rate in use (1 = full speed). */
  getThrottle(): number {
    return this.throttle;
  }

  /** Milliseconds left in the current global backoff (0 when none). */
  backoffRemainingMs(): number {
    return Math.max(0, this.backoffUntil - Date.now());
  }

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    // 1. Intercept /reports/ requests (Legacy custom report endpoints if any)
    if (url.includes('/reports/')) {
      return new Promise((resolve, reject) => {
        this.reportQueue.push({url, options, resolve, reject});
        // Fire-and-forget: queue drain; per-task resolve/reject handles errors.
        void this.processReportQueue();
      });
    }

    // 2. General Queue (Token Bucket)
    return new Promise((resolve, reject) => {
      this.queue.push({url, options, resolve, reject});
      // Fire-and-forget: queue drain; per-task resolve/reject handles errors.
      void this.processQueue();
    });
  }

  async processReportQueue(): Promise<void> {
    if (this.isProcessingReport || this.reportQueue.length === 0) return;

    // Global backoff check
    const now = Date.now();
    if (now < this.backoffUntil) {
      setTimeout(() => this.processReportQueue(), this.backoffUntil - now);
      return;
    }

    this.isProcessingReport = true;
    const task = this.reportQueue.shift();
    if (!task) {
      this.isProcessingReport = false;
      return;
    }
    this.requestCounter++;

    try {
      const response = await fetch(task.url, task.options);
      if (response.status === 429) this.triggerBackoff(task.url, response);
      task.resolve(response);
    } catch (e: unknown) {
      log.error('Report fetch failed', {url: task.url, error: e});
      task.reject(e);
    } finally {
      // Strict 3s cooldown for reports
      await new Promise(r => setTimeout(r, CONFIG.REPORT_COOLDOWN_MS));
      this.isProcessingReport = false;
      // Fire-and-forget: recursive drain; errors handled per-task inside.
      void this.processReportQueue();
    }
  }

  async processQueue(): Promise<void> {
    const now = Date.now();
    if (
      this.activeWorkers >= this.effectiveConcurrency(now) ||
      this.queue.length === 0
    ) {
      return;
    }

    // Global backoff check
    if (now < this.backoffUntil) {
      setTimeout(() => this.processQueue(), this.backoffUntil - now);
      return;
    }

    this.maybeRecoverThrottle(now);

    // Token Bucket Check
    this.refillTokens();
    if (this.tokens < 1) {
      // Not enough tokens, schedule a retry after refill interval
      setTimeout(() => this.processQueue(), this.refillInterval());
      return;
    }

    // Consume Token
    this.tokens -= 1;
    this.activeWorkers++;
    this.requestCounter++;

    const task = this.queue.shift();
    if (!task) {
      this.activeWorkers--;
      return;
    }

    // Fill any remaining capacity now. Otherwise each completion admits only
    // one successor, and the in-flight count never climbs back up after a
    // slow-start window narrowed it.
    if (this.queue.length > 0) void this.processQueue();

    // Staggered Start Delay (minimal now, rely on token bucket for rate)
    const startDelay =
      Math.floor(
        Math.random() * (this.startDelayRange[1] - this.startDelayRange[0] + 1),
      ) + this.startDelayRange[0];
    if (startDelay > 0) await new Promise(r => setTimeout(r, startDelay));

    try {
      const response = await fetch(task.url, task.options);
      if (response.status === 429) this.triggerBackoff(task.url, response);
      task.resolve(response);
    } catch (e: unknown) {
      task.reject(e);
    } finally {
      this.activeWorkers--;
      // Immediately try next, token bucket will govern admission.
      // Fire-and-forget: recursive drain; errors handled per-task inside.
      void this.processQueue();
    }
  }

  refillTokens(): void {
    const now = Date.now();
    const interval = this.refillInterval();
    const elapsed = now - this.lastRefill;
    if (elapsed > interval) {
      const newTokens = Math.floor(elapsed / interval);
      this.tokens = Math.min(this.burstCap(now), this.tokens + newTokens);
      // precision:
      this.lastRefill = now - (elapsed % interval);
    }
  }

  /** ms per token at the current throttle. */
  private refillInterval(): number {
    return this.refillRate / this.throttle;
  }

  /** Bucket capacity: 1 during slow start, else the throttled burst. */
  private burstCap(now: number): number {
    if (now < this.slowStartUntil) return 1;
    return Math.max(1, Math.floor(this.rateLimit * this.throttle));
  }

  /** In-flight ceiling: narrowed during slow start, scaled by throttle. */
  private effectiveConcurrency(now: number): number {
    const scaled = Math.max(1, Math.ceil(this.maxConcurrency * this.throttle));
    return now < this.slowStartUntil
      ? Math.min(scaled, SLOW_START_CONCURRENCY)
      : scaled;
  }

  /** Step the throttle back up after a quiet period. Lazy: runs on dispatch. */
  private maybeRecoverThrottle(now: number): void {
    if (this.throttle >= 1) return;
    if (now - this.lastRateLimitedAt < THROTTLE_RECOVERY_MS) return;
    if (now - this.lastThrottleChangeAt < THROTTLE_RECOVERY_MS) return;
    this.throttle = Math.min(1, this.throttle + THROTTLE_STEP);
    this.lastThrottleChangeAt = now;
    log.info('Request rate recovering', {throttle: this.throttle});
  }

  /**
   * Activate global backoff for as long as the server asked, and notify
   * listeners (e.g., TabCoordinator — other tabs share the same IP/user
   * bucket, so they pause for the same span).
   */
  private triggerBackoff(url: string, response: Response): void {
    const now = Date.now();
    // A 429 from a request that was already in flight when an earlier 429
    // started the pause says nothing new about our rate, so only the first
    // 429 of an episode cuts the throttle.
    if (now >= this.backoffUntil) {
      this.throttle = Math.max(MIN_THROTTLE, this.throttle / 2);
      this.lastThrottleChangeAt = now;
    }
    this.lastRateLimitedAt = now;
    const {ms, source} = backoffFromResponse(response, now);
    const until = now + ms;
    log.warn('429 received, pausing requests', {
      waitMs: Math.round(ms),
      source,
      throttle: this.throttle,
      xRateLimit: response.headers?.get?.('x-rate-limit') ?? null,
      url: url.slice(0, 160),
    });
    this.setBackoff(until);
    this.onBackoff?.(until);
  }
}

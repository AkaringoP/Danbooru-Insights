import {CONFIG} from '../config';
import {createLogger} from './logger';
import {KNOWN_LANES, RateLane, parseXRateLimit} from './rate-lane';
import type {RateLimitInfo} from './rate-lane';

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
  const info = parseXRateLimit(raw);
  if (!info) return null;
  return Math.max(0, ((info.cost - info.lowest) / info.rate) * 1000);
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
 * A 429 inside the slow-start window — the first request or two after a
 * pause — means the pause was shorter than the server's own penalty, not
 * that our rate is too high. In a 46k-post run the edge limiter answered
 * the first request after a 5 s pause with another 429; treating that as a
 * rate problem cut the throttle and its ceiling to the 25 % floor for the
 * rest of the load. Such a 429 now doubles the pause instead (5 s, 10 s,
 * 20 s, … up to `CONFIG.MAX_BACKOFF_MS`) and leaves throttle and ceiling
 * alone. A server-provided wait still wins over the doubling.
 */
const PAUSE_ESCALATION_FACTOR = 2;

/**
 * Adaptive rate. Each 429 that arrives outside a pause halves the request
 * rate (and concurrency) down to `MIN_THROTTLE` of the configured value;
 * every `THROTTLE_RECOVERY_MS` without a 429 gives back `THROTTLE_STEP`.
 * The edge limiter's real budget is unknown (it was evidently below the
 * 9 req/s configured before v9.12), so the limiter finds a sustainable
 * rate instead of re-hitting the same wall every few seconds.
 *
 * Recovery is capped by a ceiling one step below the rate that drew the
 * last 429. Without it the throttle sawtoothed: a 46k-post run held 0.5
 * with no 429 for 20 s, but every recovery to 0.56–0.75 drew another 429
 * within 1–8 s, each costing a pause plus slow start. The ceiling itself
 * rises one step per `CEILING_RELAX_MS` without any 429, so a budget that
 * frees up (another tab closed, a quieter hour) is found again.
 */
const MIN_THROTTLE = 0.25;
const THROTTLE_RECOVERY_MS = 20_000;
const THROTTLE_STEP = 0.25;
const CEILING_RELAX_MS = 120_000;

/* --- Helper: Rate Limited Fetch --- */

/** Internal task queued for rate-limited dispatch. */
interface QueueTask {
  url: string;
  options?: RequestInit;
  resolve: (value: Response) => void;
  reject: (reason?: unknown) => void;
  /** The per-action lane it waits in; null = general traffic. */
  lane: RateLane | null;
  /** Arrival order across all queues (dispatch is first come, first served). */
  seq: number;
}

/** Queue key for traffic without a per-action limit. */
const GENERAL = 'general';

/** Path of a request URL, relative or absolute ('' if unparseable). */
function pathOf(url: string): string {
  try {
    return new URL(url, 'https://danbooru.invalid').pathname;
  } catch {
    return '';
  }
}

/**
 * Helper: Rate Limited Fetch
 *
 * Every request takes a token from one bucket (`CONFIG.RATE_LIMITER`: rate,
 * burst, concurrency), shared by all the apps on the page. On top of that,
 * actions Danbooru limits on their own (counts, reports, related tags — see
 * core/rate-lane.ts) wait in their own lane until the client's estimate of
 * that server bucket allows them. A lane that has to wait never holds up
 * other traffic: dispatch goes to the oldest request whose lane is ready.
 *
 * A 429 that carries `X-Rate-Limit` comes from one of those per-action
 * limits and only that lane waits. A 429 without it (the edge in front of
 * Danbooru) pauses everything — the global backoff, slow start and adaptive
 * rate below — and is broadcast to other tabs.
 */
export class RateLimitedFetch {
  maxConcurrency: number;
  startDelayRange: [number, number];
  /** Sustained rate, requests per second. */
  rateLimit: number;
  /** ms per token at full rate. */
  refillRate: number;
  tokens: number;
  /**
   * Bucket capacity when set explicitly; null = one second's worth
   * (`rateLimit`), which then follows {@link updateLimits}.
   */
  private readonly burstSize: number | null;
  lastRefill: number;
  activeWorkers: number;
  requestCounter: number;
  /** Waiting requests by lane key ({@link GENERAL} or a lane name). */
  private readonly queues = new Map<string, QueueTask[]>();
  /** Number of waiting requests across all queues. */
  private pending = 0;
  private nextSeq = 0;
  /** Per-action lanes, by name; created on first use. */
  private readonly lanes = new Map<string, RateLane>();

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
  /** Highest throttle recovery may reach; see CEILING_RELAX_MS. */
  private throttleCeiling = 1;
  /** Last ceiling raise (ms epoch). */
  private lastCeilingChangeAt = 0;
  /** Length of the pause most recently started by this tab's own 429. */
  private lastPauseMs = 0;
  /** The general queue's one pending wakeup; see {@link scheduleWake}. */
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  /** When {@link wakeTimer} fires (ms epoch). */
  private wakeAt = 0;

  /**
   * @param {number} maxConcurrency Maximum concurrent requests (for general queue).
   * @param {Array<number>} startDelayRange Random delay range before request [min, max] ms.
   * @param {number} requestsPerSecond Sustained rate for general requests.
   * @param {number=} burst Bucket capacity: how many requests may leave at
   *     once after a quiet spell. Defaults to one second's worth. The app
   *     passes `CONFIG.RATE_LIMITER.burst` (1), so a full bucket cannot add
   *     a second's worth of requests on top of the steady rate.
   */
  constructor(
    maxConcurrency: number = 6,
    startDelayRange: [number, number] = [50, 150],
    requestsPerSecond: number = 6,
    burst?: number,
  ) {
    this.maxConcurrency = maxConcurrency;
    this.startDelayRange = startDelayRange;

    // Token Bucket for General Requests
    this.rateLimit = requestsPerSecond;
    this.refillRate = 1000 / requestsPerSecond; // ms per token
    this.burstSize = burst ?? null;
    this.tokens = this.burstLimit();
    this.lastRefill = Date.now();

    this.activeWorkers = 0;
    this.requestCounter = 0;

    // Global backoff
    this.backoffUntil = 0;
    this.onBackoff = null;
  }

  getRequestCount(): number {
    return this.requestCounter;
  }

  /**
   * Dynamically update rate limits (e.g., when tab count changes).
   * Takes effect on the next queue processing cycle. An explicit burst is
   * kept as is; each tab may still send that many at once.
   */
  updateLimits(requestsPerSecond: number, maxConcurrency: number): void {
    this.rateLimit = requestsPerSecond;
    this.refillRate = 1000 / requestsPerSecond;
    this.maxConcurrency = maxConcurrency;
    // Clamp existing tokens to the (possibly smaller) bucket.
    this.tokens = Math.min(this.tokens, this.burstLimit());
  }

  /** Bucket capacity at full throttle. */
  private burstLimit(): number {
    return this.burstSize ?? this.rateLimit;
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
    return new Promise((resolve, reject) => {
      const lane = this.laneFor(url);
      const key = lane?.name ?? GENERAL;
      let queue = this.queues.get(key);
      if (!queue) {
        queue = [];
        this.queues.set(key, queue);
      }
      queue.push({url, options, resolve, reject, lane, seq: this.nextSeq++});
      this.pending++;
      // Fire-and-forget: queue drain; per-task resolve/reject handles errors.
      void this.processQueue();
    });
  }

  /**
   * The lane a request belongs to: one of Danbooru's known per-action limits
   * by path, or a lane learned from an earlier `X-Rate-Limit` reply on the
   * same path. Null for unlimited traffic.
   */
  private laneFor(url: string): RateLane | null {
    const path = pathOf(url);
    for (const known of KNOWN_LANES) {
      if (!path.startsWith(known.pathPrefix)) continue;
      let lane = this.lanes.get(known.name);
      if (!lane) {
        lane = new RateLane(known.name, known, Date.now());
        this.lanes.set(known.name, lane);
      }
      return lane;
    }
    return this.lanes.get(path) ?? null;
  }

  async processQueue(): Promise<void> {
    const now = Date.now();
    if (
      this.activeWorkers >= this.effectiveConcurrency(now) ||
      this.pending === 0
    ) {
      return;
    }

    // Global backoff check
    if (now < this.backoffUntil) {
      this.scheduleWake(this.backoffUntil - now);
      return;
    }

    this.maybeRecoverThrottle(now);

    // Token Bucket Check
    this.refillTokens();
    if (this.tokens < 1) {
      // Wake when the next token is due. refillTokens() needs strictly more
      // than one interval to have passed, hence the +1.
      const elapsed = Date.now() - this.lastRefill;
      this.scheduleWake(
        Math.max(1, Math.floor(this.refillInterval() - elapsed) + 1),
      );
      return;
    }

    const {task, waitMs} = this.takeNextReady(now);
    if (!task) {
      // Every waiting request is in a lane that is not ready yet. Wake when
      // the soonest one is; a lane that is only short of in-flight slots is
      // woken by its response instead.
      if (Number.isFinite(waitMs)) this.scheduleWake(waitMs);
      return;
    }

    // Consume Token
    this.tokens -= 1;
    this.activeWorkers++;
    this.requestCounter++;
    const sentAt = now;
    task.lane?.onSend(sentAt);

    // Fill any remaining capacity now. Otherwise each completion admits only
    // one successor, and the in-flight count never climbs back up after a
    // slow-start window narrowed it.
    if (this.pending > 0) void this.processQueue();

    // Staggered Start Delay (minimal now, rely on token bucket for rate)
    const startDelay =
      Math.floor(
        Math.random() * (this.startDelayRange[1] - this.startDelayRange[0] + 1),
      ) + this.startDelayRange[0];
    if (startDelay > 0) await new Promise(r => setTimeout(r, startDelay));

    try {
      const response = await fetch(task.url, task.options);
      this.onResponse(task, sentAt, response);
      task.resolve(response);
    } catch (e: unknown) {
      task.lane?.onResponse(Date.now(), sentAt, null);
      task.reject(e);
    } finally {
      this.activeWorkers--;
      // Immediately try next, token bucket will govern admission.
      // Fire-and-forget: recursive drain; errors handled per-task inside.
      void this.processQueue();
    }
  }

  /**
   * Removes and returns the oldest waiting request whose lane may send now.
   * General traffic is always ready (the token check already passed).
   * @return the task, or null with the ms until the soonest lane is ready
   *     (Infinity when the blocked lanes only wait for responses).
   */
  private takeNextReady(now: number): {task: QueueTask | null; waitMs: number} {
    let best: QueueTask[] | null = null;
    let waitMs = Infinity;
    for (const queue of this.queues.values()) {
      const head = queue[0];
      if (!head) continue;
      const wait = head.lane ? head.lane.waitMs(now) : 0;
      if (wait > 0) {
        waitMs = Math.min(waitMs, wait);
        continue;
      }
      if (!best || head.seq < best[0].seq) best = queue;
    }
    const task = best?.shift() ?? null;
    if (task) this.pending--;
    return {task, waitMs};
  }

  /**
   * Feeds a response back: lanes re-sync from its `X-Rate-Limit` header,
   * and a 429 pauses either that lane (header present — a per-action Rails
   * limit) or everything (no header — the edge).
   */
  private onResponse(
    task: QueueTask,
    sentAt: number,
    response: Response,
  ): void {
    const header = response.headers?.get?.('x-rate-limit') ?? null;
    const now = Date.now();
    let lane = task.lane;
    let info: RateLimitInfo | null = null;
    if (lane) {
      info = lane.onResponse(now, sentAt, header);
    } else if (header) {
      // A path we did not know was limited answered with its bucket. Later
      // requests to it wait in a lane of their own; this one was not sent
      // through it, so it only re-syncs the estimate.
      lane = this.laneForHeader(task.url, header, sentAt);
      info = lane?.calibrate(now, sentAt, header) ?? null;
    }
    if (response.status !== 429) return;
    if (lane && info) {
      log.warn('429 on a per-action limit, holding that lane', {
        lane: lane.name,
        action: info.action,
        waitMs: Math.round(parseXRateLimitWaitMs(header) ?? 0),
        xRateLimit: header,
        url: task.url.slice(0, 160),
      });
      // Re-check later: a lane may now be the only thing left waiting.
      void this.processQueue();
      return;
    }
    this.triggerBackoff(task.url, response);
  }

  /**
   * The lane for `url`'s path, created from the header on its first
   * sighting. Several requests to such a path can be in flight before the
   * first reply; they must all end up on the one lane, or the replies would
   * each replace it and the requests already queued on the old one would
   * keep a separate count.
   */
  private laneForHeader(
    url: string,
    header: string,
    sentAt: number,
  ): RateLane | null {
    const path = pathOf(url);
    if (!path) return null;
    const existing = this.lanes.get(path);
    if (existing) return existing;
    const info = parseXRateLimit(header);
    if (!info) return null;
    const lane = new RateLane(path, info, sentAt);
    this.lanes.set(path, lane);
    return lane;
  }

  /**
   * Arms the queue's single wakeup `delayMs` from now (lanes included),
   * unless one is already due no later than that. Every refused dispatch used to arm its
   * own timer — each fetch(), completion and fill-capacity call that found
   * no token or an active pause — so a backlog of 250 counts left tens of
   * thousands of timers that mostly woke up to re-arm (audit DA-13).
   */
  private scheduleWake(delayMs: number): void {
    const at = Date.now() + delayMs;
    if (this.wakeTimer !== null) {
      if (this.wakeAt <= at) return;
      clearTimeout(this.wakeTimer);
    }
    this.wakeAt = at;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      // Fire-and-forget: queue drain; per-task resolve/reject handles errors.
      void this.processQueue();
    }, delayMs);
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
    return Math.max(1, Math.floor(this.burstLimit() * this.throttle));
  }

  /** In-flight ceiling: narrowed during slow start, scaled by throttle. */
  private effectiveConcurrency(now: number): number {
    const scaled = Math.max(1, Math.ceil(this.maxConcurrency * this.throttle));
    return now < this.slowStartUntil
      ? Math.min(scaled, SLOW_START_CONCURRENCY)
      : scaled;
  }

  /**
   * Step the ceiling, then the throttle, back up after quiet periods.
   * Lazy: runs on dispatch.
   */
  private maybeRecoverThrottle(now: number): void {
    const quietFor = now - this.lastRateLimitedAt;
    if (
      this.throttleCeiling < 1 &&
      quietFor >= CEILING_RELAX_MS &&
      now - this.lastCeilingChangeAt >= CEILING_RELAX_MS
    ) {
      this.throttleCeiling = Math.min(1, this.throttleCeiling + THROTTLE_STEP);
      this.lastCeilingChangeAt = now;
      log.info('Request rate ceiling raised', {ceiling: this.throttleCeiling});
    }

    if (this.throttle >= this.throttleCeiling) return;
    if (quietFor < THROTTLE_RECOVERY_MS) return;
    if (now - this.lastThrottleChangeAt < THROTTLE_RECOVERY_MS) return;
    this.throttle = Math.min(
      this.throttleCeiling,
      this.throttle + THROTTLE_STEP,
    );
    this.lastThrottleChangeAt = now;
    log.info('Request rate recovering', {
      throttle: this.throttle,
      ceiling: this.throttleCeiling,
    });
  }

  /**
   * Activate global backoff for as long as the server asked, and notify
   * listeners (e.g., TabCoordinator — other tabs share the same IP/user
   * bucket, so they pause for the same span).
   */
  private triggerBackoff(url: string, response: Response): void {
    const now = Date.now();
    const {ms: serverMs, source} = backoffFromResponse(response, now);
    let ms = serverMs;
    // A 429 from a request that was already in flight when an earlier 429
    // started the pause says nothing new, so only the first 429 of an
    // episode is classified.
    const inPause = now < this.backoffUntil;
    const cause = inPause
      ? 'in-flight'
      : now < this.slowStartUntil
        ? 'pause-too-short'
        : 'rate';
    if (cause === 'pause-too-short') {
      // The pause was shorter than the server's penalty: wait longer and
      // keep the rate (see PAUSE_ESCALATION_FACTOR). Only a guessed
      // (default) wait is escalated; a server-provided one is used as is.
      if (source === 'default') {
        ms = Math.min(
          CONFIG.MAX_BACKOFF_MS,
          Math.max(serverMs, this.lastPauseMs * PAUSE_ESCALATION_FACTOR),
        );
      }
    } else if (cause === 'rate') {
      // Remember that this rate was too much: recovery stops one step below.
      this.throttleCeiling = Math.max(
        MIN_THROTTLE,
        this.throttle - THROTTLE_STEP,
      );
      this.lastCeilingChangeAt = now;
      this.throttle = Math.max(MIN_THROTTLE, this.throttle / 2);
      this.lastThrottleChangeAt = now;
    }
    if (!inPause) this.lastPauseMs = ms;
    this.lastRateLimitedAt = now;
    const until = now + ms;
    log.warn('429 received, pausing requests', {
      waitMs: Math.round(ms),
      source,
      cause,
      throttle: this.throttle,
      ceiling: this.throttleCeiling,
      xRateLimit: response.headers?.get?.('x-rate-limit') ?? null,
      url: url.slice(0, 160),
    });
    this.setBackoff(until);
    this.onBackoff?.(until);
  }
}

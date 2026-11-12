/**
 * One of Danbooru's per-action rate limits, mirrored on the client.
 *
 * Danbooru limits some actions with their own token bucket, separate from
 * everything else (danbooru `production`, `app/policies/*_policy.rb`):
 * `/counts/posts.json` 1/s burst 15, `/reports/*` 1 per 3 s burst 15,
 * `/related_tag.json` 1/s burst 30. Every response from such an action
 * carries the bucket as an `X-Rate-Limit` header — on 200s and 429s alike,
 * because the controller sets it before deciding.
 *
 * A {@link RateLane} keeps a local estimate of that bucket so the limiter
 * holds a lane's requests back *before* the server refuses them, and only
 * that lane waits: a count backlog no longer stalls a sync. The estimate
 * starts at the documented limits and is corrected from every header, so
 * other tabs spending the same per-user / per-IP bucket are accounted for.
 */

/** The parts of an `X-Rate-Limit` header the client uses. */
export interface RateLimitInfo {
  action: string;
  /** Points regenerated per second. */
  rate: number;
  burst: number;
  cost: number;
  /** The binding key's points (the lowest), after charging this request. */
  lowest: number;
}

/**
 * Parses Danbooru's `X-Rate-Limit` header:
 * `{"action","rate","burst","cost","minimum_points","enabled",
 *   "limits": {"<key>": <points>, ...}}`, one key per user / IP subnet /
 * session. @return null when absent or unusable.
 */
export function parseXRateLimit(raw: string | null): RateLimitInfo | null {
  if (!raw) return null;
  let data: {
    action?: unknown;
    rate?: unknown;
    burst?: unknown;
    cost?: unknown;
    limits?: unknown;
  };
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
  let lowest = Infinity;
  for (const p of points) if (p < lowest) lowest = p;
  const burst = Number(data.burst);
  return {
    action: typeof data.action === 'string' ? data.action : '',
    rate,
    burst: burst > 0 ? burst : Math.max(1, lowest),
    cost,
    lowest,
  };
}

/** Requests one lane may have in flight before its next header is back. */
export const LANE_MAX_IN_FLIGHT = 2;
/**
 * Points a lane keeps in reserve. A request is sent only while the estimate
 * holds `cost + LANE_RESERVE`, so a slightly stale header (the server
 * charged a little after we sent) cannot tip it into a 429 — and a request
 * made while limited costs a whole extra second on Danbooru.
 */
const LANE_RESERVE = 1;

/**
 * Danbooru's per-action read limits, by the controller's URL path. Matched
 * by controller, not by full URL: CountsController's only action is
 * `posts` (`counts:posts`), RelatedTagsController's read is `show`, and
 * every `/reports/<model>` is ReportsController#show (`reports:show`).
 * Count URLs themselves are only built by `fetchRemoteCount`.
 */
export const KNOWN_LANES: ReadonlyArray<{
  name: string;
  pathPrefix: string;
  rate: number;
  burst: number;
}> = [
  {name: 'counts', pathPrefix: '/counts/', rate: 1, burst: 15},
  {name: 'reports', pathPrefix: '/reports/', rate: 1 / 3, burst: 15},
  {name: 'related', pathPrefix: '/related_tag', rate: 1, burst: 30},
];

/** Client-side estimate of one per-action server bucket. */
export class RateLane {
  rate: number;
  burst: number;
  inFlight = 0;
  private points: number;
  private updatedAt: number;
  /** Send times of requests whose response is still out. */
  private readonly outstanding: number[] = [];
  /** Send time of the request whose header was applied last. */
  private lastAppliedSentAt = -Infinity;

  constructor(
    readonly name: string,
    limits: {rate: number; burst: number},
    now: number,
  ) {
    this.rate = limits.rate;
    this.burst = limits.burst;
    this.points = limits.burst;
    this.updatedAt = now;
  }

  /** Estimated points now (regenerated, capped at the burst). */
  pointsAt(now: number): number {
    return Math.min(
      this.burst,
      this.points + (this.rate * (now - this.updatedAt)) / 1000,
    );
  }

  /**
   * ms until this lane may send (0 = now). Infinity while its in-flight
   * slots are full: only a response can free one.
   */
  waitMs(now: number): number {
    if (this.inFlight >= LANE_MAX_IN_FLIGHT) return Infinity;
    const missing = 1 + LANE_RESERVE - this.pointsAt(now);
    if (missing <= 0) return 0;
    return Math.ceil((missing / this.rate) * 1000);
  }

  /** A request of this lane leaves now. */
  onSend(now: number): void {
    this.points = this.pointsAt(now) - 1;
    this.updatedAt = now;
    this.inFlight++;
    this.outstanding.push(now);
  }

  /**
   * Its response arrived. With a usable header the estimate is replaced by
   * the server's count: its points after charging this request, plus what
   * regenerated since it was sent, minus the requests sent after it that
   * the server has charged but this header does not show yet. An older
   * request's header arriving late never overrides a newer one.
   *
   * @param sentAt when the request was sent (as passed to {@link onSend}).
   * @return the parsed header, or null.
   */
  onResponse(
    now: number,
    sentAt: number,
    header: string | null,
  ): RateLimitInfo | null {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const i = this.outstanding.indexOf(sentAt);
    if (i >= 0) this.outstanding.splice(i, 1);
    const info = parseXRateLimit(header);
    if (!info || sentAt < this.lastAppliedSentAt) return info;
    this.lastAppliedSentAt = sentAt;
    this.rate = info.rate;
    this.burst = info.burst;
    let sentSince = 0;
    for (const t of this.outstanding) if (t > sentAt) sentSince++;
    const regenerated = (info.rate * (now - sentAt)) / 1000;
    this.points =
      Math.min(info.burst, info.lowest + regenerated) - sentSince * info.cost;
    this.updatedAt = now;
    return info;
  }
}

/**
 * Resolves last December's metric total so the grass month popover can show a
 * month-over-month delta on **January**.
 *
 * Every other month compares against a sibling in the same in-memory year, but
 * January's predecessor sits in the year before — which the heatmap has not
 * loaded. Rather than pull a whole extra year on hover, this reads the one
 * number the delta needs, and only when a January label is actually hovered.
 *
 * Three tiers, cheapest first:
 *   1. **Cached year** — if that year is marked complete, the daily tables are
 *      authoritative and a missing row genuinely means zero. No network.
 *   2. **localStorage memo** — a past December's total never changes, so a
 *      resolved value is kept indefinitely.
 *   3. **Network** — one count query for uploads; a capped page walk for the
 *      other two metrics, which have no count endpoint.
 *
 * A tier-3 failure returns null and is deliberately *not* memoised: the
 * popover then renders exactly as it does today (total only), and the next
 * hover retries.
 */

import {DataManager} from './data-manager';
import {createLogger} from './logger';
import type {ApiItem} from './data-manager';
import type {Metric, TargetUser} from '../types';

const log = createLogger('GrassPrevMonth');

/** localStorage namespace for resolved December totals. */
const CACHE_PREFIX = 'di.grass.dec';
/** Page size for the metrics that have to be counted by walking rows. */
const PAGE_LIMIT = 1000;
/**
 * Page walk ceiling. A month past ~3000 approvals/notes stops being worth a
 * hover's latency, so the delta is skipped rather than paid for.
 */
const MAX_PAGES = 3;

function cacheKeyFor(userId: string, metric: Metric, year: number): string {
  return `${CACHE_PREFIX}.${userId}.${metric}.${year}`;
}

/**
 * December's bounds in Danbooru's range syntax. The upper bound is
 * **exclusive** (`date:A...B` / `search[created_at]=A...B`), which is why it
 * reads as Jan 1 of the following year — the same convention
 * `fetchAndPersistYear` uses.
 */
function decemberRange(year: number): string {
  return `${year}-12-01...${year + 1}-01-01`;
}

/** Reads a memoised total, ignoring anything that is not a finite number. */
function readMemo(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const value = parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch (e: unknown) {
    log.debug('Could not read December memo', {error: e});
    return null;
  }
}

function writeMemo(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch (e: unknown) {
    // Private mode / quota — the value is simply re-fetched next time.
    log.debug('Could not memoise December total', {error: e});
  }
}

/**
 * Counts December rows for a metric that has no count endpoint, by walking
 * pages until one comes back short. Returns null when the month exceeds
 * {@link MAX_PAGES} — a partial count would be a wrong delta, which is worse
 * than no delta.
 */
async function countByPaging(
  dataManager: DataManager,
  metric: Metric,
  user: TargetUser,
  year: number,
): Promise<number | null> {
  const endpoint =
    metric === 'approvals' ? '/post_approvals.json' : '/note_versions.json';
  const idParam =
    metric === 'approvals' ? 'search[user_id]' : 'search[updater_id]';
  if (!user.id) return null;

  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      page: String(page),
      [idParam]: String(user.id),
      'search[created_at]': decemberRange(year),
      only: 'id',
    });
    const resp = await dataManager.rateLimiter.fetch(
      `${endpoint}?${params.toString()}`,
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rows: ApiItem[] = await resp.json();
    if (!Array.isArray(rows)) return null;
    total += rows.length;
    // A short page is the last page.
    if (rows.length < PAGE_LIMIT) return total;
  }
  log.debug('December page walk hit its cap; skipping the delta', {
    metric,
    year,
  });
  return null;
}

/** Tier 3: ask Danbooru. Returns null when the total cannot be established. */
async function fetchDecemberTotal(
  dataManager: DataManager,
  user: TargetUser,
  metric: Metric,
  year: number,
): Promise<number | null> {
  try {
    if (metric === 'uploads') {
      const name = (user.name || '').replace(/ /g, '_');
      if (!name) return null;
      return await dataManager.fetchRemoteCount(
        `user:${name} date:${decemberRange(year)}`,
      );
    }
    return await countByPaging(dataManager, metric, user, year);
  } catch (e: unknown) {
    log.debug('December total lookup failed', {error: e, metric, year});
    return null;
  }
}

/**
 * Total activity for `year`'s December, or null when it cannot be determined.
 *
 * @param args.dataManager Carries the DB handle and the shared rate limiter.
 * @param args.user Whose December to total.
 * @param args.metric Which metric the heatmap is showing.
 * @param args.year The year the December belongs to (i.e. January's year − 1).
 */
export async function resolvePrevDecemberTotal(args: {
  dataManager: DataManager;
  user: TargetUser;
  metric: Metric;
  year: number;
}): Promise<number | null> {
  const {dataManager, user, metric, year} = args;
  const userId = user.id || user.name;
  if (!userId) return null;

  // Tier 1. Only a *completed* year is authoritative. Partial rows can be the
  // residue of an interrupted sync, where a missing day is indistinguishable
  // from a quiet one — summing those would invent a confident wrong delta.
  if (await dataManager.checkYearCompletion(userId, metric, year)) {
    return dataManager.sumDailyCounts(
      metric,
      userId,
      `${year}-12-01`,
      `${year}-12-31`,
    );
  }

  const key = cacheKeyFor(userId, metric, year);
  const memo = readMemo(key);
  if (memo !== null) return memo;

  const fetched = await fetchDecemberTotal(dataManager, user, metric, year);
  // Failures stay unmemoised so the next hover gets another chance.
  if (fetched === null) return null;
  writeMemo(key, fetched);
  return fetched;
}

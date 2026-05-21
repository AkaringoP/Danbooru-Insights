/**
 * Globally-shared, user-agnostic tag statistics.
 *
 * Two values are cached here:
 *  1. `globalTotal` — total Danbooru post count (`status:any`).
 *  2. `globalTop50General` — the 50 most-frequent General-category tags
 *     site-wide, with each tag's global post count.
 *
 * Both are used by the Tag Cloud General-tab Lift filter
 * ([src/core/analytics-data-manager.ts] `getTagCloudData`) to decide which
 * globally-common tags to keep as user signatures vs. drop as noise.
 *
 * Cached in localStorage with a 24h TTL — these values change very slowly
 * site-wide, and the cache is intentionally shared across all users (not
 * per-uploader) because the underlying data has no per-user component.
 */
import type {RateLimitedFetch} from './rate-limiter';
import {fetchRemoteCount} from './data-manager';
import {createLogger} from './logger';
import type {DanbooruRelatedTag, DanbooruRelatedTagResponse} from '../types';

const log = createLogger('GlobalTagStats');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GLOBAL_TOTAL_KEY = 'di.cache.global_total';
const GLOBAL_TOP50_KEY = 'di.cache.global_top50_general';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry.expiresAt !== 'number' || Date.now() >= entry.expiresAt) {
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  try {
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (e) {
    log.debug('Failed to write cache', {key, error: e});
  }
}

/**
 * Returns the total Danbooru post count, used as the denominator when
 * computing per-tag global rates. Cached for 24h; a zero or failed result
 * is treated as a cache miss so the next call retries.
 */
export async function getGlobalTotalPosts(
  rateLimiter: RateLimitedFetch,
): Promise<number> {
  const cached = readCache<number>(GLOBAL_TOTAL_KEY);
  if (cached !== null && cached > 0) return cached;

  try {
    const count = await fetchRemoteCount(rateLimiter, 'status:any');
    if (count > 0) writeCache(GLOBAL_TOTAL_KEY, count);
    return count;
  } catch (e) {
    log.debug('Failed to fetch global total posts', {error: e});
    return 0;
  }
}

/**
 * Returns a map of the 50 most-frequent General-category tags site-wide,
 * keyed by tag name with the value being the tag's global post count.
 *
 * Cached for 24h. The map is serialized as `[name, count][]` in storage
 * since `Map` is not directly JSON-serializable.
 *
 * Returns an empty map on fetch/parse failure — callers should treat that
 * as "no filter applied" rather than blocking the Tag Cloud render.
 */
export async function getGlobalTopGeneralTags(
  rateLimiter: RateLimitedFetch,
): Promise<Map<string, number>> {
  const cached = readCache<Array<[string, number]>>(GLOBAL_TOP50_KEY);
  if (cached !== null && cached.length > 0) return new Map(cached);

  try {
    const url =
      '/related_tag.json?commit=Search&search[category]=0' +
      '&search[order]=Frequency&search[query]=status%3Aany&limit=50';
    const resp = await rateLimiter.fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = (await resp.json()) as DanbooruRelatedTagResponse;
    if (!Array.isArray(json.related_tags)) return new Map();

    const entries: Array<[string, number]> = [];
    for (const item of json.related_tags as DanbooruRelatedTag[]) {
      const name = item.tag?.name;
      const count = item.tag?.post_count;
      if (typeof name === 'string' && typeof count === 'number' && count > 0) {
        entries.push([name, count]);
      }
    }
    if (entries.length > 0) writeCache(GLOBAL_TOP50_KEY, entries);
    return new Map(entries);
  } catch (e) {
    log.debug('Failed to fetch global top-50 general tags', {error: e});
    return new Map();
  }
}

/** Test-only: clear cached values. Not exported via index. */
export function _clearGlobalTagStatsCache(): void {
  try {
    localStorage.removeItem(GLOBAL_TOTAL_KEY);
    localStorage.removeItem(GLOBAL_TOP50_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Tag Cloud General-tab Lift filter thresholds (v9.6.0 constants).
 *
 * v10 work will surface these via a settings UI — see
 * `docs/v10/DanbooruInsights v10: 위젯별 설정 Customizing 설계 보고서.md`.
 */
export const LIFT_THRESHOLD = 2.0;
export const USER_COUNT_FLOOR = 3;

/** Input row for `applyGeneralTagCloudFilter`. */
export interface TagCloudFilterEntry {
  tagName: string;
  /** User's usage rate for this tag, i.e. userCount / userTotal. */
  frequency: number;
  /** Number of the user's posts that have this tag (intersection size). */
  userCount: number;
}

/**
 * Drops globally-common tags from the user's Tag Cloud General tab,
 * unless the user uses the tag at a rate notably above the global average
 * (`lift >= LIFT_THRESHOLD`) and has at least `USER_COUNT_FLOOR` posts
 * with it.
 *
 * Pure function — no I/O, no globals. Callers fetch the global inputs
 * via `getGlobalTotalPosts` / `getGlobalTopGeneralTags` and pass them in.
 *
 * Defensive fallbacks: if `globalTotal <= 0` or `topGlobalTags` is empty
 * (e.g. fetch failed), returns `entries` unchanged. Rationale: a broken
 * filter should not block the Tag Cloud from rendering.
 *
 * @param entries Raw per-tag rows from the user's `related_tag.json` query.
 * @param topGlobalTags Map of globally top-50 General tags → global post count.
 * @param globalTotal Total Danbooru post count (`status:any`).
 * @param liftThreshold Minimum lift to "rescue" a globally-common tag.
 * @param userCountFloor Minimum intersection size to rescue.
 */
export function applyGeneralTagCloudFilter(
  entries: TagCloudFilterEntry[],
  topGlobalTags: Map<string, number>,
  globalTotal: number,
  liftThreshold: number,
  userCountFloor: number,
): TagCloudFilterEntry[] {
  if (globalTotal <= 0 || topGlobalTags.size === 0) return entries;
  return entries.filter(entry => {
    const globalCount = topGlobalTags.get(entry.tagName);
    if (globalCount === undefined) return true;
    if (entry.userCount < userCountFloor) return false;
    const globalRate = globalCount / globalTotal;
    if (globalRate <= 0) return true;
    const lift = entry.frequency / globalRate;
    return lift >= liftThreshold;
  });
}

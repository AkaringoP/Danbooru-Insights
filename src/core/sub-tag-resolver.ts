/**
 * Sub-tag resolution for the Copy / Fav_Copy / Char pie chart tooltips
 * (v9.6.0).
 *
 * Two responsibilities:
 *
 *  1. `fetchSubTagsForParents` — given a set of top-level parent tags
 *     (e.g. `idolmaster`, `fate_(series)`, `gundam`), returns each
 *     parent's set of sub-tag candidates (`antecedent_name`) by querying
 *     `/tag_implications.json` with the `consequent_name_comma` batched
 *     filter. Cached in `tag_implications_cache` with key prefix
 *     `consequent:` to coexist with the existing `tagName`-keyed
 *     `isTopLevelTag` cache. 180d TTL — `tag_implications` is near-
 *     immutable.
 *
 *  2. `applySubTagBreakdown` — pure function. Given a parent's sub-tag
 *     candidate set + the user's per-tag counts, returns the breakdown
 *     entries with share-of-sum percentages. Trims to top-N and folds
 *     the long tail into an "Others" bucket once cumulative share
 *     crosses `othersThreshold` (matching the existing pie-chart trim
 *     rule).
 *
 * Defined in core/ rather than apps/ because `analytics-data-manager`
 * (core) needs to call the fetcher. Constants are intentionally
 * duplicated from `apps/tag-analytics-data` (TTL + schema version) to
 * avoid an apps/→core/ import cycle; the URL contract is the same so
 * the same schema version (2) applies.
 */
import type {RateLimitedFetch} from './rate-limiter';
import {createLogger} from './logger';
import type {
  DanbooruTagImplication,
  SubTagBreakdownEntry,
  TagImplicationCacheRecord,
} from '../types';

// Re-export for callers who only import from this module.
export type {SubTagBreakdownEntry};

const log = createLogger('SubTagResolver');

/** 180-day TTL — same as the antecedent-keyed isTopLevel cache. */
const CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Same schema version as `apps/tag-analytics-data.IMPLICATIONS_CACHE_SCHEMA_VERSION`.
 * Both keying schemes (antecedent + consequent) share the URL contract
 * (`search[status]=active` required) so they share the version number.
 */
const CACHE_SCHEMA_VERSION = 2;

/** Cache-key prefix that distinguishes consequent-keyed records. */
const KEY_PREFIX = 'consequent:';

/**
 * Max parents per batched call. Parent names can be long (e.g.
 * `fate_(series)`) so we use a more conservative chunk than the
 * antecedent batcher (50).
 */
const CHUNK_SIZE = 30;

/** Per-parent map shape for the fetcher result. */
export type SubTagsByParent = Map<string, Set<string>>;

// Minimal Dexie row shape — avoids importing the Database class (which
// would pull in Dexie types for a pure-typing-only need).
interface ImplicationCacheTable {
  bulkGet(
    keys: string[],
  ): Promise<Array<TagImplicationCacheRecord | undefined>>;
  bulkPut(records: TagImplicationCacheRecord[]): Promise<unknown>;
}

interface DbWithImplicationCache {
  tag_implications_cache?: ImplicationCacheTable;
}

/**
 * Returns a Map<parent → set of sub-tag candidate names>. Empty sub
 * sets are cached too (so we never re-query a parent we already know
 * has no implications).
 *
 * Defensive on every failure path — a broken sub-tag fetch must NOT
 * block the pie distribution from rendering. Returns whatever could be
 * gathered.
 */
export async function fetchSubTagsForParents(
  rateLimiter: RateLimitedFetch,
  db: DbWithImplicationCache | null,
  parents: string[],
): Promise<SubTagsByParent> {
  const result: SubTagsByParent = new Map();
  if (parents.length === 0) return result;

  const now = Date.now();
  const missing: string[] = [];

  // 1. Cache read
  const table = db?.tag_implications_cache;
  if (table) {
    const keys = parents.map(p => KEY_PREFIX + p);
    try {
      const records = await table.bulkGet(keys);
      records.forEach((rec, idx) => {
        const parent = parents[idx];
        if (rec && isCacheRecordFresh(rec, now)) {
          result.set(parent, new Set(rec.subs ?? []));
        } else {
          missing.push(parent);
        }
      });
    } catch (e) {
      log.warn('Failed to read implication cache, refetching all', {error: e});
      missing.push(...parents);
    }
  } else {
    missing.push(...parents);
  }

  if (missing.length === 0) return result;

  // 2. Fetch missing in chunks
  const fetchedByParent = await fetchInChunks(rateLimiter, missing);

  // Merge fetched into result (parents with no implications get empty Set)
  for (const parent of missing) {
    result.set(parent, fetchedByParent.get(parent) ?? new Set());
  }

  // 3. Write through cache
  if (table) {
    const records: TagImplicationCacheRecord[] = missing.map(parent => ({
      tagName: KEY_PREFIX + parent,
      // Placeholder — consequent-keyed records carry `subs`; readers of
      // this shape never inspect `isTopLevel`. Required-field constraint
      // from the shared interface.
      isTopLevel: false,
      subs: [...(fetchedByParent.get(parent) ?? new Set())],
      fetchedAt: now,
      schemaVersion: CACHE_SCHEMA_VERSION,
    }));
    try {
      await table.bulkPut(records);
    } catch (e) {
      log.warn('Failed to write sub-tag cache (continuing)', {error: e});
    }
  }

  return result;
}

function isCacheRecordFresh(
  rec: TagImplicationCacheRecord,
  now: number,
): boolean {
  if (rec.schemaVersion !== CACHE_SCHEMA_VERSION) return false;
  const age = now - rec.fetchedAt;
  return age >= 0 && age < CACHE_TTL_MS;
}

async function fetchInChunks(
  rateLimiter: RateLimitedFetch,
  parents: string[],
): Promise<SubTagsByParent> {
  const out: SubTagsByParent = new Map();
  parents.forEach(p => out.set(p, new Set()));

  for (let i = 0; i < parents.length; i += CHUNK_SIZE) {
    const chunk = parents.slice(i, i + CHUNK_SIZE);
    try {
      const imps = await fetchChunk(rateLimiter, chunk);
      for (const imp of imps) {
        const parent = imp?.consequent_name;
        const sub = imp?.antecedent_name;
        if (typeof parent === 'string' && typeof sub === 'string') {
          const set = out.get(parent);
          if (set) set.add(sub);
        }
      }
    } catch (e) {
      log.warn('Sub-tag chunk fetch failed (leaving empty)', {
        chunkSize: chunk.length,
        error: e,
      });
    }
  }

  return out;
}

async function fetchChunk(
  rateLimiter: RateLimitedFetch,
  chunk: string[],
): Promise<Array<Partial<DanbooruTagImplication>>> {
  const csv = chunk.join(',');
  const url =
    `/tag_implications.json?search[consequent_name_comma]=${encodeURIComponent(csv)}` +
    '&search[status]=active&limit=1000';
  const resp = await rateLimiter.fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  return Array.isArray(json)
    ? (json as Array<Partial<DanbooruTagImplication>>)
    : [];
}

// ---------------------------------------------------------------------------
// Pure breakdown computation
// ---------------------------------------------------------------------------

/**
 * Builds the breakdown rows for one parent's tooltip.
 *
 * Algorithm:
 *  1. Intersect the parent's candidate sub-tags with the user's tag
 *     counts (only sub-tags the user actually has).
 *  2. Sum the user counts → denominator.
 *  3. Sort sub-tags by count desc.
 *  4. Emit individual rows until either `maxItems-1` entries are out
 *     OR the cumulative share crosses `othersThreshold` (default 0.95).
 *  5. Bucket the remaining tail into a single "Others" row.
 *
 * Caveat (documented elsewhere): post-coverage and tag-usage share are
 * different when a single post has multiple sub-tags. This function
 * reports tag-usage share — sum of shares is always 1.0.
 *
 * Returns an empty array if the user has no overlap with the parent's
 * sub-tag candidates (UI then skips the tooltip).
 */
export function applySubTagBreakdown(
  parentSubs: Set<string>,
  userTagCounts: Map<string, number>,
  maxItems: number = 10,
  othersThreshold: number = 0.95,
): SubTagBreakdownEntry[] {
  if (parentSubs.size === 0) return [];
  if (maxItems < 1) return [];

  // Step 1+2: intersect + sum.
  const rows: Array<{tagName: string; count: number}> = [];
  let total = 0;
  for (const sub of parentSubs) {
    const c = userTagCounts.get(sub) ?? 0;
    if (c > 0) {
      rows.push({tagName: sub, count: c});
      total += c;
    }
  }
  if (rows.length === 0 || total === 0) return [];

  // Step 3: sort.
  rows.sort((a, b) => b.count - a.count);

  // Step 4+5: emit until limit/threshold, bucket the rest.
  //
  // Rule: emit individual rows while cumulative <= threshold. Once
  // cumulative *exceeds* threshold (after the last emitted row), bucket
  // remaining rows into "Others" — even if only one row is left. The
  // earlier "single trailing emit" exemption produced subtag tooltips
  // with no Others row when the tail happened to be one item (gundam
  // case: 9 visible subs covered 96% so the 10th was emitted directly,
  // leaving no Others bucket). Users expected the chart's max-N + Others
  // pattern to hold here too.
  //
  // maxItems guard: if the next row would be the last slot but there
  // are >1 rows left, also bucket.
  const out: SubTagBreakdownEntry[] = [];
  let cumulative = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const share = r.count / total;
    const remainingSlots = maxItems - out.length;
    const cumulativeOverThreshold = cumulative > othersThreshold;
    const lastSlotWithMore = remainingSlots === 1 && i < rows.length - 1;

    if (cumulativeOverThreshold || lastSlotWithMore) {
      const tailRows = rows.slice(i);
      const tailCount = tailRows.reduce((s, x) => s + x.count, 0);
      out.push({
        tagName: 'Others',
        count: tailCount,
        share: tailCount / total,
        isOther: true,
      });
      break;
    }

    out.push({tagName: r.tagName, count: r.count, share, isOther: false});
    cumulative += share;
  }

  return out;
}

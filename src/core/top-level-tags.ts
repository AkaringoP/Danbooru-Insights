/**
 * Top-level tag detection: is a tag the antecedent of any active
 * implication? Variant tags such as `abigail_williams_(first_ascension)_(fate)`
 * imply their base tag, and the distributions fold them into that base tag's
 * sub-tag breakdown instead of letting them compete for a top-10 slot.
 *
 * The answer depends on the tag name alone, so one global pipeline serves
 * every caller (tag pages and the user dashboard's character / copyright /
 * fav-copyright pies):
 *   1. module-level session cache,
 *   2. persistent `tag_implications_cache` rows (180-day TTL),
 *   3. batched `/tag_implications.json?search[antecedent_name_comma]=…`
 *      for the rest, 50 names per request.
 *
 * Lookups that fail are never cached: their tags fall back to "top-level"
 * for this call only, so a rate-limited response cannot pin a wrong answer
 * for 180 days.
 */

import {createLogger} from './logger';
import {bulkPutSafe, evictOldestNonCurrentUser} from './quota-manager';
import type {Database} from './database';
import type {RateLimitedFetch} from './rate-limiter';
import type {DanbooruTagImplication, TagImplicationCacheRecord} from '../types';

const log = createLogger('TopLevelTags');

/** TTL for persisted implication lookups. tag_implications is near-immutable. */
export const IMPLICATIONS_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Embedded schema version for tag_implications_cache record values.
 *
 * Bump whenever the meaning of a cached `isTopLevel` flag changes (e.g.
 * the URL contract for `/tag_implications.json` is altered). Records
 * stamped with a different version are treated as cache misses on read
 * and re-fetched with the current contract — no Dexie schema bump
 * required because the version lives in the record body (schemaless).
 *
 * v1 (≤ v9.5): URL did not pass `search[status]=active`, so
 *   deleted / declined / retired implications counted toward
 *   "is sub-tag" — incorrectly excluding tags like `ninjago` whose
 *   implication chain was later removed.
 * v2 (v9.6+): URL includes `search[status]=active`.
 */
export const IMPLICATIONS_CACHE_SCHEMA_VERSION = 2;

/** Max tag names per batched /tag_implications.json call (URL-length budget). */
export const IMPLICATIONS_BATCH_CHUNK_SIZE = 50;

/**
 * Module-level in-memory cache for top-level flags. Populated from the
 * persistent table on first read and by every successful batch fetch, so
 * repeat lookups within a session cost zero I/O.
 */
const topLevelSessionCache = new Map<string, boolean>();

/** Test hook: forget session-cached flags so test cases stay independent. */
export function resetTopLevelSessionCache(): void {
  topLevelSessionCache.clear();
}

/**
 * Parses a /tag_implications.json batch response into a `name → isTopLevel`
 * map for a given input chunk. Tags present in the chunk but not in the
 * response are top-level (no implications); tags appearing as
 * `antecedent_name` in any implication are NOT top-level.
 *
 * Pure / exported for testing.
 */
export function parseImplicationsResponse(
  chunk: string[],
  imps: unknown,
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  chunk.forEach(name => result.set(name, true));
  if (Array.isArray(imps)) {
    for (const imp of imps as Array<Partial<DanbooruTagImplication>>) {
      const name = imp?.antecedent_name;
      if (name && result.has(name)) {
        result.set(name, false);
      }
    }
  }
  return result;
}

/**
 * Checks whether a persistent implication cache record is still fresh.
 * Records whose embedded `schemaVersion` does not match
 * `IMPLICATIONS_CACHE_SCHEMA_VERSION` are invalid regardless of TTL —
 * they carry a stale contract and must be re-fetched.
 * Exported for tests.
 */
export function isImplicationCacheValid(
  fetchedAt: number,
  now: number,
  schemaVersion: number | undefined,
): boolean {
  if (schemaVersion !== IMPLICATIONS_CACHE_SCHEMA_VERSION) return false;
  const age = now - fetchedAt;
  return age >= 0 && age < IMPLICATIONS_CACHE_TTL_MS;
}

/**
 * Reads cached top-level flags (session cache, then the persistent table
 * filtered by TTL + schema version). Returns only the hits.
 */
async function readImplicationCache(
  db: Database | null | undefined,
  tagNames: string[],
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const missing: string[] = [];
  for (const name of tagNames) {
    const hit = topLevelSessionCache.get(name);
    if (hit !== undefined) result.set(name, hit);
    else missing.push(name);
  }
  if (missing.length === 0 || !db?.tag_implications_cache) return result;

  try {
    const now = Date.now();
    const records = await db.tag_implications_cache.bulkGet(missing);
    records.forEach((r, i) => {
      if (r && isImplicationCacheValid(r.fetchedAt, now, r.schemaVersion)) {
        result.set(missing[i], r.isTopLevel);
        topLevelSessionCache.set(missing[i], r.isTopLevel);
      }
    });
  } catch (e) {
    log.warn('Failed to read tag_implications cache', {error: e});
  }
  return result;
}

/**
 * Persists successfully-fetched flags. Session cache is updated first and
 * unconditionally; the persistent write is best-effort.
 */
async function writeImplicationCache(
  db: Database | null | undefined,
  entries: Map<string, boolean>,
  currentUserId: number,
): Promise<void> {
  if (entries.size === 0) return;
  entries.forEach((isTopLevel, tagName) => {
    topLevelSessionCache.set(tagName, isTopLevel);
  });
  if (!db?.tag_implications_cache) return;

  try {
    const now = Date.now();
    const records: TagImplicationCacheRecord[] = [];
    entries.forEach((isTopLevel, tagName) => {
      records.push({
        tagName,
        isTopLevel,
        fetchedAt: now,
        schemaVersion: IMPLICATIONS_CACHE_SCHEMA_VERSION,
      });
    });
    await bulkPutSafe(db.tag_implications_cache, records, () =>
      evictOldestNonCurrentUser(db, currentUserId),
    );
  } catch (e) {
    log.warn('Failed to write tag_implications cache', {error: e});
  }
}

/**
 * Batched `/tag_implications.json` lookup. Only chunks whose request
 * succeeded appear in the result; a failed chunk's tags are left absent so
 * the caller can default them without caching the unreliable answer. A
 * non-OK status counts as failed — a JSON error body must not parse as "no
 * implications, everything top-level".
 */
async function fetchTopLevelTagsBatch(
  rateLimiter: RateLimitedFetch,
  tagNames: string[],
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  for (let i = 0; i < tagNames.length; i += IMPLICATIONS_BATCH_CHUNK_SIZE) {
    const chunk = tagNames.slice(i, i + IMPLICATIONS_BATCH_CHUNK_SIZE);
    const url = `/tag_implications.json?search[antecedent_name_comma]=${encodeURIComponent(chunk.join(','))}&search[status]=active&limit=1000`;
    try {
      const resp = await rateLimiter.fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const parsed = parseImplicationsResponse(chunk, await resp.json());
      parsed.forEach((v, k) => result.set(k, v));
    } catch (e) {
      log.warn('Batch tag_implications fetch failed', {
        error: e,
        chunkSize: chunk.length,
      });
    }
  }
  return result;
}

/**
 * Resolves top-level flags for `tagNames`, cache first. Misses are
 * batch-fetched and persisted; tags still unresolved after a failed batch
 * fall back to `true` (keep the candidate) without being cached.
 *
 * @param currentUserId User whose data must survive a quota eviction while
 *   persisting (0 on tag pages, which have no user context).
 */
export async function getTopLevelFlags(
  rateLimiter: RateLimitedFetch,
  db: Database | null | undefined,
  tagNames: string[],
  currentUserId = 0,
): Promise<Map<string, boolean>> {
  const unique = [...new Set(tagNames)];
  const flags = await readImplicationCache(db, unique);
  const missing = unique.filter(n => !flags.has(n));
  if (missing.length === 0) return flags;

  const fetched = await fetchTopLevelTagsBatch(rateLimiter, missing);
  await writeImplicationCache(db, fetched, currentUserId);
  for (const name of missing) flags.set(name, fetched.get(name) ?? true);
  return flags;
}

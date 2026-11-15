/**
 * How a page fetch that failed is retried: shared by the full sync
 * (`AnalyticsDataManager`) and Grass's page fetches (`DataManager`,
 * T-603). Its own module because the first imports the second.
 */

/** Total fetch attempts per page in the full-sync worker pool and Grass. */
export const SYNC_PAGE_MAX_ATTEMPTS = 5;

/** How the full-sync worker should react to a failed page fetch. */
export type SyncFetchErrorKind = 'rate-limit' | 'transient' | 'fatal';

/**
 * Classify a page-fetch failure in the full-sync worker.
 *
 * - `rate-limit`: HTTP 429. The shared rate limiter already paused the whole
 *   queue (global backoff), so the page is worth retrying after that pause.
 *   This used to be fatal, so one 429 deep into a 46k-post sync stopped the
 *   whole run at ~42k and left the user on a "Resume Sync" screen.
 * - `transient`: 5xx, the 30 s timeout abort, a dropped connection, or a
 *   truncated/HTML body that fails JSON parsing.
 * - `fatal`: any other 4xx, or an error we do not recognise. Retrying cannot
 *   change the answer.
 */
export function classifySyncFetchError(err: unknown): SyncFetchErrorKind {
  const message = err instanceof Error ? err.message : String(err);
  const status = /^HTTP (\d{3})\b/.exec(message)?.[1];
  if (status === '429') return 'rate-limit';
  if (status) return Number(status) >= 500 ? 'transient' : 'fatal';

  // DOMException is not an Error subclass in every runtime, so read the name
  // off the object instead of relying on instanceof.
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as {name: unknown}).name)
      : '';
  // AbortError: our 30 s timeout. TypeError: fetch's network failure
  // ("Failed to fetch" / "NetworkError when attempting to fetch resource").
  // SyntaxError: a 200 response whose body was not the JSON we asked for.
  if (name === 'AbortError' || name === 'TypeError' || name === 'SyntaxError') {
    return 'transient';
  }
  return 'fatal';
}

/**
 * Wait before retry number `failures` (1-based count of failures so far).
 *
 * Transient errors back off exponentially (1 s, 2 s, 4 s, 8 s). A 429's
 * wait comes from the server: the rate limiter derives it from Danbooru's
 * `X-Rate-Limit` header and pauses its queue, and `limiterBackoffMs` is what
 * is left of that pause. Every retry waits it out here rather than queueing
 * into the paused limiter, where the request's 30 s timeout would keep
 * ticking (a server wait can reach ~30 s).
 */
export function syncRetryDelayMs(
  kind: SyncFetchErrorKind,
  failures: number,
  limiterBackoffMs: number = 0,
): number {
  const own = kind === 'rate-limit' ? 1000 : 1000 * Math.pow(2, failures - 1);
  return Math.max(own, limiterBackoffMs);
}

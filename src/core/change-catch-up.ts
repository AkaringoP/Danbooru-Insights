/**
 * Catching up the local rows with posts changed on Danbooru since the last
 * sync or catch-up (T-407, decision G-2) — the page-by-page decisions,
 * pure. The walk reads `user:X order:change` (newest `updated_at` first)
 * and overwrites the rows it already has.
 *
 * A fresh run walks from page 1 until a row older than the watermark `W`
 * (the newest change the rows are known to reflect); a row at exactly `W`
 * does not stop it. Its first row's time becomes the next watermark.
 *
 * An interrupted run leaves `{page, headAt}`: the next page it would have
 * read and its own first row's time. Posts changed since then have moved to
 * the top, so a resumed run first reads from page 1 down to `headAt` (the
 * head phase), then goes back to the tail one page before where it stopped
 * (posts not yet read can only have moved down; a post expunged meanwhile
 * can move them up by one) and walks on down to `W`. Progress is saved only
 * in the tail: a run interrupted during its head phase leaves the older
 * `{page, headAt}` in place, which still covers what it had not finished.
 */

/** Where a catch-up run is. */
export interface CatchUpCursor {
  /** `head`: a resumed run re-reading recent changes; `tail`: the walk. */
  phase: 'head' | 'tail';
  /** Next `order:change` page to read. */
  page: number;
  /** The phase ends at the first row older than this (ms). */
  stopBelow: number;
  /** Where the tail resumes after the head phase. */
  resumePage: number;
  /** Newest `updated_at` on this run's first page (ms), once read. */
  headAt?: number;
}

/** Saved progress of an interrupted run. */
export interface CatchUpProgress {
  /** The next page it would have read. */
  page: number;
  /** Newest `updated_at` on its first page (ms). */
  headAt: number;
}

/** What to do after a page. */
export type CatchUpStep =
  | {kind: 'next'; cursor: CatchUpCursor}
  | {kind: 'done'; watermark: number}
  | {kind: 'overflow'};

/** The first cursor of a run, fresh or resuming `saved`. */
export function startCatchUp(
  watermark: number,
  saved?: CatchUpProgress,
): CatchUpCursor {
  if (!saved) {
    return {phase: 'tail', page: 1, stopBelow: watermark, resumePage: 1};
  }
  return {
    phase: 'head',
    page: 1,
    stopBelow: saved.headAt,
    resumePage: Math.max(1, saved.page - 1),
  };
}

/**
 * The step after reading `cursor.page`, whose rows' `updated_at` (ms,
 * newest first) are `updatedAts`; a page shorter than `limit` is the last.
 * `watermark` is the run's starting `W`. The new watermark never goes back
 * below it. Past `maxPages` (the viewer's page limit) the walk cannot go on.
 */
export function afterCatchUpPage(
  cursor: CatchUpCursor,
  watermark: number,
  updatedAts: number[],
  limit: number,
  maxPages: number,
): CatchUpStep {
  const headAt =
    cursor.headAt ?? (cursor.page === 1 ? updatedAts[0] : undefined);
  const finish = (): CatchUpStep => ({
    kind: 'done',
    watermark: Math.max(watermark, headAt ?? watermark),
  });
  const lastPage = updatedAts.length < limit;
  const reachedStop = updatedAts.some(t => t < cursor.stopBelow);

  if (lastPage) return finish();
  if (cursor.phase === 'head' && reachedStop) {
    const page = Math.max(cursor.resumePage, cursor.page + 1);
    if (page > maxPages) return {kind: 'overflow'};
    return {
      kind: 'next',
      cursor: {...cursor, phase: 'tail', page, stopBelow: watermark, headAt},
    };
  }
  if (cursor.phase === 'tail' && reachedStop) return finish();
  if (cursor.page + 1 > maxPages) return {kind: 'overflow'};
  return {kind: 'next', cursor: {...cursor, page: cursor.page + 1, headAt}};
}

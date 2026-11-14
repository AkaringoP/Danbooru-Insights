/**
 * The user dashboard's count-based distributions, computed from the local
 * `posts` rows instead of `/counts/posts.json` (T-405, used by T-406).
 * Pure: one pass over a user's rows of fields version 2 (`core/post-record`).
 */
import type {PostRecord} from '../types';

/** Post statuses as Danbooru's searches define them. */
interface LocalStatusCounts {
  /**
   * `status:active`: not pending, not deleted, not flagged (`Post.active`,
   * `app/models/post.rb`). Banned posts are not excluded: a post banned at
   * the artist's request but otherwise fine is still active.
   */
  active: number;
  deleted: number;
  banned: number;
  pending: number;
  flagged: number;
}

interface LocalDistributions {
  /** Rows counted. */
  rows: number;
  /** Posts per rating letter (`g`, `s`, `q`, `e`). */
  rating: Record<string, number>;
  status: LocalStatusCounts;
  /** Posts per character tag. */
  characters: Map<string, number>;
  /** Posts per copyright tag. */
  copyrights: Map<string, number>;
  /** Posts with fewer than 10 general tags (`gentags:<10`). */
  gentagsUnder10: number;
  /** Posts with fewer than 10 tags in all (`tagcount:<10`). */
  tagcountUnder10: number;
}

/** Collects {@link LocalDistributions} one row at a time. */
export interface LocalDistributionCounter {
  add(row: PostRecord): void;
  result(): LocalDistributions;
}

/**
 * A counter for one user's rows. Feed it every row (in any order, e.g. from
 * a Dexie `each()`), then read the result.
 *
 * A row's tag strings are split on any run of whitespace; a tag is counted
 * once per post. A row without a total tag count (`tc`) is left out of
 * `tagcountUnder10` rather than read as 0 — the caller only counts locally
 * when every row holds fields version 2.
 */
export function createLocalDistributionCounter(): LocalDistributionCounter {
  const rating: Record<string, number> = {g: 0, s: 0, q: 0, e: 0};
  const status: LocalStatusCounts = {
    active: 0,
    deleted: 0,
    banned: 0,
    pending: 0,
    flagged: 0,
  };
  const characters = new Map<string, number>();
  const copyrights = new Map<string, number>();
  let rows = 0;
  let gentagsUnder10 = 0;
  let tagcountUnder10 = 0;

  return {
    add(row: PostRecord): void {
      rows++;
      if (row.rating in rating) rating[row.rating]++;

      const deleted = row.is_deleted === true;
      const pending = row.pend === true;
      const flagged = row.flag === true;
      if (deleted) status.deleted++;
      if (row.is_banned === true) status.banned++;
      if (pending) status.pending++;
      if (flagged) status.flagged++;
      if (!deleted && !pending && !flagged) status.active++;

      countTags(characters, row.chr);
      countTags(copyrights, row.cpy);

      if (row.tag_count_general < 10) gentagsUnder10++;
      if (typeof row.tc === 'number' && row.tc < 10) tagcountUnder10++;
    },
    result(): LocalDistributions {
      return {
        rows,
        rating: {...rating},
        status: {...status},
        characters: new Map(characters),
        copyrights: new Map(copyrights),
        gentagsUnder10,
        tagcountUnder10,
      };
    },
  };
}

/** Adds one to every distinct tag of a space-separated tag string. */
function countTags(into: Map<string, number>, tagString?: string): void {
  if (!tagString) return;
  const seen = new Set<string>();
  for (const tag of tagString.split(/\s+/)) {
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    into.set(tag, (into.get(tag) ?? 0) + 1);
  }
}

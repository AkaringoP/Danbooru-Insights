/**
 * The `posts` row a sync writes, built from a `/posts.json` item (T-402).
 * One builder for the Full and the Quick sync, which used to build it twice.
 */
import type {DanbooruPost, PostRecord} from '../types';
import {tagFlagsOf} from './post-tag-flags';

/**
 * What a sync row holds; `sync_meta.fieldsVersion` records it per user once
 * a sync or the fields backfill has written every one of the user's rows
 * (T-402). A user below it gets the backfill (T-403).
 *   1 (rows from before, no record): scores, deleted / banned, rating,
 *     general tag count.
 *   2: plus `updated_at`, pending / flagged, the total tag count and the
 *     character and copyright tags — what the pies need to be counted
 *     locally (T-405, T-406) and the change catch-up to work (T-407).
 *   3: plus the tag flags of the secondary pies (`tf`, T-703).
 */
export const POST_FIELDS_VERSION = 3;

/**
 * The version the change catch-up and the first local pies (status, rating,
 * character, copyright, user stats) need. A user still at it while the
 * backfill rebuilds the rows for a later version keeps them.
 */
export const LOCAL_PIES_FIELDS_VERSION = 2;

/**
 * The version whose rows hold the current tag flags (`core/post-tag-flags`):
 * the secondary pies count locally from it on. A change to the flag list
 * bumps {@link POST_FIELDS_VERSION} and moves this to it.
 */
export const TAG_FLAGS_FIELDS_VERSION = 3;

/**
 * `only=` of the sync's `/posts.json` pages. No thumbnail (T-506, audit
 * DA-01): `variants` is not a post field, and `preview_file_url` cost about
 * 100 bytes in every row for the few the milestone cards show — their
 * lookup (`getMilestones`) fetches those, with the larger sizes. The
 * general and meta tag strings are read for the tag flags and not stored
 * (T-703); they make a page about four times larger.
 */
export const SYNC_POST_FIELDS = [
  'id',
  'uploader_id',
  'created_at',
  'updated_at',
  'up_score',
  'down_score',
  'is_deleted',
  'is_banned',
  'is_pending',
  'is_flagged',
  'rating',
  'tag_count',
  'tag_count_general',
  'tag_string_character',
  'tag_string_copyright',
  'tag_string_general',
  'tag_string_meta',
].join(',');

/**
 * The row for post `p`, `no`-th of its uploader. A field the response
 * lacks stays unset rather than becoming a 0 that reads as a real value;
 * the status flags read a missing one as false, as before.
 */
export function toPostRecord(p: DanbooruPost, no: number): PostRecord {
  const ds = p.down_score ?? 0;
  const us = p.up_score ?? 0;
  const updated = p.updated_at ? Date.parse(p.updated_at) : NaN;
  return {
    id: p.id,
    uploader_id: p.uploader_id,
    no,
    created_at: p.created_at,
    score: us + ds,
    up_score: us,
    down_score: ds,
    is_deleted: p.is_deleted ?? false,
    is_banned: p.is_banned ?? false,
    rating: p.rating,
    tag_count_general: p.tag_count_general ?? 0,
    upd: Number.isNaN(updated) ? undefined : updated,
    pend: p.is_pending ?? false,
    flag: p.is_flagged ?? false,
    tc: p.tag_count,
    chr: p.tag_string_character ?? '',
    cpy: p.tag_string_copyright ?? '',
    tf: tagFlagsOf(p.tag_string_general, p.tag_string_meta),
  };
}

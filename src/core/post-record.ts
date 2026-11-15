/**
 * The `posts` row a sync writes, built from a `/posts.json` item (T-402).
 * One builder for the Full and the Quick sync, which used to build it twice.
 */
import type {DanbooruPost, PostRecord} from '../types';

/**
 * What a sync row holds; `sync_meta.fieldsVersion` records it per user once
 * a sync has written every one of the user's rows (T-402).
 *   1 (rows from before, no record): scores, deleted / banned, rating,
 *     general tag count.
 *   2: plus `updated_at`, pending / flagged, the total tag count and the
 *     character and copyright tags — what the pies need to be counted
 *     locally (T-405, T-406) and the change catch-up to work (T-407).
 */
export const POST_FIELDS_VERSION = 2;

/**
 * `only=` of the sync's `/posts.json` pages. `variants` is not asked for: a
 * post search does not return it, so it was always empty in the rows.
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
  'preview_file_url',
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
    preview_file_url: p.preview_file_url,
    upd: Number.isNaN(updated) ? undefined : updated,
    pend: p.is_pending ?? false,
    flag: p.is_flagged ?? false,
    tc: p.tag_count,
    chr: p.tag_string_character ?? '',
    cpy: p.tag_string_copyright ?? '',
  };
}

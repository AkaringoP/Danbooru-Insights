/**
 * Pure helpers for the dashboard preview popover.
 *
 * No DOM, network, or DB access lives here: apps/ wires the data fetching
 * (AnalyticsDataManager) and ui/ renders, while this module owns the
 * unit-testable logic — status mapping, thumbnail selection, and activity
 * merging — plus the popover's colour constants.
 */
import type {
  ActivityDistribution,
  ActivitySegment,
  ActivityType,
  DanbooruPost,
  PostPreview,
  PostPreviewStatus,
} from '../types';
import {getBestThumbnailUrl} from '../utils';

/**
 * Canonical ordering of the activity feed types. Single source of truth for
 * iterating types (colour map keys, zero-filled count tallies).
 */
export const ACTIVITY_TYPES: readonly ActivityType[] = [
  'upload',
  'edit',
  'note',
  'wiki',
  'artist',
  'commentary',
  'pool',
  'forum',
  'approval',
  'comment',
  'appeal',
  'suspicious', // last: malicious-looking items, recolored across types (§B)
];

/**
 * Border colour per post status. `active` is transparent so every grid cell
 * keeps the same box size whether or not it shows a status border.
 */
export const STATUS_BORDER_COLORS: Record<PostPreviewStatus, string> = {
  active: 'transparent',
  pending: '#0969da', // blue
  appealed: '#8250df', // purple
  flagged: '#cf222e', // red
  deleted: '#6e7781', // gray (also covers banned)
};

/**
 * Distinct colour per activity type for the distribution strip. Drawn from
 * the Material palette family used by user-analytics-charts so the popover
 * harmonises with the dashboard's pie/area charts.
 */
export const ACTIVITY_COLORS: Record<ActivityType, string> = {
  upload: '#2196f3', // blue (the upload itself — the dominant activity)
  edit: '#3f51b5', // indigo (later tag/metadata edits)
  note: '#ff9800', // orange
  wiki: '#9c27b0', // purple
  artist: '#e91e63', // pink
  commentary: '#00bcd4', // cyan
  pool: '#8bc34a', // lime
  forum: '#795548', // brown
  approval: '#4caf50', // green
  comment: '#ffc107', // amber
  appeal: '#f44336', // red
  suspicious: '#1b1f24', // near-black; a red inset border (CSS) keeps it visible
};

/**
 * Maps a post (plus the set of appealed post ids) to a single display
 * status for its border colour. Order matters: `appealed` is a sub-state of
 * deleted so it wins first, and `banned` folds into `deleted`.
 */
export function derivePostStatus(
  post: Pick<
    DanbooruPost,
    'id' | 'is_pending' | 'is_flagged' | 'is_deleted' | 'is_banned'
  >,
  appealedIds: Set<number>,
): PostPreviewStatus {
  if (appealedIds.has(post.id)) return 'appealed';
  if (post.is_pending) return 'pending';
  if (post.is_flagged) return 'flagged';
  if (post.is_deleted || post.is_banned) return 'deleted';
  return 'active';
}

/**
 * 180x180 variant URL for a post, falling back to the best available
 * thumbnail (`getBestThumbnailUrl`) and finally an empty string.
 */
export function pick180ThumbUrl(
  post: Pick<
    DanbooruPost,
    'variants' | 'preview_file_url' | 'file_url' | 'large_file_url'
  >,
): string {
  const variant = post.variants?.find(v => v.type === '180x180');
  return variant?.url || getBestThumbnailUrl(post);
}

/**
 * Maps a raw post to the lightweight {@link PostPreview} view-model the
 * popover grid renders: 180px thumbnail, total score, general tag count,
 * and border status. Keeps the data manager's fetch path thin.
 */
export function toPostPreview(
  post: DanbooruPost,
  appealedIds: Set<number>,
): PostPreview {
  return {
    id: post.id,
    thumbUrl: pick180ThumbUrl(post),
    score: post.score ?? (post.up_score ?? 0) + (post.down_score ?? 0),
    // Kept undefined when absent (NOT coerced to 0): a missing count is
    // *unknown*, not zero, so it must not trip the under-tagged suspicious
    // heuristic (see isSuspiciousUpload). The grid renders '?' for unknown.
    generalTags: post.tag_count_general,
    // Defensive: rating is universal per the API, but a malformed/restricted
    // status:any row could omit it. '' keeps the grid from crashing on
    // `.toUpperCase()` and avoids a literal 'undefined' in the blur dataset.
    rating: post.rating ?? '',
    status: derivePostStatus(post, appealedIds),
  };
}

/** Score at/below which a recent upload is flagged (heavily downvoted) → red. */
const SUSPICIOUS_SCORE_MAX = -3;
/**
 * Uploader-added tag count at/below which an upload is "mintagged" → orange.
 * This counts the tags the *uploader* added on the post's first version
 * (`added_tags`, which merges the uploader's own follow-up edits within the
 * ~1h window) — not the post's current total. So a lazy uploader is caught
 * even when others tagged the post up afterwards. The threshold is generous
 * because `added_tags` includes non-general tags (artist, copyright, meta).
 */
const MINTAG_MAX = 10;

/**
 * Whether a recent upload is heavily downvoted (its label turns red): score
 * at/below {@link SUSPICIOUS_SCORE_MAX}. A low score is the community's signal
 * that the post itself is bad. Under-tagging is a separate, milder signal
 * handled by {@link isMintagged} (orange). Rating is deliberately excluded —
 * mis-rating can't be judged without inspecting the image itself.
 */
export function isSuspiciousUpload(
  preview: Pick<PostPreview, 'score'>,
): boolean {
  return preview.score <= SUSPICIOUS_SCORE_MAX;
}

/**
 * Whether the *uploader* under-tagged their own upload (its label turns
 * orange): they added {@link MINTAG_MAX} or fewer tags on the first version
 * ({@link PostPreview.uploaderTagCount}). An unknown count (the post_versions
 * lookup missed) is not flagged — fail-open, so a failed lookup never
 * mass-flags a user's whole grid.
 */
export function isMintagged(
  preview: Pick<PostPreview, 'uploaderTagCount'>,
): boolean {
  return (
    preview.uploaderTagCount !== undefined &&
    preview.uploaderTagCount <= MINTAG_MAX
  );
}

/**
 * Minimum gap (ms) between a mintagged upload's v1 and v2 for it to count as
 * "abandoned" → its label escalates from orange to red. A *short* gap is the
 * competitive-tagging race (someone tagged alongside the uploader), which
 * isn't the uploader's fault; a longer gap means the uploader had time to tag,
 * didn't, and someone else eventually had to clean it up.
 */
export const ABANDONED_GAP_MS = 15 * 60 * 1000;

/** A `/post_versions.json` row, trimmed to what the abandoned-gap check reads. */
interface PostVersionRow {
  version?: number;
  updated_at?: string;
  created_at?: string;
}

/**
 * Gap in ms between a post's first two versions (v2 − v1), or null when either
 * is absent or carries an unparseable timestamp. Timestamp prefers
 * `updated_at` (consistent with the activity feed), falling back to
 * `created_at`.
 */
export function abandonedGapMs(versions: PostVersionRow[]): number | null {
  const tsOf = (v: PostVersionRow) =>
    Date.parse(v.updated_at ?? v.created_at ?? '');
  const v1 = versions.find(v => v.version === 1);
  const v2 = versions.find(v => v.version === 2);
  if (!v1 || !v2) return null;
  const t1 = tsOf(v1);
  const t2 = tsOf(v2);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return t2 - t1;
}

/**
 * Whether a post's version history marks it "abandoned": a v2 that lands at
 * least {@link ABANDONED_GAP_MS} after v1, so the upload sat under-tagged
 * before someone else stepped in. Missing v1/v2 → not abandoned (fail-open).
 */
export function isAbandonedByGap(versions: PostVersionRow[]): boolean {
  const gap = abandonedGapMs(versions);
  return gap !== null && gap >= ABANDONED_GAP_MS;
}

/**
 * Page size appended to every legend index link. Matches the activity window
 * (`ACTIVITY_SEGMENT_LIMIT`) so the whole analysed window lands on one page —
 * the oldest item we counted is then present (not pushed onto page 2+).
 */
const INDEX_PAGE_LIMIT = 200;
const withIndexLimit = (url: string): string =>
  `${url}&limit=${INDEX_PAGE_LIMIT}`;

/**
 * URL-fragment prefix (incl. trailing separator) per type for scrolling to a
 * specific row on its index page (`#<prefix><id>`). All MEASURED on the live
 * pages: the posts gallery uses an underscore (`post_<id>`, also confirmed by
 * the LocateInGallery userscript) and comments likewise (`comment_<id>`), while
 * every `*_versions` / feed table uses Rails' *dashed* dom_id
 * (`post-version-<id>`, `note-version-<id>`, …). A non-matching fragment is
 * ignored by the browser (fail-soft). `suspicious` is absent — it reuses the
 * gallery `#post_` anchor inside {@link suspiciousPostsUrl}.
 */
const ANCHOR_PREFIX: Partial<Record<ActivityType, string>> = {
  upload: 'post_',
  edit: 'post-version-',
  note: 'note-version-',
  wiki: 'wiki-page-version-',
  artist: 'artist-version-',
  commentary: 'artist-commentary-version-',
  pool: 'pool-version-',
  forum: 'forum-post-',
  approval: 'post-approval-',
  comment: 'comment_',
  appeal: 'post-appeal-',
};

/** Appends `#<prefix><anchorId>` when a prefix + positive id are available. */
function withAnchor(
  url: string,
  type: ActivityType,
  anchorId: number | undefined,
): string {
  const prefix = ANCHOR_PREFIX[type];
  if (!prefix || !anchorId || anchorId <= 0) return url;
  return `${url}#${prefix}${anchorId}`;
}

/**
 * Builders for name-scoped index URLs (`/posts?tags=user:…`). `suspicious`
 * has no native index, so it points at the user's deleted uploads (its
 * strongest subset).
 */
const INDEX_URL_BY_NAME: Partial<
  Record<ActivityType, (name: string) => string>
> = {
  upload: name => `/posts?tags=${encodeURIComponent(`user:${name}`)}`,
  suspicious: name =>
    `/posts?tags=${encodeURIComponent(`user:${name} status:deleted`)}`,
};

/**
 * Prefixes for id-scoped index URLs — the numeric user id is appended. Mirrors
 * {@link AnalyticsDataManager.getActivityDistribution}'s fetch params.
 */
const INDEX_URL_BY_ID: Partial<Record<ActivityType, string>> = {
  edit: '/post_versions?search[is_new]=false&search[updater_id]=',
  note: '/note_versions?search[updater_id]=',
  wiki: '/wiki_page_versions?search[updater_id]=',
  artist: '/artist_versions?search[updater_id]=',
  commentary: '/artist_commentary_versions?search[updater_id]=',
  pool: '/pool_versions?search[updater_id]=',
  forum: '/forum_posts?search[creator_id]=',
  approval: '/post_approvals?search[user_id]=',
  comment: '/comments?group_by=comment&search[creator_id]=',
  appeal: '/post_appeals?search[creator_id]=',
};

/**
 * Relative Danbooru index URL for an activity type, scoped to one user — the
 * "open the full list" target for a legend item. Returns undefined when the
 * required identifier (name for uploads/suspicious, numeric id otherwise) is
 * missing. `anchorId` (the oldest in-window record id, from
 * {@link ActivityDistribution.oldestAnchorByType}) appends a `#`-scroll
 * fragment so the page lands on that boundary item.
 */
export function activityTypeIndexUrl(
  type: ActivityType,
  user: {name?: string | null; id?: string | null},
  anchorId?: number,
): string | undefined {
  let base: string | undefined;
  const byName = INDEX_URL_BY_NAME[type];
  if (byName) {
    const name = user.name ? user.name.replace(/ /g, '_') : '';
    base = name ? byName(name) : undefined;
  } else {
    const idPrefix = INDEX_URL_BY_ID[type];
    base = idPrefix && user.id ? `${idPrefix}${user.id}` : undefined;
  }
  return base ? withAnchor(withIndexLimit(base), type, anchorId) : undefined;
}

/** Per-post quality signals used to flag malicious uploads in section B. */
export interface UploadMeta {
  isDeleted?: boolean;
  isBanned?: boolean;
  score?: number;
}

/**
 * Classifies an upload activity segment for section B's strip: `'suspicious'`
 * when the post is deleted/banned or heavily downvoted
 * ({@link SUSPICIOUS_SCORE_MAX}), else `'upload'`. Unknown meta (lookup miss)
 * stays `'upload'` — fail-open, so a failed lookup never mass-flags.
 */
export function classifyUploadType(meta: UploadMeta | undefined): ActivityType {
  if (!meta) return 'upload';
  if (meta.isDeleted || meta.isBanned) return 'suspicious';
  return (meta.score ?? 0) <= SUSPICIOUS_SCORE_MAX ? 'suspicious' : 'upload';
}

/**
 * Classifies a comment activity segment: `'suspicious'` when heavily
 * downvoted ({@link SUSPICIOUS_SCORE_MAX}), else `'comment'`. Missing score →
 * `'comment'`.
 */
export function classifyCommentType(score: number | undefined): ActivityType {
  return (score ?? 0) <= SUSPICIOUS_SCORE_MAX ? 'suspicious' : 'comment';
}

/**
 * `only=` field list for the recent-posts preview fetch: the status flags
 * {@link derivePostStatus} needs, score, general tag count, and thumbnail
 * sources.
 */
export const PREVIEW_POST_FIELDS =
  'id,rating,score,up_score,down_score,tag_count_general,is_pending,' +
  'is_flagged,is_deleted,is_banned,variants,preview_file_url';

/**
 * Builds the two `/posts.json` URLs the preview grid needs: the recent
 * uploads (`status:any` so deleted/pending/flagged are visible; newest-first
 * is the API default so no `order:` metatag is needed) and the
 * `status:appealed` id probe (appealed has no per-post flag).
 * `normalizedName` must already have spaces replaced with underscores.
 */
export function buildPreviewPostUrls(
  normalizedName: string,
  limit: number,
): {postsUrl: string; appealedUrl: string} {
  const enc = (query: string) => encodeURIComponent(query);
  return {
    postsUrl: `/posts.json?tags=${enc(
      `user:${normalizedName} status:any`,
    )}&limit=${limit}&only=${PREVIEW_POST_FIELDS}`,
    appealedUrl: `/posts.json?tags=${enc(
      `user:${normalizedName} status:appealed`,
    )}&limit=${limit}&only=id`,
  };
}

/**
 * Builds the `/post_versions.json` URL for the uploader's most-recent uploads'
 * first versions (`is_new=true`), trimmed to the fields the mintag heuristic
 * needs. `added_tags` carries the tags the uploader added at upload (merged
 * with their own ~1h follow-up edits); its length feeds {@link isMintagged}.
 * Id-based (mirrors {@link AnalyticsDataManager.getActivityDistribution}); the
 * caller skips this call when the numeric id is missing.
 */
export function buildMintagVersionsUrl(userId: string, limit: number): string {
  return (
    '/post_versions.json?search[is_new]=true&search[updater_id]=' +
    `${encodeURIComponent(userId)}&limit=${limit}&only=post_id,added_tags`
  );
}

/**
 * Builds the `/post_versions.json` URL for one post's version history, trimmed
 * to the version number + timestamps the abandoned-gap check needs. Fetched
 * per mintagged post to find when v2 landed relative to v1
 * ({@link abandonedGapMs}). `limit=100` covers virtually every post's history
 * (a post with >100 versions would lose v1/v2 off the page → fail-open).
 */
export function buildPostVersionsUrl(postId: number): string {
  return (
    `/post_versions.json?search[post_id]=${postId}` +
    '&only=version,updated_at,created_at&limit=100'
  );
}

/**
 * Reduces the {@link buildMintagVersionsUrl} response to a
 * `post_id → uploader-added-tag-count` map (the `added_tags` array length).
 * Rows lacking a `post_id` or `added_tags` array are skipped, so a missing
 * field just leaves that post's count unknown (fail-open for isMintagged).
 */
export function buildUploaderTagCounts(
  versions: Array<{post_id?: number; added_tags?: string[]}>,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const v of versions) {
    if (v.post_id !== undefined && Array.isArray(v.added_tags)) {
      counts.set(v.post_id, v.added_tags.length);
    }
  }
  return counts;
}

/**
 * Tie-break key for same-`ts` segments: the record id (`anchorId`, or `postId`
 * for suspicious segments that carry no anchor), where a higher id means newer.
 * 0 when neither is present.
 */
function segOrderKey(seg: ActivitySegment): number {
  return seg.anchorId ?? seg.postId ?? 0;
}

/**
 * Flattens per-type activity arrays into one most-recent-first list capped
 * at `limit`, plus a per-type tally over that capped window (all activity
 * types present as keys, zero-filled).
 *
 * Input arrays are not mutated. Segments with a non-finite `ts` (e.g. an
 * unparseable timestamp) are dropped so they cannot sort to the top.
 */
export function mergeRecentActivity(
  perType: ActivitySegment[][],
  limit = 100,
): ActivityDistribution {
  const all: ActivitySegment[] = [];
  for (const arr of perType) {
    for (const seg of arr) {
      if (Number.isFinite(seg.ts)) all.push(seg);
    }
  }
  // Newest first; tie-break by record id (higher = newer) so a batch of
  // same-second rows sorts deterministically. Without it the oldest-in-window
  // anchor for a type could shift run to run on equal timestamps (R-12).
  all.sort((a, b) => b.ts - a.ts || segOrderKey(b) - segOrderKey(a));
  const recent = all.slice(0, limit);

  const counts = {} as Record<ActivityType, number>;
  for (const type of ACTIVITY_TYPES) {
    counts[type] = 0;
  }
  for (const seg of recent) {
    counts[seg.type] += 1;
  }
  // Collect the posts behind the suspicious segments in the *same* window the
  // legend counts, so "Suspicious N" and the id: link-out stay consistent.
  const suspiciousPostIds = [
    ...new Set(
      recent
        .filter(s => s.type === 'suspicious' && (s.postId ?? 0) > 0)
        .map(s => s.postId as number),
    ),
  ];
  // Oldest in-window anchor per type: recent is newest-first, so the last
  // write for each type wins → the oldest segment's id (the scroll boundary).
  const oldestAnchorByType: Partial<Record<ActivityType, number>> = {};
  for (const seg of recent) {
    if ((seg.anchorId ?? 0) > 0) oldestAnchorByType[seg.type] = seg.anchorId;
  }
  return {recent, counts, suspiciousPostIds, oldestAnchorByType};
}

/** Cap on ids in a single `id:` link to keep the URL a sane length. */
const SUSPICIOUS_URL_ID_CAP = 200;

/**
 * Relative `/posts` index URL listing exactly the given suspicious post ids
 * (`id:a,b,c status:any` — `status:any` so deleted/banned uploads, the whole
 * point of the flag, still appear). Returns undefined for an empty list so the
 * caller can fall back to a name-scoped search. Ids are deduped and capped at
 * {@link SUSPICIOUS_URL_ID_CAP}.
 */
export function suspiciousPostsUrl(ids: number[]): string | undefined {
  const unique = [...new Set(ids.filter(id => id > 0))].slice(
    0,
    SUSPICIOUS_URL_ID_CAP,
  );
  if (unique.length === 0) return undefined;
  const query = `id:${unique.join(',')} status:any`;
  const url = withIndexLimit(`/posts?tags=${encodeURIComponent(query)}`);
  // `unique` is newest-first, so the last id is the oldest flagged post —
  // the same "boundary" target the per-type anchors use. Verified `#post_`.
  return `${url}#post_${unique[unique.length - 1]}`;
}

/**
 * Splits `items` into consecutive, size-balanced chunks of at most `perRow`
 * each, using the minimum number of chunks and spreading items so chunk sizes
 * differ by at most one (earlier chunks get the remainder). The activity
 * strip renders each chunk as a row whose cells stretch to fill the width, so
 * balancing avoids a ragged, half-empty final row. Order is preserved.
 */
export function balancedChunks<T>(items: T[], perRow: number): T[][] {
  const n = items.length;
  if (n === 0 || perRow <= 0) return [];
  const rows = Math.ceil(n / perRow);
  const base = Math.floor(n / rows);
  const extra = n % rows; // first `extra` rows get one more
  const out: T[][] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const size = base + (r < extra ? 1 : 0);
    out.push(items.slice(idx, idx + size));
    idx += size;
  }
  return out;
}

/**
 * Window (ms) within which a commentary version is treated as having been
 * created by the post's own upload rather than as a standalone edit.
 *
 * Uploading a post *with* commentary creates the v1 ArtistCommentaryVersion
 * in the same transaction, so its timestamp is essentially identical to the
 * post's `created_at`. 1s is tight on purpose: it catches only that coupled
 * v1, while a commentary the user adds manually a few seconds after upload
 * still counts as real commentary work.
 */
export const COMMENTARY_UPLOAD_EPSILON_MS = 1000;

/**
 * A commentary activity segment that still carries its `postId`, so
 * {@link filterUploadCoupledCommentary} can compare it against the post's
 * upload time before the id is dropped for the merged feed.
 */
export interface CommentarySegment extends ActivitySegment {
  type: 'commentary';
  postId: number;
}

/**
 * Drops "upload-coupled" commentary segments — the v1 commentary version
 * Danbooru auto-creates when a post is uploaded with commentary, which would
 * otherwise double-count an upload as commentary work in the activity strip.
 *
 * A segment is dropped when its post's upload time is within `epsilonMs` of
 * the segment's own timestamp. Segments whose `postId` is absent from
 * `postCreatedAt` (post unknown, deleted-and-unfetched, or — most often — a
 * post the user did not upload, so the timestamps don't line up) are kept:
 * those are genuine commentary edits. The returned segments are plain
 * {@link ActivitySegment}s with `postId` stripped, ready for merging.
 */
export function filterUploadCoupledCommentary(
  segments: CommentarySegment[],
  postCreatedAt: Map<number, number>,
  epsilonMs: number = COMMENTARY_UPLOAD_EPSILON_MS,
): ActivitySegment[] {
  const kept: ActivitySegment[] = [];
  for (const seg of segments) {
    const uploadedAt = postCreatedAt.get(seg.postId);
    if (
      uploadedAt !== undefined &&
      Math.abs(seg.ts - uploadedAt) <= epsilonMs
    ) {
      continue; // coupled to the upload — skip
    }
    kept.push({type: 'commentary', ts: seg.ts, anchorId: seg.anchorId});
  }
  return kept;
}

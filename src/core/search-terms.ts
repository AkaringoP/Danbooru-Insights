/**
 * Danbooru's search tag limit, mirrored on the client.
 *
 * A post search (and, since 2026-11-05, `/counts/posts.json`) may use at
 * most N terms, where N follows the *viewer*: anonymous 2, Member 3, Gold and
 * above unlimited (`User#tag_query_limit`, danbooru `production`). Over it
 * the server answers 422. Counting the terms first lets a caller skip a
 * request that cannot succeed. See `.claude/rules/api-endpoints.md`,
 * "Search tag limit".
 */

/**
 * Metatags that do not count toward the limit (`PostQuery::UNLIMITED_METATAGS`
 * in `app/logical/post_query.rb`). Every other metatag — `user:`, `order:`,
 * `has:`, `fav:`, `ordfav:`, `source:`, `gentags:` … — costs one term, like a
 * tag name.
 */
const UNLIMITED_METATAGS = new Set([
  'status',
  'rating',
  'limit',
  'is',
  'id',
  'date',
  'age',
  'filesize',
  'filetype',
  'parent',
  'child',
  'md5',
  'width',
  'height',
  'duration',
  'mpixels',
  'ratio',
  'score',
  'upvote',
  'downvotes',
  'favcount',
  'embedded',
  'tagcount',
  'pixiv_id',
  'pixiv',
]);

/**
 * Terms a query costs against the limit: one per tag name, wildcard, `~` OR
 * term, `-` negation and non-free metatag.
 */
export function countSearchTerms(query: string): number {
  let terms = 0;
  for (const raw of query.split(/\s+/)) {
    const token = raw.replace(/^[-~]+/, '');
    if (!token) continue;
    const metatag = /^([a-z_]+):/i.exec(token)?.[1]?.toLowerCase();
    if (metatag && UNLIMITED_METATAGS.has(metatag)) continue;
    terms++;
  }
  return terms;
}

/**
 * The viewer's limit, from `<body data-current-user-level>` (0 anonymous,
 * 20 Member, 30 Gold). Infinity when the level cannot be read: a request
 * the server refuses costs one 422, a request skipped wrongly costs data.
 */
export function viewerTagLimit(): number {
  if (typeof document === 'undefined' || !document.body) return Infinity;
  const level = Number.parseInt(
    document.body.dataset.currentUserLevel ?? '',
    10,
  );
  if (!Number.isFinite(level)) return Infinity;
  if (level >= 30) return Infinity;
  return level <= 0 ? 2 : 3;
}

/** Whether the viewer may run `query` without a 422. */
export function fitsViewerTagLimit(query: string): boolean {
  return countSearchTerms(query) <= viewerTagLimit();
}

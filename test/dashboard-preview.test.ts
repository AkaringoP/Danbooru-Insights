import {describe, it, expect} from 'vitest';
import {
  ABANDONED_GAP_MS,
  ACTIVITY_COLORS,
  ACTIVITY_TYPES,
  COMMENTARY_UPLOAD_EPSILON_MS,
  PREVIEW_POST_FIELDS,
  STATUS_BORDER_COLORS,
  abandonedGapMs,
  activityTypeIndexUrl,
  balancedChunks,
  buildMintagVersionsUrl,
  buildPostVersionsUrl,
  buildPreviewPostUrls,
  buildUploaderTagCounts,
  isAbandonedByGap,
  classifyCommentType,
  classifyUploadType,
  derivePostStatus,
  filterUploadCoupledCommentary,
  isMintagged,
  isSuspiciousUpload,
  mergeRecentActivity,
  pick180ThumbUrl,
  suspiciousPostsUrl,
  toPostPreview,
} from '../src/core/dashboard-preview';
import type {ActivitySegment, ActivityType, PostVariant} from '../src/types';
import type {CommentarySegment} from '../src/core/dashboard-preview';

describe('derivePostStatus', () => {
  const base = {
    id: 1,
    is_pending: false,
    is_flagged: false,
    is_deleted: false,
    is_banned: false,
  };
  const noAppeals = new Set<number>();

  it('returns active when no flags are set', () => {
    expect(derivePostStatus(base, noAppeals)).toBe('active');
  });

  it('treats appealed as the highest precedence (over deleted)', () => {
    expect(derivePostStatus({...base, is_deleted: true}, new Set([1]))).toBe(
      'appealed',
    );
  });

  it('ranks pending above flagged and deleted', () => {
    expect(
      derivePostStatus(
        {...base, is_pending: true, is_flagged: true, is_deleted: true},
        noAppeals,
      ),
    ).toBe('pending');
  });

  it('ranks flagged above deleted', () => {
    expect(
      derivePostStatus(
        {...base, is_flagged: true, is_deleted: true},
        noAppeals,
      ),
    ).toBe('flagged');
  });

  it('maps is_deleted and is_banned to deleted', () => {
    expect(derivePostStatus({...base, is_deleted: true}, noAppeals)).toBe(
      'deleted',
    );
    expect(derivePostStatus({...base, is_banned: true}, noAppeals)).toBe(
      'deleted',
    );
  });

  it('only marks appealed for the matching id', () => {
    expect(
      derivePostStatus({...base, id: 2, is_deleted: true}, new Set([1])),
    ).toBe('deleted');
  });
});

describe('pick180ThumbUrl', () => {
  const variant = (type: string, url: string): PostVariant => ({
    type,
    url,
    file_ext: 'webp',
  });

  it('prefers the 180x180 variant', () => {
    const post = {
      variants: [
        variant('720x720', 'u720'),
        variant('180x180', 'u180'),
        variant('360x360', 'u360'),
      ],
    };
    expect(pick180ThumbUrl(post)).toBe('u180');
  });

  it('falls back to the best thumbnail (720 webp) when no 180 exists', () => {
    const post = {
      variants: [variant('360x360', 'u360'), variant('720x720', 'u720')],
    };
    expect(pick180ThumbUrl(post)).toBe('u720');
  });

  it('falls back to preview_file_url when there are no variants', () => {
    expect(pick180ThumbUrl({preview_file_url: 'prev'})).toBe('prev');
  });

  it('returns an empty string when nothing is available', () => {
    expect(pick180ThumbUrl({})).toBe('');
  });
});

describe('toPostPreview', () => {
  it('builds the view-model with 180 thumb, score, tags, and status', () => {
    const preview = toPostPreview(
      {
        id: 7,
        created_at: '2024-01-01',
        uploader_id: 1,
        rating: 's',
        score: 42,
        tag_count_general: 15,
        is_pending: true,
        variants: [{type: '180x180', url: 'u180', file_ext: 'webp'}],
      },
      new Set(),
    );
    expect(preview).toEqual({
      id: 7,
      thumbUrl: 'u180',
      score: 42,
      generalTags: 15,
      rating: 's',
      status: 'pending',
    });
  });

  it('falls back to up_score + down_score when score is absent', () => {
    const preview = toPostPreview(
      {
        id: 8,
        created_at: '2024-01-01',
        uploader_id: 1,
        rating: 's',
        up_score: 10,
        down_score: -3,
      },
      new Set(),
    );
    expect(preview.score).toBe(7);
    // tag_count_general absent → undefined (NOT coerced to 0), so the
    // under-tagged heuristic can tell "no data" from a real 0 (R-02).
    expect(preview.generalTags).toBeUndefined();
    expect(preview.status).toBe('active');
  });

  it('falls back to rating "" and undefined tags when the API omits them', () => {
    // A malformed/restricted status:any row can drop rating + tag_count_general.
    // toPostPreview must normalise rather than let undefined reach the grid
    // (rating.toUpperCase() would crash; see R-01/R-03).
    const preview = toPostPreview(
      {id: 9, created_at: '2024-01-01', uploader_id: 1} as never,
      new Set(),
    );
    expect(preview.rating).toBe('');
    expect(preview.generalTags).toBeUndefined();
  });
});

describe('buildPreviewPostUrls', () => {
  it('recent-posts url uses status:any (newest-first default) + the fields', () => {
    const {postsUrl} = buildPreviewPostUrls('alice', 20);
    const m = postsUrl.match(/tags=([^&]+)/);
    expect(decodeURIComponent(m?.[1] ?? '')).toBe('user:alice status:any');
    expect(postsUrl).toContain(`&limit=20&only=${PREVIEW_POST_FIELDS}`);
    expect(PREVIEW_POST_FIELDS).toContain('is_pending');
    expect(PREVIEW_POST_FIELDS).toContain('is_deleted');
    expect(PREVIEW_POST_FIELDS).toContain('variants');
    expect(PREVIEW_POST_FIELDS).toContain('rating');
  });

  it('appealed url uses status:appealed and only=id', () => {
    const {appealedUrl} = buildPreviewPostUrls('alice', 20);
    const m = appealedUrl.match(/tags=([^&]+)/);
    expect(decodeURIComponent(m?.[1] ?? '')).toBe('user:alice status:appealed');
    expect(appealedUrl).toContain('only=id');
  });
});

describe('mergeRecentActivity', () => {
  const seg = (type: ActivityType, ts: number): ActivitySegment => ({type, ts});

  it('sorts most-recent-first and caps at the limit', () => {
    const {recent} = mergeRecentActivity(
      [[seg('edit', 10), seg('edit', 30)], [seg('note', 20)]],
      2,
    );
    expect(recent.map(s => s.ts)).toEqual([30, 20]);
  });

  it('tallies counts over the capped window and zero-fills absent types', () => {
    const {counts} = mergeRecentActivity(
      [[seg('edit', 5), seg('edit', 4)], [seg('approval', 3)]],
      100,
    );
    expect(counts.edit).toBe(2);
    expect(counts.approval).toBe(1);
    expect(counts.note).toBe(0);
    for (const type of ACTIVITY_TYPES) {
      expect(typeof counts[type]).toBe('number');
    }
  });

  it('counts reflect only the capped window', () => {
    const {recent, counts} = mergeRecentActivity(
      [[seg('edit', 3), seg('edit', 2), seg('note', 1)]],
      2,
    );
    expect(recent).toHaveLength(2);
    expect(counts.edit).toBe(2);
    expect(counts.note).toBe(0); // cut by the limit
  });

  it('drops segments with a non-finite ts', () => {
    const {recent} = mergeRecentActivity(
      [[seg('edit', NaN), seg('note', 5)]],
      100,
    );
    expect(recent).toEqual([seg('note', 5)]);
  });

  it('does not mutate the input arrays', () => {
    const first = [seg('edit', 1), seg('edit', 9)];
    mergeRecentActivity([first], 100);
    expect(first.map(s => s.ts)).toEqual([1, 9]);
  });

  it('collects deduped suspicious post ids from the capped window', () => {
    const sus = (ts: number, postId: number): ActivitySegment => ({
      type: 'suspicious',
      ts,
      postId,
    });
    const {suspiciousPostIds} = mergeRecentActivity(
      [[sus(5, 11), sus(4, 22), sus(3, 11)], [seg('upload', 2)]],
      100,
    );
    expect(suspiciousPostIds).toEqual([11, 22]); // deduped, order preserved
  });

  it('omits suspicious segments without a postId, and respects the cap', () => {
    const {suspiciousPostIds} = mergeRecentActivity(
      [
        [
          {type: 'suspicious', ts: 9, postId: 7}, // kept
          {type: 'suspicious', ts: 8}, // no postId (e.g. lookup miss) → skip
          {type: 'suspicious', ts: 1, postId: 99}, // cut by the limit
        ],
      ],
      2,
    );
    expect(suspiciousPostIds).toEqual([7]);
  });

  it('returns an empty suspicious id list when there are none', () => {
    const {suspiciousPostIds} = mergeRecentActivity([[seg('upload', 1)]], 100);
    expect(suspiciousPostIds).toEqual([]);
  });

  it('picks the oldest in-window anchor id per type', () => {
    const a = (type: ActivityType, ts: number, anchorId: number) => ({
      type,
      ts,
      anchorId,
    });
    const {oldestAnchorByType} = mergeRecentActivity(
      [
        [a('note', 30, 3), a('note', 10, 1), a('note', 20, 2)],
        [a('edit', 25, 9)],
      ],
      100,
    );
    // note's oldest (ts=10) → anchor 1; edit's only one → 9.
    expect(oldestAnchorByType.note).toBe(1);
    expect(oldestAnchorByType.edit).toBe(9);
  });

  it('omits anchors cut by the limit or lacking an id', () => {
    const {oldestAnchorByType} = mergeRecentActivity(
      [
        [
          {type: 'note', ts: 30, anchorId: 3},
          {type: 'note', ts: 1, anchorId: 1}, // cut by the limit
          {type: 'wiki', ts: 20}, // no anchorId
        ],
      ],
      1,
    );
    expect(oldestAnchorByType.note).toBe(3); // only the in-window one survives
    expect(oldestAnchorByType.wiki).toBeUndefined();
  });

  it('breaks same-ts ties by id (higher = newer) deterministically (R-12)', () => {
    const a = (ts: number, anchorId: number): ActivitySegment => ({
      type: 'note',
      ts,
      anchorId,
    });
    // Three note rows share ts=10; the comparator must order them by id desc
    // regardless of input order, so the oldest-in-window anchor is stable.
    const order = (perType: ActivitySegment[][]) =>
      mergeRecentActivity(perType, 100).recent.map(s => s.anchorId);
    expect(order([[a(10, 1), a(10, 3), a(10, 2)]])).toEqual([3, 2, 1]);
    // Same set, shuffled input → identical output (determinism).
    expect(order([[a(10, 2)], [a(10, 1)], [a(10, 3)]])).toEqual([3, 2, 1]);
    // …and the per-type oldest anchor is the lowest id of the tied batch.
    expect(
      mergeRecentActivity([[a(10, 3), a(10, 1), a(10, 2)]], 100)
        .oldestAnchorByType.note,
    ).toBe(1);
  });
});

describe('suspiciousPostsUrl', () => {
  it('builds an id: list scoped to status:any with a 200 page size + oldest anchor', () => {
    // input is newest-first, so the last id (99) is the oldest flagged post.
    expect(suspiciousPostsUrl([42, 99])).toBe(
      `/posts?tags=${encodeURIComponent('id:42,99 status:any')}&limit=200#post_99`,
    );
  });

  it('dedupes and drops non-positive ids', () => {
    expect(suspiciousPostsUrl([5, 5, 0, -1, 6])).toBe(
      `/posts?tags=${encodeURIComponent('id:5,6 status:any')}&limit=200#post_6`,
    );
  });

  it('returns undefined for an empty list so the caller can fall back', () => {
    expect(suspiciousPostsUrl([])).toBeUndefined();
    expect(suspiciousPostsUrl([0, -2])).toBeUndefined();
  });

  it('caps the id list at 200', () => {
    const ids = Array.from({length: 250}, (_, i) => i + 1);
    const url = suspiciousPostsUrl(ids)!;
    const tagsPart = url.split('tags=')[1].split('&')[0];
    const decoded = decodeURIComponent(tagsPart);
    const list = decoded.replace('id:', '').replace(' status:any', '');
    expect(list.split(',')).toHaveLength(200);
  });
});

describe('filterUploadCoupledCommentary', () => {
  const cseg = (postId: number, ts: number): CommentarySegment => ({
    type: 'commentary',
    postId,
    ts,
  });

  it('drops the v1 commentary created at upload time (ts === post.created_at)', () => {
    const out = filterUploadCoupledCommentary(
      [cseg(100, 1_000_000)],
      new Map([[100, 1_000_000]]),
    );
    expect(out).toEqual([]);
  });

  it('keeps a commentary the user added shortly after upload (> epsilon)', () => {
    const uploadedAt = 1_000_000;
    const out = filterUploadCoupledCommentary(
      [cseg(100, uploadedAt + COMMENTARY_UPLOAD_EPSILON_MS + 1)],
      new Map([[100, uploadedAt]]),
    );
    expect(out).toEqual([{type: 'commentary', ts: uploadedAt + 1001}]);
  });

  it('drops within the epsilon window on either side', () => {
    const uploadedAt = 5_000_000;
    const out = filterUploadCoupledCommentary(
      [
        cseg(1, uploadedAt + COMMENTARY_UPLOAD_EPSILON_MS), // boundary kept-in
        cseg(2, uploadedAt - COMMENTARY_UPLOAD_EPSILON_MS), // boundary kept-in
      ],
      new Map([
        [1, uploadedAt],
        [2, uploadedAt],
      ]),
    );
    expect(out).toEqual([]); // both within (<=) epsilon → dropped
  });

  it("keeps segments whose post is unknown (not the user's own upload)", () => {
    const out = filterUploadCoupledCommentary(
      [cseg(999, 7_000_000)],
      new Map(), // post_id not present → genuine commentary edit
    );
    expect(out).toEqual([{type: 'commentary', ts: 7_000_000}]);
  });

  it('strips postId from kept segments (ready for the merged feed)', () => {
    const [kept] = filterUploadCoupledCommentary([cseg(1, 42)], new Map());
    expect(kept).toEqual({type: 'commentary', ts: 42});
    expect('postId' in kept).toBe(false);
  });

  it('keeps a re-edit (v2) far from upload but drops the coupled v1', () => {
    const uploadedAt = 1_700_000_000_000;
    const out = filterUploadCoupledCommentary(
      [
        cseg(50, uploadedAt), // v1 at upload → drop
        cseg(50, uploadedAt + 86_400_000), // v2 a day later → keep
      ],
      new Map([[50, uploadedAt]]),
    );
    expect(out).toEqual([{type: 'commentary', ts: uploadedAt + 86_400_000}]);
  });
});

describe('isSuspiciousUpload', () => {
  it('flags a heavily-downvoted post (score <= -3) → red', () => {
    expect(isSuspiciousUpload({score: -3})).toBe(true);
    expect(isSuspiciousUpload({score: -10})).toBe(true);
  });

  it('does not flag a post with an acceptable score', () => {
    expect(isSuspiciousUpload({score: -2})).toBe(false);
    expect(isSuspiciousUpload({score: 0})).toBe(false);
    expect(isSuspiciousUpload({score: 50})).toBe(false);
  });
});

describe('isMintagged', () => {
  it('flags an upload whose uploader added few tags (<= 10) → orange', () => {
    expect(isMintagged({uploaderTagCount: 0})).toBe(true);
    expect(isMintagged({uploaderTagCount: 2})).toBe(true);
    expect(isMintagged({uploaderTagCount: 10})).toBe(true);
  });

  it('does not flag a well-tagged upload', () => {
    expect(isMintagged({uploaderTagCount: 11})).toBe(false);
    expect(isMintagged({uploaderTagCount: 40})).toBe(false);
  });

  it('does not flag when the uploader tag count is unknown (fail-open)', () => {
    // The post_versions lookup missed — don't mass-flag on missing data.
    expect(isMintagged({uploaderTagCount: undefined})).toBe(false);
  });
});

describe('buildMintagVersionsUrl', () => {
  it('queries first-version uploads by updater id, trimmed to mintag fields', () => {
    const url = buildMintagVersionsUrl('42', 10);
    expect(url).toContain('/post_versions.json?');
    expect(url).toContain('search[is_new]=true');
    expect(url).toContain('search[updater_id]=42');
    expect(url).toContain('&limit=10');
    expect(url).toContain('&only=post_id,added_tags');
  });
});

describe('buildUploaderTagCounts', () => {
  it('maps post_id → added_tags length', () => {
    const map = buildUploaderTagCounts([
      {post_id: 1, added_tags: ['a', 'b', 'c']},
      {post_id: 2, added_tags: []},
    ]);
    expect(map.get(1)).toBe(3);
    expect(map.get(2)).toBe(0); // a real 0 (uploader added nothing) is kept
  });

  it('skips rows missing post_id or added_tags (leaves count unknown)', () => {
    const map = buildUploaderTagCounts([
      {added_tags: ['a']}, // no post_id
      {post_id: 5}, // no added_tags
      {post_id: 6, added_tags: ['x', 'y']},
    ]);
    expect(map.has(5)).toBe(false);
    expect(map.get(6)).toBe(2);
    expect(map.size).toBe(1);
  });
});

describe('buildPostVersionsUrl', () => {
  it('lists one post’s version history, trimmed to version + timestamps', () => {
    const url = buildPostVersionsUrl(123);
    expect(url).toContain('/post_versions.json?');
    expect(url).toContain('search[post_id]=123');
    expect(url).toContain('&only=version,updated_at,created_at');
    expect(url).toContain('&limit=100');
  });
});

describe('abandonedGapMs', () => {
  const v = (version: number, ts: string) => ({version, created_at: ts});

  it('returns the v2 − v1 gap in ms', () => {
    const gap = abandonedGapMs([
      v(1, '2024-01-01T00:00:00Z'),
      v(2, '2024-01-01T00:20:00Z'),
    ]);
    expect(gap).toBe(20 * 60 * 1000);
  });

  it('prefers updated_at over created_at', () => {
    const gap = abandonedGapMs([
      {version: 1, created_at: '2024-01-01T00:00:00Z'},
      {
        version: 2,
        updated_at: '2024-01-01T00:10:00Z',
        created_at: '2024-01-01T05:00:00Z',
      },
    ]);
    expect(gap).toBe(10 * 60 * 1000); // from updated_at, not created_at
  });

  it('returns null when v1 or v2 is missing, or a timestamp is unparseable', () => {
    expect(abandonedGapMs([v(1, '2024-01-01T00:00:00Z')])).toBeNull();
    expect(abandonedGapMs([v(2, '2024-01-01T00:00:00Z')])).toBeNull();
    expect(
      abandonedGapMs([v(1, 'not-a-date'), v(2, '2024-01-01T00:20:00Z')]),
    ).toBeNull();
  });
});

describe('isAbandonedByGap', () => {
  const V1_MS = Date.parse('2024-01-01T00:00:00Z');
  const pair = (gapMs: number) => [
    {version: 1, created_at: '2024-01-01T00:00:00Z'},
    {version: 2, created_at: new Date(V1_MS + gapMs).toISOString()},
  ];

  it('flags a gap at/above the threshold (left under-tagged, others fixed it)', () => {
    expect(isAbandonedByGap(pair(ABANDONED_GAP_MS))).toBe(true);
    expect(isAbandonedByGap(pair(ABANDONED_GAP_MS + 60_000))).toBe(true);
  });

  it('does not flag a sub-threshold gap (the competitive-tagging race)', () => {
    expect(isAbandonedByGap(pair(ABANDONED_GAP_MS - 60_000))).toBe(false);
    expect(isAbandonedByGap(pair(0))).toBe(false);
  });

  it('does not flag when v1/v2 are missing (fail-open)', () => {
    expect(
      isAbandonedByGap([{version: 1, created_at: '2024-01-01T00:00:00Z'}]),
    ).toBe(false);
  });
});

describe('activityTypeIndexUrl', () => {
  const user = {name: 'Akari P', id: '42'};

  it('uploads/suspicious key off the user name (tags=user:, normalized)', () => {
    expect(activityTypeIndexUrl('upload', user)).toBe(
      `/posts?tags=${encodeURIComponent('user:Akari_P')}&limit=200`,
    );
    expect(activityTypeIndexUrl('suspicious', user)).toBe(
      `/posts?tags=${encodeURIComponent('user:Akari_P status:deleted')}&limit=200`,
    );
  });

  it('version/feed types key off the numeric id', () => {
    expect(activityTypeIndexUrl('edit', user)).toBe(
      '/post_versions?search[is_new]=false&search[updater_id]=42&limit=200',
    );
    expect(activityTypeIndexUrl('note', user)).toBe(
      '/note_versions?search[updater_id]=42&limit=200',
    );
    expect(activityTypeIndexUrl('forum', user)).toBe(
      '/forum_posts?search[creator_id]=42&limit=200',
    );
    expect(activityTypeIndexUrl('approval', user)).toBe(
      '/post_approvals?search[user_id]=42&limit=200',
    );
    expect(activityTypeIndexUrl('comment', user)).toContain('group_by=comment');
  });

  it('appends &limit=200 so the whole window fits one page', () => {
    expect(activityTypeIndexUrl('note', user)).toContain('&limit=200');
    expect(activityTypeIndexUrl('upload', user)).toContain('&limit=200');
  });

  it('appends a #-scroll anchor for the oldest in-window id', () => {
    // post gallery + comments use an underscore; *_versions use dashes
    // (both measured live — see ANCHOR_PREFIX).
    expect(activityTypeIndexUrl('upload', user, 555)).toBe(
      `/posts?tags=${encodeURIComponent('user:Akari_P')}&limit=200#post_555`,
    );
    expect(activityTypeIndexUrl('note', user, 777)).toBe(
      '/note_versions?search[updater_id]=42&limit=200#note-version-777',
    );
    expect(activityTypeIndexUrl('edit', user, 888)).toContain(
      '#post-version-888',
    );
    expect(activityTypeIndexUrl('comment', user, 12)).toContain('#comment_12');
  });

  it('omits the anchor when no id is supplied or it is non-positive', () => {
    expect(activityTypeIndexUrl('note', user)).not.toContain('#');
    expect(activityTypeIndexUrl('note', user, 0)).not.toContain('#');
  });

  it('returns undefined when the required identifier is missing', () => {
    expect(activityTypeIndexUrl('edit', {name: 'x'})).toBeUndefined(); // no id
    expect(activityTypeIndexUrl('upload', {id: '1'})).toBeUndefined(); // no name
    expect(
      activityTypeIndexUrl('upload', {name: null, id: null}),
    ).toBeUndefined();
  });
});

describe('classifyUploadType', () => {
  it('flags deleted or banned uploads as suspicious', () => {
    expect(classifyUploadType({isDeleted: true, score: 100})).toBe(
      'suspicious',
    );
    expect(classifyUploadType({isBanned: true, score: 100})).toBe('suspicious');
  });

  it('flags heavily-downvoted uploads as suspicious', () => {
    expect(classifyUploadType({score: -3})).toBe('suspicious');
    expect(classifyUploadType({score: -20})).toBe('suspicious');
  });

  it('keeps healthy uploads as upload', () => {
    expect(classifyUploadType({score: 5})).toBe('upload');
    expect(classifyUploadType({isDeleted: false, score: -2})).toBe('upload');
  });

  it('fails open: unknown meta stays upload (never mass-flags)', () => {
    expect(classifyUploadType(undefined)).toBe('upload');
  });
});

describe('classifyCommentType', () => {
  it('flags heavily-downvoted comments as suspicious', () => {
    expect(classifyCommentType(-3)).toBe('suspicious');
    expect(classifyCommentType(-9)).toBe('suspicious');
  });

  it('keeps healthy / unknown-score comments as comment', () => {
    expect(classifyCommentType(0)).toBe('comment');
    expect(classifyCommentType(10)).toBe('comment');
    expect(classifyCommentType(undefined)).toBe('comment');
  });
});

describe('balancedChunks', () => {
  it('returns [] for empty input or non-positive perRow', () => {
    expect(balancedChunks([], 80)).toEqual([]);
    expect(balancedChunks([1, 2, 3], 0)).toEqual([]);
    expect(balancedChunks([1, 2, 3], -5)).toEqual([]);
  });

  it('keeps everything in one row when it fits', () => {
    expect(balancedChunks([1, 2, 3, 4], 80)).toEqual([[1, 2, 3, 4]]);
  });

  it('balances 200 into 3 full rows (67/67/66), not 83/83/34', () => {
    const items = Array.from({length: 200}, (_, i) => i);
    const rows = balancedChunks(items, 80);
    expect(rows.map(r => r.length)).toEqual([67, 67, 66]);
  });

  it('uses the minimum rows and balances them (83 → 42/41)', () => {
    const items = Array.from({length: 83}, (_, i) => i);
    expect(balancedChunks(items, 80).map(r => r.length)).toEqual([42, 41]);
  });

  it('preserves order and loses no items', () => {
    const items = Array.from({length: 170}, (_, i) => i);
    const rows = balancedChunks(items, 80);
    expect(rows.flat()).toEqual(items); // order preserved, nothing dropped
    const sizes = rows.map(r => r.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });
});

describe('palette constants', () => {
  it('defines a hex colour for every activity type', () => {
    for (const type of ACTIVITY_TYPES) {
      expect(ACTIVITY_COLORS[type]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('uses a transparent border for active posts', () => {
    expect(STATUS_BORDER_COLORS.active).toBe('transparent');
  });
});

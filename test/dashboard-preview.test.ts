import {describe, it, expect} from 'vitest';
import {
  ACTIVITY_COLORS,
  ACTIVITY_TYPES,
  COMMENTARY_UPLOAD_EPSILON_MS,
  PREVIEW_POST_FIELDS,
  STATUS_BORDER_COLORS,
  activityTypeIndexUrl,
  balancedChunks,
  buildPreviewPostUrls,
  classifyCommentType,
  classifyUploadType,
  derivePostStatus,
  filterUploadCoupledCommentary,
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
    expect(preview.generalTags).toBe(0);
    expect(preview.status).toBe('active');
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
  it('flags a heavily-downvoted post (score <= -3)', () => {
    expect(isSuspiciousUpload({score: -3, generalTags: 30})).toBe(true);
    expect(isSuspiciousUpload({score: -10, generalTags: 30})).toBe(true);
  });

  it('flags an under-tagged post (generalTags <= 5)', () => {
    expect(isSuspiciousUpload({score: 100, generalTags: 5})).toBe(true);
    expect(isSuspiciousUpload({score: 100, generalTags: 0})).toBe(true);
  });

  it('does not flag a healthy post (good score and tags)', () => {
    expect(isSuspiciousUpload({score: -2, generalTags: 6})).toBe(false);
    expect(isSuspiciousUpload({score: 50, generalTags: 25})).toBe(false);
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

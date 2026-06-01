# API Endpoints

All API calls must go through `RateLimitedFetch`.

| Endpoint | Purpose |
|---|---|
| `/posts.json` | Fetch uploads (tags, only, limit, page) |
| `/post_approvals.json` | Fetch approvals (search params) |
| `/note_versions.json` | Fetch notes (search params) |
| `/counts/posts.json` | Count queries (integrity checks, rating counts) |
| `/related_tag.json` | Character/copyright distribution (category filter) |
| `/tag_implications.json` | Top-level tag detection. Single-tag: `search[antecedent_name_matches]=<name>`. Batched (v10+): `search[antecedent_name_comma]=t1,t2,...&limit=1000` — used by `TagAnalyticsDataService.fetchTopLevelTagsBatch` to collapse 20 candidates into one request |
| `/user_feedbacks.json` | Promotion/level change history |
| `/posts/random.json` | Random post fetch |
| `/posts/{id}.json` | Single post details (milestone thumbnails) |

## Mintag / abandoned detection (v9.7.1 — preview popover section A)

`AnalyticsDataManager.getRecentPostsPreview` fires a third parallel request alongside the recent-uploads + appeal fetches: `buildMintagVersionsUrl(userId, limit)` → `/post_versions.json?search[is_new]=true&search[updater_id]=<id>&only=post_id,added_tags`. `buildUploaderTagCounts` reduces it to `Map<post_id, added_tags.length>` — the number of tags *that uploader* added in the post's first version (not the post's current `tag_count_general`, which others inflate). A preview is **mintagged** (orange) when `uploaderTagCount ≤ 10` (`isMintagged`).

`AnalyticsDataManager.getAbandonedPostIds(postIds)` runs a background, non-blocking pass (`mapConcurrent`, concurrency 6) over the mintagged ids: `buildPostVersionsUrl(postId)` → `/post_versions.json?search[post_id]=<id>&only=version,updated_at,created_at&limit=100`. A post is **abandoned** (red, escalated from orange) when its `version===2` row lands `≥ 15 min` (`ABANDONED_GAP_MS`) after its `version===1` row (`isAbandonedByGap`); a v2 inside 15 min is treated as a tagging race and stays orange. Unparseable/missing v1 or v2 → not abandoned (fail-soft). The grid renders mintagged labels immediately; abandoned upgrades arrive later, guarded against stale popover generations.

## Activity distribution feed (v9.7.0 — preview popover section B)

`AnalyticsDataManager.getActivityDistribution` fans out one `&limit=200&only=id,updated_at,created_at` request per type via `mapConcurrent` and merges the most-recent 200. Timestamp = `updated_at ?? created_at` (version tables merge consecutive same-user edits onto `updated_at`).

| type | Endpoint | search param |
|---|---|---|
| upload | `/post_versions.json` | `search[updater_id]` + `search[is_new]=true` (the upload itself) |
| edit | `/post_versions.json` | `search[updater_id]` + `search[is_new]=false` (later tag/metadata edits) |
| note | `/note_versions.json` | `search[updater_id]` |
| wiki | `/wiki_page_versions.json` | `search[updater_id]` |
| artist | `/artist_versions.json` | `search[updater_id]` |
| commentary | `/artist_commentary_versions.json` | `search[updater_id]` |
| pool | `/pool_versions.json` | `search[updater_id]` |
| forum | `/forum_posts.json` | `search[creator_id]` |
| approval | `/post_approvals.json` | `search[user_id]` |
| comment | `/comments.json` | `search[creator_id]` |
| appeal | `/post_appeals.json` | `search[creator_id]` |

`approval`/`note` params match the existing grass `DataManager` usage. The `*_versions` tables follow Danbooru's `updater_id` convention; `forum`/`comment`/`appeal` use `creator_id`. Per-type failures degrade to `[]` so one dead endpoint never sinks the strip.

**Suspicious-activity re-typing (section B):** segments that look malicious are recolored to a separate `suspicious` category (near-black). Two sources:
- `upload`: fetched with `only=id,post_id,...`; their posts are batch-resolved via `/posts.json?tags=id:<csv> status:any&only=id,is_deleted,is_banned,score` and re-typed to `suspicious` when deleted/banned or `score ≤ -3` (`classifyUploadType`).
- `comment`: fetched with `only=id,post_id,score,created_at` and re-typed to `suspicious` when `score ≤ -3` (`classifyCommentType`).

Both fail open (a lookup miss / missing field leaves the segment in its normal category). `suspicious` is deliberately **not** named `flagged` to avoid clashing with Danbooru's `status:flagged`.

**Suspicious id: link-out:** a suspicious segment keeps the post behind it — the upload's own `post_id`, or (for a suspicious comment) the `post_id` the comment sits on. `mergeRecentActivity` dedupes these across the capped window into `ActivityDistribution.suspiciousPostIds`, and clicking the **Suspicious** legend item opens `/posts?tags=id:<csv> status:any&limit=200` (`suspiciousPostsUrl`, ids capped at 200) — the *exact* flagged posts, so the page matches the "Suspicious N" count (modulo comments that share a post). Falls back to the name-scoped `user:<name> status:deleted` search when no ids resolve. `status:any` is required so deleted/banned uploads — the whole point of the flag — still appear.

**Legend index links — `&limit=200` + oldest-row `#anchor`:** every `activityTypeIndexUrl` / `suspiciousPostsUrl` target appends `&limit=200` (= the activity window, `ACTIVITY_SEGMENT_LIMIT`) so the entire analysed window lands on one page, then appends a `#<prefix>_<id>` fragment that scrolls to the **oldest in-window** row (the boundary of what the strip analysed).

The scroll id is the oldest segment's `anchorId`: each fetch keeps a per-row id — `fetchActivityType` keeps `id` (the version/record id), `fetchUploadActivity` uses the post id, `fetchCommentActivity` uses the comment id, `fetchCommentaryActivity` uses the commentary-version id. `mergeRecentActivity` reduces these to `ActivityDistribution.oldestAnchorByType` (newest-first → last write per type = oldest). `suspicious` derives its anchor from the last (oldest) of `suspiciousPostIds`.

Anchor prefixes (`ANCHOR_PREFIX`, stored *with* their trailing separator) are **MEASURED on the live pages**. Two separator styles: the posts gallery and comments use an **underscore** — `post_<id>` (also confirmed by the LocateInGallery userscript; covers `upload`/`suspicious`) and `comment_<id>` — while every `*_versions` / feed table uses Rails' **dashed** dom_id: `post-version-`, `note-version-`, `wiki-page-version-`, `artist-version-`, `artist-commentary-version-`, `pool-version-`, `forum-post-`, `post-approval-`, `post-appeal-` (all `<…>-<id>`). A non-matching fragment is ignored by the browser (fail-soft: the page still opens at the top with the whole window present).

**Commentary upload-coupling filter:** uploading a post *with* commentary auto-creates a v1 `ArtistCommentaryVersion` in the same transaction (its `created_at` ≈ the post's upload time), which would double-count the upload as commentary. `getActivityDistribution` fetches `post_id` for the commentary versions, batch-resolves those posts' upload times (`/posts.json?tags=id:<csv> status:any&only=id,created_at`), and drops any commentary segment within 1s of its post's upload (`filterUploadCoupledCommentary`, `COMMENTARY_UPLOAD_EPSILON_MS`).

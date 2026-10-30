# API Endpoints

All API calls must go through `RateLimitedFetch`.

| Endpoint | Purpose |
|---|---|
| `/posts.json` | Fetch uploads (tags, only, limit, page) |
| `/post_approvals.json` | Fetch approvals (search params) |
| `/note_versions.json` | Fetch notes (search params) |
| `/counts/posts.json` | Count queries (integrity checks, rating counts) |
| `/related_tag.json` | Character/copyright distribution (category filter) |
| `/tag_implications.json` | Top-level tag detection. Single-tag: `search[antecedent_name_matches]=<name>`. Batched (v10+): `search[antecedent_name_comma]=t1,t2,...&limit=1000` — used by `getTopLevelFlags` in `core/top-level-tags.ts` (50 names per request, cached 180d in `tag_implications_cache`) — shared by tag pages and the user dashboard's character / copyright / fav-copyright pies, which used to fire one single-tag request per candidate |
| `/user_feedbacks.json` | Promotion/level change history |
| `/posts/random.json` | Random post fetch |
| `/posts/{id}.json` | Single post details (milestone thumbnails) |

## Search tag limit (Member 2-tag)

A post search by a **Member** (blue) account may use at most **2 tags**; Gold+ has a higher limit. The limit follows the *viewer* running the script, not the user being analysed, so every query must fit 2 tags. Over the limit Danbooru answers **422** (an error page for click-through links). Count fetches treat a 422 as deterministic: no retry, nothing cached as lost (`countBatch`).

**What counts (v8.0.3 rule, from [forum #33823](https://danbooru.donmai.us/forum_topics/33823)):** search **metatags** are free —

```
user:  rating:  status:  order:  date:  age:  id:
has:   is:      fav:     ordfav: limit: source:
gentags:  copytags:  chartags:  arttags:
```

— and every **tag name** counts, Meta-category tags included (the original note names `1girl`, `commentary`, `translated`). `~` OR terms and `-` negations count one each.

How the code stays within it:
- **Gender pies**: `~1girl ~2girls … ~6+girls` (6 tags) is split into one single-tag count per term and summed; `DistributionItem.originalTag` keeps the OR query for the click-through link, which 422s on Member accounts (v8.0.3).
- **Translation "Untagged"**: computed by inclusion-exclusion over 6 queries of ≤ 2 tags each (`computeUntaggedTranslation`, `buildUntaggedTranslationQueries`), instead of one 4-tag negation query (v8.0.3, reused tag-side in v9.6.3).
- **Suspicious upload tags** (`SUSPICIOUS_UPLOAD_TAGS`): matched client-side on `tag_string_meta` inside the existing `id:<csv> status:any` lookup (both metatags, so 0 tags), never as a 4-term `~` search.

**Open question (2026-10-30):** the maintainer recalled that Meta-category tags (e.g. `ai-generated`, `translated`) do *not* count toward the limit, which contradicts the v8.0.3 rule above. Unverified — the dev container cannot reach Danbooru. To settle it, run `~off-topic ~third-party_edit ~ai-generated ~pixel-perfect_duplicate` (4 Meta-category tags) from a Member account: a 422 confirms the v8.0.3 rule; results mean Meta-category tags are free, and this section, the `SUSPICIOUS_UPLOAD_TAGS` comment in `core/dashboard-preview.ts` and possibly the Translation decomposition can be simplified. Until then, write new queries to the stricter v8.0.3 rule.

## Mintag / abandoned detection (v9.7.1 — preview popover section A)

`AnalyticsDataManager.getRecentPostsPreview` fires a third parallel request alongside the recent-uploads + appeal fetches: `buildMintagVersionsUrl(userId, limit)` → `/post_versions.json?search[is_new]=true&search[updater_id]=<id>&only=post_id,added_tags`. `buildUploaderTagCounts` reduces it to `Map<post_id, added_tags.length>` — the number of tags *that uploader* added in the post's first version (not the post's current `tag_count_general`, which others inflate). A preview is **mintagged** (orange) when `uploaderTagCount ≤ 10` (`isMintagged`).

`AnalyticsDataManager.getAbandonedPostIds(postIds)` runs a background, non-blocking pass (`mapConcurrent`, concurrency 6) over the mintagged ids: `buildPostVersionsUrl(postId)` → `/post_versions.json?search[post_id]=<id>&only=version,updated_at,created_at&limit=100`. A post is **abandoned** (red, escalated from orange) when its `version===2` row lands `≥ 15 min` (`ABANDONED_GAP_MS`) after its `version===1` row (`isAbandonedByGap`); a v2 inside 15 min is treated as a tagging race and stays orange. Unparseable/missing v1 or v2 → not abandoned (fail-soft). The grid renders mintagged labels immediately; abandoned upgrades arrive later, guarded against stale popover generations.

## Profile summary — "At a glance" (v9.11.1)

Pure builder: `buildProfileSummary(input, now, scope)` in `src/core/profile-summary.ts`; rendering in `src/ui/profile-summary-view.ts` (DOM nodes only).

- **Dashboard card (`scope: 'lifetime'`) makes no extra requests.** Input = local `posts` (the scatter data, or one `getScatterData` cursor pass under the scatter gate) + the already-loaded `status_dist` / `copyright_dist` / `character_dist` (assembled by `assembleProfileSummaryInput`). A `status_dist` revalidate (`DanbooruInsights:DataUpdated`) re-renders the card in place.
- **Popover section (`scope: 'recent'`)**: `AnalyticsDataManager.getRecentUploadWindow` → `/posts.json?tags=user:<name>&limit=200&only=id,created_at,score,tag_count_general,rating,is_pending,is_flagged,is_deleted,is_banned,tag_string_copyright,tag_string_character`, cached in piestats `recent_window` with the count-cache TTL (failures/empties not cached). Baselines come from local posts and the *cached* pies only (`buildRecentSummaryInput`) — no other network. Never-synced users get the window's own health without comparisons.
- **No `status:` metatag needed**: Danbooru's default post search *includes* deleted posts (verified 2026-10-18 — `user:X` count equals `user:X status:any`, and a status-less listing returns `is_deleted: true` rows). `status:any` only matters for the HTML thumbnail display.
- Thresholds (constants at the top of `profile-summary.ts`): deletion 10% / 23% (UploadLimit break-even at ~25 slots / ≤15 slots), early deletion = within 3 days (`moderation_period`, 5 upload slots each), untagged ≤3 / under-tagged <10 general tags after a 15-minute grace (`ABANDONED_GAP_MS`), downvoted = score ≤ −3 (`SUSPICIOUS_SCORE_MAX`), score comparisons skip uploads younger than 7 days.

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
- `upload`: fetched with `only=id,post_id,...`; their posts are batch-resolved via `/posts.json?tags=id:<csv> status:any&only=id,is_deleted,is_flagged,score,tag_string_meta` and re-typed to `suspicious` when deleted, flagged, tagged with any of `SUSPICIOUS_UPLOAD_TAGS` (`off-topic`, `third-party_edit`, `ai-generated`, `pixel-perfect_duplicate`), or `score ≤ -3` (`classifyUploadType`). **Banned is not a signal**: Danbooru bans a post at the artist's request (takedown), which says nothing about the uploader. All four are Meta-category tags, so they are matched client-side on `tag_string_meta` in that same lookup: no extra request, and the check works whatever the viewer's tag limit (see **Search tag limit** below). A `~a ~b ~c ~d` OR search would cost a second request and may exceed a Member's limit. A tag added to the list must be Meta-category too, or the lookup must switch to the full `tag_string`.
- `comment`: fetched with `only=id,post_id,score,created_at` and re-typed to `suspicious` when `score ≤ -3` (`classifyCommentType`).

Both fail open (a lookup miss / missing field leaves the segment in its normal category). `suspicious` is deliberately **not** named `flagged` to avoid clashing with Danbooru's `status:flagged`.

**Suspicious id: link-out:** a suspicious segment keeps the post behind it — the upload's own `post_id`, or (for a suspicious comment) the `post_id` the comment sits on. `mergeRecentActivity` dedupes these across the capped window into `ActivityDistribution.suspiciousPostIds`, and clicking the **Suspicious** legend item opens `/posts?tags=id:<csv> status:any&limit=200` (`suspiciousPostsUrl`, ids capped at 200) — the *exact* flagged posts, so the page matches the "Suspicious N" count (modulo comments that share a post). Falls back to the name-scoped `user:<name> status:deleted` search when no ids resolve. `status:any` is required so deleted uploads — the strongest signal — still appear.

**Legend index links — `&limit=200` + oldest-row `#anchor`:** every `activityTypeIndexUrl` / `suspiciousPostsUrl` target appends `&limit=200` (= the activity window, `ACTIVITY_SEGMENT_LIMIT`) so the entire analysed window lands on one page, then appends a `#<prefix>_<id>` fragment that scrolls to the **oldest in-window** row (the boundary of what the strip analysed).

The scroll id is the oldest segment's `anchorId`: each fetch keeps a per-row id — `fetchActivityType` keeps `id` (the version/record id), `fetchUploadActivity` uses the post id, `fetchCommentActivity` uses the comment id, `fetchCommentaryActivity` uses the commentary-version id. `mergeRecentActivity` reduces these to `ActivityDistribution.oldestAnchorByType` (newest-first → last write per type = oldest). `suspicious` derives its anchor from the last (oldest) of `suspiciousPostIds`.

Anchor prefixes (`ANCHOR_PREFIX`, stored *with* their trailing separator) are **MEASURED on the live pages**. Two separator styles: the posts gallery and comments use an **underscore** — `post_<id>` (also confirmed by the LocateInGallery userscript; covers `upload`/`suspicious`) and `comment_<id>` — while every `*_versions` / feed table uses Rails' **dashed** dom_id: `post-version-`, `note-version-`, `wiki-page-version-`, `artist-version-`, `artist-commentary-version-`, `pool-version-`, `forum-post-`, `post-approval-`, `post-appeal-` (all `<…>-<id>`). A non-matching fragment is ignored by the browser (fail-soft: the page still opens at the top with the whole window present).

**Commentary upload-coupling filter:** uploading a post *with* commentary auto-creates a v1 `ArtistCommentaryVersion` in the same transaction (its `created_at` ≈ the post's upload time), which would double-count the upload as commentary. `getActivityDistribution` fetches `post_id` for the commentary versions, batch-resolves those posts' upload times (`/posts.json?tags=id:<csv> status:any&only=id,created_at`), and drops any commentary segment within 1s of its post's upload (`filterUploadCoupledCommentary`, `COMMENTARY_UPLOAD_EPSILON_MS`).

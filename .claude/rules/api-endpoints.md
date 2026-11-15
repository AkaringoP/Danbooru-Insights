# API Endpoints

All API calls must go through `RateLimitedFetch`.

| Endpoint | Purpose |
|---|---|
| `/posts.json` | Fetch uploads (tags, only, limit, page). The syncs, the fields backfill and the change catch-up all ask for `SYNC_POST_FIELDS` (`core/post-record.ts`). Fields backfill (T-403): `user:X status:any id:a..b order:id`. Change catch-up (T-407): `user:X order:change` (newest `updated_at` first; 2 terms, fine for a logged-out viewer), numbered pages within the page limit. First-post lookup before a sync from the start (T-508): `user:X order:id date:>=<day before joining>&limit=1&only=id` — never `user:X order:id id:>0`, which times out for accounts whose posts start far into the id range |
| `/post_approvals.json` | Fetch approvals (search params) |
| `/note_versions.json` | Fetch notes (search params) |
| `/counts/posts.json` | Count queries (integrity checks, rating counts). Server rate limit 1 req/s, burst 15, and the search tag limit applies (both since 2026-11-05). A count the server cannot finish in time comes back as `{"counts":{"posts":null}}` with HTTP 200, and that `null` is cached server-side for 5 minutes; `fetchRemoteCount` throws `CountUnavailableError` for it (never 0), and `countBatch` does not retry it |
| `/reports/posts.json` | Tag page uploader / approver rankings (`fetchReportRanking`: `search[tags]`, `search[group]`, `search[from]`, `search[to]`). Also supports `search[period]=day…year` time series and `search[group]=rating` / `is_deleted`. Server rate limit 1 req / 3 s, burst 15. Time buckets are UTC (`date_trunc`). `from` / `to` are cut to dates and compared with `BETWEEN`, so `to` reaches only 00:00 of its day: ask for a later `to` to include today. A `period` reply is an array `[{date: "YYYY-MM-DD", posts: n}]`, newest first, with every bucket from `from` to `to` present (0 when empty; at most 2000 buckets). Monthly history helpers: `core/monthly-report.ts` (`ReportsController#show`, `Aggregatable#timeseries`, checked 2026-11-13). A `group` reply without `period` is `[{<group>: value, posts: n}]`, one row per value that has posts; `from` defaults to a month ago, so always send it. Tag pages read ratings (`group=rating`) and deleted / not deleted (`group=is_deleted`) this way (`parseGroupReport`, T-306) |
| `/related_tag.json` | Character/copyright distribution (category filter). Server rate limit 1 req/s, burst 30 |
| `/tag_implications.json` | Top-level tag detection. Single-tag: `search[antecedent_name_matches]=<name>`. Batched (v10+): `search[antecedent_name_comma]=t1,t2,...&limit=1000` — used by `getTopLevelFlags` in `core/top-level-tags.ts` (50 names per request, cached 180d in `tag_implications_cache`) — shared by tag pages and the user dashboard's character / copyright / fav-copyright pies, which used to fire one single-tag request per candidate |
| `/user_feedbacks.json` | Promotion/level change history |
| `/posts/random.json` | Random post fetch |
| `/posts/{id}.json` | Single post details (hover cards) |

**Thumbnails (T-506, decision G-3).** A post's image sizes come under `media_asset` when asked as `only=…,media_asset[variants]` (verified 2026-11-16: `180x180` jpg, `360x360` jpg, `720x720` webp, `sample`, `original`, each with `type, url, width, height, file_ext`); Danbooru has no top-level `variants` field, though the code asked for one in 14 places until T-506. Only the single-post cards ask for the sizes (single post, user milestones, top posts, recent popular, random, the tag page's latest, trending and milestones) and show the 720 webp (`getBestThumbnailUrl`). Lists, the syncs, pie slice thumbnails (an 80px tooltip) and the preview grid (180px cells) ask for `preview_file_url` only, or nothing.

## Search tag limit

A post search may use at most **N terms**, where N follows the *viewer* running the script, not the user being analysed: **anonymous 2, Member 3, Gold and above unlimited** (since 2026-11-10 — `User.tag_query_limit` in `app/models/user.rb`, Danbooru `production` branch; Member was 2 before). Over the limit Danbooru answers **422** ("You cannot search for more than N tags at a time"; an error page for click-through links). `/counts/posts.json` enforces it too since 2026-11-05. Count fetches treat a 422 as deterministic: no retry, nothing cached as lost (`countBatch`). The viewer's level is on the page as `<body data-current-user-level>` (0 anonymous, 20 Member, 30 Gold).

**What counts** (`PostQuery#term_count`, `app/logical/post_query.rb`): every tag name, every wildcard, and every metatag **except** these free ones (`UNLIMITED_METATAGS`):

```
status  rating  limit  is  id  date  age  filesize  filetype  parent  child  md5
width  height  duration  mpixels  ratio  score  upvote  downvotes  favcount
embedded  tagcount  pixiv_id  pixiv
```

So **`user:`, `order:`, `has:`, `fav:`, `ordfav:`, `source:` and the `gentags:`-style category counts cost one term each**. Tag names count one each, Meta-category tags included; `~` OR terms and `-` negations count one each. An empty search and a single plain tag are never checked.

Verified live as anonymous (limit 2) in the 2026-11-12 audit: `user:X 1girl` → 200, `user:X 1girl solo` → 422, `user:X 1girl status:deleted` → 200, `user:X 1girl has:commentary` → 422, `user:X gentags:<10 1girl` → 422.

**Where the current queries stand:**

| Query | Terms | Anonymous | Member | Gold+ |
|---|---|---|---|---|
| `user:X <tag>`, `user:X gentags:<10`, `user:X status:<s>`, `user:X rating:<r>`, `user:X order:score …` (free metatags only) | ≤ 2 | ok | ok | ok |
| Gender pies: `~1girl ~2girls … ~6+girls` split into one `user:X <term>` count per term and summed (v8.0.3) | 2 | ok | ok | ok |
| Translation "Untagged": inclusion-exclusion (`buildUntaggedTranslationQueries`); 4 of its 6 queries are `user:X <a> <b>` | 3 | not sent, 🔒 (T-408) | ok | ok |
| Hair "Bald": `user:X ~bald ~bald_female` | 3 | not sent, 🔒 (T-408) | ok | ok |
| Commentary "Untagged" (T-408, G-5): `user:X has:commentary` − `user:X has:commentary commentary` − `user:X has:commentary commentary_request` (`buildUntaggedCommentaryQueries`). Was one 4-term search, a 422 below Gold | 3 | not sent, 🔒 | ok | ok |
| Pie slice thumbnails (`enrichThumbnails`): `user:X <tag> order:score rating:g` (`fav:X …` for fav-copyright) | 3 | **422** | ok | ok |
| … the Hair "Bald" slice's thumbnail: `user:X ~bald ~bald_female order:score rating:g` | 4 | **422** | **422** | ok |
| Tag page commentary: `<tag> has:commentary commentary` / `… commentary_request`; tag-side translation inclusion-exclusion | 3 | not sent, 🔒 (T-308) | ok | ok |
| Suspicious upload tags: matched client-side on `tag_string_meta` inside the `id:<csv> status:any` lookup, never as a 4-term `~` search | 0 | ok | ok | ok |

**How a lost count shows (v9.12, T-204).** In the user dashboard's Commentary, Translation and Hair length pies, a count that comes back 422, `null` or lost after its retry becomes an `unknown` slice (`DistributionItem.unknown`): the legend shows "—" with an explanation and the slice takes no share of the pie. Translation's "Untagged" is not computed when any of its six terms is missing. A 422 run is cached (it would 422 again); a `null` or lost count is not (`countBatch` → `cacheUnlessPartial`).

**Locked slices (T-408).** Before sending, the user side's Commentary, Translation and Hair length pies check each slice's searches with `fitsViewerTagLimit`; a slice over the viewer's limit is not asked and becomes `unknown` + `locked` (`DistributionItem.locked`): the legend shows "🔒" with "Log in to see it", the slice takes no share. Only an anonymous viewer (limit 2) meets it today — Commentary and Translation "Untagged" and Hair "Bald"; a Member (3) runs them all. A locked run is cached like a 422 run (piestats TTL).

**Tag page (v9.12, T-308).** `fetchCountWithRetry` gives `null`, never 0, for a count it cannot have: a 422 or other 4xx and a `null` count are not retried, a 429 / 5xx / network failure is retried once, and a search over the viewer's limit is not sent (`fitsViewerTagLimit`). The pies' counts are `TagCountMap` (`number | null`); an unknown slice is listed with "—", a locked one with "🔒" (`buildPieSlices`), neither takes a share. For an anonymous viewer the commentary pie asks nothing (its breakdowns are 3 tags; `total` alone shows nothing) and translation asks only Translated and Requested.

`fetchRemoteCount` throws `CountUnavailableError` on a `null` count instead of returning 0, so every caller treats it as a failure: the Grass integrity check skips (it used to wipe the year), `getTotalPostCount` falls back to the profile, `getUserStats` keeps its previous value.

Pie slice thumbnails over the viewer's limit are not requested at all (`fitsViewerTagLimit` in `core/search-terms.ts`, which counts terms like `PostQuery#term_count` and reads `<body data-current-user-level>`): an anonymous viewer gets no pie thumbnails, a Member none for Hair "Bald".

**Known over-limit click-through links (intentional since v8.0.3).** Some pie-slice links keep the full conceptual query (`buildSearchQuery` in `apps/user-analytics-pie-helpers.ts`), so a viewer below the limit lands on the Search Error page; Gold+ get the real search:
- Gender slices: `user:X ~1girl ~2girls ~3girls ~4girls ~5girls ~6+girls` (7 terms; same for boys / others), via `DistributionItem.originalTag`.
- Translation "Untagged" slice: `user:X *_text -english_text -translation_request -translated` (5 terms).
- Commentary "Untagged" slice: `user:X has:commentary -commentary -commentary_request` (4 terms) — the count now comes from three smaller searches (T-408), the link keeps the one search that shows those posts. The Hair "Bald" slice: 3 terms.

**History:**
- Before 2026-11-05 `/counts/posts.json` did not check the tag limit at all, which is why queries designed under the wrong rule below still returned numbers.
- The v8.0.3 rule (from [forum #33823](https://danbooru.donmai.us/forum_topics/33823)) treated `user:`, `order:`, `has:`, `fav:`, `ordfav:`, `source:` and `gentags:`-style metatags as free. That list was wrong: only the `UNLIMITED_METATAGS` above are free.
- On 2026-10-30 a Member-account test confirmed Meta-category tags count: `~off-topic ~third-party_edit ~ai-generated ~pixel-perfect_duplicate` → "Search Error — You cannot search for more than 2 tags at a time." Commit `480cab4` briefly stated the opposite in comments; `e0bbb0c` and the next docs commit corrected it.
- 2026-11-10: Member limit raised 2 → 3, anonymous set to 2, Gold aligned with Platinum (unlimited).

## Posts the viewer cannot see

A banned post is hidden from viewers below Approver, and a post with a restricted tag from viewers below Gold (its uploader excepted); `Post#visible?` in `app/models/post.rb`. Such a post **stays in search results**, and `PostPolicy#api_attributes` drops only `md5`, `file_url`, `large_file_url` and `preview_file_url` from its JSON. An `only=` naming them just leaves them out. Every other field still comes back, including the tag strings, `rating`, `tag_count*` and the status flags.

Verified live 2026-11-15: `user:X status:banned` with `only=id,is_banned,rating,tag_count_general,tag_string_character,tag_string_copyright,preview_file_url` returned the banned posts with their tags and rating, and without `preview_file_url`.

So the sync stores these posts with full tags, and the local pies (T-406) count them the same way `/counts/posts.json` does. Only their thumbnail is missing: `getBestThumbnailUrl` returns `''`. The milestone lookup (`getMilestones`) stores `variants: []` on such a row, so it does not ask again until a sync rewrites the row (T-506).

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

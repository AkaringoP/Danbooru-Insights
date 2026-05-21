# Sync Strategies

## Grass Sync (DataManager — uploads/approvals/notes)
- **Incremental**: Start from last cached date minus 3-day safety buffer
- **Integrity check**: For past years, compare remote count vs local sum; force re-fetch on mismatch
- **Completion cache**: Mark past years as complete to skip future fetches
- **Batch**: 200 items/page, 5 concurrent pages, exponential backoff on 429/5xx

## User Analytics Sync (AnalyticsDataManager)
- **Quick Sync** (`quickSyncAllPosts`): For users with ≤1200 total posts. Sequential cursor-based pagination. Auto-triggered in `renderDashboard()`.
- **Full Sync** (`syncAllPosts`): For large users. Standard pagination with retry, streaming iteration for memory efficiency.
- Both strategies store posts in IndexedDB and call `refreshAllStats()` to populate the piestats cache.
- **Quota-safe writes (v9.4)**: bulk inserts on `posts` go through `bulkPutSafe()` from [src/core/quota-manager.ts](../../src/core/quota-manager.ts). On `QuotaExceededError` (or `AbortError` whose `.inner` resolves to one), `evictOldestNonCurrentUser(db, currentUserId)` deletes the least-recently-synced non-current user's posts/piestats and the bulk write retries once. The current user's data is never evicted. Writes inside `db.transaction(...)` keep the raw `bulkPut` (e.g. Grass uploads/approvals/notes) — wrapping there would risk `PrematureCommitError`.
- **Persistent storage opt-in (v9.4)**: After the first successful Quick/Full sync completion, `requestPersistence()` calls `navigator.storage.persist()` (idempotent via the `di.persist.requested` localStorage flag). Lifts Safari ITP eviction and Chrome heuristic eviction risk for users who actually engaged with the dashboard.

## Tag Analytics Sync (TagAnalyticsApp)
- **Cache-First**: Load from `tag_analytics` table, check 24h expiry + post count diff
- **Delta Sync**: Fetch first 100 posts to detect changes; if diff ≥ threshold (50), fetch delta and re-aggregate
- **Full Sync**: For new tags, fetch all posts and aggregate by user
- **Small Tag Optimization**: Tags with ≤1200 posts (`MAX_OPTIMIZED_POSTS`) are fetched entirely into memory — history, rankings, and milestones calculated locally without DB storage.

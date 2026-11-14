# Database Schema (Dexie.js)

Schema changes require a new version number in `database.ts` (Dexie.js migration requirement).

## Tables

| Table | Key fields | Purpose |
|---|---|---|
| `uploads` | id, userId, date, count | Daily upload counts |
| `approvals` | id, userId, date, count | Daily approval counts |
| `notes` | id, userId, date, count | Daily note edit counts |
| `posts` | id, uploader_id, [uploader_id+no], [uploader_id+created_at] | Full post history. Since v13 (T-401) only these indexes; `no`, `created_at`, `score`, `rating`, `tag_count_general` are still stored in every row but unindexed (no reader; each index was rewritten on every bulkPut). Rows written since T-402 also hold `upd` (`updated_at`, ms), `pend`, `flag`, `tc` (`tag_count`), `chr`, `cpy` (character / copyright tag strings) — short names, since IndexedDB stores key names in every row; built by `toPostRecord` (`core/post-record.ts`) |
| `piestats` | [key+userId], updated_at | Cached pie chart statistics (24h expiry) |
| `completed_years` | userId, metric, year | Past year completion flags |
| `hourly_stats` | userId, metric, year | 24-hour distribution cache |
| `tag_analytics` | tagName, updatedAt, lastFullScanAt | Wiki/artist tag report cache (24h expiry); `lastFullScanAt` schemaless, added v12 for 90-day forced rescan |
| `grass_settings` | userId, width, xOffset | Graph layout persistence |
| `user_stats` | userId | User-level aggregate counters (v10) |
| `tag_monthly_counts` | [tag+yearMonth], tag, fetchedAt | Per-tag, per-month post counts; distance-based TTL (v12). Written by the monthly history's layers 2–3 only; rows without `basis: 'utc'` (unindexed, v9.12) are from viewer-time-zone months and are not read. Deleted with their tag's expired report, and in the tag page's daily sweep when no report owns them (T-309) |
| `sync_meta` | userId | Per-user sync state (`SyncMetaRecord`, v13): `fieldsVersion`, `changeWatermark`, catch-up resume point, the viewer's time zone at the sync, a sync-in-progress mark, last visit. Keyed by the numeric uploader id (as `posts.uploader_id`; IndexedDB keys `1` and `"1"` differ). Helpers in `core/sync-meta.ts` (`patchSyncMeta`: read-merge-write in one transaction). A sync that wrote every row from the first post (Full sync from `startId` 0, or Quick sync) sets `fieldsVersion: 2`, `changeWatermark` (server `Date` of its first page) and `timeZone` (T-402); a resume sync sets none |
| `tag_implications_cache` | tagName, fetchedAt | Global cache for top-level (implication antecedent) flags, shared by tag pages and user pies via `core/top-level-tags.ts`; 180d TTL (v12), expired rows deleted by `pruneImplicationCache` in the tag page's daily sweep (T-309) |

Key compound indexes: `[uploader_id+no]` (milestone lookups), `[uploader_id+created_at]` (per-user last-sync lookup, v11), `[tag+yearMonth]` (monthly count cache, v12). `[uploader_id+score]` was dropped in v13 (no reader since v9.8.0). Before adding a query on a `posts` field, check it has an index — `where` / `orderBy` on an unindexed field throws.

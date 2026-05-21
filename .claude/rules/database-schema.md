# Database Schema (Dexie.js)

Schema changes require a new version number in `database.ts` (Dexie.js migration requirement).

## Tables

| Table | Key fields | Purpose |
|---|---|---|
| `uploads` | id, userId, date, count | Daily upload counts |
| `approvals` | id, userId, date, count | Daily approval counts |
| `notes` | id, userId, date, count | Daily note edit counts |
| `posts` | id, uploader_id, no, created_at, score, rating | Full post history |
| `piestats` | [key+userId], updated_at | Cached pie chart statistics (24h expiry) |
| `completed_years` | userId, metric, year | Past year completion flags |
| `hourly_stats` | userId, metric, year | 24-hour distribution cache |
| `tag_analytics` | tagName, updatedAt, lastFullScanAt | Wiki/artist tag report cache (24h expiry); `lastFullScanAt` schemaless, added v12 for 90-day forced rescan |
| `grass_settings` | userId, width, xOffset | Graph layout persistence |
| `user_stats` | userId | User-level aggregate counters (v10) |
| `tag_monthly_counts` | [tag+yearMonth], tag, fetchedAt | Per-tag, per-month post counts; distance-based TTL (v12) |
| `tag_implications_cache` | tagName, fetchedAt | Global cache for `isTopLevelTag` results; 180d TTL (v12) |

Key compound indexes: `[uploader_id+no]` (milestone lookups), `[uploader_id+score]` (top-score queries), `[uploader_id+created_at]` (per-user last-sync lookup, v11), `[tag+yearMonth]` (monthly count cache, v12).

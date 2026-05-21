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

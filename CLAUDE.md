# DanbooruInsights — working notes for Claude

## Overview
A Tampermonkey userscript that adds a GitHub-style contribution graph and analytics dashboards to Danbooru's profile, wiki and artist pages.
GitHub repository: `AkaringoP/Danbooru-Insights`

## Code style
- TypeScript: follow [GTS (Google TypeScript Style Guide)](https://google.github.io/styleguide/tsguide.html)
- Enforced by `npm run lint` / `npm run fix`

## Working principles
- **Search before reading**: do not read whole files; find the target with Grep/Glob first. Prefer a targeted search whenever one is possible
- **Report before changing behaviour**: any change that affects existing behaviour a user can see needs the user's confirmation before it is made
- **Self-verify right after editing** (left-shifted feedback): run `npx vitest run <changed-file>` on a changed file at once — during the work, not at the end. Regressions are caught before they pile up
- **Trust the harness, not your own judgement**: never declare "looks fine" without running the Evaluator Rubric below. Mechanical checks come before intuition
- **Report the changed files for every task**: say clearly which files changed and how
- **One task at a time**: do not mix several tasks in one session
- **Keep the UserScript header**: never edit the metadata block (`@version`, `@match`, `@grant`, …) by hand — the monkey plugin in `vite.config.ts` manages it
- **Repository documents are in English**: everything written into tracked files (this file, `.claude/rules/`, `docs/`, CHANGELOG, code comments) is English

## Core rules (not mechanically enforced — the agent applies them)
- A DB schema change → bump the version number in `database.ts` (a Dexie.js migration requirement)
- New CSS classes use the `di-` prefix (the Danbooru Insights namespace)
- The mechanically enforced rules (no raw `fetch`, no `[key: string]: any`, dependency direction, build/lint/test passing, the function complexity cap, dead code) are listed in the **Evaluator Rubric** below and run automatically in the pre-commit gate chain — do not repeat them in code reviews or plans; trust the gates

## Multi-model workflow

**Default**: the main session runs on **Opus 5**. Opus handles orchestration, decisions, reviews and small-to-medium implementation itself. **Sonnet 5** is called as a subagent (`Agent` tool, `model="sonnet"`) only when the delegation criteria below are met.

For heavier work, **Fable 5** (Mythos-class, the tier above Opus) can be the main model — `/model claude-fable-5`. The delegation criteria below apply the same whether the main model is Opus or Fable.

Rationale: this is a Claude Code subscription, not a metered API. Opus tokens come out of a rate-limit quota, not per-token billing, so keeping the strongest model in the main loop costs nothing extra as long as the quota is not at risk. Delegation is for **saving Opus quota** and **keeping the main context clean**, not for saving money.

### What the main session (Opus/Fable) does itself
- Architecture, algorithms, design decisions
- Debugging (hypothesis → check → fix loop)
- Code review after any change
- Edits to fewer than 5 files, or work that needs judgement along the way
- Anything that must stay in the main context for follow-up work
- Discussing, planning and updating the meta documents (`CLAUDE.md`, `TASK.md`, `PLAN.md`)

### When to delegate to a Sonnet subagent
Delegate only when **all** of these hold — otherwise Opus does it:
- The work is **mechanical** (bulk find/replace, applying a known pattern to many files, removing dead code, scaffolding from a clear spec)
- The spec is **clear** enough that no further judgement from the main session is needed during the work
- The scope is **5 files or more** OR the work would pile **100+ lines of noisy output** into the main context (e.g. a broad code search where only the summary matters)
- The result is a **diff or summary** Opus can review in one go

When delegating, write a **self-contained prompt**: the subagent cannot see this conversation. Include the decisions/spec, the target files and patterns, the constraints and what to report

### Task procedure
1. Opus reads the task item and decides **direct** or **delegate** by the criteria above
2. **Direct path**: Opus implements → runs the relevant Evaluator Rubric gates itself → reports the changed files
3. **Delegate path**: Opus writes a self-contained prompt → calls `Agent(model="sonnet", ...)` → reviews the returned diff → runs the Evaluator Rubric gates → reports the changed files
4. Move to the next task once the review passes

### Rate-limit fallback
If the Opus quota is at risk of running out during a session, switch the main session itself to Sonnet with `/model sonnet` and continue in the inverted pattern (Sonnet main, no delegation). Treat it as a recovery mode, not the default

### Task document rule
When writing or updating `TASK.md`, `PLAN.md` or any other task list, **every task item must state its execution path**, one of:
- `Direct (Opus)` — implemented by the Opus main session itself
- `Delegate (Sonnet)` — Opus delegates to a Sonnet subagent, then reviews

If the choice is not obvious, note the reason briefly. This keeps the pipeline reproducible across sessions

## Git branch strategy
- `develop` — the integration branch, where `feature/*` branches merge. Kept releasable
- `feature/*` — new features and improvements. Branch from `develop`, merge into `develop`
- `hotfix/*` — urgent fixes. Branch from `develop`; if urgent, merge into `main` and `develop` together
- `main` — stable releases only. Merged from `develop`. Always releasable
- No direct commits to `develop`
- Branch names: `feature/<short-description>` / `hotfix/<short-description>`

## Build & Dev
- `npm run dev` — Vite dev server (HMR)
- `npm run build` — `vitest run && tsc && vite build` → outputs `dist/danbooruinsights.user.js`
- `npm run compile` — `tsc` alone (type check only, no bundle)
- `npm run lint` / `npm run fix` — GTS lint / auto-fix
- `npm run test` — Vitest unit tests (currently 1442 cases)
- `npm run check:dead` — knip dead-code detection (Phase 6 gate)
- `npm run test:e2e` — Playwright e2e tests (`test/e2e/`, 7 visual-regression baselines)
- `npm run test:e2e:update` — update the e2e snapshot baselines (only for an intended visual change)
- `npm run clean` — gts clean

The bench tools in `scripts/` are run directly, not through npm scripts: `node scripts/bench-collect.ts <log-file> > out.json` aggregates a perf log and `bench-compare.ts` compares two results (their input is perf-logger output — see [.claude/rules/perf-logging.md](.claude/rules/perf-logging.md))

## Domain glossary
| Term | Meaning |
|---|---|
| Grass | GitHub-style calendar heatmap (contribution graph) |
| Quick Sync | Fast path for users with ≤1200 posts — sequential cursor pagination |
| Full Sync | Standard pagination + retries for large users |
| Delta Sync | Incremental tag-analytics update — fetch the first 100 posts and re-aggregate when the diff is ≥ 50 |
| Piestats | Cached aggregate statistics for the pie charts (24h expiry) |
| At a glance | Two-line user summary. Dashboard = all uploads (`lifetime`), popover = the latest 200 (`recent`) |
| untagged / under-tagged | At a glance, by the **current state**: ≤3 / <10 general tags 15 minutes after upload. A different notion from the popover grid's **mintag / abandoned** (by the number of tags the uploader put in v1) — do not mix them |

## Architecture

### Entry point
`src/main.ts` → `main()` → routes by URL path:
- **Profile mode** (`/users/*`, `/profile`): runs `GrassApp` + `UserAnalyticsApp`. While Grass is loading, a 📊 click does not start a sync (`GrassLoadGate`, G-7 — [sync-strategies.md](.claude/rules/sync-strategies.md))
- **Tag mode** (`/wiki_pages/*`, `/artists/*`): runs `TagAnalyticsApp`

### Data flow
1. `ProfileContext` / `detectCurrentTag()` → identify the target (a user or a tag)
2. `DataManager` / `AnalyticsDataManager` → Danbooru API calls + IndexedDB caching
3. `GraphRenderer` / the App classes → render with D3.js / CalHeatmap

### Layers (mechanically enforced — see [test/architecture.test.ts](test/architecture.test.ts))
Dependency direction: `core/ → ui/ → apps/`. A lower layer must not import a higher one

| Layer | Role | Examples |
|---|---|---|
| `src/core/` | Data layer — API, DB, rate limiting, settings, quota, domain utilities | `data-manager.ts`, `analytics-data-manager.ts`, `database.ts`, `rate-limiter.ts`, `rate-lane.ts`, `fetch-retry.ts`, `search-terms.ts`, `grass-load-gate.ts`, `monthly-report.ts`, `post-record.ts`, `post-tag-flags.ts`, `sync-meta.ts`, `local-distributions.ts`, `change-catch-up.ts`, `profile-context.ts`, `settings.ts`, `tab-coordinator.ts`, `quota-manager.ts`, `global-tag-stats.ts`, `sub-tag-resolver.ts`, `threshold-tuner.ts`, `scroll-lock.ts`, `logger.ts`, `perf-logger.ts`, `dashboard-preview.ts`, `grass-month-stats.ts`, `grass-prev-month.ts`, `related-tag-rerank.ts`, `top-level-tags.ts`, `profile-summary.ts` |
| `src/ui/` | Reusable UI primitives — no app orchestration | `graph-renderer.ts`, `settings-popover.ts`, `approval-detail-popover.ts`, `post-hover-card.ts`, `dashboard-footer.ts`, `modal.ts`, `popover-utils.ts`, `theme-palette.ts`, `tag-cloud-widget.ts`, `subtag-breakdown-tooltip.ts`, `widget-locked-placeholder.ts`, `threshold-preview-modal.ts`, `toast.ts`, `two-step-tap.ts`, `dashboard-preview-popover.ts`, `grass-month-popover.ts`, `profile-summary-view.ts` |
| `src/apps/` | App orchestration — combines core + ui | `grass-app.ts`, `user-analytics-app.ts`, `user-analytics-data.ts`, `user-analytics-charts.ts`, `user-analytics-pie-helpers.ts`, `user-analytics-scatter.ts`, `tag-analytics-app.ts`, `tag-analytics-data.ts`, `tag-analytics-charts.ts`, `created-tags-widget.ts`, `progress-tracker.ts`, `widget-gates.ts` |
| `src/dev/` | Developer diagnostics — isolated, dev-only modules | `diagnostic.ts`, `log-capture.ts` |
| `src/` (root) | Entry, shared types/utils/config | `main.ts`, `types.ts`, `utils.ts`, `config.ts`, `styles.ts`, `version.ts` |

## Key constraints
- `@grant none` — no GM_* APIs
- Browser only (no Node.js APIs)
- External libraries load through `@require` / `externalGlobals` (a Vite build project — the bundler handles imports, runtime dependencies stay external)
- `d3` is typed as `any` — do not add `@types/d3` (it breaks the app files' typing). At d3 call sites use the `D3Any` alias from `src/types.ts` instead of a raw `any`. The only place `@typescript-eslint/no-explicit-any` is disabled
- The Dexie tables in `database.ts` use the real row interfaces defined in `src/types.ts` (`DailyCountRecord`, `PostRecord`, …) — **no `Table<any>`**. (Older docs said `Table<any>`; outdated since the lint-CI initiative)
- App classes use composition (dataService, chartRenderer) — no index signatures
- The `dist/` output is a single bundled `.user.js` — never edit it by hand

## External dependencies (`@require` / `externalGlobals`)
- **d3.v7** — charts and visualisation (global: `d3`)
- **d3-cloud** — Tag Cloud word-cloud layout (global: `d3.layout.cloud`, `@require` only — not in externalGlobals)
- **cal-heatmap** — calendar heatmap (global: `CalHeatmap`)
- **Dexie.js** — IndexedDB wrapper (global: `Dexie`)

## CSS
- All styles are centralised in `GLOBAL_CSS` in `src/styles.ts`
- `injectGlobalStyles()` injects one `<style>` tag
- CSS class prefix: `di-` (Danbooru Insights)

## Rate Limiting (RateLimitedFetch)

**Server-side limits** (Danbooru `production` source, checked 2026-11-11). There is no single global limit but **a token bucket per action**, keyed separately by user, IP range and session:

| Action | Limit | Source |
|---|---|---|
| `/counts/posts.json` | 1 req/s, burst 15 (since 2026-11-05) | `app/policies/post_query_policy.rb` |
| `/reports/*` | 1 req / 3 s, burst 15 | `app/policies/report_policy.rb` |
| `/related_tag.json` | 1 req/s, burst 30 | `app/policies/related_tag_query_policy.rb` |
| Other reads (`/posts.json`, …) | no Rails limit | `rate_limit_for_read` in `app/policies/application_policy.rb` |

A request sent while over the limit costs another second's worth of points (floor −30). The Rails limits put an `X-Rate-Limit` header on both successful responses and 429s. The often-quoted "10 req/s overall" is not in the repository (no `limit_req` in `config/nginx.conf`, no rack-attack-style middleware — checked 2026-11-13).

**Edge (Cloudflare) limit** — the rule is not public. Measured 2026-11-13: an edge 429 has `server: cloudflare`, a **`cf-mitigated: challenge`** header and a "Just a moment..." challenge page (HTML) as its body, with no `X-Rate-Limit` or `Retry-After`. So a Cloudflare rate-limiting rule issues a challenge instead of a block, and fetch, unable to solve it, sees only a 429. Requests often pass again once the rate drops. The criterion looks like **a count per minute** (measured 2026-11-15, not settled): the requests in the 60 s before a refused one were 181, 187, 190, 191, 202, 219 and 228, and a request was refused right after a 5 s pause had brought the 10 s window down to 20 (the 60 s window stayed at 190 → 191). The boundary moves between runs — 188–228 have also passed — and every run without a 429 peaked at 182 or below in 60 s. On a day the server is fast (about 0.8 s a page), a 5-worker sync reaches 190–223 a minute and meets the boundary. Two earlier candidates were ruled out: "about 50 per 10 s" (from two refusals at 49 on 2026-11-13, but see the refusal at 20 above) and "about 240 per 2 minutes" (305 passed in 120 s). A per-minute budget (T-215 candidate) is on hold by the user's decision (2026-11-15). Measure anew with `sent*` / `peakOk*` in the diagnostic log's `429 received` entries and with `Sync traffic` ([docs/debugging.md](docs/debugging.md)).

**Client** — one token bucket + a lane per server action (v9.12). Exact values in `CONFIG.RATE_LIMITER` in [src/config.ts](src/config.ts):
- **General queue**: 8 concurrent requests, **4.5 req/sec, burst 1**, 0–50 ms jitter → from one tab at most 6 requests in any second, 47 in any 10 s and about 270 in any minute (T-213, v9.12 — set below the then-candidate "about 50 per 10 s"; that candidate was ruled out but the cap stays). The earlier decision G-1 was 6 req/sec (7 per second, 61 per 10 s). v9.6's 9 req/sec with a burst of 9 (burst equal to the rate) reached 16 per second and 98 per 10 s when Grass and a sync overlapped. A large account's Full Sync is paced by its worker count (`SYNC_WORKERS` 5, about 3.5 req/s on average), not by this cap; the cap only trims the bursts when responses come back fast ([sync-strategies.md](.claude/rules/sync-strategies.md)). Grass, UserAnalytics and TagAnalytics share the one limiter `main.ts` builds (a required constructor argument, gate 4 rule 11). The 4th argument of `RateLimitedFetch` is the burst (defaults to the rate — for tests)
- **Lanes** ([src/core/rate-lane.ts](src/core/rate-lane.ts)): counts, reports and related_tag requests each wait in their own lane. A lane sends only while its local estimate of the server bucket (the table's values at first, then corrected by the `X-Rate-Limit` on every response — which also reflects other tabs using the same bucket) holds 2 points or more (1 point of slack) and fewer than 2 of its requests are in flight. A lane request also takes a general-bucket token → counts and reports together stay within the 6 / 47 caps above. Dispatch takes "the earliest request whose lane is ready", so a waiting lane never holds up a sync. An unknown path that sends `X-Rate-Limit` gets a lane of its own. The report-only queue of v9.11 (a fixed 3 s wait) is gone
- **Scope of a 429**: a 429 with `X-Rate-Limit` (a Rails per-action limit) makes **only its lane** wait — no global pause, no halved rate, no notice to other tabs. Only a 429 without the header (the edge) leads to the global pause below. `backoffRemainingMs()` means the global pause only
- **Wake-up**: one scheduled wake-up for the whole queue (`scheduleWake`). The old way, a timer per refusal, made tens of thousands of timers for 250 waiting requests (audit DA-13)
- **TabCoordinator**: in multi-tab use on one IP, rps and concurrency are divided by the tab count (not rounded down — 2 tabs get 2.25 each of 4.5). The burst of 1 stays per tab — with N tabs the worst second is about 5 + N requests
- **Simulation**: [test/rate-limiter-sim.test.ts](test/rate-limiter-sim.test.ts) runs the real limiter against a model of Danbooru's server limits (`test/helpers/server-bucket.ts`, `rate_limit.rb` as is) and asserts the 1 s and 10 s caps, the 429 count and losses. When changing the limiter, check these numbers first
- **429 global backoff** (a 429 without the header): pause the whole queue for `Retry-After` if present, otherwise `CONFIG.BACKOFF_DURATION_MS` (5 s) (`backoffFromResponse`, clamped to `[1s, CONFIG.MAX_BACKOFF_MS]`), and notify the other tabs. (`backoffFromResponse` also has a path that computes `(cost − floor points) / rate` seconds + 0.5 s from `X-Rate-Limit`, but such 429s now go to the lanes)
- **Slow start + adaptive rate**: after a pause, resume with 1 token / 2 concurrent for 5 s (a full bucket and the waiting timers firing at once used to cause the next 429). Every 429 outside a pause halves the rate and concurrency (floor 25%); every 20 s without a 429 restores 25 points. Recovery is capped one step (25 points) below the rate the 429 came at — without the cap, holding at 0.5 and recovering to 0.56–0.75 drew a 429 within seconds each time, a sawtooth. The cap rises one step per 2 minutes without a 429. A 429 during slow start (right after a pause) is read as "the pause was shorter than the server's penalty": rate and cap stay and only the pause doubles (5→10→20 s…, up to `MAX_BACKOFF_MS`, or the server's wait if it gives one). In practice Danbooru's edge 429s come as HTML without `X-Rate-Limit`, so following the server's wait never applies — these two mechanisms are the real defence

## Evaluator Rubric (self-evaluation before declaring work done)
All 7 gates must pass before a task can be reported done. Run them yourself — never assume

The pre-commit hook ([`.githooks/pre-commit`](.githooks/pre-commit), wired up on `npm install` by the `prepare` script) chains gates 1–7 in one go: `npm run build && npm run lint && npm run check:dead`. Running them one by one during the work gives faster feedback

| # | Gate | Command | Enforced by |
|---|---|---|---|
| 1 | Type safety | `tsc --noEmit` (or `npm run build`) | TypeScript strict mode |
| 2 | Lint/style | `npm run lint` | GTS (Google TS style) |
| 3 | Tests pass | `npx vitest run` | Vitest |
| 4 | Architecture invariants | (covered by gate 3) | [test/architecture.test.ts](test/architecture.test.ts) — 14 rules today (list below) |
| 5 | Build succeeds | `npm run build` | Pre-commit hook (also runs gates 1+3) |
| 6 | Complexity cap | `npm run lint` | T-26 ESLint rules — `max-lines-per-function: 200` (skipBlankLines+skipComments), `max-depth: 6`, `complexity: 15`, `max-nested-callbacks: 4`. Existing violations carry an inline `// T-26 baseline:` disable; new ones are blocked |
| 7 | No dead code | `npm run check:dead` | knip — entry points / project globs / `cal-heatmap` + `eslint` ignored. Catches unused files, exports, types and devDependencies |

### Gate 4 in detail — the 14 rules of architecture.test.ts
1–4. Dependency direction: `core/ ↛ apps/`, `core/ ↛ ui/`, `ui/ ↚ apps/`, `apps/ ↛ main`
5. No `[key: string]: any` index signatures
6. No raw `fetch()` — use `rateLimiter.fetch()` (exceptions: `rate-limiter.ts`, `dev/`)
7. No raw `console.*` — use `createLogger()` (exceptions: `logger.ts`, `perf-logger.ts`, `dev/`)
8. Legacy NSFW localStorage keys only in the migration code of `core/settings.ts`
9. `/counts/posts.json` URLs only through `fetchRemoteCount()` — no inline re-rolls
10. `/wiki_pages/` hrefs must encode the tag name (a tag can contain `/` — `fate/grand_order`)
11. `new RateLimitedFetch(` **only in `main.ts`** — one bucket per tab (v9.12, G-1). The constructors of `DataManager`, `AnalyticsDataManager`, the three Apps and `UserAnalyticsDataService` take the limiter as a required argument (tsc catches an omission). A bucket made anywhere else, like the old `rateLimiter ?? new RateLimitedFetch(…)` fallback, ignores the multi-tab split and the 429 pause and doubles the rate (v9.9.0 H-1). The test asserts the number of files checked and the single hit in `main.ts` together (no vacuous pass)
12. The popover position formula (`getBoundingClientRect` + `pageXOffset/pageYOffset`) only in `ui/popover-utils.ts`
13. `dev/` does not import `core/`, `ui/` or `apps/` (isolated diagnostics)
14. No inline script in markup — `on*="…"` attributes in HTML strings, `on*` attributes set with `setAttribute` / d3 `.attr`, `javascript:` URLs (v9.11.4 — Danbooru enforces a CSP without `unsafe-inline` since 2026-11-11, so they silently do nothing). Attach listeners; where innerHTML redraws, use a delegated listener on the outer container (see `ui/thumb-fallback.ts`). The detector comes with its own self-test

**Beware — vacuous passes**: these tests filter file paths as strings. A filter that matches 0 files finds 0 violations and **looks like a pass**. Always compare paths through `relFromSrc()` / forward-slash-normalised values (Windows `path.relative` returns backslashes, so `'apps/'` never matches — rule 11 really did pass on Windows checking 0 files). When adding a rule, check that it checks a non-zero number of files

When a gate fails, fix the root cause — no whitelisting, suppressing or working around. The mechanical gates exist because LLM judgement cannot be trusted for these checks ("Never send an LLM to do a linter's job").

The pre-commit hook is now authoritative — the old "run lint by hand before committing" rule is automated. Keep the left-shifted feedback of running single gates during the work; the final guarantee is the hook

### Gate 8 — e2e (by hand, before merging)
`npm run test:e2e` (Playwright, ~8 s). **Not in the pre-commit hook** — it needs the dev server, too heavy for every commit. Instead, **run it once right before merging a branch**. Otherwise a rotting visual-regression baseline goes unnoticed (the only verification area outside the gates)

The baseline images are **per platform** (`…-chromium-win32.png`, `…-chromium-darwin.png`). Without a baseline for the platform, the first run fails with "A snapshot doesn't exist … writing actual" and makes one from the current code, and every pass after that only compares against what was just taken (this happened on Windows on 2026-11-12). Make a new platform's baselines from `develop` code and commit them. The win32 baselines were made at `dadcbfc` (v9.11.3)

## References (level-3 documents — load when needed)
- **Danbooru server source**: the **`production` branch** of [danbooru/danbooru](https://github.com/danbooru/danbooru) (what the site actually runs; may differ from `master`). Limits and search rules change often, so read the source before trusting numbers in the docs — `app/models/user.rb` (tag, page and timeout limits per level), `app/logical/post_query.rb` (free metatags, count cache), `app/policies/*_policy.rb` (`rate_limit_for_*`), `config/initializers/content_security_policy.rb`
- [.claude/rules/api-endpoints.md](.claude/rules/api-endpoints.md) — catalogue of the Danbooru API endpoints
- [.claude/rules/database-schema.md](.claude/rules/database-schema.md) — Dexie.js table layout & compound indexes
- [.claude/rules/sync-strategies.md](.claude/rules/sync-strategies.md) — Grass / User / Tag sync algorithms
- [.claude/rules/perf-logging.md](.claude/rules/perf-logging.md) — perf-logger usage, enable/disable, label namespaces
- [docs/debugging.md](docs/debugging.md) — the diagnostic panel (`#di_diag` hash or `di.diag.enabled` in localStorage) and how to diagnose desktop/mobile issues
- [test/architecture.test.ts](test/architecture.test.ts) — the canonical source of the architecture rules
- [docs/audit-remediation.md](docs/audit-remediation.md) — retrospective of the v9.6 audit's 6 phases (why the Phase 1–6 helpers and guardrails exist)
- [CHANGELOG.md](CHANGELOG.md) — release history & version context

## Current release state
Current version **v9.12.1** (`APP_VERSION` in [src/version.ts](src/version.ts) is the single source of truth — bump only there on release). No active issue. "v9.12" in the docs means v9.12.0 and its hotfixes.

Recent releases (details in [CHANGELOG.md](CHANGELOG.md)):
- **v9.12.1** (hotfix) — every dashboard widget reads the open's data manager, so the rows are scanned once and a pie tab opened after a catch-up counts the updated rows (the monthly chart and the widgets used the app's own manager and its older scan); the scatter plot releases its `window` / `document` listeners, two-step tap controller and `<body>` popover / tooltip when it leaves the document (each open left a set behind)
- **v9.12.0** — the 2026-11-12 audit follow-up (Phases 1–7). A lane per server limit and one shared 4.5 req/s budget; the user dashboard's pies counted from the synced rows (fields versions 2 and 3, a one-time backfill, a change catch-up); tag page history from reports in UTC months; lost counts shown as unknown, never saved as 0; searches over the viewer's tag limit not sent (🔒); sync fixes (page-limit segments, first-post anchor, numbering gaps); Grass reusing synced posts, retrying pages, hours in the account zone, 90-day cache sweep; large thumbnails through `media_asset[variants]`; inline handlers replaced for Danbooru's CSP; a pre-release review's seven fixes. Schema v13 (`sync_meta`). Tests 1040 → 1437. Two known limits are listed in the CHANGELOG's Internal section
- **v9.11.3** (hotfix) — on mobile, a "?" tooltip opened by a tap (Suspicious, the Recent uploads colour legend) did not close on a tap elsewhere. A shared `attachTapTooltip` (detects an outside tap with a document capture-phase click, only while open), `closeTapTooltips` in the popover's `hide()`, and the CSS hover/focus reveal limited to `@media (hover: hover)` (a phone's sticky hover and tap focus held the tooltip)
- **v9.11.2** (hotfix) — the preview popover was cut off on the right on phones (width clamped to the screen − 16 px, `documentElement.clientWidth` instead of `innerWidth` — the overflowing popover inflated mobile Chrome's `innerWidth`), repositioned on rotation while open (a `resize` listener, only while open). A "?" explanation beside Suspicious in the Activity legend (hover on PC / tap on mobile, full width above the legend). Suspicious-upload conditions reworked: banned excluded (an artist-requested takedown), flagged and four Meta tags (`SUSPICIOUS_UPLOAD_TAGS`) added — only `is_flagged,tag_string_meta` added to the existing lookup, matched client-side (Meta-category tags count toward a Member's 2-tag limit — rechecked 2026-10-30, api-endpoints.md "Search tag limit")
- **v9.11.1** — "At a glance" summary: a card at the top of the dashboard (over all synced uploads — share of the main copyrights and characters, deleted/banned/pending counts + % of all, tagging health, 30-day pace, streaks, peak year, change in reception, **no extra requests**) + a section at the top of the preview popover (over the latest 200, compared with the usual, one `/posts.json` request cached in piestats `recent_window`). Pure builder `core/profile-summary.ts` (`scope: 'lifetime' | 'recent'`), rendering in `ui/profile-summary-view.ts` (DOM nodes — no HTML strings). Fixed: the dark-mode colour of the upload card's pause button, the User History scrollbar (Chrome ignores a custom scrollbar when the standard `scrollbar-width` is set)
- **v9.10.0** — a large account's full sync stopped at a single 429 (retries for 429, timeouts and network errors, retried after the wait), a rate limiter redesign (slow start, adaptive rate + recovery cap, a doubled pause for a 429 right after a pause, following `X-Rate-Limit`/`Retry-After` — on a 46k account's re-sync + first dashboard, about 45 429s with page retries alone → 4 with these), failed counts cached as 0 (`countBatch` retries once + `cacheUnlessPartial`), the implication lookups of the three related-tag pies batched and cached together (`core/top-level-tags.ts`, 119 → ≤4 requests), the six secondary pie tabs load when opened on a cold open, orange progress while waiting on the rate limit, a Logs section + Refresh in the diagnostic panel. Tests 896 → 954
- **v9.9.2** — a race where switching the Grass metric/year quickly let a late fetch draw old data under the new label (issue #4), a duplicated threshold notice
- **v9.9.1** (hotfix) — two `backdrop-filter`s removed from the modals (ghosting/stutter on Windows), architecture.test.ts path normalisation (a rule passed on Windows checking 0 files)
- **v9.9.0** — faster dashboard open (the nine heavy tag distributions off the blocking path, cached values painted at once + lazy revalidation of the visible pie tab only → ~46k account 30 s → 5 s), month popover charts (daily sparkline + yearly trend line), escaping of tags containing `<`/`>`, failed syncs reported as successful, local ghost rows of deleted posts cleaned up (`pruneGhostPosts`), all dashboard traffic through the shared rate limiter (+ new gate 4 rule 11). Tests 782 → 893
- **v9.8.0** — Grass month-label hover popover (month total / MoM / share of active days / busiest day, computed from the year's in-memory data — no extra API)
- **v9.7.2** — Recent / Most Popular / milestones not refreshed after a partial sync, full-refresh hint 7 days → 30 days
- **v9.7.0 / v9.7.1** — dashboard preview popover (recent uploads grid + activity distribution strip), mintag/abandoned detection + colour legend

The preview popover's behaviour catalogue (mintag/abandoned criteria, the 11 activity types, suspicious re-typing, anchor prefixes) lives in the "Mintag / abandoned detection" and "Activity distribution feed" sections of [.claude/rules/api-endpoints.md](.claude/rules/api-endpoints.md) — that is canonical, do not repeat it here

## Notes
- When adding a theme to `CONFIG.THEMES`, keep the light/dark section comments (12 themes today — Light 6: Light/Solarized Light/Sakura/Lavender/Ice/Aurora, Dark 6: Midnight/Solarized Dark/Dracula/Ocean/Monokai/Ember)
- `getBestThumbnailUrl()` priority: 720x720 webp > 360x360 webp > other variants > preview > file. Variants come from `media_asset.variants` (Danbooru gives no top-level `variants`) or a stored row's `variants`. Only the single-post card requests ask for the large sizes, as `only=…,media_asset[variants]` (single post, milestones, top posts, recent popular, random, the tag page's latest / trending / milestones — decision G-3, T-506). Lists, the syncs, pie thumbnails (80px) and the preview grid (180px) ask for no variants and use `preview_file_url` (the 180×180 jpg). Sync rows store no thumbnail; the milestone lookup fills it in on its rows once (`variants: []` when there is none)
- The `mapConcurrent()` utility controls parallel API calls (used for count fetches and tag filtering)
- `MAX_OPTIMIZED_POSTS = 1200` — the threshold for the Quick Sync / Small Tag paths ([src/config.ts](src/config.ts))
- Count cache TTL (v9.6): `getCountCacheTtlMs()`, 10 minutes by default, adjustable in the settings popover. Used consistently by `tryGetCachedStats<T>`
- **Search tag limit** (since 2026-11-10): anonymous 2, Member 3, Gold and above unlimited (by the level of the **viewer** running the script). The only free metatags are `status rating limit is id date age filesize filetype parent child md5 width height duration mpixels ratio score upvote downvotes favcount embedded tagcount pixiv_id pixiv` — **`user:` `order:` `has:` `fav:` `ordfav:` `source:` and the `gentags:` kind count as one each**, and tag names count one each, Meta category included. `/counts/posts.json` gets the same check since 2026-11-05 and answers 422 over it. Fit new queries to the anonymous limit (2), or handle the levels for queries that go over. Details and the current workarounds in "Search tag limit" in [.claude/rules/api-endpoints.md](.claude/rules/api-endpoints.md)
- Count-based statistics (status / rating / the 9 distributions) get their counts through `countBatch()` and save through `cacheUnlessPartial()`. A 429, 5xx or network failure is retried once (queued behind the rate limiter's pause); if a count is still lost, nothing is cached → the previous cache is shown and the next open retries. A deterministic 4xx (e.g. a Member's 422 over the tag limit) is neither retried nor blocking. A count the server gave as `null` makes `fetchRemoteCount` throw `CountUnavailableError` (never 0) — not retried (the server caches it 5 minutes) and not cached (v9.12). A lost slice in Commentary, Translation or Hair length is `unknown` (legend "—", left out of the pie's shares). New distributions use this path rather than calling `fetchRemoteCount` directly. Queries over the viewer's tag limit can be filtered out up front with `fitsViewerTagLimit` in `core/search-terms.ts`. On tag pages `fetchCountWithRetry` follows the same rules and gives a lost value as `null` (never sending queries over the limit); the pies show "—"/"🔒" and saving keeps the previous whole pie (T-308, [sync-strategies.md](.claude/rules/sync-strategies.md))
- **Local pies (T-406)**: the user dashboard's Status (except appealed), Rating, Character and Copyright pies and the two tag-count-below-10 values are counted from the local `posts` rows instead of counts when the conditions hold (`getLocalDistributions` → `core/local-distributions.ts`). Conditions: `sync_meta.fieldsVersion ≥ 2`, no sync under way or failed + a completion stamp, no gap in the numbering (T-404). Otherwise the count path above. Same return shapes and piestats keys. The secondary pies (Gender, Breasts, Hair length, Hair color, Translation, and Commentary's two tag slices) are counted from the same scan when `fieldsVersion ≥ 3` and every row holds the tag flags `tf` (T-703, `getLocalTagCounts`). The tag strings are not stored; a row keeps only indices into `TAG_FLAG_NAMES` (`core/post-tag-flags.ts`) — changing that list bumps `POST_FIELDS_VERSION` and moves `TAG_FLAGS_FIELDS_VERSION` with it. Commentary's Untagged is `has:commentary` (an artist commentary record, not a tag) and stays 3 counts. To move another distribution local, add the fields it needs to `SYNC_POST_FIELDS` and bump `POST_FIELDS_VERSION` (existing users get the backfill again); the first local pies check only `LOCAL_PIES_FIELDS_VERSION` (2) and stay local during it

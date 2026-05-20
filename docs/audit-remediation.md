# Codebase Audit Remediation (v9.6)

A retrospective of the six-phase cleanup that produced the v9.6 release.
An external audit (early 2026) catalogued thirty-two findings across the
codebase — dead code, duplicated patterns, leaky layer boundaries, over-
and under-abstraction, and a handful of multi-hundred-line functions that
had grown past comprehensibility. This document summarises what was done,
in what order, and which guardrails were installed so the same problems
don't quietly accumulate again.

The phases ran sequentially over a single working initiative; each closed
before the next began so the codebase stayed shippable between phases.

---

## Why an audit at all

By v9.5 the project had been live for about a year. The grass dashboard,
user analytics, and tag analytics features had all matured independently,
which meant good local hygiene inside each app but limited cross-cutting
consistency:

- Two apps reading the same setting under two different localStorage keys.
- A small `fetchRemoteCount(tags)` helper was defined but bypassed by 24
  out of 25 call sites — each one rolling its own
  `/counts/posts.json?tags=...` URL.
- A few entry-point-level orchestrator functions had crossed the 700-line
  mark, including one (`renderGraph`) at 1,112 lines.
- Six unused functions and interfaces had been left behind by past
  refactors.

None of these were bugs. They were the kind of drift that erodes
maintainability — costs that show up six months later when someone tries
to change a "small" thing and discovers it touches eleven places. The
audit catalogued the patterns; the six phases addressed them in
dependency order.

---

## Phase 1 — Dead and stale removal

**Focus**: unused functions, unused interfaces, and obsolete comments
left behind by completed migrations.

Six straight-forward removals:

- `DanbooruApproval` and `DanbooruNoteVersion` interfaces in
  [`src/types.ts`](../src/types.ts) — defined but never imported.
- `httpErrorMessage` in [`src/core/logger.ts`](../src/core/logger.ts) and
  `isDarkMode` in
  [`src/ui/theme-palette.ts`](../src/ui/theme-palette.ts) — neither had a
  caller.
- Three stale comments referencing removed features (bubble chart data
  collection, "server bubble data cleanup").
- Phase 1 also removed `revalidateCurrentYearCache` — a v9.2.3 hotfix
  mechanism that v9.5.4's permanent fix had superseded but never deleted.

Mechanical risk-free changes. The bundle shrank a few hundred bytes; the
real win was the next sweep being easier to read.

---

## Phase 2 — Helper extraction

**Focus**: three patterns that had been *partially* abstracted but never
fully consolidated.

### `fetchRemoteCount`

[`src/core/data-manager.ts`](../src/core/data-manager.ts) already defined
a `fetchRemoteCount(rateLimiter, tags)` helper, but only one site called
it. The other twenty-four sites built the
`${baseUrl}/counts/posts.json?tags=${encodeURIComponent(...)}` URL
themselves — same pattern, same rate-limit semantics, no reuse.

Phase 2 lifted the helper to a module-level export, kept the existing
`DataManager.fetchRemoteCount` method as a thin wrapper, and migrated all
twenty-two app-side callers (plus the in-class sites) to the shared
helper. The diagnostic module
([`src/dev/diagnostic.ts`](../src/dev/diagnostic.ts)) keeps its own copy
intentionally — it's designed to be app-independent.

### Cache preludes

`AnalyticsDataManager` had fourteen distribution-fetch methods, each
starting with the same four lines:

```ts
if (!forceRefresh && uploaderId) {
  const cached = await this.getStats(cacheKey, uploaderId);
  if (cached) return cached as SomeType;
}
```

Only the type cast differed. A single `tryGetCachedStats<T>(...)` private
helper collapsed all fourteen.

### Popover chrome utilities

Four sites — two app orchestrators and two ui/ popovers — each had their
own click-outside handler and popover position formula
(`getBoundingClientRect()` + `window.pageYOffset`). The formulas were
near-identical; the differences were per-call-site knobs (which sibling
elements to treat as "inside," whether to defer attachment, click vs
mousedown).

[`src/ui/popover-utils.ts`](../src/ui/popover-utils.ts) was created with
`calcPopoverPosition(target)` and
`createClickOutsideHandler(container, onClose, { ignore })`. The knobs
became explicit options so each site keeps its native behaviour.

---

## Phase 3 — Duplication removal

**Focus**: full feature duplications that had drifted between apps.

### Shared modal utility

`user-analytics-app.ts` and `tag-analytics-app.ts` each carried their own
copy of `createModal` (~60 LOC each) and `toggleModal` (~35 LOC each).
The differences were cosmetic: id strings, an `onBeforeClose` hook, the
history.state contract for the back button. Both apps moved to
[`src/ui/modal.ts`](../src/ui/modal.ts) with a single
`createModal({ id, onBeforeClose })` interface.

### Settings popover chrome

`showSyncSettingsPopover` (99 LOC) and `showSettingsPopover` (120 LOC)
shared most of their chrome: div creation, `data-di-theme` propagation,
CSS-var styling, the click-outside handler, and the Dashboard Theme
select block. Phase 2's popover-utils consumed most of it; the Dashboard
Theme select got its own dedicated helper.

### Body-attached tooltip

Four independent `d3.select('body').append('div')` tooltip
implementations across pie / grass / tag-cloud charts. A
`createBodyTooltip(className)` helper in `popover-utils.ts` replaced them.
The four sites kept their per-chart visual styles but share the four
universal technical styles (absolute positioning, opacity zero,
non-interactive, max z-index).

### NSFW localStorage key unification

Two apps used two different keys for the same logical setting:

- `danbooru_grass_nsfw_enabled` (user analytics)
- `tag_analytics_nsfw_enabled` (tag analytics)

Toggling NSFW in one didn't affect the other. Phase 3 introduced a
unified `di.nsfw_enabled` key in
[`src/core/settings.ts`](../src/core/settings.ts) plus a one-time
`migrateNsfwKey()` that reads the legacy keys at startup, writes the
unified key, and removes the old ones — idempotent and safe to ship
without a flag.

---

## Phase 4 — Layer boundary cleanup

**Focus**: imports that crossed the project's declared layer hierarchy.

The codebase follows a strict `core/ → ui/ → apps/` dependency direction,
enforced by [`test/architecture.test.ts`](../test/architecture.test.ts).
Two violations had crept in:

- `applyDashboardTheme` and `resolveEffectiveDashboardTheme` lived in
  `src/main.ts` (the entry point) but were imported by two app
  orchestrators. Phase 4 moved them to
  [`src/ui/theme-palette.ts`](../src/ui/theme-palette.ts) where they
  belong, and added an architecture test rule forbidding `apps/ → main`
  back-imports.
- `src/apps/tag-cloud-widget.ts` was a generic UI widget that
  `user-analytics-app.ts` (not `tag-analytics-app.ts`) consumed. Despite
  the name it was app-orchestration-independent. Moved to
  `src/ui/tag-cloud-widget.ts`.

Both changes were single-import-path updates plus the file move, but they
restored the boundary that the architecture test guards.

---

## Phase 5 — Decomposing the giants

Phase 5 was the largest and was split into three sub-phases:

### 5a — Playwright infrastructure

Before touching the giant functions, the codebase needed something
stronger than unit tests. The targets included `renderGraph` (1,112 LOC)
which depends on CalHeatmap (a window-global library that does not work
under JSDOM). Visual regressions in heatmap rendering, pie chart layout,
and popover positioning could not be caught without real browser
rendering.

Phase 5a added Playwright 1.60, a `test/e2e/` directory with per-widget
harness HTML pages, JSON fixtures for posts / piestats / tag analytics,
and helper utilities to intercept Danbooru API calls during tests. A
`test:e2e` script and a `test-results/` gitignore entry rounded out the
setup. Initial baseline: harness smoke tests on three pages.

### 5b — Function-level tests

Five giant functions were the next phase's decomposition targets. Phase
5b wrote tests *before* the decomposition, so external behaviour would be
locked in by green tests during the refactor:

- `createSettingsPopover` (753 LOC) — 14 JSDOM cases + Playwright
  baseline screenshot.
- `renderDashboard` (945 LOC) — 9 JSDOM cases + zero-uploads Playwright
  baseline (the full render baseline was punted to per-widget specs
  because the dashboard composition is built from the same widgets that
  T-18 and T-19 baseline directly).
- `renderPieWidget` (1,134 LOC) — 8 JSDOM cases + 3D-pie SVG baseline.
- `renderGraph` + `injectSkeleton` (1,112 + 785 LOC) — 10 JSDOM cases
  (with a `MockCalHeatmap` class) + real-CDN Playwright baseline.
- `getMetricData` + `syncAllPosts` (426 + 339 LOC) — vitest coverage
  expansion (+11 + 6 cases) using existing mock patterns. This was the
  only Phase 5b task delegated to a Sonnet subagent; the fresh-eye review
  also caught one piece of unreachable code (later removed in 5c).

The tests verified *current external behaviour*, not internal structure
— sub-function names, signatures, call order remained free to change
during decomposition.

### 5c — The actual decomposition

With the safety net in place, the seven giant functions were split into
helper functions. Each task in this phase landed as a single commit; the
Phase 5b test suite stayed green after every commit with no baseline
updates required (SVG and heatmap pixels stayed byte-identical).

| Function | Before | After | Reduction |
|---|---|---|---|
| `createSettingsPopover` | 753 LOC | 98 LOC | -87% |
| `renderDashboard` | 945 LOC | 145 LOC | -85% |
| `renderPieWidget` | 1,134 LOC | 244 LOC | -78% |
| `renderGraph` | 1,112 LOC | 203 LOC | -82% |
| `injectSkeleton` | 785 LOC | 189 LOC | -76% |
| `getMetricData` | 426 LOC | 69 LOC | -84% |
| `syncAllPosts` | 339 LOC | 120 LOC | -65% |
| **Total** | **5,494 LOC** | **1,068 LOC** | **-81%** |

The extracted helpers carry their own LOC, so total project LOC didn't
drop by 4,426 — but the *body* of each orchestrator is now small enough
to read in one sitting. Bundle size went from 682.35 kB to 682.30 kB
across the five tasks — essentially flat. Three tasks added kilobytes
(signature + JSDoc overhead) and two tasks removed kilobytes
(deduplicating tooltip and frequency-normalisation logic). The point of
decomposition was readability, not byte savings.

Three cross-section state patterns emerged from this phase, each
documented in the relevant commit messages:

- **`paletteTargets` mutable ref array** — settings popover sections push
  their re-colourable elements into a shared array; a final
  `applyPopoverPalette()` call iterates the whole list. Theme changes
  re-colour everything in one pass without each section knowing about
  the others.
- **`NsfwBus = { enabled, apply }` mutable holder** — the dashboard
  header writes `enabled` on toggle, the widget bundle writes `apply`
  during mount, the header's onChange handler reads `nsfw.apply()` at
  click time. Timing is safe because widgets always finish mounting
  before the modal becomes interactive.
- **`GrassLayout` interface struct** — graph renderer's inline/below
  mode geometry is mutable state shared between `injectSkeleton` and
  `createGrassHandle`. Explicit struct (not closure capture) makes the
  shared mutation contract visible from the signatures.

---

## Phase 6 — Permanent guardrails

The decomposition only pays off if the code stays decomposed. Phase 6
installed four mechanical guardrails that catch regressions at commit
time.

### ESLint complexity rules

`eslint.config.js` gained four rules:

```js
'max-lines-per-function': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
'max-depth': ['error', 6],
complexity: ['error', 15],
'max-nested-callbacks': ['error', 4],
```

Tests opt out of `max-lines-per-function` only — vitest `describe`
blocks legitimately wrap large case lists.

Phase 5c had reduced the giant orchestrators to within budget, but
thirty-eight other functions still violated one or more rules. Each
received an inline `// T-26 baseline: ...` disable comment with a
specific reason — either a decomposition candidate not in Phase 5c
scope, or a structural constraint that makes splitting worse (closure-
shared state, event-handler lifecycle, switch-table branching). The
baselines are greppable (`grep -rn 'T-26 baseline'`) so future cleanup
sprints have a worklist; new violations without that prefix are caught
at commit time.

The Dexie `Database` constructor (predicted to need a permanent
exemption) turned out to pass naturally — the `.version().stores()`
chain has one logical statement per line, and `skipBlankLines +
skipComments` keeps it under the 200-LOC threshold.

### Architecture-test pattern guards

[`test/architecture.test.ts`](../test/architecture.test.ts) gained three
regex-based pattern guards beyond the existing layer-direction checks:

- **Legacy NSFW keys** — `danbooru_grass_nsfw_enabled` and
  `tag_analytics_nsfw_enabled` may only appear in `core/settings.ts`
  (where the migration code lives).
- **Inline `/counts/posts.json` URLs** — the literal string is forbidden
  in non-comment lines outside `core/data-manager.ts` (helper) and
  `dev/` (isolation policy). Forces callers through `fetchRemoteCount`.
- **Popover position formula** — combining `getBoundingClientRect()`
  with `pageXOffset` / `pageYOffset` in the same file is forbidden
  outside an allowlist of three UI primitives.

The fourth pattern (`apps/ → main` back-imports) was added in Phase 4 and
is kept as-is.

### Dead-code detection (`knip`)

The cleanup phases had relied on a manual audit; Phase 6 made dead-code
detection automatic. `knip` 6.14 is configured via `knip.json` with the
production entry, build-tooling entries (`eslint.config.js`,
`scripts/bench-*.ts`), and test entries. `cal-heatmap` and `eslint` are
ignored at the dependency level (cal-heatmap is a runtime `@require`
that knip can't see in UserScript headers; eslint is transitive via
gts).

The baseline knip scan found three real dead exports that the Phase 1
manual sweep had missed (`removeBodyTooltip`, `interceptUserAnalyticsDefaults`,
`Rating`) plus nine internal-only exports that were quietly downgraded
to module-private. `Rating` is interesting — knip flagged it as an
unused export, the downgrade attempt triggered TypeScript's
`noUnusedLocals` ("declared but never used"), which surfaced it as
genuinely dead.

`npm run check:dead` runs the scan; expected output is empty.

### Pre-commit hook

[`.githooks/pre-commit`](../.githooks/pre-commit) chains the three gates
in sequence: `npm run build` → `npm run lint` → `npm run check:dead`.
First failure aborts. Short-circuits when no source or config files are
staged so documentation-only commits skip the ~10-second pipeline.

Wiring is automatic per-clone: a `prepare` script in `package.json`
sets `git config core.hooksPath .githooks` on `npm install`. Existing
clones can run that one command manually or re-run `npm install`.

The CLAUDE.md Evaluator Rubric (project-internal review checklist) was
updated from five gates to seven; the previous "always run lint manually
before commit" reminder is now automated.

---

## Aggregate impact

| Metric | Pre-audit | v9.6 | Δ |
|---|---|---|---|
| Bundle (gzip) | 147.3 kB | 147.35 kB | ~0 |
| vitest cases | 394 | 456 | +62 |
| Playwright cases | 0 | 7 | +7 |
| Architecture tests | 7 | 11 | +4 |
| Functions over 300 LOC | 7 | 0 | -7 |
| Layer-boundary violations | 2 | 0 | -2 |
| Duplicate NSFW keys | 2 | 1 | -1 |
| `/counts/posts.json` inline sites | 25 | 1 (helper only) | -24 |
| Mechanical gates at commit time | 1 | 3 (chained) | +2 |

The bundle is essentially unchanged — this was never a size-reduction
initiative. The wins are elsewhere:

- **62 new vitest cases plus 7 Playwright baselines** lock in external
  behaviour for every previously-untested orchestrator.
- **Four architectural patterns** (layer direction, raw-fetch ban, NSFW
  key, count-URL helper) are mechanically enforced; previous violations
  re-emerging would fail the architecture test instead of waiting for
  the next manual audit.
- **Thirty-eight legacy complexity violations** are tracked by greppable
  baseline comments; new violations are blocked at commit time.

---

## Design notes from the journey

- **Tests *before* decomposition, not after.** Writing the test suite
  against the *current* (giant) function locks in observable behaviour.
  Decomposition then has freedom in internal structure — sub-function
  names, call order, closure shape can all change. If tests had been
  written against the post-decomposition shape, they would have
  shadowed the structure they were meant to verify.

- **Trust the harness, not predictions.** Several Phase 6 expectations
  turned out to be wrong on the first measurement. The Dexie
  `Database` constructor was predicted to need a permanent exemption;
  it didn't. The `max-depth` rule was predicted to apply at function
  level; it applies at the opening line of the deepest block (which
  required block-level disables instead of signature-level). Running
  the gate and reading the report beats simulating it in advance.

- **Decomposition pays off as a `*pair*` with guardrails.** Phase 5c's
  ROI (~5,000 LOC of orchestrator body reduced) is only realised if the
  code stays decomposed. Phase 6's ~700 LOC of guard code (tests +
  config + hook) is what makes Phase 5c permanent. Treating them as
  separate "nice to have" initiatives would lose the point.

- **knip + tsc are complementary.** knip catches exports unused outside
  the defining file. TypeScript's `noUnusedLocals` catches symbols
  unused inside a file. Together they catch dead code at both scopes;
  separately, each misses the other's territory. The `Rating` type
  removal in Phase 6 is the canonical chain: knip flagged the export →
  downgrade attempted → tsc flagged the internal usage → genuinely dead
  → removed.

- **Cross-section mutable state needs a name.** When extracting helpers
  from a giant function, closure-captured `let` variables can't survive
  the lift. The replacement pattern — explicit mutable holder
  (`NsfwBus`), explicit ref array (`paletteTargets`), or explicit
  interface struct (`GrassLayout`) — has the same runtime semantics but
  makes the mutation contract visible from the signatures. The cost is
  a named type for what was previously implicit; the win is that the
  next reader can see "what does this helper mutate?" without reading
  the body.

- **Commit-time gating beats CI-time gating beats post-merge audits.**
  The pre-commit hook catches violations before the commit even lands.
  CI gates catch them before merge but after push. Periodic audits
  catch them after they've shipped. The fastest feedback loop wins by
  the largest margin — each step backwards costs about an order of
  magnitude in remediation effort.

---

## What's left

The baseline disables installed in Phase 6 are not permanent licences.
They are tracked debt:

- `renderTopPostsWidget` (265 LOC) — decomposition candidate, parallel
  to other large user-analytics widgets but not in Phase 5c scope.
- `_fetchLargeTag` (239 LOC, complexity 34) — multi-phase fetch with
  intermediate render checkpoints; decomposition candidate.
- `getCreatedTags` (complexity 33) — multi-stage pipeline that could be
  split per stage.
- A few more in [`test/architecture.test.ts`](../test/architecture.test.ts)
  and the inline `// T-26 baseline:` comments.

A future sprint can pick any of these up. The architecture test for
"localStorage key duplication" specifically catches future *recurrences*
of the F-DUP-9 pattern (the NSFW split) — separately, the
`danbooru_grass_last_sync_<uid>` template literal is duplicated across
six call sites in `core/` and `apps/`. That one wasn't in the audit's
scope, but it's the same shape and a natural next target for
centralisation into `core/settings.ts`.

The point of guardrails is that none of this needs to be tracked in a
TODO list. The next sprint will hit one of these naturally when it
touches the file, the gate will catch the violation, and the natural
flow becomes "decompose now" instead of "leave it for an audit later."

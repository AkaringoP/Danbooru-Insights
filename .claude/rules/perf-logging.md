# Performance Logging

Lightweight instrumentation for measuring sync and render hot paths.
Implemented in [src/core/perf-logger.ts](../../src/core/perf-logger.ts).

## Enable / Disable (DevTools console on a Danbooru page)

```js
// Enable perf logging: persists across reloads
localStorage.setItem('di.perf.enabled', '1')

// Disable
localStorage.removeItem('di.perf.enabled')
// or: localStorage.setItem('di.perf.enabled', '0')

// Optional: enable the on-demand p95 stats dump (see "Stats" section below)
localStorage.setItem('di.perf.stats', '1')
```

**Reload required** after toggling — the flag is read once in the
`PerfLogger` constructor.

Runtime toggle without reload (in-memory only): `perfLogger.setEnabled(true)`
if you have a reference to the singleton in scope.

## Two-Stage Gating

1. **Build-time** (`__PERF_ENABLED__` in [build-flags.ts](../../build-flags.ts))
   - Set to `false` when building on `main` branch → logger body is
     dead-code-eliminated from the release bundle.
   - Set to `true` on every other branch.
   - Override via `DI_PERF=0` or `DI_PERF=1` env var.
2. **Runtime** (`localStorage['di.perf.enabled']`)
   - Even on dev/feature builds, logs only fire when the user opts in.

## API

```ts
perfLogger.mark(label, meta?)         // begin span (User Timing API mark too)
perfLogger.measure(label, meta?)      // end span, log delta, fire performance.measure
perfLogger.wrap(label, asyncFn, meta?) // mark/measure around an async call
perfLogger.event(label, deltaMs, meta?) // record a one-off measurement
perfLogger.stats(label) → {p50, p95, p99, count} | null
perfLogger.dumpStats()                // gated on di.perf.stats=1
```

`mark` / `measure` are the canonical names. `start` / `end` are kept as
aliases (legacy migration path) and share the same internals — mixing them
is safe.

`mark` / `measure` additionally drive the **User Timing API**
(`performance.mark` + `performance.measure`), so spans appear as entries in
the Chrome DevTools **Performance** panel. Open Performance → start
recording → reload page → spans show up under "User Timing".

## Label namespaces (`dbi:<channel>:<op>:<phase>`)

| Prefix | Scope |
|---|---|
| `dbi:db:sync:quick:*` | `quickSyncAllPosts` (≤1200 posts path) |
| `dbi:db:sync:full:*` | `syncAllPosts` (worker-pool path); suffix `.wN` = worker ID |
| `dbi:db:refresh:*` | `refreshAllStats` and per-distribution fetches |
| `dbi:render:total` | `renderDashboard` end-to-end |
| `dbi:render:precheck` / `dbi:render:precheck:*` | Pre-sync stats+total check |
| `dbi:net:fetchData:*` | Parallel `Promise.all` children in `fetchDashboardData` |
| `dbi:render:widget:*` | Individual widget render functions |

The `dbi:` root makes labels grep-friendly across the codebase and
distinguishes them from any browser-built-in performance entries.

## Log format

```
[Perf #42] dbi:db:sync:quick:page: 234.1ms (abs 1738ms) { page: 3, cursor: 'a12345', fetched: 200 }
```

- `#42` — monotonic sequence (helps order interleaved async logs)
- `234.1ms` — delta (`end - start`)
- `abs 1738ms` — `performance.now()` at end (relative to page load)
- trailing object — optional structured meta

## Stats (p50 / p95 / p99)

Every `measure` / `end` / `event` call also feeds a per-label ring buffer
(capacity 100, FIFO). Two ways to read it:

```js
// Programmatic — returns null if no samples yet.
perfLogger.stats('dbi:db:sync:full:bulkPut.w0')
// → { count: 100, p50: 18.4, p95: 32.1, p99: 41.0 }

// Console dump — gated on di.perf.stats=1; prints a ranked table.
perfLogger.dumpStats()
```

Percentiles are nearest-rank approximations (`sorted[ceil(p/100 * n) - 1]`),
which is accurate enough for tail-latency triage. Average values are
intentionally not exposed — they hide the long tail.

`dumpStats()` ranks labels by p95 descending, so the slowest spans surface
first. It is a no-op when `di.perf.stats` is unset, regardless of whether
`di.perf.enabled` is on, so leaving it on in code costs nothing.

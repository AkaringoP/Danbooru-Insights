# Debugging Guide

How to diagnose issues with Danbooru Insights on both desktop and mobile.

---

## 1. Diagnostic Panel

An in-page overlay that shows the internal state of all three apps (GrassApp, UserAnalyticsApp, TagAnalyticsApp) without needing browser DevTools.

### Activation

| Method | How | Best for |
|---|---|---|
| **URL hash** | Append `#di_diag` to the end of the page URL and reload | Mobile (quickest) |
| **localStorage** | Run `localStorage.setItem('di.diag.enabled', '1')` in DevTools, then reload | PC (persists across reloads) |

**To disable:** Remove the `#di_diag` hash, or run `localStorage.removeItem('di.diag.enabled')` and reload.

### Using the Panel

- The panel appears at the bottom of the page.
- **Sections** are collapsible — tap the header to expand/collapse.
- The section most relevant to the current page is expanded by default (GrassApp + UserAnalytics on profile pages, TagAnalytics on wiki/artist pages).
- **Copy** button copies all diagnostic data as plain text to the clipboard.
- **Close** hides the panel and leaves a small floating **DI** button in the bottom-right corner. Tap it to reopen.

### What Each Section Shows

#### System
- Script version, page URL, User-Agent, DB version, IndexedDB store list
- All `di*` / `danbooru*` localStorage keys and their values

#### GrassApp
- Cached user IDs in the database
- For each metric (uploads, approvals, notes):
  - Today's cached count
  - Last 7 days of cached counts
  - Current year local total
  - Remote count from Danbooru API (for uploads)
  - **Match/mismatch** comparison between local and remote
  - `completed_years` flag status
- Grass layout settings, last sync timestamp and age
- First 5 sample rows (for checking key format)

#### UserAnalyticsApp
- Total posts cached for the user
- Sync path indicator (Quick Sync vs Full Sync based on the 1200-post threshold)
- Recent 5 posts sample (ID, date, score, rating)
- `piestats` cache entries and their age
- `hourly_stats` and `user_stats` cache existence

#### TagAnalyticsApp
- Current tag name (extracted from URL)
- Cache existence and age, 24-hour expiry check
- Cached vs remote post count comparison
- Small tag optimization threshold check (1200 posts)
- Recently cached tags (up to 10, sorted by age)

---

## 2. Debug Logging

Structured console logs with module prefixes and severity levels.

### Enable

```js
// In browser DevTools console:
localStorage.setItem('di.debug.enabled', '1');
// Then reload the page
```

### Disable

```js
localStorage.removeItem('di.debug.enabled');
// Then reload
```

### Log Format

```
[DI:ModuleName] LEVEL  message  {structured meta}
```

**Levels:**
- `ERROR` / `WARN` — Always visible in console (never gated)
- `INFO` — Visible in dev/feature builds only (dead-code eliminated on `main`)
- `DEBUG` — Requires both a non-main build AND the runtime localStorage flag

### Build-Time vs Runtime Gating

Debug and performance logs use a **two-stage gating** system:

| Stage | What it controls | How it works |
|---|---|---|
| **Build-time** (`__DEBUG_ENABLED__` / `__PERF_ENABLED__`) | Whether `INFO`/`DEBUG`/`Perf` code exists in the bundle at all | Automatically set to `false` on the `main` branch. Vite replaces the constant with a literal `false`, and esbuild/terser removes the dead code entirely. On `develop`/`feature` branches it's `true`. |
| **Runtime** (`localStorage` flag) | Whether enabled code actually fires | Even on dev builds, `DEBUG` and `Perf` logs only fire when the user explicitly opts in via localStorage. |

**Practical implications:**
- On the **release build** (installed from GitHub): `INFO`, `DEBUG`, and `Perf` logs physically do not exist in the script — zero runtime cost, no way to enable them.
- On a **dev/feature build** (built locally): `ERROR`/`WARN` always visible. `INFO` visible immediately. `DEBUG` requires `di.debug.enabled`. `Perf` requires `di.perf.enabled`.

**How to check which build you have:**
1. Open DevTools Console on a Danbooru page with the script loaded
2. Any `[DI:*] INFO` message visible on page load → you're on a dev build
3. No `[DI:*]` messages at all (except errors) → you're on a release build

**Override at build time** (for local builds):
```sh
# Force debug logging ON even on main branch
DI_DEBUG=1 npm run build

# Force it OFF on any branch
DI_DEBUG=0 npm run build

# Same for performance logging
DI_PERF=1 npm run build
```

### Filtering in DevTools

Use the Console filter box to narrow down logs:
- `[DI:` — all Danbooru Insights logs
- `[DI:DataManager]` — GrassApp data layer only
- `[DI:Analytics]` — UserAnalytics data layer only
- `[DI:TagAnalytics]` — TagAnalytics app logs
- `ERROR` — errors only across all modules

### On Mobile Without DevTools

If you don't have DevTools access (e.g., mobile browser):
1. Use the **Diagnostic Panel** (Section 1 above) instead — it shows the most important state without needing the console.
2. Alternatively, inject a mobile console tool like [Eruda](https://github.com/nickstenning/eruda) or [vConsole](https://github.com/nickstenning/vconsole) via a bookmarklet.

---

## 3. Performance Logging

Detailed timing data for sync and render operations.

### Enable

```js
localStorage.setItem('di.perf.enabled', '1');
// Then reload
```

### Disable

```js
localStorage.removeItem('di.perf.enabled');
// Then reload
```

### Log Format

```
[Perf #42] sync.quick.page: 234.1ms (abs 1738ms) { page: 3, cursor: 'a12345', fetched: 200 }
```

- `#42` — monotonic sequence number
- `234.1ms` — operation duration
- `abs 1738ms` — absolute time since page load
- Trailing object — optional structured metadata

---

## 4. Common Diagnostic Scenarios

### "Today's count shows 0 but I uploaded posts"

1. Open the Diagnostic Panel (`#di_diag`)
2. In the **GrassApp** section, check:
   - `Today` row — is the count 0 or missing?
   - `Remote today` — does the API return the correct count?
   - `Today match` — does it say MISMATCH?
3. If mismatch: the local cache is stale. Try reloading the page to trigger a delta sync.
4. Copy the diagnostic output and include it in a bug report if the issue persists.

### "Pie charts won't load"

1. Open the Diagnostic Panel
2. In the **UserAnalyticsApp** section, check:
   - `Posts in DB` — is there data? If 0, sync hasn't completed.
   - `piestats entries` — are there cache entries? Check their age.
   - If piestats age is > 24h, the cache has expired and will refresh on next load.

### "Tag data seems outdated"

1. Open the Diagnostic Panel on the wiki/artist page
2. In the **TagAnalyticsApp** section, check:
   - `Cache expired (24h)` — if YES, data will refresh on next load.
   - `Count match` — if DIFF, the cached data has fewer posts than the live count.

---

## 5. Reporting Issues

1. Open the Diagnostic Panel on the affected page
2. Click **Copy** to copy all diagnostic data
3. Open a [GitHub Issue](https://github.com/AkaringoP/Danbooru-Insights/issues/new)
4. Paste the diagnostic output in a code block:

````
```
=== Danbooru Insights Diagnostic ===
(paste here)
```
````

This gives maintainers the exact DB state, cache ages, and remote comparison data needed to diagnose the issue.

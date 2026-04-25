/**
 * Lightweight performance logger for instrumenting hot paths.
 *
 * Two-stage gating:
 *   1. Build-time (`__PERF_ENABLED__`): the entire logger body is dead-code
 *      eliminated in release builds (main branch). See build-flags.ts.
 *   2. Runtime (`localStorage['di.perf.enabled']`): on dev/feature builds,
 *      users must explicitly opt in before any log fires.
 *
 * Usage in DevTools (only on dev/feature branch builds):
 *   localStorage.setItem('di.perf.enabled', '1')      // then reload
 *   localStorage.setItem('di.perf.stats', '1')        // enable stats dump
 *
 * When either gate is off, every method short-circuits on a single boolean
 * check, so no measurable cost is paid.
 *
 * P5 additions:
 *   - `mark(label, meta?)` / `measure(label, meta?)` — new canonical names.
 *     They mirror `start`/`end` and additionally drive the User Timing API
 *     (`performance.mark` / `performance.measure`), so spans show up in the
 *     Chrome DevTools Performance panel and any RUM agent that listens to
 *     `PerformanceObserver`.
 *   - Sample ring buffer (capacity 100 per label) feeds `stats(label)`,
 *     which returns nearest-rank p50/p95/p99. `dumpStats()` prints the
 *     ranked table to the console when `di.perf.stats=1` is set.
 *   - `start`/`end` are retained as aliases for backward compatibility
 *     until the prefix rewrite (Task 3.2) lands; they share the same
 *     internal path so all sites contribute to the stats buffer.
 */

// Injected by Vite/Vitest `define` (see build-flags.ts). Replaced at build
// time with a boolean literal, enabling dead-code elimination on main.
declare const __PERF_ENABLED__: boolean;

const ENABLED_KEY = 'di.perf.enabled';
const STATS_KEY = 'di.perf.stats';

/** Maximum samples retained per label. Older entries are evicted FIFO. */
const SAMPLE_BUFFER_SIZE = 100;

/** Optional structured metadata attached to a log entry. */
export type PerfMeta = Record<string, unknown>;

/** Result of `stats(label)` — nearest-rank approximation of percentiles. */
export interface PerfStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
}

class PerfLogger {
  private enabled: boolean;
  private readonly marks = new Map<string, number>();
  /** Per-label ring buffer of recent deltas (ms). FIFO when over capacity. */
  private readonly samples = new Map<string, number[]>();
  private seq = 0;

  constructor() {
    this.enabled = __PERF_ENABLED__ ? this.readFlag() : false;
  }

  private readFlag(): boolean {
    try {
      return localStorage.getItem(ENABLED_KEY) === '1';
    } catch {
      // localStorage can throw in private mode / sandboxed contexts.
      return false;
    }
  }

  /** Whether the logger is currently active (both gates on). */
  isEnabled(): boolean {
    return __PERF_ENABLED__ && this.enabled;
  }

  /**
   * Toggle at runtime without reload. Also persists for next session.
   * No-op in release builds (build-time gate off).
   */
  setEnabled(on: boolean): void {
    if (!__PERF_ENABLED__) return;
    this.enabled = on;
    try {
      localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
    } catch {
      // Ignore storage failures; in-memory toggle still applies.
    }
  }

  /**
   * Begin timing `label`. Records the start time and emits a User Timing
   * API mark so the span is visible in the DevTools Performance panel.
   * Overwrites any prior unmatched mark for the same label.
   */
  mark(label: string, meta?: PerfMeta): void {
    if (!__PERF_ENABLED__) return;
    if (!this.enabled) return;
    this.marks.set(label, performance.now());
    try {
      // `performance.mark` is fire-and-forget; failures are non-fatal.
      performance.mark(`${label}:start`, meta ? {detail: meta} : undefined);
    } catch {
      // Some environments (e.g. very old browsers, sandboxed iframes)
      // reject custom marks; ignore.
    }
  }

  /**
   * End timing `label`, log the delta, push it into the stats buffer,
   * and emit a User Timing API measure so the span is visible alongside
   * other Performance entries. No-op if there is no matching `mark()`
   * (or `start()`).
   *
   * Returns the measured duration in ms, or `undefined` if disabled
   * or unmatched.
   */
  measure(label: string, meta?: PerfMeta): number | undefined {
    if (!__PERF_ENABLED__) return undefined;
    if (!this.enabled) return undefined;
    const startTime = this.marks.get(label);
    if (startTime === undefined) return undefined;
    this.marks.delete(label);
    const now = performance.now();
    const delta = now - startTime;
    try {
      performance.mark(`${label}:end`, meta ? {detail: meta} : undefined);
      performance.measure(label, `${label}:start`, `${label}:end`);
      // Drop the temporary marks to prevent unbounded buffer growth in
      // the User Timing API. The measure entry itself is preserved.
      performance.clearMarks(`${label}:start`);
      performance.clearMarks(`${label}:end`);
    } catch {
      // Marks may have been cleared elsewhere or never created in
      // sandboxed contexts; the console log + sample buffer still apply.
    }
    this.emit(label, delta, now, meta);
    return delta;
  }

  /** Legacy alias for `mark`. Retained until the Task 3.2 rewrite lands. */
  start(label: string): void {
    this.mark(label);
  }

  /** Legacy alias for `measure`. Retained until the Task 3.2 rewrite lands. */
  end(label: string, meta?: PerfMeta): number | undefined {
    return this.measure(label, meta);
  }

  /**
   * Wrap an async function with mark/measure timing. The timing is recorded
   * even if the function throws. Returns the function's result.
   */
  async wrap<T>(
    label: string,
    fn: () => Promise<T>,
    meta?: PerfMeta,
  ): Promise<T> {
    if (!__PERF_ENABLED__) return fn();
    if (!this.enabled) return fn();
    this.mark(label);
    try {
      return await fn();
    } finally {
      this.measure(label, meta);
    }
  }

  /**
   * Record a one-off measurement without start/end pairing.
   * Useful for reporting durations computed elsewhere (e.g., from a callback).
   */
  event(label: string, delta: number, meta?: PerfMeta): void {
    if (!__PERF_ENABLED__) return;
    if (!this.enabled) return;
    this.emit(label, delta, performance.now(), meta);
  }

  /**
   * Return nearest-rank p50/p95/p99 over the last up to 100 samples for
   * `label`. `null` when no samples have been recorded.
   */
  stats(label: string): PerfStats | null {
    if (!__PERF_ENABLED__) return null;
    const buf = this.samples.get(label);
    if (!buf || buf.length === 0) return null;
    const sorted = [...buf].sort((a, b) => a - b);
    return {
      count: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    };
  }

  /**
   * Print a ranked table of every label's p95 to the console. Gated on
   * `localStorage['di.perf.stats'] === '1'` so it stays silent unless
   * explicitly enabled — useful for ad-hoc debugging without log noise.
   */
  dumpStats(): void {
    if (!__PERF_ENABLED__) return;
    if (!this.enabled) return;
    let allow = false;
    try {
      allow = localStorage.getItem(STATS_KEY) === '1';
    } catch {
      return;
    }
    if (!allow) return;

    const labels = [...this.samples.keys()];
    if (labels.length === 0) {
      console.log('[Perf:Stats] (no samples)');
      return;
    }
    const rows = labels
      .map(l => ({label: l, stats: this.stats(l)!}))
      .filter(r => r.stats !== null)
      .sort((a, b) => b.stats.p95 - a.stats.p95);
    console.log('[Perf:Stats] Ranked by p95 (count, p50/p95/p99 ms):');
    rows.forEach(r => {
      console.log(
        `  ${r.label}: n=${r.stats.count}, p50=${r.stats.p50.toFixed(1)}, p95=${r.stats.p95.toFixed(1)}, p99=${r.stats.p99.toFixed(1)}`,
      );
    });
  }

  private recordSample(label: string, delta: number): void {
    let buf = this.samples.get(label);
    if (!buf) {
      buf = [];
      this.samples.set(label, buf);
    }
    buf.push(delta);
    if (buf.length > SAMPLE_BUFFER_SIZE) {
      // FIFO eviction so the buffer always reflects the most recent
      // SAMPLE_BUFFER_SIZE measurements.
      buf.shift();
    }
  }

  private emit(
    label: string,
    delta: number,
    abs: number,
    meta?: PerfMeta,
  ): void {
    this.seq++;
    this.recordSample(label, delta);
    const prefix = `[Perf #${this.seq}] ${label}: ${delta.toFixed(1)}ms (abs ${abs.toFixed(0)}ms)`;
    if (meta && Object.keys(meta).length > 0) {
      console.log(prefix, meta);
    } else {
      console.log(prefix);
    }
  }
}

/** Nearest-rank percentile on a pre-sorted ascending array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

/** Shared singleton — import where instrumentation is needed. */
export const perfLogger = new PerfLogger();

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
 *   localStorage.setItem('di.perf.enabled', '1')  // then reload
 *
 * When either gate is off, every method short-circuits on a single boolean
 * check, so no measurable cost is paid.
 */

// Injected by Vite/Vitest `define` (see build-flags.ts). Replaced at build
// time with a boolean literal, enabling dead-code elimination on main.
declare const __PERF_ENABLED__: boolean;

const ENABLED_KEY = 'di.perf.enabled';

/** Optional structured metadata attached to a log entry. */
export type PerfMeta = Record<string, unknown>;

class PerfLogger {
  private enabled: boolean;
  private readonly marks = new Map<string, number>();
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

  /** Begin timing `label`. Overwrites any prior unmatched mark. */
  start(label: string): void {
    if (!__PERF_ENABLED__) return;
    if (!this.enabled) return;
    this.marks.set(label, performance.now());
  }

  /**
   * End timing `label` and log the delta.
   * No-op if there is no matching `start()`.
   * Returns the measured duration in ms, or undefined if disabled/unmatched.
   */
  end(label: string, meta?: PerfMeta): number | undefined {
    if (!__PERF_ENABLED__) return undefined;
    if (!this.enabled) return undefined;
    const startTime = this.marks.get(label);
    if (startTime === undefined) return undefined;
    this.marks.delete(label);
    const now = performance.now();
    const delta = now - startTime;
    this.emit(label, delta, now, meta);
    return delta;
  }

  /**
   * Wrap an async function with start/end timing. The timing is recorded
   * even if the function throws. Returns the function's result.
   */
  async wrap<T>(
    label: string,
    fn: () => Promise<T>,
    meta?: PerfMeta,
  ): Promise<T> {
    if (!__PERF_ENABLED__) return fn();
    if (!this.enabled) return fn();
    this.start(label);
    try {
      return await fn();
    } finally {
      this.end(label, meta);
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

  private emit(
    label: string,
    delta: number,
    abs: number,
    meta?: PerfMeta,
  ): void {
    this.seq++;
    const prefix = `[Perf #${this.seq}] ${label}: ${delta.toFixed(1)}ms (abs ${abs.toFixed(0)}ms)`;
    if (meta && Object.keys(meta).length > 0) {
      console.log(prefix, meta);
    } else {
      console.log(prefix);
    }
  }
}

/** Shared singleton — import where instrumentation is needed. */
export const perfLogger = new PerfLogger();

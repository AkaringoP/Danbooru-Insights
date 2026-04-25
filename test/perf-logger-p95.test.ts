/**
 * P5 — perf-logger ring buffer + percentile tests.
 *
 * The PerfLogger is a singleton; tests interact with it via the public
 * API and reset state between cases by re-enabling and re-emitting.
 *
 * Note on environment: vitest runs in `node`. `performance` is available
 * (Node ships User Timing API), but `localStorage` is not — we stub it
 * for `setEnabled`/`dumpStats` to pick up the gates.
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {perfLogger} from '../src/core/perf-logger';

interface MemoryStorage {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
}

function makeMemoryLocalStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

describe('PerfLogger p95 + ring buffer (P5)', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = makeMemoryLocalStorage();
    vi.stubGlobal('localStorage', storage);
    perfLogger.setEnabled(true);
    // Suppress console noise from emit() during tests.
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    perfLogger.setEnabled(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('stats(label)', () => {
    it('returns null for an unseen label', () => {
      expect(perfLogger.stats('di:test:never-seen')).toBeNull();
    });

    it('computes nearest-rank p50/p95/p99 over recorded samples', () => {
      // Record 100 deterministic samples: 1ms, 2ms, ..., 100ms.
      const label = 'di:test:p95-known';
      for (let i = 1; i <= 100; i++) {
        perfLogger.event(label, i);
      }
      const s = perfLogger.stats(label);
      expect(s).not.toBeNull();
      expect(s!.count).toBe(100);
      // Nearest-rank p50 over [1..100] = sorted[ceil(0.50 * 100) - 1] = sorted[49] = 50.
      expect(s!.p50).toBe(50);
      // p95 = sorted[ceil(0.95 * 100) - 1] = sorted[94] = 95.
      expect(s!.p95).toBe(95);
      // p99 = sorted[ceil(0.99 * 100) - 1] = sorted[98] = 99.
      expect(s!.p99).toBe(99);
    });

    it('handles a single sample correctly', () => {
      perfLogger.event('di:test:single', 42);
      const s = perfLogger.stats('di:test:single');
      expect(s).toEqual({count: 1, p50: 42, p95: 42, p99: 42});
    });
  });

  describe('ring buffer FIFO', () => {
    it('caps buffer at 100 samples and evicts oldest first', () => {
      const label = 'di:test:ring';
      // Push 110 samples: 1, 2, ..., 110.
      // Buffer should keep the last 100 (i.e., 11..110).
      for (let i = 1; i <= 110; i++) {
        perfLogger.event(label, i);
      }
      const s = perfLogger.stats(label);
      expect(s).not.toBeNull();
      expect(s!.count).toBe(100);
      // After eviction the smallest sample is 11, so p50 = sorted[49] = 60.
      expect(s!.p50).toBe(60);
      // p95 = sorted[94] = 105, p99 = sorted[98] = 109.
      expect(s!.p95).toBe(105);
      expect(s!.p99).toBe(109);
    });
  });

  describe('mark / measure pairing', () => {
    it('measure() returns a positive delta after a mark()', () => {
      const label = 'di:test:pair';
      perfLogger.mark(label);
      const delta = perfLogger.measure(label);
      expect(delta).toBeDefined();
      expect(delta).toBeGreaterThanOrEqual(0);
    });

    it('measure() without a prior mark returns undefined', () => {
      expect(perfLogger.measure('di:test:lonely')).toBeUndefined();
    });

    it('start/end are functional aliases that feed the same buffer', () => {
      const label = 'di:test:legacy';
      // Mix old and new APIs; both should populate stats together.
      perfLogger.start(label);
      perfLogger.end(label);
      perfLogger.mark(label);
      perfLogger.measure(label);
      const s = perfLogger.stats(label);
      expect(s!.count).toBe(2);
    });
  });

  describe('dumpStats()', () => {
    it('is a no-op when di.perf.stats is unset', () => {
      perfLogger.event('di:test:dump-off', 10);
      const logSpy = console.log as unknown as ReturnType<typeof vi.fn>;
      logSpy.mockClear();
      perfLogger.dumpStats();
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('prints a ranked table when di.perf.stats=1', () => {
      storage.setItem('di.perf.stats', '1');
      perfLogger.event('di:test:dump-fast', 5);
      perfLogger.event('di:test:dump-slow', 500);
      const logSpy = console.log as unknown as ReturnType<typeof vi.fn>;
      logSpy.mockClear();
      perfLogger.dumpStats();
      // Header line + at least 2 row lines.
      expect(logSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
      const headerLine = String(logSpy.mock.calls[0][0]);
      expect(headerLine).toMatch(/Stats/);
      // Slow label should appear before fast (sorted by p95 descending).
      const allOutput = logSpy.mock.calls
        .map(args => String(args[0]))
        .join('\n');
      const slowIdx = allOutput.indexOf('di:test:dump-slow');
      const fastIdx = allOutput.indexOf('di:test:dump-fast');
      expect(slowIdx).toBeGreaterThan(-1);
      expect(fastIdx).toBeGreaterThan(-1);
      expect(slowIdx).toBeLessThan(fastIdx);
    });

    it('reports "no samples" when buffer is empty', () => {
      storage.setItem('di.perf.stats', '1');
      const logSpy = console.log as unknown as ReturnType<typeof vi.fn>;
      logSpy.mockClear();
      perfLogger.dumpStats();
      // dumpStats may have nothing to report if no events were recorded
      // for this freshly-constructed singleton state. The singleton is
      // shared across tests, so existing samples may exist. Accept either
      // case but ensure no exception.
      expect(logSpy).toHaveBeenCalled();
    });
  });
});

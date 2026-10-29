import {describe, it, expect, beforeAll, beforeEach, vi} from 'vitest';
import {
  clearCapturedLogs,
  formatLogArg,
  getCapturedLogs,
  installLogCapture,
} from '../src/dev/log-capture';

describe('formatLogArg', () => {
  it('passes strings through', () => {
    expect(formatLogArg('hello')).toBe('hello');
  });

  it('renders Error as name: message, also when nested in meta', () => {
    expect(formatLogArg(new TypeError('boom'))).toBe('TypeError: boom');
    expect(formatLogArg({page: 221, error: new Error('HTTP 500')})).toBe(
      '{"page":221,"error":"Error: HTTP 500"}',
    );
  });

  it('survives circular objects', () => {
    const a: Record<string, unknown> = {x: 1};
    a.self = a;
    expect(formatLogArg(a)).toBe('{"x":1,"self":"[Circular]"}');
  });

  it('truncates very long values', () => {
    const obj = formatLogArg({s: 'z'.repeat(5000)});
    expect(obj.length).toBe(2001);
    expect(obj.endsWith('…')).toBe(true);
  });

  it('handles undefined and functions', () => {
    expect(formatLogArg(undefined)).toBe('undefined');
    expect(formatLogArg(() => 1)).toContain('=>');
  });
});

describe('installLogCapture', () => {
  const originals = {
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };

  beforeAll(() => {
    // Swap in spies *before* install so the wrapper calls through to them.
    console.warn = originals.warn;
    console.error = originals.error;
    console.log = originals.log;
    console.info = originals.info;
    console.debug = originals.debug;
    installLogCapture();
    installLogCapture(); // idempotent — must not double-wrap
  });

  beforeEach(() => {
    clearCapturedLogs();
    for (const fn of Object.values(originals)) fn.mockClear();
  });

  it('captures every warn/error and still calls through once', () => {
    console.warn('[DI:Analytics] WARN Page fetch attempt failed', {page: 221});
    console.error('third-party error');
    const logs = getCapturedLogs();
    expect(logs.map(l => l.level)).toEqual(['warn', 'error']);
    expect(logs[0].text).toBe(
      '[DI:Analytics] WARN Page fetch attempt failed {"page":221}',
    );
    expect(originals.warn).toHaveBeenCalledTimes(1);
    expect(originals.error).toHaveBeenCalledTimes(1);
  });

  it('captures log/info/debug only for our own prefixes', () => {
    console.log('[DI:Grass] INFO synced');
    console.log('[Perf #3] dbi:db:sync:full:total: 10ms');
    console.info('unrelated page noise');
    console.debug('[DI:Analytics] DEBUG detail');
    expect(getCapturedLogs().map(l => l.text)).toEqual([
      '[DI:Grass] INFO synced',
      '[Perf #3] dbi:db:sync:full:total: 10ms',
      '[DI:Analytics] DEBUG detail',
    ]);
    expect(originals.info).toHaveBeenCalledWith('unrelated page noise');
  });

  it('keeps only the newest 500 lines', () => {
    for (let i = 0; i < 520; i++) console.warn(`w${i}`);
    const logs = getCapturedLogs();
    expect(logs).toHaveLength(500);
    expect(logs[0].text).toBe('w20');
    expect(logs[499].text).toBe('w519');
  });
});

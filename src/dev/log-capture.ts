/**
 * In-memory console capture for the diagnostic panel.
 *
 * Mobile browsers have no DevTools, so WARN/ERROR lines such as the
 * worker-pool sync's `Page failed, stopping sync` are invisible there.
 * When the diagnostic gate is on, main.ts installs this capture before any
 * app runs; the panel's Logs section then reads the buffer back and the
 * Copy button exports it with the rest of the report.
 *
 * Captured:
 *   - every `console.warn` / `console.error` call (ours and anyone else's)
 *   - `console.log` / `console.info` / `console.debug` lines that carry our
 *     own `[DI:` or `[Perf` prefix (INFO / DEBUG / perf-logger output)
 *
 * The originals are always called through, so DevTools output is unchanged.
 * Like the rest of dev/, this module imports nothing from core/ui/apps — it
 * wraps console rather than hooking the app logger.
 */

export interface CapturedLog {
  /** Milliseconds since page load (performance.now()). */
  t: number;
  level: 'log' | 'info' | 'debug' | 'warn' | 'error';
  text: string;
}

const CAPACITY = 500;
const MAX_ARG_CHARS = 2000;
const OWN_PREFIXES = ['[DI:', '[Perf'];

const buffer: CapturedLog[] = [];
let installed = false;

/** Render one console argument as text, Error-aware and cycle-safe. */
export function formatLogArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg === undefined) return 'undefined';
  let text: string;
  try {
    const seen = new WeakSet<object>();
    text = JSON.stringify(arg, (_key, value: unknown) => {
      if (value instanceof Error) return `${value.name}: ${value.message}`;
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
  } catch {
    text = String(arg);
  }
  if (text === undefined) text = String(arg);
  return text.length > MAX_ARG_CHARS
    ? `${text.slice(0, MAX_ARG_CHARS)}…`
    : text;
}

function record(level: CapturedLog['level'], args: unknown[]): void {
  buffer.push({
    t: performance.now(),
    level,
    text: args.map(formatLogArg).join(' '),
  });
  if (buffer.length > CAPACITY) buffer.shift();
}

function isOwnLine(args: unknown[]): boolean {
  const first = args[0];
  return (
    typeof first === 'string' && OWN_PREFIXES.some(p => first.startsWith(p))
  );
}

/**
 * Start mirroring console output into the ring buffer. Idempotent.
 */
export function installLogCapture(): void {
  if (installed) return;
  installed = true;

  const levels: CapturedLog['level'][] = [
    'log',
    'info',
    'debug',
    'warn',
    'error',
  ];
  for (const level of levels) {
    const original = console[level].bind(console);
    const alwaysCapture = level === 'warn' || level === 'error';
    console[level] = (...args: unknown[]) => {
      try {
        if (alwaysCapture || isOwnLine(args)) record(level, args);
      } catch {
        // Capture must never break the caller's logging.
      }
      original(...args);
    };
  }
}

/** Snapshot of captured lines, oldest first. */
export function getCapturedLogs(): CapturedLog[] {
  return buffer.slice();
}

/** Test hook: empty the buffer without uninstalling. */
export function clearCapturedLogs(): void {
  buffer.length = 0;
}

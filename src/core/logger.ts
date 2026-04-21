/**
 * Structured application logger for Danbooru Insights.
 *
 * Two-stage gating (same pattern as perf-logger.ts):
 *   1. Build-time (`__DEBUG_ENABLED__`): INFO and DEBUG levels are
 *      dead-code eliminated in release builds (main branch).
 *   2. Runtime (`localStorage['di.debug.enabled']`): on dev/feature builds,
 *      DEBUG level requires explicit opt-in.
 *
 * ERROR and WARN always fire regardless of gates — they indicate issues
 * that should always be visible in the console.
 *
 * Usage:
 *   import { createLogger } from '../core/logger';
 *   const log = createLogger('DataManager');
 *   log.error('Sync failed', { userId: 123, status: 429 });
 *   log.warn('Cache expired, refetching', { tagName: 'hatsune_miku' });
 *   log.info('Delta sync complete', { rowsUpdated: 42 });
 *   log.debug('Page fetched', { page: 3, cursor: 'a12345' });
 *
 * Enable DEBUG in DevTools (only on dev/feature branch builds):
 *   localStorage.setItem('di.debug.enabled', '1')  // then reload
 */

// Injected by Vite/Vitest `define` (see build-flags.ts). Replaced at build
// time with a boolean literal, enabling dead-code elimination on main.
declare const __DEBUG_ENABLED__: boolean;

const DEBUG_KEY = 'di.debug.enabled';

/** Optional structured metadata attached to a log entry. */
export type LogMeta = Record<string, unknown>;

export interface Logger {
  error(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  debug(message: string, meta?: LogMeta): void;
}

/** Read the runtime debug flag from localStorage. */
function readDebugFlag(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    // localStorage can throw in private mode / sandboxed contexts.
    return false;
  }
}

// Module-level cached flag — read once on load, same as PerfLogger.
const runtimeDebugEnabled: boolean = __DEBUG_ENABLED__
  ? readDebugFlag()
  : false;

function formatPrefix(module: string, level: string): string {
  return `[DI:${module}] ${level}`;
}

function emit(
  consoleFn: (...args: unknown[]) => void,
  module: string,
  level: string,
  message: string,
  meta?: LogMeta,
): void {
  const prefix = formatPrefix(module, level);
  if (meta && Object.keys(meta).length > 0) {
    consoleFn(`${prefix} ${message}`, meta);
  } else {
    consoleFn(`${prefix} ${message}`);
  }
}

/**
 * Create a logger scoped to a module name.
 *
 * @param module - Short module identifier (e.g. 'DataManager', 'TagAnalytics')
 */
export function createLogger(module: string): Logger {
  return {
    error(message: string, meta?: LogMeta): void {
      // ERROR always fires — no gating.
      emit(console.error.bind(console), module, 'ERROR', message, meta);
    },

    warn(message: string, meta?: LogMeta): void {
      // WARN always fires — no gating.
      emit(console.warn.bind(console), module, 'WARN', message, meta);
    },

    info(message: string, meta?: LogMeta): void {
      // INFO is gated by build flag only.
      if (!__DEBUG_ENABLED__) return;
      emit(console.log.bind(console), module, 'INFO', message, meta);
    },

    debug(message: string, meta?: LogMeta): void {
      // DEBUG is gated by both build flag and runtime flag.
      if (!__DEBUG_ENABLED__) return;
      if (!runtimeDebugEnabled) return;
      emit(console.log.bind(console), module, 'DEBUG', message, meta);
    },
  };
}

/**
 * Convert an HTTP status code to a user-friendly error message.
 * Technical details (status code, URL) should go to the console via the logger;
 * this message is for display in toasts or error panels.
 */
export function httpErrorMessage(status: number): string {
  switch (status) {
    case 429:
      return 'Too many requests. Please wait a moment.';
    case 503:
      return 'Server is temporarily unavailable.';
    case 404:
      return 'Data not found.';
    case 403:
      return 'Access denied.';
    case 500:
      return 'Server error occurred.';
    default:
      return 'An error occurred while loading data.';
  }
}

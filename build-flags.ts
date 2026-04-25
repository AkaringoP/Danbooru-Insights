import {execSync} from 'node:child_process';

/**
 * Detect the current git branch. Returns 'main' if detection fails.
 * Cached so multiple flag detectors share one exec call.
 */
function getCurrentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'main';
  }
}

/**
 * Build-time flag: whether the performance-logging code path should be
 * compiled into the output bundle.
 *
 * Resolution order:
 *   1. `DI_PERF=0` or `DI_PERF=1` — explicit override always wins.
 *   2. Disabled on the `main` branch (release builds).
 *   3. Enabled on every other branch (develop / feature / hotfix).
 *
 * Vite replaces the `__PERF_ENABLED__` constant at build time with the
 * literal boolean, allowing esbuild/terser to dead-code-eliminate every
 * gated branch in release builds.
 */
export function detectPerfLoggingEnabled(): boolean {
  if (process.env.DI_PERF === '0') return false;
  if (process.env.DI_PERF === '1') return true;
  return getCurrentBranch() !== 'main';
}

/**
 * Build-time flag: whether INFO/DEBUG log levels in the structured logger
 * should be compiled into the output bundle.
 *
 * Resolution order:
 *   1. `DI_DEBUG=0` or `DI_DEBUG=1` — explicit override always wins.
 *   2. Disabled on the `main` branch (release builds).
 *   3. Enabled on every other branch (develop / feature / hotfix).
 *
 * ERROR and WARN are never gated — they always fire in all builds.
 * Vite replaces the `__DEBUG_ENABLED__` constant at build time.
 */
export function detectDebugLoggingEnabled(): boolean {
  if (process.env.DI_DEBUG === '0') return false;
  if (process.env.DI_DEBUG === '1') return true;
  return getCurrentBranch() !== 'main';
}

/**
 * Build-time variant: selects the UserScript metadata flavor (name, namespace,
 * updateURL branch) baked into the bundle header.
 *
 * Resolution order:
 *   1. `DI_BUILD_VARIANT=prod` or `=dev` — explicit override always wins.
 *   2. `prod` on the `main` branch (release builds).
 *   3. `dev` on every other branch (develop / feature / hotfix).
 *
 * The `dev` variant uses a distinct `@name` and `@namespace` so it can be
 * installed alongside the release build in Tampermonkey without collision.
 */
export function detectBuildVariant(): 'dev' | 'prod' {
  const override = process.env.DI_BUILD_VARIANT;
  if (override === 'prod') return 'prod';
  if (override === 'dev') return 'dev';
  return getCurrentBranch() === 'main' ? 'prod' : 'dev';
}

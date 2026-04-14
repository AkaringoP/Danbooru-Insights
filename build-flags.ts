import {execSync} from 'node:child_process';

/**
 * Build-time flag: whether the performance-logging code path should be
 * compiled into the output bundle.
 *
 * Resolution order:
 *   1. `DI_PERF=0` or `DI_PERF=1` — explicit override always wins.
 *   2. Disabled on the `main` branch (release builds).
 *   3. Enabled on every other branch (develop / feature / hotfix).
 *   4. Disabled if git is unavailable or detection fails.
 *
 * Vite replaces the `__PERF_ENABLED__` constant at build time with the
 * literal boolean, allowing esbuild/terser to dead-code-eliminate every
 * gated branch in release builds.
 */
export function detectPerfLoggingEnabled(): boolean {
  if (process.env.DI_PERF === '0') return false;
  if (process.env.DI_PERF === '1') return true;
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return branch !== 'main';
  } catch {
    return false;
  }
}

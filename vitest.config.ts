/// <reference types="vitest" />
import {defineConfig} from 'vitest/config';

export default defineConfig({
  define: {
    // Tests always exercise the enabled paths. Build-time gating (off on
    // `main` via build-flags.ts) is purely a release-bundle optimization
    // — verified by bundle inspection, not by vitest. If we honored the
    // branch fallback here, perfLogger / logger.debug tests would
    // silently no-op on the `main` branch and only catch regressions on
    // dev/feature branches.
    __PERF_ENABLED__: JSON.stringify(true),
    __DEBUG_ENABLED__: JSON.stringify(true),
  },
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
    exclude: ['build/**', 'dist/**', 'node_modules/**'],
  },
});

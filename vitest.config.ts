/// <reference types="vitest" />
import {defineConfig} from 'vitest/config';
import {
  detectPerfLoggingEnabled,
  detectDebugLoggingEnabled,
} from './build-flags';

export default defineConfig({
  define: {
    __PERF_ENABLED__: JSON.stringify(detectPerfLoggingEnabled()),
    __DEBUG_ENABLED__: JSON.stringify(detectDebugLoggingEnabled()),
  },
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
    exclude: ['build/**', 'dist/**', 'node_modules/**'],
  },
});

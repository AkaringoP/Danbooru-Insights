import {defineConfig} from 'vite';
import monkey from 'vite-plugin-monkey';
import {APP_VERSION} from './src/version';
import {
  detectPerfLoggingEnabled,
  detectDebugLoggingEnabled,
} from './build-flags';

const perfEnabled = detectPerfLoggingEnabled();
const debugEnabled = detectDebugLoggingEnabled();
const isDev = process.env.DI_BUILD_VARIANT === 'dev';
console.log(
  `[build-flags] __PERF_ENABLED__ = ${perfEnabled}, __DEBUG_ENABLED__ = ${debugEnabled}, variant = ${isDev ? 'dev' : 'prod'}`,
);

const rawBaseURL = 'https://github.com/AkaringoP/Danbooru-Insights/raw';
const publishBranch = isDev ? 'testbuild' : 'build';
const scriptName = isDev ? 'Danbooru Insights (dev)' : 'Danbooru Insights';
const scriptURL = `${rawBaseURL}/${publishBranch}/danbooruinsights.user.js`;

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __PERF_ENABLED__: JSON.stringify(perfEnabled),
    __DEBUG_ENABLED__: JSON.stringify(debugEnabled),
  },
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: scriptName,
        namespace: isDev
          ? 'http://tampermonkey.net/danbooru-insights-dev'
          : 'http://tampermonkey.net/',
        version: APP_VERSION,
        description:
          'Injects a GitHub-style contribution graph and advanced analytics dashboard into Danbooru profile and wiki pages.',
        author: 'AkaringoP with Claude Code',
        match: [
          'https://*.donmai.us/users/*',
          'https://*.donmai.us/profile',
          'https://*.donmai.us/wiki_pages*',
          'https://*.donmai.us/artists/*',
        ],
        grant: 'none',
        icon: 'https://danbooru.donmai.us/favicon.ico',
        homepageURL: 'https://github.com/AkaringoP/Danbooru-Insights',
        updateURL: scriptURL,
        downloadURL: scriptURL,
        require: [
          'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
          'https://cdn.jsdelivr.net/npm/d3-cloud@1.2.7/build/d3.layout.cloud.min.js',
          'https://cdn.jsdelivr.net/npm/cal-heatmap@4.2.4/dist/cal-heatmap.min.js',
          'https://cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.min.js',
        ],
      },
      build: {
        externalGlobals: {
          d3: 'd3',
          'cal-heatmap': 'CalHeatmap',
          dexie: 'Dexie',
        },
      },
    }),
  ],
});

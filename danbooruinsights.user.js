// ==UserScript==
// @name         Danbooru Insights (dev)
// @namespace    http://tampermonkey.net/danbooru-insights-dev
// @version      9.4.5
// @author       AkaringoP with Claude Code
// @description  Injects a GitHub-style contribution graph and advanced analytics dashboard into Danbooru profile and wiki pages.
// @icon         https://danbooru.donmai.us/favicon.ico
// @homepageURL  https://github.com/AkaringoP/Danbooru-Insights
// @downloadURL  https://github.com/AkaringoP/Danbooru-Insights/raw/testbuild/danbooruinsights.user.js
// @updateURL    https://github.com/AkaringoP/Danbooru-Insights/raw/testbuild/danbooruinsights.user.js
// @match        https://*.donmai.us/users/*
// @match        https://*.donmai.us/profile
// @match        https://*.donmai.us/wiki_pages*
// @match        https://*.donmai.us/artists/*
// @require      https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js
// @require      https://cdn.jsdelivr.net/npm/d3-cloud@1.2.7/build/d3.layout.cloud.min.js
// @require      https://cdn.jsdelivr.net/npm/cal-heatmap@4.2.4/dist/cal-heatmap.min.js
// @require      https://cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.min.js
// @grant        none
// ==/UserScript==

(function (Dexie, d3) {
  'use strict';

  function _interopNamespaceDefault(e) {
    const n = Object.create(null, { [Symbol.toStringTag]: { value: 'Module' } });
    if (e) {
      for (const k in e) {
        if (k !== 'default') {
          const d = Object.getOwnPropertyDescriptor(e, k);
          Object.defineProperty(n, k, d.get ? d : {
            enumerable: true,
            get: () => e[k]
          });
        }
      }
    }
    n.default = e;
    return Object.freeze(n);
  }

  const d3__namespace = _interopNamespaceDefault(d3);

  const DAY_MS = 864e5;
  const CONFIG = {
    STORAGE_PREFIX: "danbooru_contrib_",
    CLEANUP_THRESHOLD_MS: 7 * DAY_MS,

MAX_OPTIMIZED_POSTS: 1200,
REPORT_COOLDOWN_MS: 3e3,
ANALYTICS_CLEANUP_THRESHOLD_MS: 14 * DAY_MS,
CACHE_EXPIRY_MS: DAY_MS,
BACKOFF_DURATION_MS: 5e3,
    RATE_LIMITER: { concurrency: 6, jitter: [0, 50], rps: 6 },
    TAB_COORDINATOR: {
      channelName: "di-rate-coord",
      heartbeatInterval: 5e3,
      staleTimeout: 15e3
    },
    SELECTORS: {
      STATISTICS_SECTION: "div.user-statistics"
    },
    THEMES: {
light: {
        name: "Light",
        bg: "#ffffff",
        empty: "#ebedf0",
        text: "#24292f",
        levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
        grassOptions: [
          {
            name: "Green",
            levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"]
          },
          {
            name: "Blues",
            levels: ["#ebedf0", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"]
          },
          {
            name: "Purples",
            levels: ["#ebedf0", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"]
          },
          {
            name: "Oranges",
            levels: ["#ebedf0", "#fdbe85", "#fd8d3c", "#e6550d", "#a63603"]
          }
        ]
      },
      solarized_light: {
        name: "Solarized Light",
        bg: "#fdf6e3",
        empty: "#eee8d5",
        text: "#586e75",
        scrollbar: "#93a1a1",
        grassOptions: [
          {
            name: "Green",
            levels: ["#eee8d5", "#9be9a8", "#40c463", "#30a14e", "#216e39"]
          },
          {
            name: "YlOrBr",
            levels: ["#eee8d5", "#fed98e", "#fe9929", "#d95f0e", "#993404"]
          },
          {
            name: "Blues",
            levels: ["#eee8d5", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"]
          },
          {
            name: "BuGn",
            levels: ["#eee8d5", "#b2e2e2", "#66c2a4", "#2ca25f", "#006d2c"]
          }
        ]
      },
      sakura: {
        name: "Sakura",
        bg: "#fff0f5",
        empty: "#ffe0ea",
        text: "#24292f",
        grassOptions: [
          {
            name: "Pink",
            levels: ["#ffe0ea", "#ffc0cb", "#ff85a2", "#e0245e", "#a8123c"]
          },
          {
            name: "Green",
            levels: ["#ffe0ea", "#9be9a8", "#40c463", "#30a14e", "#216e39"]
          },
          {
            name: "Purples",
            levels: ["#ffe0ea", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"]
          },
          {
            name: "RdPu",
            levels: ["#ffe0ea", "#fbb4b9", "#f768a1", "#c51b8a", "#7a0177"]
          }
        ]
      },
      lavender: {
        name: "Lavender",
        bg: "#f5f0ff",
        empty: "#e8dff5",
        text: "#3d2c5e",
        scrollbar: "#c4b0e0",
        grassOptions: [
          {
            name: "Purple",
            levels: ["#e8dff5", "#d4a5f5", "#b36bdb", "#8a3db5", "#5e1d8a"]
          },
          {
            name: "Green",
            levels: ["#e8dff5", "#9be9a8", "#40c463", "#30a14e", "#216e39"]
          },
          {
            name: "Blues",
            levels: ["#e8dff5", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"]
          },
          {
            name: "PuRd",
            levels: ["#e8dff5", "#d4b9da", "#c994c7", "#dd1c77", "#980043"]
          }
        ]
      },
      ice: {
        name: "Ice",
        bg: "#e6fffb",
        empty: "#ffffff",
        text: "#006d75",
        scrollbar: "#5cdbd3",
        grassOptions: [
          {
            name: "Cyan",
            levels: ["#ffffff", "#b2e2e2", "#66c2a4", "#2ca25f", "#006d2c"]
          },
          {
            name: "Green",
            levels: ["#ffffff", "#9be9a8", "#40c463", "#30a14e", "#216e39"]
          },
          {
            name: "Blues",
            levels: ["#ffffff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"]
          },
          {
            name: "Purples",
            levels: ["#ffffff", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"]
          }
        ]
      },
      aurora: {
        name: "Aurora",
        bg: "linear-gradient(135deg, #BAD1DE 0%, #ECECF5 100%)",
        empty: "#ffffff",
        text: "#2e3338",
        scrollbar: "#9FB5C6",
        grassOptions: [
          {
            name: "Blues",
            levels: ["#ffffff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"]
          },
          {
            name: "Green",
            levels: ["#ffffff", "#9be9a8", "#40c463", "#30a14e", "#216e39"]
          },
          {
            name: "BuPu",
            levels: ["#ffffff", "#b3cde3", "#8c96c6", "#8856a7", "#810f7c"]
          },
          {
            name: "YlGn",
            levels: ["#ffffff", "#d9f0a3", "#addd8e", "#41ab5d", "#006837"]
          }
        ]
      },
midnight: {
        name: "Midnight",
        bg: "#000000",
        empty: "#222222",
        text: "#f0f6fc",
        levels: ["#222222", "#0e4429", "#006d32", "#26a641", "#39d353"],
        grassOptions: [
          {
            name: "Neon Green",
            levels: ["#222222", "#0e4429", "#006d32", "#26a641", "#39d353"]
          },
          {
            name: "Viridis",
            levels: ["#222222", "#31446b", "#21908d", "#5dc863", "#fde725"]
          },
          {
            name: "Plasma",
            levels: ["#222222", "#6a00a8", "#b12a90", "#e16462", "#fca636"]
          },
          {
            name: "Cool",
            levels: ["#222222", "#4a36b0", "#6e80e0", "#76d7c4", "#afffaf"]
          }
        ]
      },
      solarized_dark: {
        name: "Solarized Dark",
        bg: "#002b36",
        empty: "#073642",
        text: "#93a1a1",
        scrollbar: "#586e75",
        grassOptions: [
          {
            name: "Neon Green",
            levels: ["#073642", "#0e4429", "#006d32", "#26a641", "#39d353"]
          },
          {
            name: "Viridis",
            levels: ["#073642", "#31446b", "#21908d", "#5dc863", "#fde725"]
          },
          {
            name: "Inferno",
            levels: ["#073642", "#6a176e", "#bb3754", "#f0732a", "#fcffa4"]
          },
          {
            name: "Cool",
            levels: ["#073642", "#4a36b0", "#6e80e0", "#76d7c4", "#afffaf"]
          }
        ]
      },
      dracula: {
        name: "Dracula",
        bg: "#282a36",
        empty: "#44475a",
        text: "#f8f8f2",
        scrollbar: "#6272a4",
        grassOptions: [
          {
            name: "Green",
            levels: ["#44475a", "#0e4429", "#006d32", "#26a641", "#39d353"]
          },
          {
            name: "Pink",
            levels: ["#44475a", "#8b3a62", "#bd4f8e", "#ff79c6", "#ffb3e0"]
          },
          {
            name: "Purple",
            levels: ["#44475a", "#5b3e8a", "#7c5cbf", "#bd93f9", "#dcc5ff"]
          },
          {
            name: "Cyan",
            levels: ["#44475a", "#1a6b5a", "#2e9e85", "#8be9fd", "#c3f5ee"]
          }
        ]
      },
      ocean: {
        name: "Ocean",
        bg: "#1b2a4e",
        empty: "#2b3d68",
        text: "#e6edf3",
        grassOptions: [
          {
            name: "Neon Blue",
            levels: ["#2b3d68", "#1b5e80", "#2188ff", "#58a6ff", "#79c0ff"]
          },
          {
            name: "Neon Green",
            levels: ["#2b3d68", "#0e4429", "#006d32", "#26a641", "#39d353"]
          },
          {
            name: "Viridis",
            levels: ["#2b3d68", "#31446b", "#21908d", "#5dc863", "#fde725"]
          },
          {
            name: "Plasma",
            levels: ["#2b3d68", "#6a00a8", "#b12a90", "#e16462", "#fca636"]
          }
        ]
      },
      monokai: {
        name: "Monokai",
        bg: "#272822",
        empty: "#3e3d32",
        text: "#f8f8f2",
        scrollbar: "#75715e",
        grassOptions: [
          {
            name: "Neon Green",
            levels: ["#3e3d32", "#0e4429", "#006d32", "#26a641", "#39d353"]
          },
          {
            name: "Inferno",
            levels: ["#3e3d32", "#6a176e", "#bb3754", "#f0732a", "#fcffa4"]
          },
          {
            name: "Magma",
            levels: ["#3e3d32", "#51127c", "#b73779", "#fb8861", "#fcfdbf"]
          },
          {
            name: "Turbo",
            levels: ["#3e3d32", "#3e49bb", "#1ac7c2", "#aad833", "#f5e642"]
          }
        ]
      },
      ember: {
        name: "Ember",
        bg: "linear-gradient(135deg, #1a0a0a 0%, #2d1215 100%)",
        empty: "#3a1a1d",
        text: "#f0c0a0",
        scrollbar: "#6b3030",
        grassOptions: [
          {
            name: "Ember",
            levels: ["#3a1a1d", "#5c1a1a", "#a93226", "#e74c3c", "#ff8a75"]
          },
          {
            name: "Neon Green",
            levels: ["#3a1a1d", "#0e4429", "#006d32", "#26a641", "#39d353"]
          },
          {
            name: "Inferno",
            levels: ["#3a1a1d", "#6a176e", "#bb3754", "#f0732a", "#fcffa4"]
          },
          {
            name: "OrRd",
            levels: ["#3a1a1d", "#7a3014", "#b35900", "#e67e22", "#f5b041"]
          }
        ]
      }
    }
  };
  const GLOBAL_CSS = `
    /* -- Dark Mode: CSS Variables --
       Light values are provided as var() fallbacks in each rule.
       Dark overrides are scoped to OUR container elements only — NOT on
       body or :root — to avoid triggering a full-page style recalculation
       on Danbooru's large DOM (thousands of nodes). */
    [data-di-theme="dark"] {
      /* Surface */
      --di-bg: #1a1a2e;
      --di-bg-secondary: #22223a;
      --di-bg-tertiary: #2a2a44;
      --di-bg-glass: rgba(26, 26, 46, 0.95);

      /* Text */
      --di-text: #e0e0e0;
      --di-text-secondary: #aaaaaa;
      --di-text-muted: #888888;
      --di-text-faint: #777777;
      --di-text-heading: #d0d0d0;

      /* Border */
      --di-border: #3a3a55;
      --di-border-light: #2e2e48;
      --di-border-input: #444466;

      /* Interactive */
      --di-link: #58a6ff;
      --di-btn-bg: #2a2a44;
      --di-btn-text: #cccccc;
      --di-btn-active-bg: #58a6ff;
      --di-btn-active-text: #ffffff;
      --di-btn-hover-bg: #3a3a55;

      /* Card */
      --di-card-bg: #22223a;
      --di-card-border: #2e2e48;

      /* Chart */
      --di-chart-bg: #1a1a2e;
      --di-chart-grid: #2e2e48;
      --di-chart-axis: #cccccc;
      --di-chart-axis-secondary: #999999;

      /* Scrollbar */
      --di-scrollbar-thumb: #444466;
      --di-scrollbar-thumb-hover: #555588;

      /* Shadow */
      --di-shadow: rgba(0, 0, 0, 0.5);
      --di-shadow-light: rgba(0, 0, 0, 0.3);

      /* Overlay */
      --di-overlay-bg: rgba(0, 0, 0, 0.6);

      /* Spinner */
      --di-spinner-track: #2a2a44;
      --di-spinner-accent: #58a6ff;

      /* Table */
      --di-table-row-hover: #2a2a44;
      --di-table-border: #2e2e48;

      /* Hover (fade) */
      --di-fade-end: rgba(26, 26, 46, 0.95);

      /* Input */
      --di-input-bg: #2a2a44;
    }

    /* -- Animations & Base -- */
    @keyframes di-slide-in-out-a {
        0%, 28% { transform: translateX(0); opacity: 1; }
        33% { transform: translateX(-20px); opacity: 0; }
        35%, 95% { transform: translateX(20px); opacity: 0; }
        100% { transform: translateX(0); opacity: 1; }
    }
    @keyframes di-slide-in-out-b {
        0%, 28% { transform: translateX(20px); opacity: 0; }
        33%, 61% { transform: translateX(0); opacity: 1; }
        66% { transform: translateX(-20px); opacity: 0; }
        68%, 100% { transform: translateX(20px); opacity: 0; }
    }
    @keyframes di-slide-in-out-c {
        0%, 61% { transform: translateX(20px); opacity: 0; }
        66%, 95% { transform: translateX(0); opacity: 1; }
        100% { transform: translateX(-20px); opacity: 0; }
    }

    /* -- UserAnalyticsApp Modal & Button -- */
    #danbooru-grass-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      /* Opaque backdrop — the underlying Danbooru profile page must not
         show through. Theme-aware fallback: dark variant uses the dashboard
         background, light variant gets a solid white. */
      background: var(--di-overlay-bg, var(--di-bg, #1a1a2e));
      z-index: 10000;
      display: none;
      justify-content: center;
      align-items: center;
      backdrop-filter: blur(2px);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    #danbooru-grass-modal-overlay.visible {
      display: flex;
      opacity: 1;
    }
    /* TagAnalytics modal uses dvh for mobile URL bar handling */
    #tag-analytics-modal {
      height: 100vh !important;
      height: 100dvh !important;
    }
    #danbooru-grass-modal-window {
      width: 80%;
      max-width: 1000px;
      /* 100% height fills the overlay flex container fully — eliminates the
         vertical gap that previously let the underlying page bleed through
         above/below the modal on desktop. */
      height: 100%;
      background: var(--di-bg-glass, rgba(255, 255, 255, 0.9));
      border-radius: 12px;
      box-shadow: 0 10px 30px var(--di-shadow, rgba(0, 0, 0, 0.2));
      backdrop-filter: blur(10px);
      display: flex;
      flex-direction: column;
      position: relative;
      color: var(--di-text, #333333);
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
    }
    #danbooru-grass-modal-close {
      position: absolute;
      top: 15px;
      right: 20px;
      font-size: 24px;
      cursor: pointer;
      color: var(--di-text-secondary, #666666);
      z-index: 10;
      line-height: 1;
    }
    #danbooru-grass-modal-close:hover {
      color: var(--di-text, #333333);
    }
    #danbooru-grass-modal-content {
      padding: 40px;
      overflow-y: auto;
      flex: 1;
    }
    .di-analytics-entry-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 10px;
      vertical-align: middle;
      cursor: pointer;
      background: transparent;
      border: none;
      padding: 4px;
      border-radius: 50%;
      transition: background 0.2s;
      font-size: 1.2em;
    }
    .di-analytics-entry-btn:hover {
      background: rgba(128,128,128,0.2);
    }

    /* -- User History timeline: discoverability for scrollable overflow --
       Two-layer approach:
       1. Slim always-visible scrollbar (works on Chrome/Firefox where custom
          ::-webkit-scrollbar disables overlay auto-hide).
       2. Bottom fade gradient (reliable fallback for Safari/macOS where
          overlay scrollbars auto-hide regardless of custom styles).
       The fade is only shown when the has-overflow class is set via JS after
       measuring scrollHeight, so it doesn't clutter the UI when there's
       nothing to scroll. */
    .di-user-history-timeline {
      scrollbar-width: thin;
      scrollbar-color: var(--di-scrollbar-thumb, #cccccc) transparent;
    }
    .di-user-history-timeline::-webkit-scrollbar {
      width: 8px;
    }
    .di-user-history-timeline::-webkit-scrollbar-track {
      background: transparent;
    }
    .di-user-history-timeline::-webkit-scrollbar-thumb {
      background: var(--di-scrollbar-thumb, #cccccc);
      border-radius: 4px;
    }
    .di-user-history-timeline:hover::-webkit-scrollbar-thumb {
      background: var(--di-scrollbar-thumb-hover, #999999);
    }
    .di-user-history-wrap {
      position: relative;
    }
    .di-user-history-wrap.has-overflow::after {
      content: '';
      position: absolute;
      left: 14px;
      right: 8px;
      bottom: 0;
      height: 14px;
      background: linear-gradient(to bottom, transparent 0%, var(--di-fade-end, rgba(255, 255, 255, 0.95)) 100%);
      pointer-events: none;
    }
    .di-user-history-wrap.has-overflow.scrolled-to-bottom::after {
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    /* -- Spinner -- */
    .di-spinner {
        width: 50px;
        height: 50px;
        border: 5px solid var(--di-spinner-track, #f3f3f3);
        border-top: 5px solid var(--di-spinner-accent, #0969da);
        border-radius: 50%;
        animation: di-spin 1s linear infinite;
    }
    @keyframes di-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    /* -- Animated Summary Card -- */
    .di-upload-card-pane {
        animation-duration: 15s;
        animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
        animation-iteration-count: infinite;
    }
    #danbooru-insights-upload-card.paused .di-upload-card-pane {
        animation-play-state: paused;
    }
    .di-play-pause-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0.5;
        transition: opacity 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border-radius: 4px;
    }
    .di-play-pause-btn:hover {
        opacity: 1;
        background-color: var(--di-bg-tertiary, #f0f0f0);
    }

    /* -- Pie Chart Tabs -- */
    .di-pie-tab {
        background: var(--di-btn-bg, #eeeeee);
        color: var(--di-btn-text, #555555);
        border: none;
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
    }
    .di-pie-tab:hover { background: var(--di-btn-hover-bg, #dddddd); }
    .di-pie-tab.active { background: var(--di-btn-active-bg, #555555); color: var(--di-btn-active-text, #ffffff); box-shadow: 0 1px 3px var(--di-shadow, rgba(0, 0, 0, 0.2)); }
    .di-pie-tab:not(.active):hover { background: var(--di-btn-hover-bg, #dddddd); }

    /* -- User Rankings (Tag Analytics) -- */
    .di-ranking-username:hover { font-weight: bold; }
    .user-admin { color: #ed2426; } .user-admin:hover { color: #ff5a5b; }
    .user-moderator { color: #00ab2c; } .user-moderator:hover { color: #35c64a; }
    .user-builder { color: #a800aa; } .user-builder:hover { color: #d700d9; }
    .user-platinum { color: #777892; } .user-platinum:hover { color: #9192a7; }
    .user-gold { color: #fd9200; } .user-gold:hover { color: #ffc5a5; }
    .user-member { color: #0075f8; } .user-member:hover { color: #5091fa; }
    .user-janitor { color: var(--di-text, #333333); } .user-janitor:hover { color: var(--di-text-secondary, #666666); }

    /* -- Hover Utilities -- */
    .di-hover-translate-up { transition: transform 0.2s; }

    .di-hover-scale { transition: transform 0.2s; }

    .di-hover-underline { text-decoration: none; }

    .di-hover-text-primary { transition: color 0.2s; }

    /* -- Layout Utilities -- */
    .di-card { background: var(--di-card-bg, #f9f9f9); padding: 15px; border-radius: 8px; }
    .di-card-sm { background: var(--di-card-bg, #f9f9f9); padding: 10px; border-radius: 6px; border: 1px solid var(--di-card-border, #eeeeee); }
    .di-flex-col-between { display: flex; flex-direction: column; justify-content: space-between; }
    .di-flex-row-between { display: flex; justify-content: space-between; align-items: center; }
    .di-flex-center { display: flex; justify-content: center; align-items: center; }

    /* -- Tag Cloud Widget -- */
    .di-tag-cloud-word {
        cursor: pointer;
        transition: opacity 0.2s, font-size 0.15s ease;
    }
    .di-tag-cloud-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 200px;
    }
    .di-tag-cloud-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.75em;
        color: var(--di-text-muted, #888888);
        padding-top: 8px;
        border-top: 1px solid var(--di-border-light, #eeeeee);
    }

    /* -- Created Tags Widget -- */
    .di-created-tags-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85em;
    }
    .di-created-tags-table th {
        text-align: left;
        color: var(--di-text-secondary, #666666);
        font-weight: 600;
        padding: 6px 8px;
        border-bottom: 2px solid var(--di-border, #e1e4e8);
        font-size: 0.85em;
        text-transform: uppercase;
        letter-spacing: 0.3px;
    }
    .di-created-tags-table td {
        padding: 5px 8px;
        border-bottom: 1px solid var(--di-table-border, #f0f0f0);
    }
    .di-created-tags-row:hover {
        background: var(--di-table-row-hover, #f6f8fa);
    }
    .di-created-tags-row a {
        text-decoration: none;
    }
    .di-created-tags-row a:hover {
        text-decoration: underline;
    }
    .di-created-tags-status {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 0.85em;
        padding: 1px 6px;
        border-radius: 8px;
    }

    /* -- User Analytics Charts -- */
    .month-column .column-overlay { transition: fill 0.2s; }
    .star-shiny {
        font-size: 15px;
        stroke-width: 0.1px !important;
        filter: drop-shadow(0 0 5px #ffd700);
    }

    /* -- Tag Analytics Dashboard --
       Static styles extracted from tag-analytics-app.ts template literals
       (Task 3). Dynamic values like \`color: \${titleColor}\` remain inline at
       the call site. Runtime DOM .style.X = ... overrides in the same file
       (e.g. rank-tab and pie-tab toggling) are intentionally untouched. */

    /* Settings popover (showSettingsPopover) */
    #tag-analytics-settings-popover .di-section {
        margin-bottom: 8px;
        line-height: 1.4;
    }
    #tag-analytics-settings-popover .di-section.di-divider {
        border-top: 1px solid var(--di-border-light, #eeeeee);
        padding-top: 8px;
    }
    #tag-analytics-settings-popover .di-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    #tag-analytics-settings-popover .di-row.di-gapped {
        margin-bottom: 10px;
    }
    #tag-analytics-settings-popover input[type="number"] {
        width: 60px;
        padding: 3px;
        border: 1px solid var(--di-border-input, #dddddd);
        border-radius: 3px;
        background: var(--di-input-bg, #ffffff);
        color: var(--di-text, #333333);
    }
    #tag-analytics-settings-popover .di-save-btn {
        background: none;
        border: 1px solid #28a745;
        color: #28a745;
        border-radius: 4px;
        cursor: pointer;
        padding: 2px 8px;
        font-size: 11px;
    }

    /* Tag analytics entry button (icon-container in createButton) */
    .di-tag-analytics-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: var(--di-bg-secondary, #f9f9f9);
        border: 1px solid var(--di-border, #e1e4e8);
        border-radius: 6px;
        transition: all 0.2s;
    }

    /* Modal scaffold (createModal) */
    #tag-analytics-modal > div {
        background: var(--di-bg, #ffffff);
        border-radius: 8px;
        width: 80%;
        max-width: 800px;
        /* 100dvh handles iOS address-bar collapse; replaces 90vh which left
           a gap that exposed the underlying profile page. */
        max-height: 100dvh;
        position: relative;
        display: flex;
        flex-direction: column;
    }
    #tag-analytics-close {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        color: var(--di-text, #333);
        font-size: 1.5rem;
        cursor: pointer;
        z-index: 10;
    }
    #tag-analytics-content {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
        -webkit-overflow-scrolling: touch;
    }

    /* Dashboard header (buildDashboardHeader) */
    .di-tag-header {
        border-bottom: 1px solid var(--di-border-light, #eeeeee);
        padding-bottom: 15px;
        margin-bottom: 20px;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
    }
    .di-tag-header h2 {
        margin: 0 0 5px 0;
        /* color is set inline (driven by tag category) */
    }
    .di-tag-header-meta {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .di-category-badge {
        background: var(--di-btn-bg, #eeeeee);
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.8em;
        color: var(--di-btn-text, #555555);
    }
    .di-tag-header-date {
        font-size: 0.9em;
        color: var(--di-text-faint, #999999);
    }
    .di-tag-header-date-updated {
        border-left: 1px solid var(--di-border-input, #dddddd);
        padding-left: 10px;
        display: flex;
        align-items: center;
    }
    #tag-settings-anchor {
        display: inline-flex;
        align-items: center;
        margin-left: 5px;
    }
    .di-tag-header-nsfw {
        display: flex;
        align-items: center;
        font-size: 0.9em;
        color: var(--di-btn-text, #555555);
        cursor: pointer;
        user-select: none;
    }
    .di-tag-header-nsfw input[type="checkbox"] {
        margin-right: 6px;
    }

    /* NSFW monitor cards (latest / trending / trending NSFW).
       The :not(.di-milestone-card) carve-out mirrors the existing mobile
       override at line 773: milestone cards re-use .di-nsfw-monitor only for
       the shared NSFW visibility logic (data-rating attribute), but their
       layout is block-style with an absolute-positioned thumbnail, not the
       column-thumb pattern of latest/trending cards. */
    .di-nsfw-monitor:not(.di-milestone-card) {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 80px;
        flex-shrink: 0;
    }
    #trending-post-nsfw {
        display: none;
    }
    .di-nsfw-monitor-thumb {
        padding: 2px;
        border-radius: 4px;
        background: var(--di-bg, #ffffff);
        width: 100%;
        aspect-ratio: 1/1;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }
    .di-nsfw-monitor-thumb-latest {
        border: 1px solid var(--di-border-input, #dddddd);
    }
    .di-nsfw-monitor-thumb-trending {
        border: 1px solid #ffd700;
        box-shadow: 0 0 5px rgba(255, 215, 0, 0.3);
    }
    .di-nsfw-monitor-thumb-trending-nsfw {
        border: 1px solid #ff4444;
        box-shadow: 0 0 5px rgba(255, 0, 0, 0.3);
    }
    .di-nsfw-monitor-thumb a {
        display: block;
        width: 100%;
        height: 100%;
    }
    .di-nsfw-monitor-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .di-nsfw-monitor-label {
        font-size: 0.8em;
        font-weight: bold;
        color: var(--di-btn-text, #555555);
        margin-top: 5px;
    }
    .di-nsfw-monitor-label-trending {
        font-size: 0.75em;
        font-weight: bold;
        color: #e0a800;
        margin-top: 5px;
    }
    .di-nsfw-monitor-label-trending-nsfw {
        font-size: 0.75em;
        font-weight: bold;
        color: #cc0000;
        margin-top: 5px;
    }
    .di-nsfw-monitor-sublabel {
        font-size: 0.7em;
        color: var(--di-text-faint, #999999);
    }

    /* Main grid: summary card + distribution card (buildMainGrid) */
    .di-summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 20px;
        margin-bottom: 30px;
    }
    .di-summary-card {
        min-height: 180px;
        position: relative;
    }
    .di-summary-card-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
    }
    .di-summary-stat-label {
        font-size: 0.9em;
        color: var(--di-text-secondary, #666666);
        font-weight: bold;
        margin-bottom: 5px;
    }
    .di-summary-stat-value {
        font-size: 2.2em;
        font-weight: bold;
        color: var(--di-link, #007bff);
        line-height: 1.1;
    }
    .di-summary-stat-trend {
        font-size: 0.8em;
        color: #28a745;
        margin-top: 5px;
    }
    .di-summary-stat-trend-meta {
        color: var(--di-text-faint, #999999);
        font-weight: normal;
    }
    .di-summary-card-thumbs {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
    }
    .di-distribution-card {
        background: var(--di-card-bg, #f9f9f9);
        padding: 15px;
        border-radius: 8px;
        min-height: 180px;
        position: relative;
        display: flex;
        flex-direction: column;
    }
    .di-distribution-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
    }
    .di-distribution-title {
        font-size: 0.9em;
        color: var(--di-text-secondary, #666666);
        font-weight: bold;
    }
    .pie-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        justify-content: flex-end;
    }
    #status-pie-chart-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        opacity: 0;
        transition: opacity 0.5s;
    }
    #status-pie-chart {
        width: 120px;
        height: 120px;
        flex-shrink: 0;
    }
    #status-pie-legend {
        margin-left: 15px;
        font-size: 0.75em;
        flex: 1;
        min-width: 140px;
        max-height: 140px;
        overflow-y: auto;
        padding-right: 10px;
    }
    #status-pie-loading {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: var(--di-text-muted, #888888);
        font-size: 0.8em;
    }

    /* User rankings section (buildRankingsSection) */
    .di-rankings-section {
        margin-bottom: 30px;
    }
    .di-rankings-header {
        border-bottom: 2px solid var(--di-border-light, #eeeeee);
        margin-bottom: 15px;
        display: flex;
        gap: 20px;
        align-items: center;
    }
    .di-rankings-title {
        margin: 0;
        padding-bottom: 10px;
        font-size: 1.2em;
        color: var(--di-text-heading, #444444);
        border-bottom: 3px solid var(--di-link, #007bff);
        margin-bottom: -2px;
    }
    .di-rank-tabs {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
    }
    .rank-tab {
        border: none;
        background: none;
        font-weight: normal;
        color: var(--di-text-muted, #888888);
        cursor: pointer;
        padding: 5px 10px;
    }
    .rank-tab.active {
        font-weight: bold;
        color: var(--di-link, #007bff);
    }
    #ranking-container {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 15px;
    }

    /* Milestones + charts containers (buildBottomSections) */
    #tag-analytics-milestones {
        margin-bottom: 30px;
        display: none;
    }
    #tag-analytics-milestones .di-milestones-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
    }
    #tag-analytics-milestones h2 {
        color: var(--di-text-heading, #444444);
        border-left: 4px solid #ffc107;
        padding-left: 10px;
        margin: 0;
    }
    #tag-milestones-toggle {
        background: none;
        border: none;
        color: var(--di-link, #007bff);
        cursor: pointer;
        font-size: 0.9em;
        display: none;
    }
    #milestones-loading {
        color: var(--di-text-muted, #888888);
        text-align: center;
        padding: 20px;
    }
    .milestones-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        gap: 15px;
        max-height: 120px;
        overflow: hidden;
        transition: max-height 0.3s ease;
    }
    #tag-analytics-charts {
        margin-bottom: 30px;
    }
    #tag-analytics-charts h2 {
        color: var(--di-text-heading, #444444);
        border-left: 4px solid var(--di-link, #007bff);
        padding-left: 10px;
        margin-bottom: 15px;
    }
    #chart-loading {
        color: var(--di-text-muted, #888888);
        text-align: center;
        padding: 20px;
    }
    #history-chart-monthly {
        width: 100%;
        height: 300px;
        margin-bottom: 20px;
    }
    #history-chart-cumulative {
        width: 100%;
        height: 300px;
    }

    /* ===== Mobile Responsive ===== */

    @media (max-width: 768px) {
      #danbooru-grass-modal-window {
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        border-radius: 0 !important;
      }
      #danbooru-grass-modal-content {
        padding: 20px !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
      }
      #tag-analytics-modal > div {
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: 100vh !important;
        border-radius: 0 !important;
      }
      #tag-analytics-content {
        padding-top: 50px !important;
      }

      /* Phase 2: Pie chart + legend vertical */
      .pie-content {
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
      }
      .danbooru-grass-legend-scroll {
        margin-left: 0 !important;
        margin-top: 10px !important;
        width: 100% !important;
      }

      /* Phase 2: Summary cards single column */
      .di-summary-grid {
        grid-template-columns: 1fr !important;
      }

      /* Phase 2: Upload card inner vertical stack */
      .di-upload-card-inner {
        flex-direction: column !important;
      }

      /* Phase 2: Timeline row word wrap */
      .di-timeline-row {
        white-space: normal !important;
        word-break: break-word !important;
      }

      /* Phase 2: Top posts vertical layout */
      .di-top-post-layout {
        flex-direction: column !important;
        align-items: center !important;
      }
      .di-top-post-thumb {
        width: 120px !important;
        height: 120px !important;
      }

      /* Phase 2: Tag analytics header wrap */
      .di-tag-header {
        flex-direction: column !important;
        align-items: flex-start !important;
        gap: 10px !important;
      }

      /* Phase 2: Trending thumbnails smaller (exclude milestone cards) */
      .di-nsfw-monitor:not(.di-milestone-card) {
        width: 60px !important;
      }

      /* Phase 2: Scatter plot controls unstacked */
      .di-scatter-toggle {
        position: static !important;
        margin-bottom: 5px !important;
      }
      .di-scatter-filter {
        position: static !important;
        width: fit-content !important;
        margin: 5px 0 5px auto !important;
      }
      .di-scatter-downvote {
        position: static !important;
        width: fit-content !important;
        margin: 0 0 5px auto !important;
      }

      /* Phase 3: Rankings horizontal swipe */
      #ranking-container {
        display: flex !important;
        overflow-x: auto !important;
        scroll-snap-type: x mandatory !important;
        -webkit-overflow-scrolling: touch !important;
      }
      #ranking-container > .di-card-sm {
        scroll-snap-align: start !important;
        min-width: calc(100vw - 80px) !important;
        flex-shrink: 0 !important;
      }

      /* Phase 4: Created tags table scroll */
      .di-created-tags-wrap {
        overflow-x: auto !important;
      }

      /* Grass wrapper: stack vertically on mobile so stats reclaims full width */
      #danbooru-grass-wrapper {
        flex-direction: column !important;
      }
      #danbooru-grass-wrapper > :first-child {
        max-width: 100% !important;
        overflow: visible !important;
      }
      #danbooru-grass-column {
        flex-basis: 100% !important;
      }

      /* Grass containers must not overflow viewport on mobile.
         Inline min-width / padding from graph-renderer.ts assume desktop
         layout; force border-box + clamp so the wrapper's right edge stays
         inside the viewport instead of triggering a body horizontal scroll. */
      #danbooru-grass-column,
      #danbooru-grass-container,
      #danbooru-grass-panel {
        box-sizing: border-box !important;
        min-width: 0 !important;
        max-width: 100% !important;
      }
      #danbooru-grass-container {
        padding: 10px !important;
      }
      #danbooru-grass-panel {
        width: 100% !important;
      }

      /* Phase 4: Grass handles hide on mobile */
      .di-grass-handle {
        display: none !important;
      }

      /* Phase 4: Settings flyout reposition */
      #danbooru-grass-flyout {
        left: auto !important;
        right: 10px !important;
        max-width: calc(100vw - 20px) !important;
      }

      /* Fix 11: Modal content no horizontal scroll */
      #danbooru-grass-modal-content {
        overflow-x: hidden !important;
      }
      #tag-analytics-content {
        overflow-x: hidden !important;
      }

      /* Fix 4: UserAnalytics header controls wrap */
      #analytics-header-controls {
        flex-direction: column !important;
        align-items: flex-end !important;
        gap: 8px !important;
      }

      /* Fix 1: TagAnalytics header icons spacing */
      .di-tag-header span {
        flex-wrap: wrap !important;
      }
      #tag-settings-anchor {
        margin-left: 10px !important;
      }

      /* Fix: TagAnalytics close button position (avoid status bar) */
      #tag-analytics-close {
        top: 15px !important;
        right: 15px !important;
        font-size: 1.8rem !important;
        min-width: 44px;
        min-height: 44px;
      }

      /* Fix 2: TagAnalytics milestones grid - 2 columns on mobile */
      .milestones-grid {
        grid-template-columns: repeat(2, 1fr) !important;
      }

      /* UserAnalytics milestones: 2 columns on mobile */
      #analytics-milestone-container {
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 6px !important;
      }
      #analytics-milestone-container > a,
      #analytics-milestone-container > .di-next-milestone-card {
        padding: 8px !important;
      }
      #analytics-milestone-container > a > div:last-child {
        width: 45px !important;
        height: 45px !important;
      }

      /* Fix 10: Created Tags pagination wrap */
      .di-created-tags-wrap > div:last-child {
        flex-wrap: wrap !important;
        justify-content: center !important;
      }
    }

    @media (hover: hover) {
      .di-hover-translate-up:hover { transform: translateY(-3px) !important; }
      .di-hover-scale:hover { transform: scale(1.02) !important; }
      .di-hover-underline:hover { text-decoration: underline !important; }
      .di-hover-text-primary:hover { color: var(--di-link, #007bff) !important; }
      .month-column:hover .column-overlay { fill: rgba(0, 123, 255, 0.05); }
      .month-column:hover .monthly-bar { fill: #216e39; }
    }

    @media (pointer: coarse) {
      .di-pie-tab {
        padding: 6px 12px;
        font-size: 13px;
        min-height: 36px;
      }
      #danbooru-grass-modal-close,
      #tag-analytics-close {
        font-size: 28px;
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .top-post-tab {
        padding: 4px 10px;
        font-size: 12px;
      }
    }

    /* ── Toast Notifications ── */
    .di-toast-container {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483646;
      display: flex;
      flex-direction: column-reverse;
      gap: 8px;
      pointer-events: none;
      max-width: 380px;
    }
    .di-toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
      line-height: 1.4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #fff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      opacity: 0;
      transform: translateX(40px);
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
    .di-toast.di-toast-visible {
      opacity: 1;
      transform: translateX(0);
    }
    .di-toast.di-toast-exit {
      opacity: 0;
      transform: translateX(40px);
    }
    .di-toast-success { background: #2d8a4e; }
    .di-toast-error   { background: #c93c37; }
    .di-toast-warn    { background: #bf6a1f; }
    .di-toast-info    { background: #2563a8; }
    .di-toast-message {
      flex: 1;
      word-break: break-word;
    }
    .di-toast-close {
      flex-shrink: 0;
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.7);
      font-size: 16px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
    }
    .di-toast-close:hover {
      color: #fff;
    }
    @media (max-width: 480px) {
      .di-toast-container {
        left: 8px;
        right: 8px;
        bottom: 8px;
        max-width: none;
      }
    }
  `;
  function injectGlobalStyles() {
    if (document.getElementById("danbooru-insights-global-css")) return;
    const style = document.createElement("style");
    style.id = "danbooru-insights-global-css";
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
  }
  const DEBUG_KEY = "di.debug.enabled";
  function readDebugFlag() {
    try {
      return localStorage.getItem(DEBUG_KEY) === "1";
    } catch {
      return false;
    }
  }
  const runtimeDebugEnabled = readDebugFlag();
  function formatPrefix(module, level) {
    return `[DI:${module}] ${level}`;
  }
  function emit(consoleFn, module, level, message, meta) {
    const prefix = formatPrefix(module, level);
    if (meta && Object.keys(meta).length > 0) {
      consoleFn(`${prefix} ${message}`, meta);
    } else {
      consoleFn(`${prefix} ${message}`);
    }
  }
  function createLogger(module) {
    return {
      error(message, meta) {
        emit(console.error.bind(console), module, "ERROR", message, meta);
      },
      warn(message, meta) {
        emit(console.warn.bind(console), module, "WARN", message, meta);
      },
      info(message, meta) {
        emit(console.log.bind(console), module, "INFO", message, meta);
      },
      debug(message, meta) {
        if (!runtimeDebugEnabled) return;
        emit(console.log.bind(console), module, "DEBUG", message, meta);
      }
    };
  }
  const log$h = createLogger("Database");
  function onVersionChange(db) {
    db.close();
    window.location.reload();
  }
  function onBlocked() {
    log$h.warn(
      "DB upgrade blocked by another tab — versionchange handler should have closed us first"
    );
  }
  class Database extends Dexie {
    uploads;
    approvals;
    notes;
    posts;
    piestats;
    completed_years;
    approvals_detail;
    hourly_stats;
    tag_analytics;
    grass_settings;
    user_stats;
    tag_monthly_counts;
    tag_implications_cache;
constructor() {
      super("DanbooruGrassDB");
      this.version(1).stores({
        uploads: "id, userId, date, count",
approvals: "id, userId, date, count",
        notes: "id, userId, date, count"
      });
      this.version(2).stores({
uploads: "id, userId, date, count",
        approvals: "id, userId, date, count",
        notes: "id, userId, date, count",



posts: "id, uploader_id, no, created_at, score, rating, tag_count_general"
      });
      this.version(3).stores({
        uploads: "id, userId, date, count",
        approvals: "id, userId, date, count",
        notes: "id, userId, date, count",
        posts: "id, uploader_id, no, created_at, score, rating, tag_count_general",
        piestats: "[key+userId], userId, updated_at"
      });
      this.version(4).stores({
        uploads: "id, userId, date, count",
        approvals: "id, userId, date, count",
        notes: "id, userId, date, count",
        posts: "id, uploader_id, no, created_at, score, rating, tag_count_general",
piestats: "[key+userId], userId, updated_at",
completed_years: "id, userId, metric, year",
approvals_detail: "id, userId",
hourly_stats: "id, userId, metric, year"
});
      this.version(5).stores({
        uploads: "id, userId, date, count",
        approvals: "id, userId, date, count",
        notes: "id, userId, date, count",
        posts: "id, uploader_id, no, created_at, score, rating, tag_count_general",
        piestats: "[key+userId], userId, updated_at",
        completed_years: "id, userId, metric, year",
        approvals_detail: "id, userId",
        hourly_stats: "id, userId, metric, year",
        bubble_data: "[userId+copyright], userId, copyright, updated_at"
      });
      this.version(6).stores({
        uploads: "id, userId, date, count",
        approvals: "id, userId, date, count",
        notes: "id, userId, date, count",
        posts: "id, uploader_id, no, created_at, score, rating, tag_count_general",
        piestats: "[key+userId], userId, updated_at",
        completed_years: "id, userId, metric, year",
        approvals_detail: "id, userId",
        hourly_stats: "id, userId, metric, year",
        bubble_data: "[userId+copyright], userId, copyright, updated_at",
        tag_analytics: "tagName, updatedAt"
      });
      this.version(7).stores({
        uploads: "id, userId, date, count",
        approvals: "id, userId, date, count",
        notes: "id, userId, date, count",
        posts: "id, uploader_id, no, created_at, score, rating, tag_count_general",
        piestats: "[key+userId], userId, updated_at",
        completed_years: "id, userId, metric, year",
        approvals_detail: "id, userId",
        hourly_stats: "id, userId, metric, year",
        bubble_data: "[userId+copyright], userId, copyright, updated_at",
        tag_analytics: "tagName, updatedAt",
        grass_settings: "userId"
});
      this.version(8).stores({
        bubble_data: null
      });
      this.version(9).stores({
        posts: "id, uploader_id, no, created_at, score, rating, tag_count_general, [uploader_id+no], [uploader_id+score]"
      });
      this.version(10).stores({
        user_stats: "userId"
      });
      this.version(11).stores({
        posts: "id, uploader_id, no, created_at, score, rating, tag_count_general, [uploader_id+no], [uploader_id+score], [uploader_id+created_at]"
      });
      this.version(12).stores({
        tag_monthly_counts: "[tag+yearMonth], tag, fetchedAt",
        tag_implications_cache: "tagName, fetchedAt"
      });
      this.on("versionchange", () => onVersionChange(this));
      this.on("blocked", () => onBlocked());
    }
  }
  const log$g = createLogger("Settings");
  class SettingsManager {
    key;
    defaults;
    settings;
constructor() {
      this.key = CONFIG.STORAGE_PREFIX + "settings";
      this.defaults = {
        theme: "light",
        thresholds: {
          uploads: [1, 10, 25, 50],
          approvals: [10, 50, 100, 150],
          notes: [1, 10, 20, 30]
        },
        rememberedModes: {}
};
      this.settings = this.load();
    }
load() {
      try {
        const s = localStorage.getItem(this.key);
        const saved = s ? JSON.parse(s) : {};
        if (saved.remembered_modes && !saved.rememberedModes) {
          saved.rememberedModes = saved.remembered_modes;
          delete saved.remembered_modes;
        }
        return {
          ...this.defaults,
          ...saved,
          thresholds: {
            ...this.defaults.thresholds,
            ...saved.thresholds || {}
          },
          rememberedModes: {
            ...saved.rememberedModes || {}
          }
        };
      } catch (e) {
        log$g.error("Error loading settings, using defaults", { error: e });
        return this.defaults;
      }
    }
save(newSettings) {
      this.settings = {
        ...this.settings,
        ...newSettings
      };
      localStorage.setItem(this.key, JSON.stringify(this.settings));
    }
getTheme() {
      const t = this.settings.theme === "newspaper" ? "dracula" : this.settings.theme;
      return CONFIG.THEMES[t] ? t : "light";
    }
getThresholds(metric) {
      return this.settings.thresholds[metric] || this.defaults.thresholds[metric] || [1, 5, 10, 20];
    }
setThresholds(metric, values) {
      const newThresholds = {
        ...this.settings.thresholds,
        [metric]: values
      };
      this.save({
        thresholds: newThresholds
      });
    }
getGrassIndex(themeKey) {
      const byTheme = this.settings.grassIndexByTheme;
      if (byTheme && typeof byTheme[themeKey] === "number") {
        return Math.max(0, Math.min(3, byTheme[themeKey]));
      }
      const legacy = this.settings.grassIndex;
      return typeof legacy === "number" && legacy >= 0 && legacy <= 3 ? legacy : 0;
    }
setGrassIndex(themeKey, index) {
      const byTheme = { ...this.settings.grassIndexByTheme || {} };
      byTheme[themeKey] = Math.max(0, Math.min(3, index));
      const patch = { grassIndexByTheme: byTheme };
      const legacySettings = this.settings;
      if (legacySettings.grassIndex !== void 0) {
        delete legacySettings.grassIndex;
      }
      this.save(patch);
    }
resolveLevels(themeKey, theme) {
      const defaultLevels = [
        "#ebedf0",
        "#9be9a8",
        "#40c463",
        "#30a14e",
        "#216e39"
      ];
      if (theme.grassOptions && theme.grassOptions.length > 0) {
        const idx = this.getGrassIndex(themeKey);
        const option = theme.grassOptions[idx] || theme.grassOptions[0];
        return option.levels;
      }
      return theme.levels || defaultLevels;
    }
applyTheme(themeKey) {
      const theme = CONFIG.THEMES[themeKey] || CONFIG.THEMES.light;
      const root = document.querySelector(":root");
      if (root) {
        root.style.setProperty("--grass-bg", theme.bg);
        root.style.setProperty("--grass-empty-cell", theme.empty);
        root.style.setProperty("--grass-text", theme.text);
        root.style.setProperty(
          "--grass-scrollbar-thumb",
          theme.scrollbar || "#d0d7de"
        );
        const levels = this.resolveLevels(themeKey, theme);
        levels.forEach((color, i) => {
          root.style.setProperty(`--grass-level-${i}`, color);
        });
      }
      this.save({
        theme: themeKey
      });
      window.dispatchEvent(
        new CustomEvent("DanbooruInsights:ThemeChanged", {
          detail: { themeKey }
        })
      );
    }
getLastMode(userId) {
      return this.settings.rememberedModes[userId] || null;
    }
setLastMode(userId, mode) {
      const newModes = {
        ...this.settings.rememberedModes,
        [userId]: mode
      };
      this.save({
        rememberedModes: newModes
      });
    }
getSyncThreshold() {
      return typeof this.settings.syncThreshold === "number" ? this.settings.syncThreshold : 5;
    }
setSyncThreshold(val) {
      this.save({
        syncThreshold: parseInt(String(val), 10)
      });
    }
getDarkMode() {
      return this.settings.darkMode ?? "auto";
    }
setDarkMode(pref) {
      this.save({ darkMode: pref });
    }
getSnapToEdge() {
      return this.settings.snapToEdge !== false;
    }
setSnapToEdge(enabled) {
      this.save({ snapToEdge: enabled });
    }
  }
  const log$f = createLogger("RateLimiter");
  class RateLimitedFetch {
    maxConcurrency;
    startDelayRange;
    rateLimit;
    refillRate;
    tokens;
    lastRefill;
    queue;
    activeWorkers;
    requestCounter;
    reportQueue;
    isProcessingReport;
backoffUntil;
onBackoff;
constructor(maxConcurrency = 6, startDelayRange = [50, 150], requestsPerSecond = 6) {
      this.maxConcurrency = maxConcurrency;
      this.startDelayRange = startDelayRange;
      this.rateLimit = requestsPerSecond;
      this.refillRate = 1e3 / requestsPerSecond;
      this.tokens = requestsPerSecond;
      this.lastRefill = Date.now();
      this.queue = [];
      this.activeWorkers = 0;
      this.requestCounter = 0;
      this.reportQueue = [];
      this.isProcessingReport = false;
      this.backoffUntil = 0;
      this.onBackoff = null;
    }
    getRequestCount() {
      return this.requestCounter;
    }
updateLimits(requestsPerSecond, maxConcurrency) {
      this.rateLimit = requestsPerSecond;
      this.refillRate = 1e3 / requestsPerSecond;
      this.maxConcurrency = maxConcurrency;
      this.tokens = Math.min(this.tokens, this.rateLimit);
    }
setBackoff(until) {
      this.backoffUntil = Math.max(this.backoffUntil, until);
    }
    async fetch(url, options) {
      if (url.includes("/reports/")) {
        return new Promise((resolve, reject) => {
          this.reportQueue.push({ url, options, resolve, reject });
          void this.processReportQueue();
        });
      }
      return new Promise((resolve, reject) => {
        this.queue.push({ url, options, resolve, reject });
        void this.processQueue();
      });
    }
    async processReportQueue() {
      if (this.isProcessingReport || this.reportQueue.length === 0) return;
      const now = Date.now();
      if (now < this.backoffUntil) {
        setTimeout(() => this.processReportQueue(), this.backoffUntil - now);
        return;
      }
      this.isProcessingReport = true;
      const task = this.reportQueue.shift();
      if (!task) {
        this.isProcessingReport = false;
        return;
      }
      this.requestCounter++;
      try {
        const response = await fetch(task.url, task.options);
        if (response.status === 429) this.triggerBackoff();
        task.resolve(response);
      } catch (e) {
        log$f.error("Report fetch failed", { url: task.url, error: e });
        task.reject(e);
      } finally {
        await new Promise((r) => setTimeout(r, CONFIG.REPORT_COOLDOWN_MS));
        this.isProcessingReport = false;
        void this.processReportQueue();
      }
    }
    async processQueue() {
      if (this.activeWorkers >= this.maxConcurrency || this.queue.length === 0) {
        return;
      }
      const now = Date.now();
      if (now < this.backoffUntil) {
        setTimeout(() => this.processQueue(), this.backoffUntil - now);
        return;
      }
      this.refillTokens();
      if (this.tokens < 1) {
        const waitTime = this.refillRate;
        setTimeout(() => this.processQueue(), waitTime);
        return;
      }
      this.tokens -= 1;
      this.activeWorkers++;
      this.requestCounter++;
      const task = this.queue.shift();
      if (!task) {
        this.activeWorkers--;
        return;
      }
      const startDelay = Math.floor(
        Math.random() * (this.startDelayRange[1] - this.startDelayRange[0] + 1)
      ) + this.startDelayRange[0];
      if (startDelay > 0) await new Promise((r) => setTimeout(r, startDelay));
      try {
        const response = await fetch(task.url, task.options);
        if (response.status === 429) this.triggerBackoff();
        task.resolve(response);
      } catch (e) {
        task.reject(e);
      } finally {
        this.activeWorkers--;
        void this.processQueue();
      }
    }
    refillTokens() {
      const now = Date.now();
      const elapsed = now - this.lastRefill;
      if (elapsed > this.refillRate) {
        const newTokens = Math.floor(elapsed / this.refillRate);
        this.tokens = Math.min(this.rateLimit, this.tokens + newTokens);
        this.lastRefill = now - elapsed % this.refillRate;
      }
    }
triggerBackoff() {
      const until = Date.now() + CONFIG.BACKOFF_DURATION_MS;
      this.setBackoff(until);
      this.onBackoff?.(until);
    }
  }
  class TabCoordinator {
    channel = null;
    tabId;
    activeTabs = new Map();
heartbeatTimer = null;
    boundBeforeUnload;
onTabCountChange = null;
onBackoffReceived = null;
    constructor() {
      this.tabId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      this.boundBeforeUnload = () => this.destroy();
    }
start() {
      if (typeof BroadcastChannel === "undefined") return;
      const cfg = CONFIG.TAB_COORDINATOR;
      try {
        this.channel = new BroadcastChannel(cfg.channelName);
      } catch {
        return;
      }
      this.channel.onmessage = (e) => this.handleMessage(e.data);
      this.activeTabs.set(this.tabId, Date.now());
      this.broadcast({ type: "join", id: this.tabId });
      this.heartbeatTimer = setInterval(() => {
        this.broadcast({ type: "ping", id: this.tabId });
        this.cleanupStaleTabs();
      }, cfg.heartbeatInterval);
      window.addEventListener("beforeunload", this.boundBeforeUnload);
    }
destroy() {
      if (this.heartbeatTimer !== null) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.broadcast({ type: "leave", id: this.tabId });
      this.channel?.close();
      this.channel = null;
      window.removeEventListener("beforeunload", this.boundBeforeUnload);
    }
broadcastBackoff(until) {
      this.broadcast({ type: "backoff", until });
    }
getTabCount() {
      return Math.max(1, this.activeTabs.size);
    }
    handleMessage(msg) {
      switch (msg.type) {
        case "join":
          this.activeTabs.set(msg.id, Date.now());
          this.broadcast({ type: "pong", id: this.tabId });
          this.notifyTabCountChange();
          break;
        case "pong":
          this.activeTabs.set(msg.id, Date.now());
          this.notifyTabCountChange();
          break;
        case "ping":
          this.activeTabs.set(msg.id, Date.now());
          break;
        case "leave":
          this.activeTabs.delete(msg.id);
          this.notifyTabCountChange();
          break;
        case "backoff":
          this.onBackoffReceived?.(msg.until);
          break;
      }
    }
    broadcast(msg) {
      try {
        this.channel?.postMessage(msg);
      } catch {
      }
    }
    cleanupStaleTabs() {
      const now = Date.now();
      const staleTimeout = CONFIG.TAB_COORDINATOR.staleTimeout;
      let changed = false;
      for (const [id, lastSeen] of this.activeTabs) {
        if (id !== this.tabId && now - lastSeen > staleTimeout) {
          this.activeTabs.delete(id);
          changed = true;
        }
      }
      this.activeTabs.set(this.tabId, now);
      if (changed) this.notifyTabCountChange();
    }
    notifyTabCountChange() {
      this.onTabCountChange?.(this.getTabCount());
    }
  }
  const log$e = createLogger("ProfileContext");
  class ProfileContext {
    targetUser;
constructor() {
      try {
        this.targetUser = this.getTargetUserInfo();
      } catch (e) {
        log$e.error("Context init failed", { error: e });
        this.targetUser = null;
      }
    }
getTargetUserInfo() {
      let name = null;
      let id = null;
      let joinDate = ( new Date()).toISOString();
      try {
        const titleMatch = document.title.match(/^User: (.+?) \|/);
        if (titleMatch) {
          name = titleMatch[1];
        }
        if (!name) {
          const h1 = document.querySelector("h1");
          if (h1) name = h1.textContent?.trim().replace(/^User: /, "") ?? null;
        }
        const urlMatch = window.location.pathname.match(/^\/users\/(\d+)/);
        if (urlMatch) {
          id = urlMatch[1];
        }
        if (!id && name) {
          const messagesLink = document.querySelector(
            'a[href*="/messages?search%5Bto_user_id%5D="]'
          );
          if (messagesLink) {
            const match = messagesLink.href.match(
              /to_user_id%5D=(\d+)/
            );
            if (match) id = match[1];
          }
        }
        if (!id && window.location.pathname === "/profile") {
          const editLink = document.querySelector(
            'a[href^="/users/"][href$="/edit"]'
          );
          if (editLink) {
            const m = editLink.getAttribute("href")?.match(/\/users\/(\d+)\/edit/);
            if (m) id = m[1];
          }
        }
        if (!id && name) {
          const userLinks = Array.from(
            document.querySelectorAll('a[href^="/users/"]')
          );
          for (const link of userLinks) {
            const m = link.getAttribute("href")?.match(/\/users\/(\d+)(?:\?|$)/);
            if (m && link.textContent?.trim() === name) {
              id = m[1];
              break;
            }
          }
        }
        const cells = Array.from(document.querySelectorAll("th, td"));
        const joinHeader = cells.find(
          (el) => el.textContent?.trim() === "Join Date"
        );
        if (joinHeader) {
          const valEl = joinHeader.nextElementSibling;
          if (valEl) {
            const timeEl = valEl.querySelector("time");
            if (timeEl) {
              joinDate = timeEl.getAttribute("datetime") || timeEl.textContent?.trim() || joinDate;
            } else {
              joinDate = valEl.textContent?.trim() || joinDate;
            }
          }
        }
        let level_string = null;
        const levelHeader = cells.find((el) => el.textContent?.trim() === "Level");
        if (levelHeader) {
          const valEl = levelHeader.nextElementSibling;
          if (valEl) {
            level_string = valEl.textContent?.trim() ?? null;
          }
        }
        if (!name) return null;
        if (!id) {
          log$e.warn("User ID not found, functionality may be limited (Notes)");
        }
        return {
          name,
          normalizedName: name.replace(/ /g, "_"),
          id,
          created_at: joinDate,
          joinDate: new Date(joinDate),
          level_string
        };
      } catch (e) {
        log$e.warn("User info extraction error", { error: e });
        return null;
      }
    }
isValidProfile() {
      if (!this.targetUser || !this.targetUser.name) return false;
      const path = window.location.pathname;
      const isProfileUrl = path === "/profile" || /^\/users\/\d+$/.test(path);
      return isProfileUrl;
    }
  }
  const log$d = createLogger("DataManager");
  class DataManager {
    baseUrl;

db;
    rateLimiter;

constructor(db, rateLimiter = null) {
      this.baseUrl = window.location.origin;
      this.db = db;
      const rl = CONFIG.RATE_LIMITER;
      this.rateLimiter = rateLimiter || new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);
    }
async fetchPostDetails(postId) {
      try {
        const url = `/posts/${postId}.json?only=id,created_at,score,fav_count,rating,variants,preview_file_url,tag_string_artist,tag_string_copyright,tag_string_character`;
        const resp = await this.rateLimiter.fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (data && data.id) return data;
      } catch (e) {
        log$d.warn(`Failed to fetch post details for post ${postId}`, { error: e });
      }
      return null;
    }
async getStats(key, userId) {
      try {
        const record = await this.db.piestats.get({ key, userId });
        if (record) {
          return record.data;
        }
        return null;
      } catch (e) {
        log$d.warn("Failed to load stats cache", { error: e });
        return null;
      }
    }
async saveStats(key, userId, data) {
      try {
        await this.db.piestats.put({
          key,
          userId,
          data,
          updated_at: ( new Date()).toISOString()
        });
      } catch (e) {
        log$d.warn("Failed to save stats cache", { error: e });
      }
    }
async getGrassSettings(userId) {
      if (!userId) return null;
      try {
        return await this.db.grass_settings.get(userId.toString());
      } catch (e) {
        log$d.warn("Failed to load grass settings", { error: e });
        return null;
      }
    }
async saveGrassSettings(userId, settings) {
      if (!userId) return;
      try {
        await this.db.grass_settings.put({
          userId: userId.toString(),
          ...settings,
          updated_at: ( new Date()).toISOString()
        });
      } catch (e) {
        log$d.warn("Failed to save grass settings", { error: e });
      }
    }
async checkYearCompletion(userId, metric, year) {
      const id = `${userId}_${metric}_${year}`;
      try {
        const record = await this.db.completed_years.get(id);
        return !!record;
      } catch (e) {
        log$d.warn("Failed to check year completion status", { error: e });
        return false;
      }
    }
async markYearComplete(userId, metric, year) {
      try {
        await this.db.completed_years.put({
          id: `${userId}_${metric}_${year}`,
          userId,
          metric,
          year,
          timestamp: Date.now()
        });
      } catch (e) {
        log$d.warn("Failed to mark year complete", { error: e });
      }
    }
async getMetricData(metric, userInfo, year, onProgress = null) {
      try {
        let endpoint = "";
        let storeName = "";
        let dateKey = "created_at";
        let idKey = "";
        const startDate = `${year}-01-01`;
        const endDate = `${year + 1}-01-01`;
        const params = {
          limit: metric === "uploads" ? 200 : 1e3
        };
        const normalizedName = (userInfo.name || "").replace(/ /g, "_");
        let hourlyCounts = new Array(24).fill(0);
        switch (metric) {
          case "uploads":
            endpoint = "/posts.json";
            storeName = "uploads";
            dateKey = "created_at";
            idKey = "uploader_id";
            params["only"] = "uploader_id,created_at";
            break;
          case "approvals":
            endpoint = "/post_approvals.json";
            storeName = "approvals";
            dateKey = "created_at";
            idKey = "user_id";
            params["search[user_id]"] = userInfo.id;
            params["only"] = "id,post_id,created_at";
            break;
          case "notes":
            if (!userInfo.id) throw new Error("User ID required for Notes");
            endpoint = "/note_versions.json";
            storeName = "notes";
            dateKey = "created_at";
            idKey = "updater_id";
            params["search[updater_id]"] = userInfo.id;
            params["only"] = "updater_id,created_at";
            break;
          default:
            return {};
        }
        const table = this.db[storeName];
        const userIdVal = userInfo.id || userInfo.name;
        const isYearCompleteCache = await this.checkYearCompletion(
          userIdVal,
          metric,
          year
        );
        let forceFullFetch = false;
        if (!isYearCompleteCache && metric === "uploads" && year < ( new Date()).getFullYear()) {
          try {
            const strictEndDate = `${year + 1}-01-01`;
            const checkRange = `${startDate}...${strictEndDate}`;
            const queryTags = `user:${normalizedName} date:${checkRange}`;
            const remoteCount = await this.fetchRemoteCount(queryTags);
            const matchedEndDate = `${year}-12-31`;
            let localCount = 0;
            await table.where("id").between(
              `${userIdVal}_${startDate}`,
              `${userIdVal}_${matchedEndDate}￿`,
              true,
              true
).each((cur) => {
              localCount += cur["count"] || 0;
            });
            if (remoteCount !== localCount) {
              log$d.warn(`Data mismatch detected for ${year}, forcing full sync`, {
                remoteCount,
                localCount
              });
              const deleteEndDate = `${year}-12-31`;
              await table.where("id").between(
                `${userIdVal}_${startDate}`,
                `${userIdVal}_${deleteEndDate}￿`,
                true,
                true
).delete();
              forceFullFetch = true;
            } else {
            }
          } catch (e) {
            log$d.warn(
              "Integrity check failed (Network/API), proceeding with cache",
              { error: e }
            );
          }
        }
        let fetchFromDate = null;
        let lastEntry = null;
        let existingHourlyStats = [];
        if (!forceFullFetch && !isYearCompleteCache) {
          lastEntry = await table.where("id").between(
            `${userIdVal}_${startDate}`,
            `${userIdVal}_${year}-12-31￿`,
            true,
            true
          ).last();
          existingHourlyStats = await this.db.hourly_stats.where("id").between(
            `${userIdVal}_${metric}_${year}_00`,
            `${userIdVal}_${metric}_${year}_24`,
            true,
            false
          ).toArray();
          if (existingHourlyStats.length > 0) {
            existingHourlyStats.forEach((stat) => {
              if (stat.hour >= 0 && stat.hour < 24) {
                hourlyCounts[stat.hour] = stat.count;
              }
            });
          }
        }
        if (lastEntry) {
          const lastDate = new Date(lastEntry["date"]);
          const currentYear = ( new Date()).getFullYear();
          const isYearComplete = year < currentYear;
          if (isYearComplete) {
            fetchFromDate = endDate;
          } else {
            lastDate.setDate(lastDate.getDate() - 3);
            const bufferDateStr = lastDate.toISOString().slice(0, 10);
            fetchFromDate = bufferDateStr;
          }
        }
        {
          let stopDate = null;
          const fetchDirection = "desc";
          const rangeStart = fetchFromDate || startDate;
          let effectiveEndDate = endDate;
          if (lastEntry && year === ( new Date()).getFullYear()) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() + 3);
            effectiveEndDate = cutoff.toISOString().slice(0, 10);
          }
          const fetchRange = `${rangeStart}...${effectiveEndDate}`;
          if (metric === "uploads") {
            params["tags"] = `user:${normalizedName} date:${fetchRange}`;
          } else if (metric === "notes") {
            params["search[created_at]"] = fetchRange;
          } else if (metric === "approvals") {
            params["search[created_at]"] = fetchRange;
          }
          stopDate = null;
          if (!isYearCompleteCache) {
            const isDeltaFetch = !!lastEntry && !forceFullFetch;
            const items = await this.fetchAllPages(
              endpoint,
              params,
              stopDate,
              dateKey,
              fetchDirection,
              onProgress,
              isDeltaFetch
            );
            const dailyCounts = {};
            items.forEach((item) => {
              const rawDate = item[dateKey] || item["created_at"];
              if (!rawDate) return;
              if (userInfo.id && item[idKey] && String(item[idKey]) !== String(userInfo.id)) {
                log$d.warn("ID mismatch, skipping item", {
                  expected: userInfo.id,
                  got: item[idKey],
                  itemDate: rawDate
                });
                return;
              }
              const dateStr = String(rawDate).slice(0, 10);
              if (!dailyCounts[dateStr]) {
                dailyCounts[dateStr] = { count: 0, postList: [] };
              }
              dailyCounts[dateStr].count += 1;
              if (item["post_id"]) {
                dailyCounts[dateStr].postList.push(item["post_id"]);
              }
              const isNewData = !lastEntry || String(rawDate).slice(0, 10) > lastEntry["date"];
              const itemDate = new Date(rawDate);
              const hour = itemDate.getHours();
              if (isNewData && !isNaN(hour) && hour >= 0 && hour < 24) {
                hourlyCounts[hour]++;
              }
            });
            const bulkData = [];
            const detailData = [];
            Object.entries(dailyCounts).forEach(([date, entry]) => {
              const id = `${userIdVal}_${date}`;
              bulkData.push({
                id,
                userId: userIdVal,
                date,
                count: entry.count
              });
              if (metric === "approvals") {
                detailData.push({
                  id,
                  userId: userIdVal,
                  post_list: entry.postList
                });
              }
            });
            const hourlyBulk = [];
            hourlyCounts.forEach((count, h) => {
              hourlyBulk.push({
                id: `${userIdVal}_${metric}_${year}_${String(h).padStart(2, "0")}`,
                userId: userIdVal,
                metric,
                year,
                hour: h,
                count
              });
            });
            await this.db.transaction(
              "rw",
              [table, this.db.approvals_detail, this.db.hourly_stats],
              async () => {
                if (bulkData.length > 0) {
                  await table.bulkPut(bulkData);
                }
                if (detailData.length > 0) {
                  await this.db.approvals_detail.bulkPut(detailData);
                }
                await this.db.hourly_stats.bulkPut(hourlyBulk);
              }
            );
            if (year < ( new Date()).getFullYear()) {
              await this.markYearComplete(userIdVal, metric, year);
            }
          }
        }
        const dataEndDate = `${year}-12-31`;
        const fullYearData = await table.where("id").between(
          `${userIdVal}_${startDate}`,
          `${userIdVal}_${dataEndDate}￿`,
          true,
          true
        ).toArray();
        const resultMap = {};
        fullYearData.forEach((i) => resultMap[i.date] = i.count);
        if (isYearCompleteCache) {
          const cachedHourly = await this.db.hourly_stats.where("id").between(
            `${userIdVal}_${metric}_${year}_00`,
            `${userIdVal}_${metric}_${year}_24`,
            true,
            false
          ).toArray();
          hourlyCounts = new Array(24).fill(0);
          cachedHourly.forEach((stat) => {
            if (stat.hour >= 0 && stat.hour < 24) {
              hourlyCounts[stat.hour] = stat.count;
            }
          });
        }
        return { daily: resultMap, hourly: hourlyCounts };
      } catch (e) {
        log$d.error("Metric data fetch failed", { error: e });
        throw e;
      }
    }
async clearCache(_metric, userInfo) {
      try {
        const userIdVal = userInfo.id || userInfo.name;
        const tablesToClear = [
          "uploads",
          "approvals",
          "approvals_detail",
          "notes",
          "completed_years",
          "hourly_stats"
        ];
        for (const storeName of tablesToClear) {
          const table = this.db[storeName];
          const items = await table.where("userId").equals(userIdVal).primaryKeys();
          if (items.length > 0) {
            await table.bulkDelete(items);
          }
        }
        return true;
      } catch (e) {
        log$d.error("Clear cache failed", { error: e });
        return false;
      }
    }
async fetchAllPages(endpoint, params, stopDate = null, dateKey = "created_at", direction = "desc", onProgress = null, isDelta = false) {
      let allItems = [];
      let page = 1;
      const FULL_BATCH = 5;
      const DELTA_SCALE_UP = 3;
      let batchSize = isDelta ? 1 : FULL_BATCH;
      const isApprovals = endpoint.includes("/post_approvals.json");
      const DELAY_BETWEEN_BATCHES = 150;
      while (true) {
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
          const currentPage = page + i;
          const q = new URLSearchParams({
            ...params,
            page: currentPage
          });
          const url = `${this.baseUrl}${endpoint}?${q.toString()}`;
          const fetchTask = async () => {
            if (isApprovals) {
              const delay = Math.floor(Math.random() * 300) + 200;
              await new Promise((r) => setTimeout(r, delay));
            }
            let attempt = 0;
            const backoff = [1e3, 2e3, 4e3];
            while (true) {
              const resp = await this.rateLimiter.fetch(url);
              if (resp.status === 429 || resp.status >= 500) {
                if (attempt < backoff.length) {
                  const waitMs = backoff[attempt];
                  log$d.warn(
                    `HTTP ${resp.status} on page ${currentPage}, retrying`,
                    { status: resp.status, page: currentPage, waitMs }
                  );
                  await new Promise((r) => setTimeout(r, waitMs));
                  attempt++;
                  continue;
                } else {
                  throw new Error(`HTTP ${resp.status} (Max Retries Exceeded)`);
                }
              }
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              return {
                page: currentPage,
                data: await resp.json()
              };
            }
          };
          promises.push(
            fetchTask().catch((e) => {
              log$d.error(`Critical fetch error on page ${currentPage}`, {
                page: currentPage,
                error: e
              });
              throw e;
            })
          );
        }
        const batchResults = await Promise.all(promises);
        batchResults.sort((a, b) => a.page - b.page);
        let finished = false;
        for (const res of batchResults) {
          const json = res.data;
          if (!Array.isArray(json) || json.length === 0) {
            finished = true;
            continue;
          }
          if (stopDate) {
            for (const item of json) {
              const itemDate = (item[dateKey] || "").slice(0, 10);
              if (itemDate) {
                let shouldStop = false;
                if (direction === "desc") {
                  if (itemDate < stopDate) shouldStop = true;
                } else {
                  if (itemDate > stopDate) shouldStop = true;
                }
                if (shouldStop) {
                  finished = true;
                  break;
                }
              }
              allItems.push(item);
            }
            if (finished) break;
          } else {
            allItems = allItems.concat(json);
          }
          if (onProgress) {
            onProgress(allItems.length);
          }
          if (json.length < params["limit"]) {
            finished = true;
          }
        }
        if (finished) break;
        const fetchedBatch = batchSize;
        if (batchSize < DELTA_SCALE_UP && page === 1) {
          const limit = params["limit"];
          const firstPageFull = batchResults[0]?.data?.length === limit;
          if (firstPageFull) {
            batchSize = DELTA_SCALE_UP;
          }
        }
        page += fetchedBatch;
        if (page > 1e3) {
          log$d.warn("Hit safety page limit of 1000, stopping fetch");
          break;
        }
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES));
      }
      return allItems;
    }
async fetchPromotionDate(userName) {
      try {
        const encodedName = encodeURIComponent(userName);
        const url = `${this.baseUrl}/user_feedbacks.json?search[body_matches]=to+Approver&search[category]=neutral&search[hide_bans]=No&search[user_name]=${encodedName}&limit=1`;
        const resp = await this.rateLimiter.fetch(url);
        if (!resp.ok) return null;
        const json = await resp.json();
        if (Array.isArray(json) && json.length > 0) {
          return json[0]["created_at"] ? String(json[0]["created_at"]).slice(0, 10) : null;
        }
        return null;
      } catch (e) {
        log$d.warn("Failed to fetch promotion date", { error: e });
        return null;
      }
    }
async getCacheStats() {
      const stats = {
        indexedDB: {
          count: 0,
          size: 0
        },
        localStorage: {
          count: 0,
          size: 0
        }
      };
      try {
        const tables = ["uploads", "approvals", "notes"];
        for (const t of tables) {
          const c = await this.db[t].count();
          stats.indexedDB.count += c;
        }
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          if (est.usageDetails && est.usageDetails.indexedDB) {
            stats.indexedDB.size = est.usageDetails.indexedDB;
          } else {
            stats.indexedDB.size = est.usage;
          }
        }
      } catch (e) {
        log$d.warn("Failed to get IndexedDB stats", { error: e });
      }
      let lsCount = 0;
      let lsSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CONFIG.STORAGE_PREFIX)) {
          lsCount++;
          const val = localStorage.getItem(k);
          if (val) lsSize += (k.length + val.length) * 2;
        }
      }
      stats.localStorage.count = lsCount;
      stats.localStorage.size = lsSize;
      return stats;
    }
async fetchRemoteCount(tags) {
      const url = `${this.baseUrl}/counts/posts.json?tags=${encodeURIComponent(tags)}`;
      const resp = await this.rateLimiter.fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      return json["counts"] && typeof json["counts"]["posts"] === "number" ? json["counts"]["posts"] : 0;
    }
async revalidateCurrentYearCache(userId, normalizedName) {
      const flagKey = `di_cache_v924_migrated_${userId}`;
      try {
        if (localStorage.getItem(flagKey) === "1") return;
      } catch {
        return;
      }
      const year = ( new Date()).getFullYear();
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      let anyMismatch = false;
      for (const metric of ["uploads", "approvals", "notes"]) {
        try {
          let queryTags;
          if (metric === "uploads") {
            queryTags = `user:${normalizedName} date:${startDate}...${year + 1}-01-01`;
          } else if (metric === "approvals") {
            queryTags = `approver:${normalizedName} date:${startDate}...${year + 1}-01-01`;
          } else {
            continue;
          }
          const remoteCount = await this.fetchRemoteCount(queryTags);
          const table = this.db[metric];
          let localCount = 0;
          await table.where("id").between(
            `${userId}_${startDate}`,
            `${userId}_${endDate}￿`,
            true,
            true
          ).each((cur) => {
            localCount += cur["count"] || 0;
          });
          if (remoteCount !== localCount) {
            log$d.warn(
              `v924 revalidation: ${metric} mismatch for ${year}, clearing`,
              { remoteCount, localCount }
            );
            await table.where("id").between(
              `${userId}_${startDate}`,
              `${userId}_${endDate}￿`,
              true,
              true
            ).delete();
            try {
              await this.db.completed_years.delete(`${userId}_${metric}_${year}`);
            } catch {
            }
            anyMismatch = true;
          }
        } catch (e) {
          log$d.warn(`v924 revalidation: ${metric} check failed, will retry`, {
            error: e
          });
          return;
        }
      }
      if (anyMismatch) {
        log$d.info("v924 revalidation: cleared stale data, will refetch");
      }
      try {
        localStorage.setItem(flagKey, "1");
      } catch {
      }
    }
  }
  const DEFAULT_DURATIONS = {
    success: 3e3,
    info: 3e3,
    warn: 5e3,
    error: 1e4
  };
  const MAX_TOASTS = 5;
  const activeToasts = [];
  let container = null;
  function getContainer() {
    if (container && document.body.contains(container)) return container;
    container = document.createElement("div");
    container.className = "di-toast-container";
    document.body.appendChild(container);
    return container;
  }
  function removeToast(el) {
    el.classList.remove("di-toast-visible");
    el.classList.add("di-toast-exit");
    const onEnd = () => {
      el.removeEventListener("transitionend", onEnd);
      el.remove();
      const idx = activeToasts.indexOf(el);
      if (idx !== -1) activeToasts.splice(idx, 1);
    };
    el.addEventListener("transitionend", onEnd);
    setTimeout(onEnd, 350);
  }
  function showToast(options) {
    const { type, message } = options;
    const duration = options.duration ?? DEFAULT_DURATIONS[type];
    const parent = getContainer();
    while (activeToasts.length >= MAX_TOASTS) {
      const oldest = activeToasts.shift();
      if (oldest) removeToast(oldest);
    }
    const el = document.createElement("div");
    el.className = `di-toast di-toast-${type}`;
    const msgSpan = document.createElement("span");
    msgSpan.className = "di-toast-message";
    msgSpan.textContent = message;
    el.appendChild(msgSpan);
    const closeBtn = document.createElement("button");
    closeBtn.className = "di-toast-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => removeToast(el));
    el.appendChild(closeBtn);
    parent.appendChild(el);
    activeToasts.push(el);
    requestAnimationFrame(() => {
      el.classList.add("di-toast-visible");
    });
    if (duration > 0) {
      setTimeout(() => {
        if (document.body.contains(el)) {
          removeToast(el);
        }
      }, duration);
    }
  }
  const POPOVER_LIGHT = {
    "--di-bg": "#ffffff",
    "--di-text": "#333",
    "--di-text-heading": "#444",
    "--di-text-muted": "#888",
    "--di-btn-text": "#555",
    "--di-border-input": "#ddd",
    "--di-border-light": "#eee",
    "--di-shadow": "rgba(0,0,0,0.2)",
    "--di-shadow-light": "rgba(0,0,0,0.1)",
    "--di-link": "#007bff",
    "--di-bg-tertiary": "#f0f0f0"
  };
  const POPOVER_DARK = {
    "--di-bg": "#1a1a2e",
    "--di-text": "#e0e0e0",
    "--di-text-heading": "#d0d0d0",
    "--di-text-muted": "#888",
    "--di-btn-text": "#ccc",
    "--di-border-input": "#444466",
    "--di-border-light": "#2e2e48",
    "--di-shadow": "rgba(0,0,0,0.5)",
    "--di-shadow-light": "rgba(0,0,0,0.3)",
    "--di-link": "#58a6ff",
    "--di-bg-tertiary": "#2a2a44"
  };
  const DARK_THEMES = new Set([
    "midnight",
    "solarized_dark",
    "newspaper",
    "ocean",
    "monokai",
    "ember"
  ]);
  function applyPopoverPalette(elements, themeKey) {
    const palette = DARK_THEMES.has(themeKey) ? POPOVER_DARK : POPOVER_LIGHT;
    for (const el of elements) {
      for (const [prop, val] of Object.entries(palette)) {
        el.style.setProperty(prop, val);
      }
    }
  }
  function createSettingsPopover(options) {
    const { settingsManager, db, metric, settingsBtn, closeSettings, onRefresh } = options;
    let settingsChanged = false;
    const validateThresholds = () => {
      const modes = ["uploads", "approvals", "notes"];
      for (const m of modes) {
        const vals = settingsManager.getThresholds(m);
        for (let i = 0; i < vals.length - 1; i++) {
          if (vals[i] >= vals[i + 1]) {
            return {
              valid: false,
              msg: `Invalid in [${m}]: Level ${i + 1} (${vals[i]}) must be smaller than Level ${i + 2} (${vals[i + 1]})`
            };
          }
        }
      }
      return { valid: true };
    };
    const handleClose = () => {
      const check = validateThresholds();
      if (!check.valid) {
        showToast({ type: "warn", message: check.msg ?? "Invalid settings." });
        return;
      }
      popover.style.display = "none";
      const gf = document.getElementById("danbooru-grass-flyout");
      if (gf) gf.style.display = "none";
      if (settingsChanged) {
        settingsChanged = false;
        closeSettings();
      }
    };
    const popover = document.createElement("div");
    popover.id = "danbooru-grass-settings-popover";
    document.addEventListener("click", (e) => {
      if (popover && popover.style.display === "block") {
        if (!popover.contains(e.target) && !settingsBtn.contains(e.target) && !grassFlyout.contains(e.target)) {
          handleClose();
        }
      }
    });
    const repositionPopover = () => {
      if (popover.style.display !== "block") return;
      const btnRect = settingsBtn.getBoundingClientRect();
      popover.style.left = btnRect.left + "px";
      popover.style.top = btnRect.bottom + 4 + "px";
    };
    window.addEventListener(
      "scroll",
      (e) => {
        if (popover.style.display === "block" && !popover.contains(e.target)) {
          repositionPopover();
        }
      },
      true
    );
    const themeHeaderRow = document.createElement("div");
    themeHeaderRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;";
    const themeHeader = document.createElement("div");
    themeHeader.className = "popover-header";
    themeHeader.style.margin = "0";
    themeHeader.textContent = "Color Themes";
    const previewLink = document.createElement("a");
    previewLink.href = "https://akaringop.github.io/Danbooru-Insights/theme-preview.html";
    previewLink.target = "_blank";
    previewLink.rel = "noopener";
    previewLink.textContent = "Preview all";
    previewLink.style.cssText = "font-size:11px;color:var(--di-link,#007bff);text-decoration:none;opacity:0.7;";
    previewLink.onmouseenter = () => {
      previewLink.style.opacity = "1";
    };
    previewLink.onmouseleave = () => {
      previewLink.style.opacity = "0.7";
    };
    themeHeaderRow.appendChild(themeHeader);
    themeHeaderRow.appendChild(previewLink);
    popover.appendChild(themeHeaderRow);
    const grid = document.createElement("div");
    grid.className = "theme-grid";
    const currentTheme = settingsManager.getTheme();
    Object.entries(CONFIG.THEMES).forEach(([key, theme]) => {
      const icon = document.createElement("div");
      icon.className = "theme-icon";
      if (key === currentTheme) icon.classList.add("active");
      icon.title = theme.name;
      icon.style.background = theme.bg;
      const inner = document.createElement("div");
      inner.className = "theme-icon-inner";
      inner.style.background = theme.empty;
      icon.appendChild(inner);
      icon.onclick = () => {
        const wasActive = icon.classList.contains("active");
        if (!wasActive) {
          settingsManager.applyTheme(key);
          document.querySelectorAll(".theme-icon").forEach((el) => el.classList.remove("active"));
          icon.classList.add("active");
          applyPopoverPalette([popover, grassFlyout], key);
        }
        toggleGrassFlyout(icon, key);
      };
      grid.appendChild(icon);
    });
    popover.appendChild(grid);
    const grassFlyout = document.createElement("div");
    grassFlyout.id = "danbooru-grass-flyout";
    grassFlyout.style.cssText = "position:fixed;display:none;background:var(--di-bg, #fff);border:1px solid var(--di-border-input, #ddd);border-radius:8px;box-shadow:0 4px 12px var(--di-shadow, rgba(0,0,0,0.2));padding:8px;z-index:10001;flex-direction:column;gap:6px;";
    document.body.appendChild(grassFlyout);
    let currentFlyoutKey = "";
    const toggleGrassFlyout = (anchorEl, themeKey) => {
      if (grassFlyout.style.display !== "none" && currentFlyoutKey === themeKey) {
        grassFlyout.style.display = "none";
        return;
      }
      currentFlyoutKey = themeKey;
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        const btnRect = anchorEl.getBoundingClientRect();
        grassFlyout.style.left = "10px";
        grassFlyout.style.right = "10px";
        grassFlyout.style.top = btnRect.bottom + 4 + "px";
        grassFlyout.style.maxWidth = "calc(100vw - 20px)";
      } else {
        const popoverRect = popover.getBoundingClientRect();
        grassFlyout.style.left = popoverRect.right + 8 + "px";
        grassFlyout.style.top = popoverRect.top + "px";
        grassFlyout.style.right = "";
        grassFlyout.style.maxWidth = "";
      }
      renderGrassFlyout(themeKey);
      grassFlyout.style.display = "flex";
    };
    const renderGrassFlyout = (themeKey) => {
      grassFlyout.innerHTML = "";
      const theme = CONFIG.THEMES[themeKey] || CONFIG.THEMES.light;
      const options2 = theme.grassOptions;
      if (!options2 || !Array.isArray(options2)) {
        grassFlyout.style.display = "none";
        return;
      }
      const currentIdx = settingsManager.getGrassIndex(themeKey);
      const title = document.createElement("div");
      title.style.cssText = "font-size:10px;color:var(--di-text-muted, #888);font-weight:600;margin-bottom:2px;";
      title.textContent = "Grass Color";
      grassFlyout.appendChild(title);
      options2.forEach((opt, idx) => {
        const row = document.createElement("div");
        row.style.cssText = "cursor:pointer;display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;border:2px solid transparent;transition:all 0.15s;";
        if (idx === currentIdx) row.style.borderColor = "var(--di-link, #007bff)";
        const preview = document.createElement("div");
        preview.style.cssText = "display:flex;gap:2px;";
        for (let i = 1; i < opt.levels.length; i++) {
          const cell = document.createElement("div");
          cell.style.cssText = `width:12px;height:12px;border-radius:2px;background:${opt.levels[i]};`;
          preview.appendChild(cell);
        }
        row.appendChild(preview);
        const label = document.createElement("div");
        label.style.cssText = "font-size:10px;color:var(--di-btn-text, #555);white-space:nowrap;";
        label.textContent = idx === 0 ? `★ ${opt.name}` : opt.name;
        row.appendChild(label);
        row.onmouseover = () => {
          if (idx !== currentIdx)
            row.style.background = "var(--di-bg-tertiary, #f0f0f0)";
        };
        row.onmouseout = () => {
          row.style.background = "";
        };
        row.onclick = (e) => {
          e.stopPropagation();
          settingsManager.setGrassIndex(themeKey, idx);
          settingsManager.applyTheme(themeKey);
          grassFlyout.style.display = "none";
        };
        grassFlyout.appendChild(row);
      });
    };
    popover.addEventListener("click", (e) => {
      const target = e.target;
      if (!grassFlyout.contains(target) && !target.closest(".theme-icon")) {
        grassFlyout.style.display = "none";
      }
    });
    const threshHeader = document.createElement("div");
    threshHeader.className = "popover-header";
    threshHeader.textContent = "Set thresholds";
    threshHeader.style.marginTop = "15px";
    popover.appendChild(threshHeader);
    const modeSelect = document.createElement("select");
    modeSelect.className = "popover-select";
    ["uploads", "approvals", "notes"].forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m.charAt(0).toUpperCase() + m.slice(1);
      if (m === metric.toLowerCase() || m === "uploads" && !metric)
        opt.selected = true;
      modeSelect.appendChild(opt);
    });
    popover.appendChild(modeSelect);
    const editor = document.createElement("div");
    popover.appendChild(editor);
    const renderEditor = (mode) => {
      editor.innerHTML = "";
      const vals = settingsManager.getThresholds(mode);
      const inputColors = ["#9be9a8", "#40c463", "#30a14e", "#216e39"];
      vals.forEach((val, idx) => {
        const row = document.createElement("div");
        row.className = "threshold-row";
        const label = document.createElement("span");
        label.textContent = `Level ${idx + 1}:`;
        label.style.width = "50px";
        const input = document.createElement("input");
        input.type = "number";
        input.className = "threshold-input";
        input.value = String(val);
        input.style.backgroundColor = inputColors[idx];
        input.style.color = "#ffffff";
        input.style.textShadow = "0px 1px 2px rgba(0,0,0,0.8)";
        input.style.fontWeight = "bold";
        input.style.border = "1px solid var(--di-border-input, #ddd)";
        input.style.borderRadius = "4px";
        input.onchange = () => {
          const newVals = [...vals];
          newVals[idx] = parseInt(input.value);
          settingsManager.setThresholds(mode, newVals);
          settingsChanged = true;
          vals[idx] = newVals[idx];
        };
        row.appendChild(label);
        row.appendChild(input);
        editor.appendChild(row);
      });
    };
    modeSelect.addEventListener("change", () => renderEditor(modeSelect.value));
    renderEditor(modeSelect.value);
    const snapRow = document.createElement("div");
    snapRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:12px;";
    const snapCheckbox = document.createElement("input");
    snapCheckbox.type = "checkbox";
    snapCheckbox.id = "di-snap-to-edge";
    snapCheckbox.checked = settingsManager.getSnapToEdge();
    snapCheckbox.style.cssText = "margin:0;cursor:pointer;";
    const snapLabel = document.createElement("label");
    snapLabel.htmlFor = "di-snap-to-edge";
    snapLabel.textContent = "Snap to edge when resizing";
    snapLabel.style.cssText = "font-size:11px;color:var(--di-text, #333);cursor:pointer;user-select:none;";
    snapCheckbox.onchange = () => {
      settingsManager.setSnapToEdge(snapCheckbox.checked);
    };
    snapRow.appendChild(snapCheckbox);
    snapRow.appendChild(snapLabel);
    popover.appendChild(snapRow);
    const cacheSection = document.createElement("div");
    cacheSection.style.marginTop = "15px";
    cacheSection.style.borderTop = "1px solid var(--di-border-input, #ddd)";
    cacheSection.style.paddingTop = "10px";
    const cacheHeader = document.createElement("div");
    cacheHeader.style.display = "flex";
    cacheHeader.style.justifyContent = "space-between";
    cacheHeader.style.alignItems = "center";
    cacheHeader.style.marginBottom = "5px";
    cacheHeader.innerHTML = `
          <div style="font-weight:bold; color:var(--di-text-heading, #444);">Cache Info</div>
          <button id="grass-purge-btn" title="Purge Cache" style="
            padding: 2px 6px;
            background-color: #ffebe9;
            border: 1px solid #ff818266;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            color: #cf222e;
            line-height: 1;
          ">↺</button>
        `;
    cacheSection.appendChild(cacheHeader);
    const cacheStatsContainer = document.createElement("div");
    cacheStatsContainer.id = "grass-cache-container";
    cacheStatsContainer.innerHTML = `
          <div style="font-size:12px; margin-bottom:10px;">
            <a href="#" id="grass-cache-trigger" style="color:var(--di-link, #007bff); text-decoration:none;">[ Show Stats ]</a>
          </div>
          <div id="grass-cache-content" style="display:none;"></div>
        `;
    cacheSection.appendChild(cacheStatsContainer);
    popover.appendChild(cacheSection);
    const trigger = cacheSection.querySelector("#grass-cache-trigger");
    const contentDiv = cacheSection.querySelector("#grass-cache-content");
    const purgeBtn = cacheSection.querySelector("#grass-purge-btn");
    const formatBytes = (bytes, decimals = 2) => {
      if (!+bytes) return "0 B";
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    };
    let isStatsVisible = false;
    let statsInterval = null;
    const updateMyStats = async () => {
      const dataManager = new DataManager(db);
      const stats = await dataManager.getCacheStats();
      contentDiv.innerHTML = `
            <table style="width:100%; border-collapse:collapse; font-size:11px;">
              <tr style="border-bottom:1px solid var(--di-border-light, #eee);">
                <th style="text-align:left; padding:2px;">Source</th>
                <th style="text-align:right; padding:2px;">Items</th>
                <th style="text-align:right; padding:2px;">Size</th>
              </tr>
              <tr>
                <td style="padding:2px;">IndexedDB</td>
                <td style="text-align:right; padding:2px;">${stats.indexedDB.count}</td>
                <td style="text-align:right; padding:2px;">${formatBytes(stats.indexedDB.size)}</td>
              </tr>
              <tr>
                <td style="padding:2px;">Settings</td>
                <td style="text-align:right; padding:2px;">${stats.localStorage.count}</td>
                <td style="text-align:right; padding:2px;">${formatBytes(stats.localStorage.size)}</td>
              </tr>
            </table>
          `;
    };
    trigger.onclick = async (e) => {
      e.preventDefault();
      if (isStatsVisible) {
        contentDiv.style.display = "none";
        trigger.textContent = "[ Show Stats ]";
        isStatsVisible = false;
        if (statsInterval) {
          clearInterval(statsInterval);
          statsInterval = null;
        }
      } else {
        trigger.textContent = "Calculating...";
        contentDiv.style.display = "block";
        await updateMyStats();
        trigger.textContent = "[ Hide Stats ]";
        isStatsVisible = true;
        if (statsInterval) clearInterval(statsInterval);
        statsInterval = setInterval(() => {
          if (isStatsVisible && popover.style.display === "block") {
            void updateMyStats();
          } else {
            if (statsInterval) clearInterval(statsInterval);
          }
        }, 100);
      }
    };
    purgeBtn.onclick = () => {
      if (confirm(
        "Are you sure you want to clear all cached data? This will trigger a full re-fetch."
      )) {
        onRefresh();
      }
    };
    applyPopoverPalette([popover, grassFlyout], settingsManager.getTheme());
    return { popover, close: handleClose };
  }
  function escapeHtml$1(text) {
    const el = document.createElement("div");
    el.textContent = text;
    return el.innerHTML;
  }
  async function isTopLevelTag(rateLimiter, tagName) {
    const impUrl = `/tag_implications.json?search[antecedent_name_matches]=${encodeURIComponent(tagName)}`;
    try {
      const imps = await rateLimiter.fetch(impUrl).then((r) => r.json());
      return !(Array.isArray(imps) && imps.length > 0);
    } catch {
      return true;
    }
  }
  function getLevelClass(level) {
    if (!level) return "user-member";
    const l = level.toLowerCase();
    if (l.includes("admin") || l.includes("owner")) return "user-admin";
    if (l.includes("moderator")) return "user-moderator";
    if (l.includes("builder") || l.includes("contributor") || l.includes("approver"))
      return "user-builder";
    if (l.includes("platinum")) return "user-platinum";
    if (l.includes("gold")) return "user-gold";
    if (l.includes("janitor")) return "user-janitor";
    if (l.includes("member")) return "user-member";
    return "user-member";
  }
  function getBestThumbnailUrl(post) {
    if (!post) return "";
    if (post.variants && Array.isArray(post.variants) && post.variants.length > 0) {
      const preferredTypes = ["720x720", "360x360"];
      for (const type of preferredTypes) {
        const variant = post.variants.find(
          (v) => v.type === type && v.file_ext === "webp"
        );
        if (variant) return variant.url;
      }
      for (const type of preferredTypes) {
        const variant = post.variants.find((v) => v.type === type);
        if (variant) return variant.url;
      }
      if (post.variants[0] && post.variants[0].url) return post.variants[0].url;
    }
    return post.preview_file_url || post.file_url || post.large_file_url || "";
  }
  function isTouchDevice() {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }
  class TapTracker {


static MOVE_THRESHOLD_PX = 15;
    static TIME_THRESHOLD_MS = 600;
    start = null;
onTouchStart(event) {
      const t = event.touches[0];
      this.start = t ? { x: t.clientX, y: t.clientY, time: Date.now() } : null;
    }
onTouchMove(event) {
      if (!this.start) return;
      const t = event.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - this.start.x) > TapTracker.MOVE_THRESHOLD_PX || Math.abs(t.clientY - this.start.y) > TapTracker.MOVE_THRESHOLD_PX) {
        this.start = null;
      }
    }
onTouchEnd(event) {
      const start = this.start;
      this.start = null;
      if (!start) return false;
      const t = event.changedTouches[0];
      if (!t) return false;
      const dx = Math.abs(t.clientX - start.x);
      const dy = Math.abs(t.clientY - start.y);
      const dt = Date.now() - start.time;
      return dx <= TapTracker.MOVE_THRESHOLD_PX && dy <= TapTracker.MOVE_THRESHOLD_PX && dt <= TapTracker.TIME_THRESHOLD_MS;
    }
get isTracking() {
      return this.start !== null;
    }
  }
  function createTwoStepTap(options) {
    let activeDatum = null;
    const eq = options.isEqual ?? ((a, b) => a === b);
    const reset = () => {
      if (activeDatum !== null) {
        activeDatum = null;
        options.onReset();
      }
    };
    const outsideTapHandler = (e) => {
      if (activeDatum === null) return;
      const inside = options.insideElements();
      const target = e.target;
      if (inside.some((el) => el?.contains(target))) return;
      reset();
    };
    document.addEventListener("touchstart", outsideTapHandler, { passive: true });
    document.addEventListener("click", outsideTapHandler);
    let scrollHandler = null;
    if (options.resetOnScroll) {
      scrollHandler = () => reset();
      window.addEventListener("scroll", scrollHandler, { passive: true });
    }
    return {
      tap(datum) {
        if (activeDatum !== null && eq(activeDatum, datum)) {
          if (options.navigateOnSameTap === false) {
            return false;
          }
          const d = activeDatum;
          activeDatum = null;
          options.onSecondTap(d);
          return true;
        }
        activeDatum = datum;
        options.onFirstTap(datum);
        return false;
      },
      navigateActive() {
        if (activeDatum === null) return false;
        const d = activeDatum;
        activeDatum = null;
        options.onSecondTap(d);
        return true;
      },
      get active() {
        return activeDatum;
      },
      reset,
      destroy() {
        document.removeEventListener("touchstart", outsideTapHandler);
        document.removeEventListener("click", outsideTapHandler);
        if (scrollHandler) {
          window.removeEventListener("scroll", scrollHandler);
        }
        activeDatum = null;
      }
    };
  }
  const cardId = "di-post-hover-card";
  const cache = new Map();
  const inFlight = new Map();
  const RATING_LABELS = {
    g: "General",
    s: "Sensitive",
    q: "Questionable",
    e: "Explicit"
  };
  const ensureCard = () => {
    let el = document.getElementById(cardId);
    if (el) return el;
    el = document.createElement("div");
    el.id = cardId;
    el.style.cssText = [
      "position: absolute",
      "background: var(--di-bg, #fff)",
      "border: 1px solid var(--di-border-input, #ddd)",
      "border-radius: 8px",
      "box-shadow: 0 6px 20px var(--di-shadow, rgba(0,0,0,0.2))",
      "padding: 10px",
      "width: 300px",
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      "font-size: 12px",
      "color: var(--di-text, #333)",
      "pointer-events: none",
      "z-index: 100000",
      "display: none"
    ].join(";");
    document.body.appendChild(el);
    return el;
  };
  const escapeHtml = (s) => s.replace(
    /[&<>"']/g,
    (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]
  );
  const firstTag = (tagString) => {
    if (!tagString) return "";
    const first = tagString.split(" ").find((t) => t.length > 0);
    return first ? first.replace(/_/g, " ") : "";
  };
  const buildCardHtml = (post) => {
    const thumb = getBestThumbnailUrl(post) || post.preview_file_url || "";
    const dateStr = post.created_at ? post.created_at.slice(0, 10) : "?";
    const score = post.score ?? "?";
    const favs = post.fav_count ?? "?";
    const rating = post.rating ? RATING_LABELS[post.rating] ?? post.rating : "?";
    const artist = firstTag(post.tag_string_artist);
    const copyright = firstTag(post.tag_string_copyright);
    const character = firstTag(post.tag_string_character);
    const tagLine = (icon, label, value) => value ? `<div style="font-size:11px;color:var(--di-text-heading, #444);"><strong>${icon} ${label}:</strong> ${escapeHtml(value)}</div>` : "";
    const tagsBlock = artist || copyright || character ? `<div style="margin-top:6px;border-top:1px solid var(--di-border-light, #eee);padding-top:6px;display:flex;flex-direction:column;gap:2px;">
        ${tagLine("🎨", "Artist", artist)}
        ${tagLine("©", "Copy", copyright)}
        ${tagLine("👤", "Char", character)}
      </div>` : "";
    return `
    <div style="display:flex;gap:10px;align-items:flex-start;">
      <div style="width:80px;height:80px;flex-shrink:0;background:var(--di-bg-tertiary, #f0f0f0);border-radius:4px;overflow:hidden;">
        ${thumb ? `<img src="${escapeHtml(thumb)}" style="width:100%;height:100%;object-fit:cover;">` : ""}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:bold;color:var(--di-link, #007bff);font-size:13px;">Post #${post.id}</div>
        <div style="font-size:11px;color:var(--di-text-secondary, #666);line-height:1.5;margin-top:2px;">
          📅 ${dateStr}<br>
          ❤️ Score: <strong>${score}</strong><br>
          ⭐ Favs: <strong>${favs}</strong><br>
          🤔 Rating: <strong>${rating}</strong>
        </div>
      </div>
    </div>
    ${tagsBlock}
  `;
  };
  const positionCard = (card, anchor, positionRef) => {
    const refRect = positionRef.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    card.style.display = "block";
    const cardRect = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 10;
    let top = anchorRect.top + window.scrollY;
    if (top + cardRect.height > window.scrollY + vh - margin) {
      top = window.scrollY + vh - cardRect.height - margin;
    }
    if (top < window.scrollY + margin) top = window.scrollY + margin;
    const spaceRight = vw - refRect.right;
    const spaceLeft = refRect.left;
    let left;
    if (spaceRight >= cardRect.width + gap + margin) {
      left = refRect.right + window.scrollX + gap;
    } else if (spaceLeft >= cardRect.width + gap + margin) {
      left = refRect.left + window.scrollX - cardRect.width - gap;
    } else {
      if (spaceRight >= spaceLeft) {
        left = refRect.right + window.scrollX + gap;
      } else {
        left = refRect.left + window.scrollX - cardRect.width - gap;
      }
    }
    const minLeft = window.scrollX + margin;
    const maxLeft = window.scrollX + vw - cardRect.width - margin;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };
  const fetchWithCache = async (postId, fetcher) => {
    const cached = cache.get(postId);
    if (cached) return cached;
    const pending = inFlight.get(postId);
    if (pending) return pending;
    const promise = (async () => {
      const result = await fetcher(postId);
      if (result) cache.set(postId, result);
      inFlight.delete(postId);
      return result;
    })();
    inFlight.set(postId, promise);
    return promise;
  };
  function attachPostHoverCard(el, postId, fetcher, positionRef) {
    if (isTouchDevice()) return;
    let debounceTimer = null;
    let currentToken = 0;
    const hide = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      currentToken++;
      const card = document.getElementById(cardId);
      if (card) card.style.display = "none";
    };
    el.addEventListener("mouseenter", () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      const token = ++currentToken;
      debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        const details = await fetchWithCache(postId, fetcher);
        if (token !== currentToken) return;
        if (!details) return;
        const card = ensureCard();
        card.innerHTML = buildCardHtml(details);
        positionCard(card, el, positionRef ?? el);
      }, 100);
    });
    el.addEventListener("mouseleave", hide);
  }
  function hidePostHoverCard() {
    const card = document.getElementById(cardId);
    if (card) card.style.display = "none";
  }
  const log$c = createLogger("ApprovalPopover");
  async function showApprovalsDetail(db, dateStr, userId, event, fetchPostDetails) {
    const popoverId = "danbooru-approvals-popover";
    let pop = document.getElementById(popoverId);
    if (!pop) {
      pop = document.createElement("div");
      pop.id = popoverId;
      document.body.appendChild(pop);
    }
    const detailId = `${userId}_${dateStr}`;
    const detail = await db.approvals_detail.get(detailId);
    if (!detail) {
      log$c.warn(`No entry found in approvals_detail for ID: ${detailId}`);
      return;
    }
    if (!detail.post_list || detail.post_list.length === 0) {
      log$c.warn("Entry found but post_list is empty", { detailId });
      return;
    }
    const posts = detail.post_list;
    const total = posts.length;
    const limit = 100;
    let currentPage = 1;
    const totalPages = Math.ceil(total / limit);
    const renderPage = (page) => {
      currentPage = page;
      const start = (page - 1) * limit;
      const end = Math.min(start + limit, total);
      const pagePosts = posts.slice(start, end);
      pop.innerHTML = `
          <div class="header">
            <div class="header-title">${dateStr} Approvals (${total})</div>
            <div style="display:flex; align-items:center; gap:8px;">
              <a href="/posts?tags=id:${pagePosts.join(",")}" target="_blank" class="gallery-btn" title="View Current Page as Gallery">
                <svg aria-hidden="true" height="18" viewBox="0 0 16 16" version="1.1" width="18" data-view-component="true" style="fill: currentColor;">
                  <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.75.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-1.19l-4.22 4.22a.75.75 0 1 1-1.06-1.06L12.44 3.5h-1.19a.75.75 0 0 1-.75-.75Z"></path>
                </svg>
              </a>
              <div class="close-btn">&times;</div>
            </div>
          </div>
          <div class="post-grid">
            ${pagePosts.map((id) => `<a href="/posts/${id}" target="_blank" class="post-link">#${id}</a>`).join("")}
          </div>
          <div class="pagination">
            <button class="page-btn" id="popover-prev" ${page === 1 ? "disabled" : ""}>&lt;</button>
            <span>${page} / ${totalPages}</span>
            <button class="page-btn" id="popover-next" ${page === totalPages ? "disabled" : ""}>&gt;</button>
          </div>
        `;
      pop.querySelector(".close-btn").onclick = () => {
        pop.style.display = "none";
        hidePostHoverCard();
      };
      pop.querySelector("#popover-prev").onclick = (e) => {
        e.stopPropagation();
        renderPage(currentPage - 1);
      };
      pop.querySelector("#popover-next").onclick = (e) => {
        e.stopPropagation();
        renderPage(currentPage + 1);
      };
      if (fetchPostDetails) {
        pop.querySelectorAll(".post-link").forEach((linkEl) => {
          const a = linkEl;
          const match = a.getAttribute("href")?.match(/\/posts\/(\d+)/);
          if (!match) return;
          const id = parseInt(match[1]);
          if (id) attachPostHoverCard(a, id, fetchPostDetails, pop);
        });
      }
    };
    renderPage(1);
    pop.style.setProperty("display", "block", "important");
    const rect = pop.getBoundingClientRect();
    let left = event.pageX + 10;
    let top = event.pageY - 20;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    if (left + rect.width > scrollX + viewportWidth - 20) {
      left = event.pageX - rect.width - 10;
    }
    if (top + rect.height > scrollY + viewportHeight - 20) {
      top = event.pageY - rect.height - 10;
    }
    if (left < scrollX + 10) left = scrollX + 10;
    if (top < scrollY + 10) top = scrollY + 10;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    const closeHandler = (e) => {
      if (!pop.contains(e.target)) {
        pop.style.setProperty("display", "none", "important");
        hidePostHoverCard();
        document.removeEventListener("mousedown", closeHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener("mousedown", closeHandler);
    }, 100);
  }
  const log$b = createLogger("GraphRenderer");
  class GraphRenderer {
    containerId;
    cal;
    settingsManager;
    db;
    dataManager;
reapplyGraphConstraints = null;
savedLayoutMode = null;
currentYear = null;
constructor(settingsManager, db) {
      this.containerId = "danbooru-grass-container";
      this.cal = null;
      this.settingsManager = settingsManager;
      this.db = db;
      this.dataManager = null;
      this.reapplyGraphConstraints = null;
    }
scrollToCurrentMonth() {
      const scrollContainer = document.getElementById("cal-heatmap-scroll");
      if (!scrollContainer) return;
      if (this.currentYear !== ( new Date()).getFullYear()) {
        scrollContainer.scrollLeft = 0;
        return;
      }
      const currentMonth = ( new Date()).getMonth() + 1;
      const targetMonth = scrollContainer.querySelector(
        `.ch-domain:nth-of-type(${currentMonth})`
      );
      if (targetMonth) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const elementRect = targetMonth.getBoundingClientRect();
        scrollContainer.scrollLeft += elementRect.left - containerRect.left - 10;
      } else {
        scrollContainer.scrollLeft = scrollContainer.scrollWidth;
      }
    }
async injectSkeleton(dataManager, userId) {
      this.dataManager = dataManager;
      if (document.getElementById(this.containerId)) {
        return true;
      }
      let stats = document.querySelector(CONFIG.SELECTORS.STATISTICS_SECTION);
      if (!stats) {
        const table = document.querySelector(
          "#a-show > div:nth-child(1) > div:nth-child(2) > table"
        );
        if (table) stats = table.parentElement;
      }
      if (!stats) {
        document.querySelectorAll("h1, h2").forEach((el) => {
          if (el.textContent.trim() === "Statistics") stats = el.parentElement;
        });
      }
      if (!stats) {
        log$b.error("Injection point not found");
        return false;
      }
      let wrapper = document.getElementById("danbooru-grass-wrapper");
      if (!wrapper) {
        if (stats.parentNode.id === "danbooru-grass-wrapper") {
          wrapper = stats.parentNode;
        } else {
          wrapper = document.createElement("div");
          wrapper.id = "danbooru-grass-wrapper";
          wrapper.style.display = "flex";
          wrapper.style.alignItems = "flex-start";
          wrapper.style.gap = "20px";
          wrapper.style.flexWrap = "wrap";
          wrapper.style.width = "100%";
          stats.parentNode?.insertBefore(wrapper, stats);
          wrapper.appendChild(stats);
        }
      }
      const statsEl = stats;
      statsEl.style.minWidth = "0";
      statsEl.style.maxWidth = "60%";
      statsEl.style.overflowWrap = "break-word";
      statsEl.style.overflow = "hidden";
      const container2 = document.createElement("div");
      container2.id = this.containerId;
      container2.style.position = "relative";
      const grassSettings = await dataManager.getGrassSettings(userId);
      this.savedLayoutMode = grassSettings?.layoutMode ?? null;
      let inlineWidth = grassSettings?.inlineWidth ?? (typeof grassSettings?.width === "number" ? grassSettings.width : null);
      let inlineX = grassSettings?.inlineXOffset ?? grassSettings?.xOffset ?? 0;
      let belowWidth = grassSettings?.belowWidth ?? null;
      let belowX = grassSettings?.belowXOffset ?? 0;
      let savedWidth = this.savedLayoutMode === "below" ? belowWidth : inlineWidth;
      let savedX = this.savedLayoutMode === "below" ? belowX : inlineX;
      const persistSettings = () => {
        void dataManager.saveGrassSettings(userId, {
          layoutMode: this.savedLayoutMode,
          inlineWidth,
          inlineXOffset: inlineX,
          belowWidth,
          belowXOffset: belowX
        });
      };
      const HOURLY_PANEL_MIN_WIDTH = 310;
      let cachedNaturalWidth = null;
      const measureNaturalWidth = () => {
        if (cachedNaturalWidth !== null) return cachedNaturalWidth;
        const heatmapEl = container2.querySelector(
          "#cal-heatmap"
        );
        if (!heatmapEl) return null;
        const domains = heatmapEl.querySelectorAll(".ch-domain");
        if (domains.length === 0) return null;
        const firstRect = domains[0].getBoundingClientRect();
        const lastRect = domains[domains.length - 1].getBoundingClientRect();
        const svgWidth = Math.ceil(lastRect.right - firstRect.left);
        if (svgWidth <= 0) return null;
        const labelsEl = container2.querySelector(
          "#gh-day-labels"
        );
        let labelsWidth = 0;
        if (labelsEl) {
          const labelCS = getComputedStyle(labelsEl);
          labelsWidth = labelsEl.offsetWidth + parseFloat(labelCS.marginLeft || "0") + parseFloat(labelCS.marginRight || "0");
        }
        const cs = getComputedStyle(container2);
        const padH = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
        cachedNaturalWidth = Math.ceil(svgWidth + labelsWidth + padH);
        return cachedNaturalWidth;
      };
      let cachedCurrentToDecWidth = null;
      const measureCurrentToDecWidth = () => {
        if (cachedCurrentToDecWidth !== null) return cachedCurrentToDecWidth;
        const heatmapEl = container2.querySelector(
          "#cal-heatmap"
        );
        if (!heatmapEl) return null;
        const domains = heatmapEl.querySelectorAll(".ch-domain");
        if (domains.length === 0) return null;
        const isCurrentYear = this.currentYear === ( new Date()).getFullYear();
        const startIdx = isCurrentYear ? ( new Date()).getMonth() : 0;
        if (startIdx >= domains.length) return null;
        const startRect = domains[startIdx].getBoundingClientRect();
        const lastRect = domains[domains.length - 1].getBoundingClientRect();
        const svgSpan = Math.ceil(lastRect.right - startRect.left);
        if (svgSpan <= 0) return null;
        const scrollOffset = isCurrentYear ? 10 : 0;
        const labelsEl = container2.querySelector(
          "#gh-day-labels"
        );
        let labelsWidth = 0;
        if (labelsEl) {
          const labelCS = getComputedStyle(labelsEl);
          labelsWidth = labelsEl.offsetWidth + parseFloat(labelCS.marginLeft || "0") + parseFloat(labelCS.marginRight || "0");
        }
        const cs = getComputedStyle(container2);
        const padH = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
        cachedCurrentToDecWidth = Math.ceil(
          svgSpan + scrollOffset + labelsWidth + padH
        );
        return cachedCurrentToDecWidth;
      };
      const measureHourlyMinWidth = () => {
        const panel = document.getElementById("danbooru-grass-panel");
        if (!panel) return HOURLY_PANEL_MIN_WIDTH;
        const w = panel.offsetWidth;
        return w > 0 ? w : HOURLY_PANEL_MIN_WIDTH;
      };
      const applyConstraints = () => {
        const wrapperWidth = wrapper.offsetWidth;
        const statsWidth = stats.offsetWidth;
        const gap = 20;
        let isWrapped;
        if (this.savedLayoutMode !== null) {
          isWrapped = this.savedLayoutMode === "below";
        } else {
          isWrapped = container2.offsetTop > stats.offsetTop + 10;
        }
        let maxAvailableWidth;
        if (isWrapped) {
          maxAvailableWidth = wrapperWidth;
        } else {
          maxAvailableWidth = Math.max(300, wrapperWidth - statsWidth - gap);
        }
        const hourlyMin = measureHourlyMinWidth();
        const minWidth = Math.min(hourlyMin, maxAvailableWidth);
        const natural = measureNaturalWidth();
        const naturalCap = natural ?? maxAvailableWidth;
        if (savedWidth) {
          const numericWidth = parseFloat(String(savedWidth));
          const clampedWidth = Math.max(
            minWidth,
            Math.min(numericWidth, naturalCap, maxAvailableWidth)
          );
          container2.style.flex = "0 0 auto";
          container2.style.width = `${clampedWidth}px`;
          const clampedX = Math.max(
            0,
            Math.min(savedX ?? 0, maxAvailableWidth - clampedWidth)
          );
          container2.style.transform = `translateX(${clampedX}px)`;
        } else {
          if (natural !== null) {
            const target = Math.max(
              minWidth,
              Math.min(natural, maxAvailableWidth)
            );
            container2.style.flex = "0 0 auto";
            container2.style.width = `${target}px`;
          } else {
            container2.style.flex = "1";
          }
          container2.style.transform = "translateX(0px)";
        }
      };
      const syncPanelPosition = () => {
        const panel = document.getElementById("danbooru-grass-panel");
        if (!panel) return;
        const xOffset = parseFloat(
          container2.style.transform?.replace(/translateX\(|px\)/g, "") || "0"
        ) || 0;
        panel.style.marginLeft = xOffset > 0 ? `${xOffset}px` : "0";
      };
      this.reapplyGraphConstraints = () => {
        cachedNaturalWidth = null;
        cachedCurrentToDecWidth = null;
        applyConstraints();
        syncPanelPosition();
      };
      setTimeout(() => {
        applyConstraints();
        syncPanelPosition();
      }, 0);
      if (typeof ResizeObserver !== "undefined") {
        let stableTicks = 0;
        let lastWidth = 0;
        const ro = new ResizeObserver(() => {
          const w = wrapper.offsetWidth;
          if (w <= 0) return;
          applyConstraints();
          syncPanelPosition();
          if (w === lastWidth) {
            stableTicks++;
            if (stableTicks >= 2) ro.disconnect();
          } else {
            stableTicks = 0;
            lastWidth = w;
          }
        });
        ro.observe(wrapper);
        setTimeout(() => ro.disconnect(), 2e3);
      }
      container2.style.minWidth = "300px";
      const createHandle = (type, side) => {
        const handle = document.createElement("div");
        if (type === "resize") {
          const insideRadius = side === "left" ? "0 8px 8px 0" : "8px 0 0 8px";
          handle.style.cssText = `
            position: absolute;
            top: 0;
            ${side}: -5px;
            width: 10px;
            height: 100%;
            cursor: col-resize;
            z-index: 101;
            background: rgba(136, 136, 136, 0.08);
            border-radius: ${insideRadius};
            transition: background 0.15s ease;
          `;
          handle.addEventListener("mouseenter", () => {
            handle.style.background = "rgba(136, 136, 136, 0.25)";
          });
          handle.addEventListener("mouseleave", () => {
            handle.style.background = "rgba(136, 136, 136, 0.08)";
          });
        } else if (type === "move") {
          handle.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 30px;
            height: 30px;
            cursor: move;
            z-index: 102;
            background: rgba(136, 136, 136, 0.1);
            border-bottom-right-radius: 8px;
            border-top-left-radius: 8px;
          `;
        }
        handle.onmousedown = (e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth = container2.offsetWidth;
          const startXOffset = parseFloat(
            container2.style.transform.replace(/translateX\(|px\)/g, "")
          ) || 0;
          const ACTIVATION_THRESHOLD = 30;
          const DEACTIVATION_THRESHOLD = 10;
          const visuallyBelow = container2.offsetTop > stats.offsetTop + 10;
          const currentMode = this.savedLayoutMode === "below" || visuallyBelow ? "below" : "inline";
          let verticalIntent = false;
          let candidateMode = currentMode;
          let dropHint = null;
          let hintStyleEl = null;
          const showDropHint = (mode) => {
            if (!hintStyleEl) {
              hintStyleEl = document.createElement("style");
              hintStyleEl.id = "di-drop-hint-keyframes";
              hintStyleEl.textContent = `
              @keyframes di-glow-pulse {
                0%, 100% { opacity: 0.7; box-shadow: 0 0 6px 2px rgba(66,153,225,0.5); }
                50%      { opacity: 1;   box-shadow: 0 0 14px 4px rgba(66,153,225,0.8); }
              }
            `;
              document.head.appendChild(hintStyleEl);
            }
            if (!dropHint) {
              dropHint = document.createElement("div");
              dropHint.id = "danbooru-grass-drop-hint";
              dropHint.style.cssText = `
                position: absolute;
                left: 0;
                width: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                pointer-events: none;
                z-index: 10000;
                transition: opacity 0.15s ease;
              `;
              const bar = document.createElement("div");
              bar.style.cssText = `
                width: 100%;
                height: 3px;
                background: rgba(66, 153, 225, 0.9);
                border-radius: 2px;
                animation: di-glow-pulse 1s ease-in-out infinite;
              `;
              bar.className = "di-drop-bar";
              const label2 = document.createElement("span");
              label2.className = "di-drop-label";
              label2.style.cssText = `
                font-size: 0.75em;
                font-weight: 600;
                color: rgba(66, 153, 225, 0.9);
                margin: 2px 0;
                white-space: nowrap;
              `;
              dropHint.appendChild(bar);
              dropHint.appendChild(label2);
              container2.appendChild(dropHint);
            }
            const label = dropHint.querySelector(".di-drop-label");
            if (mode === "below") {
              dropHint.style.flexDirection = "column";
              dropHint.style.bottom = "";
              dropHint.style.top = `${container2.offsetHeight + 4}px`;
              label.textContent = "Move to below ↓";
            } else {
              dropHint.style.flexDirection = "column-reverse";
              dropHint.style.top = "";
              dropHint.style.bottom = `${container2.offsetHeight + 4}px`;
              label.textContent = "Move to side ↑";
            }
            dropHint.style.display = "flex";
            dropHint.style.opacity = "1";
          };
          const hideDropHint = () => {
            if (dropHint) {
              dropHint.style.opacity = "0";
              dropHint.style.display = "none";
            }
          };
          const destroyDropHint = () => {
            dropHint?.remove();
            dropHint = null;
            hintStyleEl?.remove();
            hintStyleEl = null;
          };
          const SNAP_THRESHOLD = 15;
          const snapEnabled = this.settingsManager.getSnapToEdge();
          let snappedToNat = false;
          const onMouseMove = (mE) => {
            const delta = mE.clientX - startX;
            const wrapperWidth = wrapper.offsetWidth;
            const statsWidth = stats.offsetWidth;
            const gap = 20;
            const isWrapped = container2.offsetTop > stats.offsetTop + 10;
            let maxAvailableWidth;
            if (isWrapped) {
              maxAvailableWidth = wrapperWidth;
            } else {
              maxAvailableWidth = Math.max(300, wrapperWidth - statsWidth - gap);
            }
            const minWidth = Math.min(measureHourlyMinWidth(), maxAvailableWidth);
            if (type === "move") {
              let newX = startXOffset + delta;
              newX = Math.max(0, Math.min(newX, maxAvailableWidth - startWidth));
              container2.style.transform = `translateX(${newX}px)`;
              const deltaY = mE.clientY - startY;
              if (!verticalIntent) {
                if (Math.abs(deltaY) >= ACTIVATION_THRESHOLD) {
                  candidateMode = deltaY > 0 ? "below" : "inline";
                  verticalIntent = candidateMode !== currentMode;
                }
              } else {
                const committedSign = candidateMode === "below" ? 1 : -1;
                const sameDirection = deltaY * committedSign > 0;
                if (Math.abs(deltaY) < DEACTIVATION_THRESHOLD || !sameDirection) {
                  verticalIntent = false;
                  candidateMode = currentMode;
                }
              }
              if (verticalIntent) showDropHint(candidateMode);
              else hideDropHint();
            } else if (type === "resize") {
              const natCap = measureNaturalWidth() ?? maxAvailableWidth;
              const snapEdge = measureCurrentToDecWidth() ?? natCap;
              if (side === "right") {
                const spaceRight = maxAvailableWidth - startXOffset;
                const maxWidth = Math.min(natCap, spaceRight);
                const unclamped = Math.max(
                  minWidth,
                  Math.min(startWidth + delta, maxWidth)
                );
                if (snapEnabled && snapEdge <= maxWidth) {
                  if (!snappedToNat && unclamped >= snapEdge - SNAP_THRESHOLD && unclamped <= snapEdge + SNAP_THRESHOLD) {
                    snappedToNat = true;
                  }
                  if (snappedToNat && (unclamped < snapEdge - SNAP_THRESHOLD || unclamped > snapEdge + SNAP_THRESHOLD)) {
                    snappedToNat = false;
                  }
                }
                const newWidth = snappedToNat ? snapEdge : unclamped;
                container2.style.flex = "0 0 auto";
                container2.style.width = `${newWidth}px`;
              } else if (side === "left") {
                const minDelta = -startXOffset;
                const clampedDelta = Math.max(delta, minDelta);
                const maxWidth = Math.min(natCap, maxAvailableWidth);
                const unclamped = Math.max(
                  minWidth,
                  Math.min(startWidth - clampedDelta, maxWidth)
                );
                if (snapEnabled && snapEdge <= maxWidth) {
                  if (!snappedToNat && unclamped >= snapEdge - SNAP_THRESHOLD && unclamped <= snapEdge + SNAP_THRESHOLD) {
                    snappedToNat = true;
                  }
                  if (snappedToNat && (unclamped < snapEdge - SNAP_THRESHOLD || unclamped > snapEdge + SNAP_THRESHOLD)) {
                    snappedToNat = false;
                  }
                }
                const newWidth = snappedToNat ? snapEdge : unclamped;
                const finalDelta = startWidth - newWidth;
                const newX = startXOffset + finalDelta;
                container2.style.flex = "0 0 auto";
                container2.style.width = `${newWidth}px`;
                container2.style.transform = `translateX(${newX}px)`;
              }
              this.scrollToCurrentMonth();
            }
            syncPanelPosition();
          };
          const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            destroyDropHint();
            const modeChanged = type === "move" && verticalIntent && candidateMode !== currentMode;
            if (modeChanged) {
              const columnWrapper = document.getElementById(
                "danbooru-grass-column"
              );
              if (columnWrapper) {
                columnWrapper.style.setProperty("flex-grow", "1");
                columnWrapper.style.setProperty("flex-shrink", "1");
                columnWrapper.style.setProperty(
                  "flex-basis",
                  candidateMode === "below" ? "100%" : "0%"
                );
              }
              this.savedLayoutMode = candidateMode;
              savedWidth = candidateMode === "below" ? belowWidth : inlineWidth;
              savedX = candidateMode === "below" ? belowX : inlineX;
              const needsNaturalMeasure = !savedWidth;
              if (needsNaturalMeasure) {
                container2.style.alignSelf = "flex-start";
              }
              container2.style.width = "";
              container2.style.flex = "";
              container2.style.transform = "";
              void container2.offsetWidth;
              applyConstraints();
              if (needsNaturalMeasure) {
                container2.style.alignSelf = "";
              }
              this.scrollToCurrentMonth();
            } else {
              const finalX = parseFloat(
                container2.style.transform.replace(/translateX\(|px\)/g, "")
              ) || 0;
              const newWidthPx = parseFloat(container2.style.width);
              const nextWidth = Number.isFinite(newWidthPx) ? newWidthPx : null;
              if (this.savedLayoutMode === "below") {
                belowWidth = nextWidth;
                belowX = finalX;
              } else {
                inlineWidth = nextWidth;
                inlineX = finalX;
              }
              savedWidth = nextWidth;
              savedX = finalX;
            }
            persistSettings();
            syncPanelPosition();
          };
          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
        };
        handle.className = "di-grass-handle";
        return handle;
      };
      container2.style.background = "var(--card-background-color, #222)";
      container2.style.padding = "15px";
      container2.style.borderRadius = "8px";
      container2.style.minHeight = "180px";
      container2.style.color = "var(--text-color, #eee)";
      container2.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px; align-items:center;">
          <h2 style="font-size:1.2em; margin:0;">Contribution Graph</h2>
          <div id="grass-controls" style="gap:10px; display:flex;"></div>
        </div>
        <div id="cal-heatmap" style="overflow-x:auto; padding-bottom:5px;"></div>
        <div id="grass-loading" style="text-align:center; padding:20px; color:#888;">Initializing...</div>
      `;
      container2.appendChild(createHandle("resize", "left"));
      container2.appendChild(createHandle("resize", "right"));
      container2.appendChild(createHandle("move"));
      const currentTheme = this.settingsManager.getTheme();
      this.settingsManager.applyTheme(currentTheme);
      wrapper.appendChild(container2);
      this.populateSummaryGrid();
      if (!document.getElementById("danbooru-grass-tooltip")) {
        const tooltip = document.createElement("div");
        tooltip.id = "danbooru-grass-tooltip";
        tooltip.style.position = "absolute";
        tooltip.style.padding = "8px";
        tooltip.style.background = "#222";
        tooltip.style.color = "#fff";
        tooltip.style.borderRadius = "4px";
        tooltip.style.border = "1px solid #444";
        tooltip.style.pointerEvents = "none";
        tooltip.style.opacity = "0";
        tooltip.style.zIndex = "99999";
        tooltip.style.fontSize = "12px";
        document.body.appendChild(tooltip);
      }
      return true;
    }
updateControls(_availableYears, _currentYear, currentMetric, _onYearChange, onMetricChange, _onRefresh) {
      const controls = document.getElementById("grass-controls");
      if (!controls) return;
      controls.innerHTML = "";
      const metricSel = document.createElement("select");
      metricSel.className = "ui-select";
      ["uploads", "approvals", "notes"].forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.text = m.charAt(0).toUpperCase() + m.slice(1);
        if (m === currentMetric) opt.selected = true;
        metricSel.appendChild(opt);
      });
      metricSel.onchange = (e) => onMetricChange(e.target.value);
      controls.appendChild(metricSel);
    }
populateSummaryGrid() {
      const panel = document.getElementById("danbooru-grass-panel");
      if (!panel) return;
      panel.innerHTML = "";
      const wrapper = document.createElement("div");
      wrapper.id = "danbooru-grass-summary-grid-wrapper";
      const header = document.createElement("div");
      header.id = "danbooru-grass-summary-header";
      header.style.cssText = `
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 2px;
        color: var(--grass-text, #24292f);
      `;
      header.textContent = "Hourly Distribution";
      wrapper.appendChild(header);
      const topLabels = document.createElement("div");
      topLabels.className = "summary-top-labels";
      const label0 = document.createElement("div");
      label0.className = "summary-label top-label-item";
      label0.textContent = "0 / 12";
      label0.style.left = "11px";
      const label6 = document.createElement("div");
      label6.className = "summary-label top-label-item";
      label6.textContent = "6 / 18";
      label6.style.left = `${11 + (22 + 4) * 6}px`;
      topLabels.appendChild(label0);
      topLabels.appendChild(label6);
      wrapper.appendChild(topLabels);
      const midRow = document.createElement("div");
      midRow.className = "summary-row-container";
      const sideLabels = document.createElement("div");
      sideLabels.className = "summary-side-labels";
      const labelAM = document.createElement("div");
      labelAM.className = "summary-label";
      labelAM.textContent = "AM";
      const labelPM = document.createElement("div");
      labelPM.className = "summary-label";
      labelPM.textContent = "PM";
      sideLabels.appendChild(labelAM);
      sideLabels.appendChild(labelPM);
      const grid = document.createElement("div");
      grid.id = "danbooru-grass-summary-grid";
      for (let i = 0; i < 24; i++) {
        const cell = document.createElement("div");
        cell.className = "large-grass-cell";
        grid.appendChild(cell);
      }
      midRow.appendChild(sideLabels);
      midRow.appendChild(grid);
      wrapper.appendChild(midRow);
      const legendRow = document.createElement("div");
      legendRow.id = "danbooru-grass-summary-legend";
      legendRow.style.cssText = `
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 4px;
        margin-top: 6px;
        font-size: 10px;
        color: var(--grass-text, #57606a);
      `;
      legendRow.innerHTML = '<span style="margin-right:2px">Less</span>' + [0, 1, 2, 3, 4].map(
        (l) => `<div class="legend-rect" data-level="${l}" style="width:10px; height:10px; border-radius:2px; background:var(--grass-level-${l})"></div>`
      ).join("") + '<span style="margin-left:2px">More</span>';
      wrapper.appendChild(legendRow);
      panel.appendChild(wrapper);
    }
updateSummaryGrid(hourlyCounts, metric) {
      const grid = document.getElementById("danbooru-grass-summary-grid");
      if (!grid) return;
      const cells = grid.querySelectorAll(".large-grass-cell");
      if (cells.length !== 24) return;
      if (!hourlyCounts) {
        cells.forEach((cell) => {
          cell.style.background = "var(--grass-empty-cell, #ebedf0)";
          cell.onmouseenter = null;
          cell.onmouseleave = null;
          cell.removeAttribute("title");
        });
        const header2 = document.getElementById("danbooru-grass-summary-header");
        if (header2) header2.textContent = `Hourly ${metric} Distribution`;
        return;
      }
      const header = document.getElementById("danbooru-grass-summary-header");
      if (header) header.textContent = `Hourly ${metric} Distribution`;
      const max = Math.max(...hourlyCounts, 1);
      cells.forEach((cell, i) => {
        const count = hourlyCounts[i] || 0;
        let level = 0;
        if (count > 0) {
          level = Math.floor(count / max * 5);
          if (level > 4) level = 4;
        }
        cell.style.background = `var(--grass-level-${level})`;
        cell.removeAttribute("title");
        cell.onmouseenter = (_e) => {
          const tooltip = document.getElementById("danbooru-grass-tooltip");
          if (!tooltip) return;
          tooltip.style.opacity = "1";
          tooltip.innerHTML = `<strong>${i.toString().padStart(2, "0")}:00</strong>, ${count} ${metric}`;
          const rect = cell.getBoundingClientRect();
          const tooltipRect = tooltip.getBoundingClientRect();
          const left = rect.left + window.scrollX + rect.width / 2 - tooltipRect.width / 2;
          const top = rect.top + window.scrollY - tooltipRect.height - 8;
          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${top}px`;
        };
        cell.onmouseleave = () => {
          const tooltip = document.getElementById("danbooru-grass-tooltip");
          if (tooltip) tooltip.style.opacity = "0";
        };
      });
      const legend = document.getElementById("danbooru-grass-summary-legend");
      if (legend) {
        const step = max / 5;
        const rects = legend.querySelectorAll(".legend-rect");
        rects.forEach((r) => {
          const l = parseInt(r.getAttribute("data-level") ?? "0");
          let minRange, maxRange;
          if (l === 0) {
            minRange = 0;
            maxRange = Math.floor(step);
          } else {
            minRange = Math.floor(step * l) + 1;
            maxRange = Math.floor(step * (l + 1));
          }
          if (l === 4) maxRange = max;
          r.removeAttribute("title");
          r.onmouseenter = (_e) => {
            const tooltip = document.getElementById("danbooru-grass-tooltip");
            if (!tooltip) return;
            tooltip.style.opacity = "1";
            tooltip.innerHTML = `${minRange} - ${maxRange}`;
            const rect = r.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            const left = rect.left + window.scrollX + rect.width / 2 - tooltipRect.width / 2;
            const top = rect.top + window.scrollY - tooltipRect.height - 8;
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
          };
          r.onmouseleave = () => {
            const tooltip = document.getElementById("danbooru-grass-tooltip");
            if (tooltip) tooltip.style.opacity = "0";
          };
        });
      }
    }
setLoading(isLoading, message = "Initializing...") {
      const el = document.getElementById("grass-loading");
      if (el) {
        el.style.display = isLoading ? "block" : "none";
        el.textContent = message;
      }
      const cal = document.getElementById("cal-heatmap");
      if (cal) cal.style.opacity = isLoading ? "0.5" : "1";
    }
async renderGraph(dataMap, year, metric, userInfo, availableYears, onYearChange, onRefresh, skipScroll = false) {
      let dailyData = dataMap;
      let hourlyData = null;
      if (dataMap && dataMap.daily) {
        dailyData = dataMap.daily;
        hourlyData = dataMap.hourly;
      }
      this.currentYear = year;
      const total = Object.values(dailyData || {}).reduce(
        (acc, v) => acc + v,
        0
      );
      const header = document.querySelector("#danbooru-grass-container h2");
      if (header) {
        header.innerHTML = "";
        const textSpan = document.createElement("span");
        textSpan.textContent = `${total.toLocaleString()} contributions in `;
        header.appendChild(textSpan);
        if (availableYears && onYearChange) {
          const yearSelect = document.createElement("select");
          yearSelect.style.cssText = `
            font-family: inherit;
            font-size: inherit;
            font-weight: normal;
            color: #24292f;
            background-color: #f6f8fa;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            padding: 2px 4px;
            margin-left: 6px;
            cursor: pointer;
            vertical-align: baseline;
          `;
          availableYears.forEach((y) => {
            const opt = document.createElement("option");
            opt.value = String(y);
            opt.textContent = String(y);
            if (y === year) opt.selected = true;
            yearSelect.appendChild(opt);
          });
          yearSelect.onchange = (e) => onYearChange(parseInt(e.target.value, 10));
          header.appendChild(yearSelect);
        } else {
          header.appendChild(document.createTextNode(String(year)));
        }
      }
      const win = window;
      if (win.cal && typeof win.cal.destroy === "function") {
        try {
          win.cal.destroy();
        } catch (e) {
          log$b.warn("Failed to destroy previous CalHeatmap instance", { error: e });
        }
      }
      win.cal = new win.CalHeatmap();
      const userName = typeof userInfo === "string" ? userInfo : userInfo.name;
      const container2 = document.getElementById("cal-heatmap");
      if (!container2) return;
      const source = Object.entries(dailyData || {}).map(([k, v]) => ({
        date: k,
        value: v
      }));
      const sanitizedName = typeof userInfo === "string" ? userInfo.replace(/ /g, "_") : userInfo.normalizedName || userName.replace(/ /g, "_");
      const userIdVal = typeof userInfo === "string" ? userInfo : userInfo.id ?? userInfo.name;
      const getUrl = (date, _count) => {
        if (!date) return null;
        switch (metric) {
          case "uploads":
            return `/posts?tags=user:${sanitizedName}+date:${date}`;
          case "approvals":
            return "#";
case "notes":
            return `/posts?tags=noteupdater:${sanitizedName}+date:${date}`;
          default:
            return null;
        }
      };
      const styleId = "danbooru-grass-styles";
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
          /* Container & Header Styling */
          #danbooru-grass-container {
            background: var(--grass-bg, #fff) !important;
            color: var(--grass-text, #24292f) !important;
            border-radius: 6px;
          }
          #danbooru-grass-container h2 {
            color: var(--grass-text, #24292f) !important;
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
            font-weight: normal !important;
          }
          /* Controls — always light (GrassApp chrome is theme-independent) */
          #grass-controls select {
            background-color: #f6f8fa !important;
            color: #24292f !important;
            border: 1px solid #d0d7de !important;
            border-radius: 6px;
            padding: 2px 2px;
          }
          /* Empty Cells & Domain Backgrounds */
          .ch-subdomain-bg { fill: var(--grass-empty-cell, #ebedf0); }
          .ch-domain-bg { fill: transparent !important; } /* Fix black bars */

          /* All SVG Text (Months & Days) */
          #cal-heatmap text,
          #gh-day-labels text {
            fill: var(--grass-text, #24292f) !important;
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
            font-size: 10px;
          }

          /* Scrollable Area */
          #cal-heatmap-scroll {
            overflow-x: auto;
            overflow-y: hidden;
            flex: 1;
            white-space: nowrap;
          }
          #cal-heatmap-scroll::-webkit-scrollbar { height: 8px; }
          #cal-heatmap-scroll::-webkit-scrollbar-thumb {
            background: var(--grass-scrollbar-thumb, #d0d7de);
            border-radius: 4px;
          }

          /* Settings Popover */
          #danbooru-grass-settings-popover {
            position: fixed;
            max-height: 70vh;
            overflow-y: auto;
            background: var(--di-bg, #fff);
            color: var(--di-text, #333);
            border: 1px solid var(--di-border-input, #ddd);
            box-shadow: 0 4px 12px var(--di-shadow, rgba(0,0,0,0.2));
            border-radius: 8px;
            padding: 12px;
            z-index: 10000;
            display: none;
            width: 290px;
            transform-origin: top left;
          }
          .theme-grid {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 8px;
          }
          .theme-icon {
            width: 36px;
            height: 36px;
            border-radius: 8px;
            position: relative;
            cursor: pointer;
            border: 2px solid transparent;
            box-sizing: border-box;
          }
          .theme-icon:hover { transform: scale(1.1); }
          .theme-icon.active { border-color: var(--di-link, #007bff); }
          .theme-icon-inner {
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 16px; height: 16px;
            border-radius: 4px;
          }
          .popover-header {
            font-weight: 600;
            font-size: 12px;
            color: var(--di-text, #333);
            margin-bottom: 8px;
          }
          .popover-select {
            width: 100%;
            margin-bottom: 10px;
            padding: 4px;
            border-radius: 4px;
            border: 1px solid var(--di-border-input, #ddd);
            background-color: var(--di-bg-tertiary, #f0f0f0);
            font-size: 12px;
          }
          .threshold-row {
            display: flex;
            align-items: center;
            margin-bottom: 6px;
            font-size: 12px;
          }
          .threshold-input {
            width: 60px;
            margin-left: auto;
            padding: 2px 4px;
            border: 1px solid var(--di-border-input, #ddd);
            border-radius: 4px;
          }

          /* Approvals Detail Popover */
          #danbooru-approvals-popover {
            position: absolute;
            background: var(--di-bg, #fff);
            color: var(--di-text, #333);
            border: 1px solid var(--di-border-input, #ddd);
            box-shadow: 0 4px 20px var(--di-shadow, rgba(0,0,0,0.2));
            border-radius: 10px;
            padding: 16px;
            z-index: 100005;
            display: none;
            width: 320px;
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
          }
          #danbooru-approvals-popover .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--di-border-light, #eee);
          }
          #danbooru-approvals-popover .header-title {
            font-weight: 600;
            font-size: 14px;
          }
          #danbooru-approvals-popover .close-btn {
            cursor: pointer;
            color: var(--di-text-muted, #888);
            font-size: 18px;
            line-height: 1;
          }
          /* Summary Grid Layout */
          #danbooru-grass-summary-grid-wrapper {
            display: flex;
            flex-direction: column;
            gap: 4px;
            width: fit-content;
            margin: 0 auto;
            padding: 10px;
            background: var(--grass-bg, rgba(128, 128, 128, 0.05));
            border-radius: 8px;
            border: 1px solid rgba(0,0,0,0.05);
          }
          #danbooru-grass-summary-grid {
            display: grid;
            grid-template-columns: repeat(12, 1fr);
            gap: 4px;
            width: fit-content;
          }
          .summary-row-container {
            display: flex;
            gap: 8px;
            align-items: center;
          }
          .summary-side-labels {
            display: flex;
            flex-direction: column;
            justify-content: space-around;
            height: 48px; /* 22px * 2 + 4px gap */
            padding-top: 2px;
          }
          .summary-top-labels {
            display: flex;
            margin-left: 28px; /* Match width of side labels + gap */
            position: relative;
            height: 14px;
          }
          .summary-label {
             fill: var(--grass-text, #24292f);
             color: var(--grass-text, #24292f);
             font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
             font-size: 10px;
             white-space: nowrap;
          }
          .top-label-item {
            position: absolute;
            transform: translateX(-50%);
          }
          .large-grass-cell {
            width: 22px;
            height: 22px;
            background-color: var(--grass-empty-cell, #ebedf0);
            border-radius: 4px;
            transition: background-color 0.2s, transform 0.1s, box-shadow 0.2s;
          }
          .large-grass-cell:hover {
            transform: scale(1.1);
            background-color: var(--grass-text, #30363d);
            opacity: 0.15;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
          }
          #danbooru-approvals-popover .gallery-btn {
            cursor: pointer;
            color: var(--di-link, #007bff);
            display: flex;
            align-items: center;
            padding: 2px;
            border-radius: 4px;
            transition: background 0.2s;
            text-decoration: none;
          }
          #danbooru-approvals-popover .gallery-btn:hover {
            background: var(--di-bg-tertiary, #f0f0f0);
            color: var(--di-link, #007bff);
          }
          #danbooru-approvals-popover .post-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            margin-bottom: 12px;
            max-height: 300px;
            overflow-y: auto;
          }
          #danbooru-approvals-popover .post-link {
            display: block;
            text-align: center;
            padding: 4px;
            background: var(--di-bg-tertiary, #f0f0f0);
            border: 1px solid var(--di-border-input, #ddd);
            border-radius: 4px;
            font-size: 11px;
            color: var(--di-link, #007bff);
            text-decoration: none;
          }
          #danbooru-approvals-popover .post-link:hover {
            background: var(--di-link, #007bff);
            color: #fff;
          }
          #danbooru-approvals-popover .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 10px;
            font-size: 12px;
          }
          #danbooru-approvals-popover .page-btn {
            padding: 2px 8px;
            border: 1px solid var(--di-border-input, #ddd);
            background: var(--di-bg, #fff);
            border-radius: 4px;
            cursor: pointer;
          }
          #danbooru-approvals-popover .page-btn:disabled {
            opacity: 0.5;
            cursor: default;
          }
        `;
        document.head.appendChild(style);
      }
      container2.innerHTML = "";
      container2.style.display = "flex";
      container2.style.flexDirection = "row";
      container2.style.alignItems = "flex-start";
      container2.style.overflow = "hidden";
      const labels = document.createElement("div");
      labels.id = "gh-day-labels";
      labels.style.display = "flex";
      labels.style.flexDirection = "column";
      labels.style.paddingTop = "20px";
      labels.style.paddingRight = "5px";
      labels.style.marginRight = "5px";
      labels.style.textAlign = "right";
      labels.style.flexShrink = "0";
      labels.style.color = "var(--grass-text, #24292f)";
      labels.style.fontSize = "9px";
      const rowStyle = "height:11px; line-height:11px; margin-bottom:2px;";
      const hiddenStyle = "height:11px; visibility:hidden; margin-bottom:2px;";
      const lastHiddenStyle = "height:11px; visibility:hidden; margin-bottom:0;";
      labels.innerHTML = `
        <div style="${hiddenStyle}"></div> <!-- Sun (0) -->
        <div style="${rowStyle}">Mon</div> <!-- Mon (1) -->
        <div style="${hiddenStyle}"></div> <!-- Tue (2) -->
        <div style="${rowStyle}">Wed</div> <!-- Wed (3) -->
        <div style="${hiddenStyle}"></div> <!-- Thu (4) -->
        <div style="${rowStyle}">Fri</div> <!-- Fri (5) -->
        <div style="${lastHiddenStyle}"></div> <!-- Sat (6) -->
      `;
      container2.appendChild(labels);
      const scrollWrapper = document.createElement("div");
      scrollWrapper.id = "cal-heatmap-scroll";
      scrollWrapper.style.minHeight = "140px";
      container2.appendChild(scrollWrapper);
      const mainContainer = document.getElementById("danbooru-grass-container");
      if (!mainContainer) return;
      if (!document.getElementById("danbooru-grass-footer")) {
        const footer = document.createElement("div");
        footer.id = "danbooru-grass-footer";
        footer.style.display = "flex";
        footer.style.justifyContent = "space-between";
        footer.style.alignItems = "center";
        footer.style.padding = "5px 20px 10px 0px";
        footer.style.marginTop = "10px";
        mainContainer.appendChild(footer);
        const footerLeft = document.createElement("div");
        footerLeft.style.display = "flex";
        footerLeft.style.alignItems = "center";
        footerLeft.style.gap = "8px";
        footer.appendChild(footerLeft);
        const settingsBtn = document.createElement("div");
        settingsBtn.id = "danbooru-grass-settings";
        settingsBtn.title = "Settings";
        settingsBtn.style.cssText = `
          padding: 2px 8px;
          border: 1px solid #d0d7de;
          border-radius: 6px;
          background-color: #f6f8fa;
          cursor: pointer;
          display: flex;
          align-items: center;
          color: #57606a;
        `;
        settingsBtn.innerHTML = `
          <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" style="fill: currentColor;">
            <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.292.028 1.555.563l.566 1.142c.27.547.106 1.181-.394 1.524l-.904.621c-.056.038-.076.104-.076.17a8.7 8.7 0 0 0 0 1.018c0 .066.02.132.076.17l.904.62c.5.344.664.978.394 1.524l-.566 1.142c-.263.535-.91.74-1.555.563l-1.103-.303c-.066-.019-.176-.011-.299.071a6.8 6.8 0 0 1-.668.386c-.133.066-.194.158-.212.224l-.288 1.107c-.17.646-.716 1.196-1.461 1.26a8.2 8.2 0 0 1-.701.031 8.2 8.2 0 0 1-.701-.031c-.745-.064-1.29-.614-1.461-1.26l-.288-1.106c-.018-.066-.079-.158-.212-.224a6.8 6.8 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.292-.028-1.555-.563l-.566-1.142c-.27-.547-.106-1.181.394-1.524l.904-.621c.056-.038.076-.104.076-.17a8.7 8.7 0 0 0 0-1.018c0-.066-.02-.132-.076-.17l-.904-.62c-.5-.344-.664-.978-.394-1.524l.566-1.142c.263-.535.91-.74 1.555-.563l1.103.303c.066.019.176.011.299-.071.214-.143.437-.272.668-.386.133-.066.194-.158.212-.224l.288-1.107C6.71.645 7.256.095 8.001.031A8.2 8.2 0 0 1 8 0Zm-.571 1.525c-.036.003-.108.036-.123.098l-.289 1.106c-.17.643-.64 1.103-1.246 1.218a5.2 5.2 0 0 0-1.157.669c-.53.411-1.192.427-1.748.046l-.904-.621c-.055-.038-.135-.04-.158.006l-.566 1.142c-.023.047.013.109.055.137l.904.621a1.9 1.9 0 0 1 0 3.23l-.904.621c-.042.029-.078.09-.055.137l.566 1.142c.023.047.103.044.158.006l.904-.621c.556-.38 1.218-.365 1.748.046.348.27.753.496 1.157.669.606.115 1.076.575 1.246 1.218l.289 1.106c.015.062.087.095.123.098.36.031.725.031 1.082 0 .036-.003.108-.036.123-.098l.289-1.106c.17-.643.64-1.103 1.246-1.218.404-.173.809-.399 1.157-.669.53-.411 1.192-.427 1.748-.046l.904.621c.055.038.135.04.158-.006l.566-1.142c.023-.047-.013-.109-.055-.137l-.904-.621a1.9 1.9 0 0 1 0-3.23l.904-.621c.042-.029.078-.09.055-.137l-.566-1.142c-.023-.047-.103-.044-.158-.006l-.904.621c-.556.38-1.218.365-1.748-.046a5.2 5.2 0 0 0-1.157-.669c-.606-.115-1.076-.575-1.246-1.218l-.289-1.106c-.015-.062-.087-.095-.123-.098a6.5 6.5 0 0 0-1.082 0ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"></path>
          </svg>
        `;
        const onSettingsClose = () => {
          if (typeof onYearChange === "function") {
            onYearChange(year);
          }
        };
        settingsBtn.onmouseover = () => {
          settingsBtn.style.backgroundColor = "#f6f8fa";
          settingsBtn.style.filter = "brightness(0.95)";
        };
        settingsBtn.onmouseout = () => {
          settingsBtn.style.backgroundColor = "#f6f8fa";
          settingsBtn.style.filter = "";
        };
        footerLeft.appendChild(settingsBtn);
        const toggleBtn = document.createElement("div");
        toggleBtn.id = "danbooru-grass-toggle-panel";
        toggleBtn.title = "Show Details";
        toggleBtn.style.cssText = `
          padding: 2px 8px;
          border: 1px solid #d0d7de;
          border-radius: 6px;
          background-color: #f6f8fa;
          cursor: pointer;
          display: flex;
          align-items: center;
          color: #57606a;
        `;
        const chevronDown = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" style="fill: currentColor;"><path d="M12.78 6.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.28a.75.75 0 0 1 1.06-1.06L8 9.94l3.72-3.72a.75.75 0 0 1 1.06 0Z"></path></svg>';
        const chevronUp = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" style="fill: currentColor;"><path d="M3.22 9.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1-1.06 1.06L8 6.06 4.28 9.78a.75.75 0 0 1-1.06 0Z"></path></svg>';
        toggleBtn.innerHTML = chevronDown;
        toggleBtn.onmouseover = () => {
          toggleBtn.style.backgroundColor = "#f6f8fa";
          toggleBtn.style.filter = "brightness(0.95)";
        };
        toggleBtn.onmouseout = () => {
          toggleBtn.style.backgroundColor = "#f6f8fa";
          toggleBtn.style.filter = "";
        };
        footerLeft.appendChild(toggleBtn);
        let columnWrapper = document.getElementById("danbooru-grass-column");
        if (!columnWrapper) {
          if (mainContainer.parentNode) {
            columnWrapper = document.createElement("div");
            columnWrapper.id = "danbooru-grass-column";
            columnWrapper.style.display = "flex";
            columnWrapper.style.flexDirection = "column";
            columnWrapper.style.flexGrow = "1";
            columnWrapper.style.flexShrink = "1";
            columnWrapper.style.flexBasis = "0%";
            columnWrapper.style.minWidth = "300px";
            mainContainer.parentNode.insertBefore(columnWrapper, mainContainer);
            columnWrapper.appendChild(mainContainer);
          }
        }
        if (columnWrapper) {
          columnWrapper.style.flexBasis = this.savedLayoutMode === "below" ? "100%" : "0%";
        }
        let panel = document.getElementById("danbooru-grass-panel");
        if (!panel) {
          panel = document.createElement("div");
          panel.id = "danbooru-grass-panel";
          panel.style.cssText = `
                width: fit-content;
                min-width: 310px;
                background: var(--grass-bg, #fff);
                border: 1px solid #d0d7de;
                border-radius: 8px;
                margin-top: 10px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);

                /* Animation Styles */
                height: 0;
                opacity: 0;
                padding: 0 10px;
                overflow: hidden;
                transition: height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
                display: block;
            `;
          if (columnWrapper) {
            columnWrapper.appendChild(panel);
          } else {
            mainContainer.parentNode?.appendChild(panel);
          }
        }
        if (panel) {
          this.populateSummaryGrid();
        }
        let isExpanded = false;
        toggleBtn.onclick = () => {
          isExpanded = !isExpanded;
          if (isExpanded) {
            panel.style.height = "150px";
            panel.style.opacity = "1";
            panel.style.padding = "10px";
            toggleBtn.innerHTML = chevronUp;
            toggleBtn.title = "Hide Details";
          } else {
            panel.style.height = "0";
            panel.style.opacity = "0";
            panel.style.padding = "0 10px";
            toggleBtn.innerHTML = chevronDown;
            toggleBtn.title = "Show Details";
          }
        };
        const { popover, close: closeSettings } = createSettingsPopover({
          settingsManager: this.settingsManager,
          db: this.db,
          metric,
          settingsBtn,
          closeSettings: onSettingsClose,
          onRefresh
        });
        settingsBtn.onclick = (e) => {
          const current = popover.style.display;
          if (current === "block") {
            closeSettings();
          } else {
            const btnRect = settingsBtn.getBoundingClientRect();
            popover.style.left = btnRect.left + "px";
            popover.style.top = btnRect.bottom + 4 + "px";
            popover.style.display = "block";
          }
          e.stopPropagation();
        };
        document.body.appendChild(popover);
        const legend = document.createElement("div");
        legend.id = "danbooru-grass-legend";
        legend.style.display = "flex";
        legend.style.justifyContent = "flex-end";
        legend.style.alignItems = "center";
        legend.style.fontSize = "10px";
        legend.style.color = "var(--grass-text, #57606a)";
        legend.style.gap = "4px";
        const colors = [
          "var(--grass-level-0)",
          "var(--grass-level-1)",
          "var(--grass-level-2)",
          "var(--grass-level-3)",
          "var(--grass-level-4)"
        ];
        const rects = colors.map(
          (c) => `<div style="width:10px; height:10px; background:${c}; border-radius:2px;"></div>`
        ).join("");
        legend.innerHTML = `
          <span style="margin-right:4px;">Less</span>
          ${rects}
          <span style="margin-left:4px;">More</span>
        `;
        footer.appendChild(legend);
      }
      const currentThresholds = this.settingsManager.getThresholds(
        metric
      );
      const buildPaintConfig = () => ({
        itemSelector: scrollWrapper,
        range: 12,
        domain: {
          type: "month",
          gutter: 3,
          label: { position: "top", text: "MMM", height: 20, textAlign: "start" }
        },
        subDomain: { type: "day", radius: 2, width: 11, height: 11, gutter: 2 },
        date: {
          start: new Date(
            new Date(year, 0, 1).getTime() - ( new Date()).getTimezoneOffset() * 6e4
          )
        },
        data: { source, x: "date", y: "value" },
        scale: {
          color: {
            range: this.settingsManager.resolveLevels(
              this.settingsManager.getTheme(),
              CONFIG.THEMES[this.settingsManager.getTheme()] || CONFIG.THEMES.light
            ),
            domain: currentThresholds,
            type: "threshold"
          }
        },
        theme: "light"
      });
      win.cal.paint(buildPaintConfig()).then(() => {
        requestAnimationFrame(() => {
          this.reapplyGraphConstraints?.();
        });
        const onThemeChange = () => {
          try {
            const sw = document.getElementById("cal-heatmap-scroll");
            const savedScroll = sw ? sw.scrollLeft : 0;
            win.cal.destroy();
            win.cal.paint(buildPaintConfig()).then(() => {
              if (sw) sw.scrollLeft = savedScroll;
              this.reapplyGraphConstraints?.();
            });
          } catch (e) {
            log$b.debug("CalHeatmap re-paint failed", { error: e });
          }
          this.updateSummaryGrid(hourlyData, metric);
        };
        window.addEventListener("DanbooruInsights:ThemeChanged", onThemeChange);
        this.updateSummaryGrid(hourlyData, metric);
        setTimeout(() => {
          const tooltip = d3__namespace.select("#danbooru-grass-tooltip");
          const updateTooltip = (event, content) => {
            tooltip.style("opacity", 1).html(content);
            const node = tooltip.node();
            if (!node) return;
            const rect = node.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            let left = event.pageX + 10;
            let top = event.pageY - 28;
            if (left + rect.width > viewportWidth - 20) {
              left = event.pageX - rect.width / 2;
              top = event.pageY - rect.height - 15;
              if (left < 5) left = 5;
            }
            tooltip.style("left", left + "px").style("top", top + "px");
          };
          const updateTooltipTouch = (touch, content) => {
            tooltip.style("opacity", 1).html(content);
            const node = tooltip.node();
            if (!node) return;
            const rect = node.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const scrollY = window.scrollY || window.pageYOffset;
            let left = touch.pageX + 10;
            let top = touch.pageY - 28;
            if (left + rect.width > viewportWidth - 20) {
              left = touch.pageX - rect.width / 2;
              top = touch.pageY - rect.height - 15;
              if (left < 5) left = 5;
            }
            if (top < scrollY + 5) top = scrollY + 5;
            tooltip.style("left", left + "px").style("top", top + "px");
          };
          const isTouch = isTouchDevice();
          if (!skipScroll) this.scrollToCurrentMonth();
          if (isTouch) {
            tooltip.style("pointer-events", "auto").style("cursor", "pointer");
          }
          const calTap = isTouch ? createTwoStepTap({
            insideElements: () => [
              tooltip.node(),
              document.getElementById("cal-heatmap-scroll")
            ],
            onFirstTap: () => {
            },
            onSecondTap: (datum) => {
              datum.v ?? 0;
              const dateStr = new Date(datum.t).toISOString().split("T")[0];
              const link = getUrl(dateStr);
              if (link && link !== "#") window.open(link, "_blank");
              tooltip.style("opacity", 0);
            },
            onReset: () => {
              tooltip.style("opacity", 0);
            }
          }) : null;
          d3__namespace.selectAll("#cal-heatmap-scroll rect").attr("rx", 2).attr("ry", 2).on("mouseover", function(event, d) {
            const datum = d || d3__namespace.select(this).datum();
            if (!datum || !datum.t) return;
            const count = datum.v ?? 0;
            const dateStr = new Date(datum.t).toISOString().split("T")[0];
            updateTooltip(
              event,
              `<strong>${dateStr}</strong>, ${count} ${metric}`
            );
          }).on("mouseout", () => tooltip.style("opacity", 0)).on("click", (event, d) => {
            if (isTouch) return;
            const datum = d;
            if (!datum || !datum.t) {
              return;
            }
            const count = datum.v ?? 0;
            const dateStr = new Date(datum.t).toISOString().split("T")[0];
            if (metric === "approvals" && count > 0) {
              void this.showApprovalsDetail(dateStr, userIdVal, event);
            } else {
              const link = getUrl(dateStr);
              if (link) window.open(link, "_blank");
            }
          });
          if (calTap) {
            const TAP_THRESHOLD = 10;
            let touchStartX = 0;
            let touchStartY = 0;
            let wasDrag = false;
            d3__namespace.selectAll("#cal-heatmap-scroll rect").on("touchstart", (event) => {
              const touch = event.touches[0];
              touchStartX = touch.clientX;
              touchStartY = touch.clientY;
              wasDrag = false;
            }).on("touchmove", () => {
              wasDrag = true;
            }).on("touchend", (event) => {
              if (wasDrag) {
                const touch = event.changedTouches[0];
                const dx = touch.clientX - touchStartX;
                const dy = touch.clientY - touchStartY;
                if (dx * dx + dy * dy > TAP_THRESHOLD * TAP_THRESHOLD) return;
              }
              const target = document.elementFromPoint(
                touchStartX,
                touchStartY
              );
              if (!target) return;
              const datum = d3__namespace.select(target).datum();
              if (!datum || !datum.t) return;
              calTap.tap(datum);
              const count = datum.v ?? 0;
              const dateStr = new Date(datum.t).toISOString().split("T")[0];
              updateTooltipTouch(
                {
                  pageX: touchStartX + window.scrollX,
                  pageY: touchStartY + window.scrollY
                },
                `<strong>${dateStr}</strong>, ${count} ${metric}`
              );
            });
            tooltip.on("click", () => {
              calTap.navigateActive();
            });
          }
          const t = this.settingsManager.getThresholds(
            metric
          );
          const legendThresholds = [
            `${t[0] > 1 ? `0-${t[0] - 1}` : "0"} (Less)`,
            `${t[0]}-${t[1] - 1}`,
            `${t[1]}-${t[2] - 1}`,
            `${t[2]}-${t[3] - 1}`,
            `${t[3]}+ (More)`
          ];
          const legendDivs = d3__namespace.selectAll("#danbooru-grass-legend > div");
          legendDivs.each(function(_d, i) {
            if (i >= 0 && i < legendThresholds.length) {
              d3__namespace.select(this).on("mouseover", (event) => {
                updateTooltip(event, legendThresholds[i]);
              }).on("mouseout", () => tooltip.style("opacity", 0));
            }
          });
        }, 300);
      }).catch((err) => {
        log$b.error("CalHeatmap render failed", { error: err });
        this.updateSummaryGrid(hourlyData, metric);
      });
    }
renderError(message, onRetry) {
      const container2 = document.getElementById(this.containerId);
      if (!container2) return;
      container2.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:140px; color:#cf222e; text-align:center;">
          <div style="font-weight:bold; margin-bottom:8px;">Unable to load contribution data</div>
          <div style="font-size:0.9em; margin-bottom:12px; color: var(--grass-text, #57606a);">${message}</div>
          <button id="grass-retry-btn" style="
            padding: 5px 16px;
            background-color: #f6f8fa;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            color: #24292f;
          ">Retry</button>
        </div>
      `;
      const btn = document.getElementById("grass-retry-btn");
      if (btn) btn.onclick = onRetry;
    }
async showApprovalsDetail(dateStr, userId, event) {
      const fetcher = this.dataManager ? (postId) => this.dataManager.fetchPostDetails(postId) : void 0;
      await showApprovalsDetail(this.db, dateStr, userId, event, fetcher);
      const pop = document.getElementById("danbooru-approvals-popover");
      if (pop) {
        const themeKey = this.settingsManager.getTheme();
        applyPopoverPalette([pop], themeKey);
      }
    }
  }
  const log$a = createLogger("GrassApp");
  class GrassApp {
    db;
    settings;
    context;
    rateLimiter;
constructor(db, settings, context, rateLimiter) {
      this.db = db;
      this.settings = settings;
      this.context = context;
      this.rateLimiter = rateLimiter ?? null;
    }
async run() {
      const context = this.context;
      const targetUser = context.targetUser;
      if (!targetUser) return;
      const dataManager = new DataManager(this.db, this.rateLimiter);
      const renderer = new GraphRenderer(this.settings, this.db);
      const userId = targetUser.id || targetUser.name;
      const injected = await renderer.injectSkeleton(dataManager, userId);
      if (!injected) {
        return;
      }
      const normalizedName = (targetUser.name || "").replace(/ /g, "_");
      await dataManager.revalidateCurrentYearCache(userId, normalizedName).catch((e) => {
        log$a.warn("Cache revalidation failed, continuing normally", { error: e });
      });
      let currentYear = ( new Date()).getFullYear();
      let currentMetric = this.settings.getLastMode(userId) || "uploads";
      const joinYear = targetUser.joinDate.getFullYear();
      const years = [];
      const startYear = Math.max(joinYear, 2005);
      for (let y = currentYear; y >= startYear; y--) years.push(y);
      const updateView = async () => {
        let availableYears = [...years];
        if (currentMetric === "approvals") {
          const promoDate = await dataManager.fetchPromotionDate(targetUser.name);
          if (promoDate) {
            const promoYear = parseInt(promoDate.slice(0, 4), 10);
            availableYears = availableYears.filter((y) => y >= promoYear);
            if (currentYear < promoYear) {
              currentYear = promoYear;
            }
          }
        }
        const onYearChange = (y) => {
          currentYear = y;
          void updateView();
        };
        renderer.setLoading(true);
        try {
          await renderer.renderGraph(
            {},
            currentYear,
            currentMetric,
            targetUser,
            availableYears,
            onYearChange,
            async () => {
              renderer.setLoading(true);
              await dataManager.clearCache(currentMetric, targetUser);
              void updateView();
            },
true
          );
          renderer.updateControls(
            availableYears,
            currentYear,
            currentMetric,
            onYearChange,
            (newMetric) => {
              currentMetric = newMetric;
              this.settings.setLastMode(userId, currentMetric);
              void updateView();
            },
async () => {
              renderer.setLoading(true);
              await dataManager.clearCache(currentMetric, targetUser);
              void updateView();
            }
          );
          const onProgress = (count) => {
            renderer.setLoading(true, `Fetching... ${count} items`);
          };
          const data = await dataManager.getMetricData(
            currentMetric,
            targetUser,
            currentYear,
            onProgress
          );
          await renderer.renderGraph(
            data,
            currentYear,
            currentMetric,
            targetUser,
            availableYears,
            onYearChange,
            async () => {
              renderer.setLoading(true);
              await dataManager.clearCache(currentMetric, targetUser);
              void updateView();
            }
          );
          window.dispatchEvent(new CustomEvent("di:sync-complete"));
        } catch (e) {
          log$a.error("Failed to render grass graph", { error: e });
          const message = e instanceof Error ? e.message : "Unknown error occurred";
          renderer.renderError(message, () => updateView());
        } finally {
          renderer.setLoading(false);
        }
      };
      void updateView();
    }
  }
  const ENABLED_KEY = "di.perf.enabled";
  const STATS_KEY = "di.perf.stats";
  const SAMPLE_BUFFER_SIZE = 100;
  class PerfLogger {
    enabled;
    marks = new Map();
samples = new Map();
    seq = 0;
    constructor() {
      this.enabled = this.readFlag();
    }
    readFlag() {
      try {
        return localStorage.getItem(ENABLED_KEY) === "1";
      } catch {
        return false;
      }
    }
isEnabled() {
      return this.enabled;
    }
setEnabled(on) {
      this.enabled = on;
      try {
        localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
      } catch {
      }
    }
mark(label, meta) {
      if (!this.enabled) return;
      this.marks.set(label, performance.now());
      try {
        performance.mark(`${label}:start`, meta ? { detail: meta } : void 0);
      } catch {
      }
    }
measure(label, meta) {
      if (!this.enabled) return void 0;
      const startTime = this.marks.get(label);
      if (startTime === void 0) return void 0;
      this.marks.delete(label);
      const now = performance.now();
      const delta = now - startTime;
      try {
        performance.mark(`${label}:end`, meta ? { detail: meta } : void 0);
        performance.measure(label, `${label}:start`, `${label}:end`);
        performance.clearMarks(`${label}:start`);
        performance.clearMarks(`${label}:end`);
      } catch {
      }
      this.emit(label, delta, now, meta);
      return delta;
    }
start(label) {
      this.mark(label);
    }
end(label, meta) {
      return this.measure(label, meta);
    }
async wrap(label, fn, meta) {
      if (!this.enabled) return fn();
      this.mark(label);
      try {
        return await fn();
      } finally {
        this.measure(label, meta);
      }
    }
event(label, delta, meta) {
      if (!this.enabled) return;
      this.emit(label, delta, performance.now(), meta);
    }
stats(label) {
      const buf = this.samples.get(label);
      if (!buf || buf.length === 0) return null;
      const sorted = [...buf].sort((a, b) => a - b);
      return {
        count: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99)
      };
    }
dumpStats() {
      if (!this.enabled) return;
      let allow = false;
      try {
        allow = localStorage.getItem(STATS_KEY) === "1";
      } catch {
        return;
      }
      if (!allow) return;
      const labels = [...this.samples.keys()];
      if (labels.length === 0) {
        console.log("[Perf:Stats] (no samples)");
        return;
      }
      const rows = labels.map((l) => ({ label: l, stats: this.stats(l) })).filter((r) => r.stats !== null).sort((a, b) => b.stats.p95 - a.stats.p95);
      console.log("[Perf:Stats] Ranked by p95 (count, p50/p95/p99 ms):");
      rows.forEach((r) => {
        console.log(
          `  ${r.label}: n=${r.stats.count}, p50=${r.stats.p50.toFixed(1)}, p95=${r.stats.p95.toFixed(1)}, p99=${r.stats.p99.toFixed(1)}`
        );
      });
    }
    recordSample(label, delta) {
      let buf = this.samples.get(label);
      if (!buf) {
        buf = [];
        this.samples.set(label, buf);
      }
      buf.push(delta);
      if (buf.length > SAMPLE_BUFFER_SIZE) {
        buf.shift();
      }
    }
    emit(label, delta, abs, meta) {
      this.seq++;
      this.recordSample(label, delta);
      const prefix = `[Perf #${this.seq}] ${label}: ${delta.toFixed(1)}ms (abs ${abs.toFixed(0)}ms)`;
      if (meta && Object.keys(meta).length > 0) {
        console.log(prefix, meta);
      } else {
        console.log(prefix);
      }
    }
  }
  function percentile(sorted, p) {
    if (sorted.length === 0) return Number.NaN;
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(p / 100 * sorted.length) - 1)
    );
    return sorted[idx];
  }
  const perfLogger = new PerfLogger();
  const log$9 = createLogger("Quota");
  const PERSIST_FLAG = "di.persist.requested";
  const SYNC_KEY_PREFIX = "danbooru_grass_last_sync_";
  const QUOTA_PRESSURE_THRESHOLD = 0.8;
  const SAMPLING_RATE = 0.25;
  async function checkQuota() {
    if (typeof navigator === "undefined" || !("storage" in navigator) || typeof navigator.storage.estimate !== "function") {
      return { usage: 0, quota: 0, ratio: 0, available: false };
    }
    try {
      const est = await navigator.storage.estimate();
      const usage = est.usage ?? 0;
      const quota = est.quota ?? 0;
      const ratio = quota > 0 ? usage / quota : 0;
      return { usage, quota, ratio, available: true };
    } catch {
      return { usage: 0, quota: 0, ratio: 0, available: false };
    }
  }
  function unwrapAbortError(e) {
    if (typeof e !== "object" || e === null) {
      return { name: "Unknown" };
    }
    const err = e;
    const name = typeof err.name === "string" ? err.name : "Unknown";
    const innerName = err.inner && typeof err.inner.name === "string" ? err.inner.name : void 0;
    return innerName ? { name, innerName } : { name };
  }
  function isQuotaExceeded(e) {
    const { name, innerName } = unwrapAbortError(e);
    return name === "QuotaExceededError" || innerName === "QuotaExceededError";
  }
  async function bulkPutSafe(table, records, evictor) {
    if (Math.random() < SAMPLING_RATE) {
      const snapshot = await checkQuota();
      if (snapshot.available && snapshot.ratio > QUOTA_PRESSURE_THRESHOLD) {
        log$9.warn("Storage quota high — pre-emptive eviction", {
          ratio: Number(snapshot.ratio.toFixed(3)),
          usageMB: Math.round(snapshot.usage / 1024 / 1024),
          quotaMB: Math.round(snapshot.quota / 1024 / 1024)
        });
        try {
          await evictor();
        } catch (e) {
          log$9.warn("Pre-emptive eviction failed", { error: unwrapAbortError(e) });
        }
      }
    }
    try {
      await table.bulkPut(records);
      return;
    } catch (e) {
      if (!isQuotaExceeded(e)) {
        log$9.error("bulkPut failed", {
          error: unwrapAbortError(e),
          records: records.length
        });
        throw e;
      }
      log$9.warn("QuotaExceededError on bulkPut — evicting and retrying", {
        records: records.length
      });
      await evictor();
    }
    await table.bulkPut(records);
  }
  async function requestPersistence() {
    try {
      if (localStorage.getItem(PERSIST_FLAG) === "1") return true;
    } catch {
    }
    if (typeof navigator === "undefined" || !("storage" in navigator) || typeof navigator.storage.persist !== "function") {
      return false;
    }
    try {
      const granted = await navigator.storage.persist();
      if (granted) {
        log$9.info("Persistent storage granted");
        try {
          localStorage.setItem(PERSIST_FLAG, "1");
        } catch {
        }
      }
      return granted;
    } catch (e) {
      log$9.warn("navigator.storage.persist threw", {
        error: unwrapAbortError(e)
      });
      return false;
    }
  }
  async function evictOldestNonCurrentUser(db, currentUserId) {
    const currentId = typeof currentUserId === "number" ? currentUserId : Number.parseInt(currentUserId, 10);
    let oldestUid = null;
    let oldestTime = Number.POSITIVE_INFINITY;
    try {
      const allIds = await db.posts.orderBy("uploader_id").uniqueKeys();
      for (const uidRaw of allIds) {
        const uid = Number(uidRaw);
        if (!Number.isFinite(uid) || uid === currentId) continue;
        let syncStr = null;
        try {
          syncStr = localStorage.getItem(`${SYNC_KEY_PREFIX}${uid}`);
        } catch {
        }
        const t = syncStr ? new Date(syncStr).getTime() : 0;
        if (t < oldestTime) {
          oldestTime = t;
          oldestUid = uid;
        }
      }
      if (oldestUid === null) {
        log$9.info("No non-current user available for eviction");
        return null;
      }
      await db.posts.where("uploader_id").equals(oldestUid).delete();
      await db.piestats.where("userId").equals(oldestUid).delete();
      try {
        localStorage.removeItem(`${SYNC_KEY_PREFIX}${oldestUid}`);
      } catch {
      }
      log$9.info("Evicted oldest non-current user", {
        uid: oldestUid,
        lastSyncMs: Number.isFinite(oldestTime) ? oldestTime : null
      });
      return oldestUid;
    } catch (e) {
      log$9.warn("Eviction failed", { error: unwrapAbortError(e) });
      return null;
    }
  }
  const log$8 = createLogger("Analytics");
  const workerLog = createLogger("Analytics:Worker");
  function computeUntaggedTranslation(counts) {
    const { t, a, b, c, ab, ac } = counts;
    return Math.max(0, t - a - b - c + ab + ac);
  }
  function buildUntaggedTranslationQueries(normalizedName) {
    const u = `user:${normalizedName}`;
    return {
      t: `${u} *_text`,
      a: `${u} english_text`,
      b: `${u} *_text translation_request`,
      c: `${u} *_text translated`,
      ab: `${u} english_text translation_request`,
      ac: `${u} english_text translated`,
      bc: `${u} translation_request translated`
    };
  }
  const BACKFILL_FAILURE_THRESHOLD = 3;
  const BACKFILL_COOLDOWN_MS = 24 * 60 * 60 * 1e3;
  function backfillFailureStorageKey(uploaderId) {
    return `di_backfill_failure_${uploaderId}`;
  }
  function isBackfillInCooldown(state, now = Date.now()) {
    if (!state) return false;
    return state.failureCount >= BACKFILL_FAILURE_THRESHOLD && now - state.lastAttemptAt < BACKFILL_COOLDOWN_MS;
  }
  function recordFailure(prev, now = Date.now()) {
    return {
      lastAttemptAt: now,
      failureCount: (prev?.failureCount ?? 0) + 1
    };
  }
  function shouldCountHttpAsFailure(status) {
    return status !== 429;
  }
  class AnalyticsDataManager extends DataManager {
    static isGlobalSyncing = false;
    static syncProgress = { current: 0, total: 0, message: "" };
    static onProgressCallback = null;
constructor(db, rateLimiter) {
      super(db, rateLimiter ?? null);
    }

async fetchThumbnailWithRetry(tags, retries = 3, delay = 2e3) {
      const url = `/posts.json?tags=${encodeURIComponent(tags)}&limit=1&only=preview_file_url,variants,rating`;
      for (let i = 0; i < retries; i++) {
        try {
          const resp = await this.rateLimiter.fetch(url);
          if (resp.status === 429) {
            await new Promise((r) => setTimeout(r, delay + Math.random() * 2e3));
            delay *= 2;
            continue;
          }
          if (resp.status === 422) return "";
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            return getBestThumbnailUrl(data[0]);
          }
          return "";
        } catch (e) {
          if (i === retries - 1) {
            log$8.warn(`Failed thumb fetch after ${retries} tries`, {
              tags,
              error: e
            });
            return "";
          }
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      return "";
    }
async getSyncStats(userInfo) {
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (!uploaderId) return { count: 0, lastSync: null };
      const [count, lastEntry] = await Promise.all([
        this.db.posts.where("uploader_id").equals(uploaderId).count(),
        this.db.posts.where("[uploader_id+created_at]").between([uploaderId, ""], [uploaderId, "￿"]).last()
      ]);
      return {
        count,
        lastSync: lastEntry ? lastEntry.created_at : null
      };
    }
async getSummaryStats(userInfo) {
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (!uploaderId)
        return {
          maxUploads: 0,
          maxDate: "N/A",
          firstUploadDate: null,
          lastUploadDate: null
        };
      const historyAll = {};
      const history1Year = {};
      let firstUploadDate = null;
      let lastUploadDate = null;
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      let count1Year = 0;
      let totalCount = 0;
      await this.db.posts.where("uploader_id").equals(uploaderId).each((p) => {
        totalCount++;
        const dStr = p["created_at"].split("T")[0];
        historyAll[dStr] = (historyAll[dStr] || 0) + 1;
        const d = new Date(p.created_at);
        if (!firstUploadDate || d < firstUploadDate) {
          firstUploadDate = d;
        }
        if (!lastUploadDate || d > lastUploadDate) {
          lastUploadDate = d;
        }
        if (d >= oneYearAgo) {
          history1Year[dStr] = (history1Year[dStr] || 0) + 1;
          count1Year++;
        }
      });
      if (totalCount === 0)
        return {
          maxUploads: 0,
          maxDate: "N/A",
          firstUploadDate: null,
          lastUploadDate: null
        };
      let maxUploads = 0;
      let maxDate = "N/A";
      const sortedDates = Object.keys(historyAll).sort();
      const activeDays = sortedDates.length;
      for (const [date, count] of Object.entries(historyAll)) {
        if (count > maxUploads) {
          maxUploads = count;
          maxDate = date;
        }
      }
      let maxStreak = 0;
      let maxStreakStart = null;
      let maxStreakEnd = null;
      let currentStreak = 0;
      let currentStreakStart = null;
      let lastDateObj = null;
      for (const dateStr of sortedDates) {
        const d = new Date(dateStr);
        d.setHours(0, 0, 0, 0);
        if (!lastDateObj) {
          currentStreak = 1;
          currentStreakStart = dateStr;
        } else {
          const diffTime = d.getTime() - lastDateObj.getTime();
          const diffDays = Math.round(diffTime / (1e3 * 60 * 60 * 24));
          if (diffDays === 1) {
            currentStreak++;
          } else if (diffDays > 1) {
            currentStreak = 1;
            currentStreakStart = dateStr;
          }
        }
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
          maxStreakStart = currentStreakStart;
          maxStreakEnd = dateStr;
        }
        lastDateObj = d;
      }
      let maxUploads1Year = 0;
      let maxDate1Year = "N/A";
      for (const [date, count] of Object.entries(history1Year)) {
        if (count > maxUploads1Year) {
          maxUploads1Year = count;
          maxDate1Year = date;
        }
      }
      return {
        maxUploads,
        maxDate,
        firstUploadDate,
        lastUploadDate,
        count1Year,
        maxUploads1Year,
        maxDate1Year,
        maxStreak,
        maxStreakStart,
        maxStreakEnd,
        activeDays
      };
    }

buildMilestoneTargets(total, customStep) {
      const targets = [];
      if (customStep === "repdigit") {
        targets.push(1);
        if (total >= 11) targets.push(11);
        for (let digits = 3; digits <= 6; digits++) {
          for (let d = 1; d <= 9; d++) {
            const num = parseInt(String(d).repeat(digits));
            if (num <= total) targets.push(num);
          }
        }
      } else if (customStep !== "auto" && typeof customStep === "number") {
        const step = customStep;
        targets.push(1);
        for (let i = step; i <= total; i += step) {
          targets.push(i);
        }
      } else {
        if (total < 1500) {
          targets.push(1);
          for (let i = 100; i <= total; i += 100) {
            targets.push(i);
          }
        } else if (total <= 1e4) {
          targets.push(1);
          if (total >= 100) targets.push(100);
          for (let i = 500; i <= total; i += 500) {
            targets.push(i);
          }
        } else if (total > 1e5) {
          targets.push(1);
          if (total >= 100) targets.push(100);
          if (total >= 1e3) targets.push(1e3);
          for (let i = 5e3; i <= total; i += 5e3) {
            targets.push(i);
          }
        } else if (total > 5e4) {
          targets.push(1);
          if (total >= 100) targets.push(100);
          if (total >= 1e3) targets.push(1e3);
          for (let i = 2500; i <= total; i += 2500) {
            targets.push(i);
          }
        } else {
          targets.push(1);
          if (total >= 100) targets.push(100);
          for (let i = 1e3; i <= total; i += 1e3) {
            targets.push(i);
          }
        }
      }
      return [...new Set(targets)].sort((a, b) => a - b);
    }
getNextMilestone(total, customStep) {
      if (customStep === "repdigit") {
        if (total < 1) return 1;
        if (total < 11) return 11;
        for (let digits = 3; digits <= 7; digits++) {
          for (let d = 1; d <= 9; d++) {
            const num = parseInt(String(d).repeat(digits));
            if (num > total) return num;
          }
        }
        return null;
      }
      if (customStep !== "auto" && typeof customStep === "number") {
        const step2 = customStep;
        if (total < 1) return 1;
        return Math.floor(total / step2) * step2 + step2;
      }
      if (total < 1) return 1;
      if (total < 100) return 100;
      let step;
      if (total < 1500) step = 100;
      else if (total <= 1e4) step = 500;
      else if (total <= 5e4) step = 1e3;
      else if (total <= 1e5) step = 2500;
      else step = 5e3;
      return Math.floor(total / step) * step + step;
    }
    async getMilestones(userInfo, isNsfwEnabled = false, customStep = "auto", forceRefresh = false) {
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (!uploaderId) return [];
      const cacheKey = `milestones_${customStep}_${isNsfwEnabled ? "1" : "0"}`;
      if (!forceRefresh) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const total = await this.db.posts.where("uploader_id").equals(uploaderId).count();
      if (total === 0) return [];
      const targets = this.buildMilestoneTargets(total, customStep);
      const matches = await this.db.posts.where("[uploader_id+no]").anyOf(targets.map((no) => [uploaderId, no])).toArray();
      const missingIds = [];
      matches.forEach((p) => {
        const isSafe = p.rating === "s" || p.rating === "g";
        const shouldFetch = isNsfwEnabled || isSafe;
        if (shouldFetch && (!p.variants || p.variants.length === 0)) {
          missingIds.push(p.id);
        }
      });
      if (missingIds.length > 0) {
        try {
          const chunkSize = 100;
          for (let i = 0; i < missingIds.length; i += chunkSize) {
            const chunk = missingIds.slice(i, i + chunkSize);
            const idsStr = chunk.join(",");
            const url = `${this.baseUrl}/posts.json?tags=id:${idsStr}&limit=100&only=id,variants,rating,preview_file_url`;
            const res = await this.rateLimiter.fetch(url);
            if (res.ok) {
              const fetchedItems = await res.json();
              fetchedItems.forEach((item) => {
                const local = matches.find((m) => m.id === item.id);
                if (local) {
                  local.variants = item.variants;
                  local.preview_file_url = item.preview_file_url;
                  local.rating = item.rating;
                  this.db.posts.update(local.id, {
                    variants: item.variants,
                    preview_file_url: item.preview_file_url,
                    rating: item.rating
                  }).catch(
                    (e) => log$8.error("Failed to update post in DB", {
                      postId: local["id"],
                      error: e
                    })
                  );
                }
              });
            }
          }
        } catch (e) {
          log$8.warn("Failed to fetch missing milestone thumbnails", { error: e });
        }
      }
      const map = new Map(matches.map((p) => [p.no, p]));
      const results = [];
      targets.forEach((t) => {
        const p = map.get(t);
        if (p) {
          let label = `#${t.toLocaleString()}`;
          if (t >= 1e3 && t % 1e3 === 0) label = `${t / 1e3} k`;
          const tStr = String(t);
          if (tStr.length >= 3 && tStr.split("").every((c) => c === tStr[0]))
            label = tStr;
          if (t === 1) label = "First";
          results.push({ type: label, post: p, milestone: t });
        }
      });
      results.sort((a, b) => a.milestone - b.milestone);
      await this.saveStats(cacheKey, uploaderId, results);
      return results;
    }
async getMonthlyStats(userInfo, minDate = null) {
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (!uploaderId) return [];
      const counts = {};
      await this.db.posts.where("uploader_id").equals(uploaderId).each((post) => {
        if (!post["created_at"]) return;
        const month = post["created_at"].substring(0, 7);
        counts[month] = (counts[month] || 0) + 1;
      });
      let results = [];
      const keys = Object.keys(counts).sort();
      if (keys.length > 0) {
        let startKey = keys[0];
        const endKey = keys[keys.length - 1];
        if (minDate) {
          const mY = minDate.getFullYear();
          const mM = minDate.getMonth() + 1;
          const mKey = `${mY}-${String(mM).padStart(2, "0")}`;
          if (mKey < startKey) startKey = mKey;
        }
        let [y, m] = startKey.split("-").map(Number);
        const [endY, endM] = endKey.split("-").map(Number);
        while (y < endY || y === endY && m <= endM) {
          const k = `${y}-${String(m).padStart(2, "0")}`;
          results.push({
            date: k,
            count: counts[k] || 0,
            label: k
          });
          m++;
          if (m > 12) {
            m = 1;
            y++;
          }
        }
      } else {
        results = [];
      }
      return results;
    }

async getStatusDistribution(userInfo, startDate = null, forceRefresh = false) {
      if (!userInfo.name) return [];
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "status_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) {
          return cached;
        }
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const statuses = [
        "active",
        "appealed",
        "banned",
        "deleted",
        "flagged",
        "pending"
      ];
      const tasks = statuses.map(async (status) => {
        try {
          let tagQuery = `user:${normalizedName} status:${status}`;
          if (startDate) {
            const dateStr = startDate instanceof Date ? startDate.toISOString().split("T")[0] : startDate;
            tagQuery += ` date:>=${dateStr}`;
          }
          const params = new URLSearchParams({ tags: tagQuery });
          const url = `/counts/posts.json?${params.toString()}`;
          const resp = await this.rateLimiter.fetch(url);
          let count = 0;
          if (resp.ok) {
            const data = await resp.json();
            count = (data && data.counts ? data.counts.posts : data ? data.posts : 0) || 0;
          }
          return {
            name: status,
            count,
            label: status.charAt(0).toUpperCase() + status.slice(1)
          };
        } catch (e) {
          log$8.warn("Failed to fetch count for status", { status, error: e });
          return {
            name: status,
            count: 0,
            label: status.charAt(0).toUpperCase() + status.slice(1)
          };
        }
      });
      const result = await Promise.all(tasks);
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, result);
      return result;
    }
async getRatingDistribution(userInfo, startDate = null, forceRefresh = false) {
      if (!userInfo.name) return [];
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "rating_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) {
          return cached;
        }
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const ratings = ["g", "s", "q", "e"];
      const labelMap = {
        g: "General",
        s: "Sensitive",
        q: "Questionable",
        e: "Explicit"
      };
      const tasks = ratings.map(async (rating) => {
        try {
          let tagQuery = `user:${normalizedName} rating:${rating}`;
          if (startDate) {
            const dateStr = startDate instanceof Date ? startDate.toISOString().split("T")[0] : startDate;
            tagQuery += ` date:>=${dateStr}`;
          }
          const params = new URLSearchParams({
            tags: tagQuery
          });
          const url = `/counts/posts.json?${params.toString()}`;
          const resp = await this.rateLimiter.fetch(url);
          if (!resp.ok) return { rating, count: 0, label: labelMap[rating] };
          const data = await resp.json();
          const count = (data && data.counts ? data.counts.posts : data ? data.posts : 0) || 0;
          return {
            rating,
            count,
            label: labelMap[rating]
          };
        } catch (e) {
          log$8.warn("Failed to fetch count for rating", { rating, error: e });
          return { rating, count: 0, label: labelMap[rating] };
        }
      });
      try {
        const results = await Promise.all(tasks);
        if (uploaderId) await this.saveStats(cacheKey, uploaderId, results);
        return results;
      } catch (e) {
        log$8.error("Failed to fetch rating distribution", { error: e });
        return [];
      }
    }
async getTagCloudData(userInfo, categoryId) {
      if (!userInfo.name) return [];
      const categoryNames = {
        0: "general",
        1: "artist",
        3: "copyright",
        4: "character"
      };
      const catName = categoryNames[categoryId] || `cat${categoryId}`;
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = `tag_cloud_${catName}`;
      if (uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const order = categoryId === 0 ? "Cosine" : "Frequency";
      const url = `/related_tag.json?commit=Search&search[category]=${categoryId}&search[order]=${order}&search[query]=user:${encodeURIComponent(normalizedName)}`;
      try {
        const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
          return [];
        const queryPostCount = resp.post_count || 0;
        const items = resp.related_tags.slice(0, 30).map((item) => ({
          name: item.tag.name.replace(/_/g, " "),
          tagName: item.tag.name,
          frequency: item.frequency,
          count: Math.round(item.frequency * queryPostCount)
        })).sort((a, b) => b.frequency - a.frequency);
        if (uploaderId) await this.saveStats(cacheKey, uploaderId, items);
        return items;
      } catch (e) {
        log$8.debug("Failed to fetch tag cloud data", { error: e });
        return [];
      }
    }
static parseNewGeneralTags(body, targetUser, reportDate) {
      const results = [];
      const userLower = targetUser.toLowerCase();
      const sectionStart = body.indexOf("New General Tags");
      if (sectionStart === -1) return results;
      const afterSection = body.slice(sectionStart);
      const nextSectionMatch = afterSection.slice(20).search(/\bh[45]\.\s/);
      const sectionBody = nextSectionMatch >= 0 ? afterSection.slice(0, nextSectionMatch + 20) : afterSection;
      const rowRegex = /\[td\]\[\[(.+?)\]\].*?\[\/td\]\s*\[td\](.*?)\[\/td\]/g;
      let match;
      while ((match = rowRegex.exec(sectionBody)) !== null) {
        const tagDisplay = match[1];
        const updaterCell = match[2];
        if (updaterCell.toLowerCase().includes(userLower)) {
          const tagName = tagDisplay.trim().replace(/ /g, "_");
          results.push({ tagName, reportDate });
        }
      }
      return results;
    }
async getCreatedTags(userInfo, onProgress) {
      if (!userInfo.name) return [];
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "created_tags";
      if (uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const report = onProgress || (() => {
      });
      try {
        const userNames = [userInfo.name];
        if (uploaderId) {
          report("Checking previous usernames...");
          try {
            const ncUrl = `/user_name_change_requests.json?search[user_id]=${uploaderId}&limit=500`;
            const ncResp = await this.rateLimiter.fetch(ncUrl).then((r) => r.json());
            if (Array.isArray(ncResp)) {
              for (const nc of ncResp) {
                if (nc.original_name && !userNames.includes(nc.original_name)) {
                  userNames.push(nc.original_name);
                }
              }
            }
          } catch {
          }
        }
        const rawTags = [];
        const seenTags = new Set();
        for (let ni = 0; ni < userNames.length; ni++) {
          const name = userNames[ni];
          report(
            `Searching reports for ${name}... (${ni + 1}/${userNames.length})`
          );
          const searchQuery = `tag report ${name}`;
          const url = `/forum_posts.json?search[body_matches]=${encodeURIComponent(searchQuery)}&limit=500`;
          const posts = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (!Array.isArray(posts)) continue;
          for (const post of posts) {
            const body = post.body || "";
            const dateMatch = body.match(/Daily Report \((\d{4}-\d{2}-\d{2})\)/);
            const reportDate = dateMatch ? dateMatch[1] : (post.created_at || "").slice(0, 10);
            const parsed = AnalyticsDataManager.parseNewGeneralTags(
              body,
              name,
              reportDate
            );
            for (const tag of parsed) {
              if (!seenTags.has(tag.tagName)) {
                seenTags.add(tag.tagName);
                rawTags.push(tag);
              }
            }
          }
        }
        if (rawTags.length === 0) return [];
        report(`Found ${rawTags.length} tags. Fetching current status...`);
        const tagNames = rawTags.map((t) => t.tagName);
        const tagStatusMap = new Map();
        for (let i = 0; i < tagNames.length; i += 100) {
          const batch = tagNames.slice(i, i + 100);
          report(
            `Fetching tag status... (${Math.min(i + 100, tagNames.length)}/${tagNames.length})`
          );
          const tagsUrl = `/tags.json?search[name_comma]=${encodeURIComponent(batch.join(","))}&only=name,post_count,is_deprecated&limit=500`;
          const tagsResp = await this.rateLimiter.fetch(tagsUrl).then((r) => r.json());
          if (Array.isArray(tagsResp)) {
            for (const t of tagsResp) {
              tagStatusMap.set(t.name, {
                postCount: t.post_count || 0,
                isDeprecated: t.is_deprecated || false
              });
            }
          }
        }
        const emptyTagNames = tagNames.filter((name) => {
          const status = tagStatusMap.get(name);
          return !status || status.postCount === 0;
        });
        report(`Checking aliases for ${emptyTagNames.length} empty tags...`);
        const aliasMap = new Map();
        let aliasChecked = 0;
        await this.mapConcurrent(emptyTagNames, 5, async (name) => {
          try {
            const aliasUrl = `/tag_aliases.json?search[antecedent_name]=${encodeURIComponent(name)}&search[status]=active&limit=1`;
            const aliasResp = await this.rateLimiter.fetch(aliasUrl).then((r) => r.json());
            if (Array.isArray(aliasResp) && aliasResp.length > 0) {
              aliasMap.set(name, aliasResp[0].consequent_name);
            }
          } catch {
          }
          aliasChecked++;
          if (aliasChecked % 10 === 0 || aliasChecked === emptyTagNames.length) {
            report(
              `Checking aliases... (${aliasChecked}/${emptyTagNames.length})`
            );
          }
          return null;
        });
        const aliasedNames = Array.from(aliasMap.values());
        const aliasPostCounts = new Map();
        if (aliasedNames.length > 0) {
          report("Fetching aliased tag counts...");
          for (let i = 0; i < aliasedNames.length; i += 100) {
            const batch = aliasedNames.slice(i, i + 100);
            const tagsUrl = `/tags.json?search[name_comma]=${encodeURIComponent(batch.join(","))}&only=name,post_count&limit=500`;
            const tagsResp = await this.rateLimiter.fetch(tagsUrl).then((r) => r.json());
            if (Array.isArray(tagsResp)) {
              for (const t of tagsResp) {
                aliasPostCounts.set(t.name, t.post_count || 0);
              }
            }
          }
        }
        report("Finalizing...");
        const items = rawTags.map((raw) => {
          const status = tagStatusMap.get(raw.tagName);
          const alias = aliasMap.get(raw.tagName) || null;
          const postCount = alias ? aliasPostCounts.get(alias) ?? 0 : status?.postCount ?? 0;
          return {
            tagName: raw.tagName,
            displayName: raw.tagName.replace(/_/g, " "),
            postCount,
            isDeprecated: status?.isDeprecated ?? false,
            aliasedTo: alias,
            reportDate: raw.reportDate
          };
        });
        items.sort((a, b) => b.postCount - a.postCount);
        if (uploaderId) await this.saveStats(cacheKey, uploaderId, items);
        return items;
      } catch (e) {
        log$8.debug("Failed to fetch created tags", { error: e });
        return [];
      }
    }
async getCharacterDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      if (reportSubStatus) reportSubStatus("Fetching Character Distribution...");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "character_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const url = `/related_tag.json?commit=Search&search[category]=4&search[order]=Frequency&search[query]=user:${encodeURIComponent(normalizedName)}`;
      try {
        const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
          return [];
        const tags = resp.related_tags;
        const itemsToProcess = tags.slice(0, 10);
        const top10 = itemsToProcess.map((item) => ({
          name: item.tag.name.replace(/_/g, " "),
          tagName: item.tag.name,
          count: 0,
          frequency: item.frequency,
          thumb: null,
          isOther: false,
          _item: item
        }));
        await perfLogger.wrap(
          "dbi:db:refresh:mapConcurrent",
          () => this.mapConcurrent(top10, 3, async (obj) => {
            const tagName = obj.tagName;
            if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
            try {
              const countUrl = `/counts/posts.json?tags=${encodeURIComponent(`user:${normalizedName} ${tagName}`)}`;
              const countResp = await this.rateLimiter.fetch(countUrl).then((r) => r.json());
              const c = countResp.counts && countResp.counts.posts ? countResp.counts.posts : 0;
              obj.count = c || obj._item?.tag.post_count || 0;
            } catch (_e) {
              log$8.debug("Failed to fetch user tag count", { error: _e });
            }
            delete obj._item;
          }),
          { distribution: "character", n: top10.length, concurrency: 3 }
        );
        const sumFreq = top10.reduce(
          (acc, curr) => acc + curr.frequency,
          0
        );
        const otherFreq = 1 - sumFreq;
        if (otherFreq > 1e-3) {
          top10.push({
            name: "Others",
            tagName: "",
            count: 0,
            frequency: otherFreq,
            thumb: "",
            isOther: true
          });
        }
        if (uploaderId) await this.saveStats(cacheKey, uploaderId, top10);
        await this.enrichThumbnails(
          cacheKey,
          uploaderId,
          top10,
          userInfo,
          reportSubStatus
        );
        return top10;
      } catch (e) {
        log$8.warn("Failed to fetch character distribution", { error: e });
        return [];
      }
    }
async getCopyrightDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      if (reportSubStatus) reportSubStatus("Fetching Copyright Distribution...");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "copyright_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const url = `/related_tag.json?commit=Search&search[category]=3&search[order]=Frequency&search[query]=user:${encodeURIComponent(normalizedName)}`;
      try {
        const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
          return [];
        const tags = resp.related_tags;
        const candidates = tags.slice(0, 20);
        const filteredResults = await this.mapConcurrent(
          candidates,
          2,
          async (item) => await isTopLevelTag(this.rateLimiter, item.tag.name) ? item : null
        );
        const filtered = filteredResults.filter(
          (item) => item !== null
        );
        const top10 = filtered.slice(0, 10).map((item) => ({
          name: item.tag.name.replace(/_/g, " "),
          tagName: item.tag.name,
          count: 0,
          frequency: item.frequency,
          thumb: null,
          isOther: false,
          _item: item
        }));
        await perfLogger.wrap(
          "dbi:db:refresh:mapConcurrent",
          () => this.mapConcurrent(top10, 3, async (obj) => {
            const tagName = obj.tagName;
            if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
            try {
              const countUrl = `/counts/posts.json?tags=${encodeURIComponent(`user:${normalizedName} ${tagName}`)}`;
              const countResp = await this.rateLimiter.fetch(countUrl).then((r) => r.json());
              const c = countResp.counts && countResp.counts.posts ? countResp.counts.posts : 0;
              obj.count = c || obj._item?.tag.post_count || 0;
            } catch (_e) {
              log$8.debug("Failed to fetch user tag count", { error: _e });
            }
            delete obj._item;
          }),
          { distribution: "copyright", n: top10.length, concurrency: 3 }
        );
        const sumFreq = top10.reduce(
          (acc, curr) => acc + curr.frequency,
          0
        );
        const otherFreq = 1 - sumFreq;
        if (otherFreq > 1e-3) {
          top10.push({
            name: "Others",
            tagName: "",
            count: 0,
            frequency: otherFreq,
            thumb: "",
            isOther: true
          });
        }
        if (uploaderId) await this.saveStats(cacheKey, uploaderId, top10);
        await this.enrichThumbnails(
          cacheKey,
          uploaderId,
          top10,
          userInfo,
          reportSubStatus
        );
        return top10;
      } catch (e) {
        log$8.warn("Failed to fetch copyright distribution", { error: e });
        return [];
      }
    }
async mapConcurrent(items, concurrency, fn, delayMs = 50) {
      const results = new Array(items.length);
      let index = 0;
      const next = async () => {
        while (index < items.length) {
          const i = index++;
          results[i] = await fn(items[i]);
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        }
      };
      await Promise.all(Array.from({ length: concurrency }, next));
      return results;
    }
async getFavCopyrightDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "fav_copyright_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const url = `/related_tag.json?commit=Search&search[category]=3&search[order]=Frequency&search[query]=ordfav:${encodeURIComponent(normalizedName)}`;
      try {
        const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
          return [];
        const tags = resp.related_tags;
        const candidates = tags.slice(0, 20);
        const filteredResults = await this.mapConcurrent(
          candidates,
          2,
          async (item) => {
            const tagName = item.tag.name;
            const impUrl = `/tag_implications.json?search[antecedent_name_matches]=${encodeURIComponent(tagName)}`;
            try {
              const imps = await this.rateLimiter.fetch(impUrl).then((r) => r.json());
              if (Array.isArray(imps) && imps.length > 0) return null;
              return item;
            } catch {
              return item;
            }
          }
        );
        const filtered = filteredResults.filter(
          (item) => item !== null
        );
        const top10 = filtered.slice(0, 10).map((item) => {
          const tagName = item.tag.name;
          const displayName = tagName.replace(/_/g, " ");
          return {
            name: displayName,
            tagName,
            count: 0,
frequency: item.frequency,
            thumb: null,
isOther: false,
            _item: item
};
        });
        await this.mapConcurrent(top10, 3, async (obj) => {
          const tagName = obj.tagName;
          if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
          try {
            const countUrl = `/counts/posts.json?tags=${encodeURIComponent(`fav:${normalizedName} ${tagName}`)}`;
            const countResp = await this.rateLimiter.fetch(countUrl).then((r) => r.json());
            const c = countResp.counts && countResp.counts.posts ? countResp.counts.posts : 0;
            obj.count = c;
          } catch (e) {
            log$8.warn("Count fetch failed for fav copyright tag", {
              tagName: obj.tagName,
              error: e
            });
          }
          delete obj._item;
        });
        const sumFreq = top10.reduce(
          (acc, curr) => acc + curr.frequency,
          0
        );
        const otherFreq = 1 - sumFreq;
        if (otherFreq > 1e-3) {
          top10.push({
            name: "Others",
            tagName: "",
            count: 0,
            frequency: otherFreq,
            thumb: "",
            isOther: true
          });
        }
        if (uploaderId) await this.saveStats(cacheKey, uploaderId, top10);
        await this.enrichThumbnails(
          cacheKey,
          uploaderId,
          top10,
          userInfo,
          reportSubStatus
        );
        return top10;
      } catch (e) {
        log$8.warn("Failed to fetch fav copyright distribution", { error: e });
        return [];
      }
    }
async getTopPostsByType(userInfo, forceRefresh = false) {
      if (!userInfo.name) return { g: null, s: null, q: null, e: null };
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "top_posts_by_type";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) {
          return cached;
        }
      }
      const fetchTop = async (ratingTag, extraQuery = "") => {
        try {
          const normalizedName = userInfo.name.replace(/ /g, "_");
          const query = `user:${normalizedName} order:score rating:${ratingTag} ${extraQuery}`;
          const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=1&only=id,preview_file_url,file_url,variants,rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
          const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (Array.isArray(resp) && resp.length > 0) {
            return resp[0];
          }
        } catch (e2) {
          log$8.warn("Failed to fetch top post for rating", { ratingTag, error: e2 });
        }
        return null;
      };
      const [g, s, q, e] = await Promise.all([
        fetchTop("g"),
        fetchTop("s"),
        fetchTop("q"),
        fetchTop("e")
      ]);
      const result = { g, s, q, e };
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, result);
      return result;
    }
async getRecentPopularPosts(userInfo, forceRefresh = false) {
      if (!userInfo.name) return { sfw: null, nsfw: null };
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "recent_popular_posts";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) {
          return cached;
        }
      }
      const fetchTop = async (ratingTag) => {
        try {
          const normalizedName = userInfo.name.replace(/ /g, "_");
          const query = `user:${normalizedName} order:score ${ratingTag} age:<1w`;
          const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=1&only=id,preview_file_url,file_url,variants,rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
          const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (Array.isArray(resp) && resp.length > 0) {
            return resp[0];
          }
        } catch (e) {
          log$8.warn("Failed to fetch recent top post", { ratingTag, error: e });
        }
        return null;
      };
      const [sfw, nsfw] = await Promise.all([
        fetchTop("is:sfw"),
        fetchTop("is:nsfw")
      ]);
      const result = { sfw, nsfw };
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, result);
      return result;
    }
async getRandomPosts(userInfo) {
      if (!userInfo.name) return { sfw: null, nsfw: null };
      const fetchRandom = async (ratingTag) => {
        try {
          const normalizedName = userInfo.name.replace(/ /g, "_");
          const query = `user:${normalizedName} ${ratingTag}`;
          const url = `/posts/random.json?tags=${encodeURIComponent(query)}&only=id,preview_file_url,file_url,variants,rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
          const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (resp && resp.id) {
            return resp;
          }
        } catch (e) {
          log$8.warn("Failed to fetch random post", { ratingTag, error: e });
        }
        return null;
      };
      const [sfw, nsfw] = await Promise.all([
        fetchRandom("is:sfw"),
        fetchRandom("is:nsfw")
      ]);
      return { sfw, nsfw };
    }
async getTopScorePost(userInfo, filterMode = "sfw") {
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (!uploaderId) return null;
      const ratingFilter = filterMode === "sfw" ? (p) => p.rating === "g" || p.rating === "s" : filterMode === "nsfw" ? (p) => p.rating === "q" || p.rating === "e" : () => true;
      const topLocal = await this.db.posts.where("[uploader_id+score]").between([uploaderId, -Infinity], [uploaderId, Infinity]).reverse().filter(ratingFilter).first();
      if (!topLocal) return null;
      try {
        const url = `/posts/${topLocal.id}.json`;
        const details = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (details && details.id) {
          return details;
        }
      } catch (e) {
        log$8.warn("Failed to fetch top post details", {
          postId: topLocal.id,
          error: e
        });
      }
      return topLocal;
    }
async getScatterData(userInfo) {
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (!uploaderId) return [];
      const result = [];
      await this.db.posts.where("uploader_id").equals(uploaderId).each((post) => {
        if (!post["created_at"]) return;
        const d = new Date(post["created_at"]).getTime();
        const r = post["rating"];
        const s = post["score"] || 0;
        const t = post["tag_count_general"] || 0;
        const dn = post["down_score"];
        const del = post["is_deleted"];
        const ban = post["is_banned"];
        result.push({ id: post["id"], d, s, t, r, dn, del, ban });
      });
      return result;
    }
getBackfillFailureState(uploaderId) {
      const raw = localStorage.getItem(backfillFailureStorageKey(uploaderId));
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
setBackfillFailureState(uploaderId, state) {
      localStorage.setItem(
        backfillFailureStorageKey(uploaderId),
        JSON.stringify(state)
      );
    }
clearBackfillFailureState(uploaderId) {
      localStorage.removeItem(backfillFailureStorageKey(uploaderId));
    }
recordBackfillFailure(uploaderId) {
      const next = recordFailure(this.getBackfillFailureState(uploaderId));
      this.setBackfillFailureState(uploaderId, next);
      log$8.warn("Backfill failure recorded", {
        uploaderId,
        failureCount: next.failureCount,
        threshold: BACKFILL_FAILURE_THRESHOLD
      });
    }
async needsPostMetadataBackfill(userInfo) {
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (!uploaderId) return false;
      const flagKey = `di_post_metadata_v2_${uploaderId}`;
      if (localStorage.getItem(flagKey) === "1") return false;
      if (isBackfillInCooldown(this.getBackfillFailureState(uploaderId))) {
        return false;
      }
      const missing = await this.db.posts.where("uploader_id").equals(uploaderId).filter(
        (p) => p.up_score === void 0 || p.down_score === void 0 || p.is_deleted === void 0 || p.is_banned === void 0
      ).first();
      if (missing === void 0) {
        localStorage.setItem(flagKey, "1");
        return false;
      }
      return true;
    }
async backfillPostMetadata(userInfo, onProgress) {
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (!uploaderId) return;
      const flagKey = `di_post_metadata_v2_${uploaderId}`;
      const allPosts = await this.db.posts.where("uploader_id").equals(uploaderId).toArray();
      const needsUpdate = allPosts.filter(
        (p) => p.up_score === void 0 || p.down_score === void 0 || p.is_deleted === void 0 || p.is_banned === void 0
      );
      if (needsUpdate.length === 0) {
        localStorage.setItem(flagKey, "1");
        return;
      }
      const total = needsUpdate.length;
      let updated = 0;
      if (onProgress) onProgress(0, total);
      const byId = new Map();
      let minId = Infinity;
      for (const p of needsUpdate) {
        byId.set(p.id, p);
        if (p.id < minId) minId = p.id;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const limit = 200;
      let lastId = minId - 1;
      let hasMore = true;
      while (hasMore && updated < total) {
        const params = new URLSearchParams({
          tags: `user:${normalizedName} status:any id:>${lastId} order:id`,
          limit: String(limit),
          only: "id,up_score,down_score,is_deleted,is_banned"
        });
        const url = `/posts.json?${params.toString()}`;
        let batch;
        try {
          const resp = await this.rateLimiter.fetch(url);
          if (!resp.ok) {
            if (shouldCountHttpAsFailure(resp.status)) {
              log$8.warn("Backfill HTTP error — pausing backfill", {
                status: resp.status
              });
              this.recordBackfillFailure(uploaderId);
            } else {
              log$8.warn(
                "Backfill HTTP 429 — pausing batch (rate-limiter cooldown active)"
              );
            }
            return;
          }
          batch = await resp.json();
        } catch (e) {
          log$8.warn("Backfill fetch failed", { error: e });
          this.recordBackfillFailure(uploaderId);
          return;
        }
        if (!Array.isArray(batch) || batch.length === 0) {
          hasMore = false;
          break;
        }
        const updates = [];
        for (const p of batch) {
          const existing = byId.get(p.id);
          if (!existing) continue;
          const ds = p.down_score ?? 0;
          const us = p.up_score ?? 0;
          updates.push({
            ...existing,
            score: us + ds,
            up_score: us,
            down_score: ds,
            is_deleted: p.is_deleted ?? false,
            is_banned: p.is_banned ?? false
          });
          updated++;
        }
        if (updates.length > 0) {
          await bulkPutSafe(
            this.db.posts,
            updates,
            () => evictOldestNonCurrentUser(this.db, uploaderId)
          );
          if (onProgress) onProgress(updated, total);
        }
        lastId = batch[batch.length - 1].id;
        if (batch.length < limit) {
          hasMore = false;
        }
      }
      if (updated >= total) {
        localStorage.setItem(flagKey, "1");
        this.clearBackfillFailureState(uploaderId);
      }
    }
async getUserStats(userInfo, force = false) {
      const userId = userInfo.id;
      if (!userId) return null;
      if (!force) {
        const cached = await this.db.user_stats.get(userId);
        if (cached && Date.now() - cached.updated_at < 24 * 60 * 60 * 1e3) {
          return {
            gentags_lt_10: cached.gentags_lt_10,
            tagcount_lt_10: cached.tagcount_lt_10
          };
        }
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const fetchCount = async (tagQuery) => {
        try {
          const params = new URLSearchParams({ tags: tagQuery });
          const url = `/counts/posts.json?${params.toString()}`;
          const resp = await this.rateLimiter.fetch(url);
          if (!resp.ok) return 0;
          const data = await resp.json();
          return (data && data.counts ? data.counts.posts : data ? data.posts : 0) || 0;
        } catch (e) {
          log$8.warn("Count query failed for user stats", { tagQuery, error: e });
          return 0;
        }
      };
      const [gentags, tagcount] = await Promise.all([
        fetchCount(`user:${normalizedName} gentags:<10`),
        fetchCount(`user:${normalizedName} tagcount:<10`)
      ]);
      const record = {
        userId,
        gentags_lt_10: gentags,
        tagcount_lt_10: tagcount,
        updated_at: Date.now()
      };
      await this.db.user_stats.put(record);
      return { gentags_lt_10: gentags, tagcount_lt_10: tagcount };
    }
async fetchPromotionDate(userName) {
      const history2 = await this.getPromotionHistory({ name: userName });
      const targetRoles = ["Approver", "Moderator", "Admin"];
      const promoEvent = history2.find(
        (h) => targetRoles.some((r) => h.role.includes(r))
      );
      if (promoEvent) {
        return promoEvent.date.toISOString().slice(0, 10);
      }
      return null;
    }
async getPromotionHistory(userInfo) {
      if (!userInfo.name) return [];
      try {
        const normalizedName = userInfo.name.replace(/ /g, "_");
        const url = `/user_feedbacks.json?commit=Search&search%5Bbody_matches%5D=promoted&search%5Buser_name%5D=${encodeURIComponent(normalizedName)}`;
        const feedbacks = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!Array.isArray(feedbacks)) return [];
        return feedbacks.map((f) => {
          const match = f.body.match(/promoted to a (.+?) level/i);
          const role = match ? match[1] : "Unknown";
          return {
            date: new Date(f.created_at),
            role,
            rawBody: f.body
          };
        }).filter((item) => item.role !== "Unknown").sort(
          (a, b) => a.date.getTime() - b.date.getTime()
        );
      } catch (e) {
        log$8.error("Failed to fetch promotion history", { error: e });
        return [];
      }
    }
async getLevelChangeHistory(userInfo, forceRefresh = false) {
      if (!userInfo.name) return [];
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "level_change_history";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) {
          return cached.map((e) => ({ ...e, date: new Date(e.date) }));
        }
      }
      const LEVEL_HIERARCHY = [
        "Restricted",
        "Member",
        "Gold",
        "Platinum",
        "Builder",
        "Contributor",
        "Janitor",
        "Approver",
        "Moderator",
        "Admin",
        "Owner"
      ];
      const levelRank = new Map(
        LEVEL_HIERARCHY.map((l, i) => [l.toLowerCase(), i])
      );
      const parse = (body) => {
        const found = [];
        const bodyLower = body.toLowerCase();
        for (const level of LEVEL_HIERARCHY) {
          if (bodyLower.includes(level.toLowerCase()) && !found.includes(level)) {
            found.push(level);
          }
        }
        if (found.length < 2) return null;
        const isPromotion = /promot/i.test(body);
        const sorted = found.slice(0, 2).sort(
          (a, b) => (levelRank.get(a.toLowerCase()) ?? 0) - (levelRank.get(b.toLowerCase()) ?? 0)
        );
        const [lower, higher] = sorted;
        return isPromotion ? { fromLevel: lower, toLevel: higher, isPromotion: true } : { fromLevel: higher, toLevel: lower, isPromotion: false };
      };
      try {
        const base = `/user_feedbacks.json?commit=Search&search[category]=neutral&search[user_name]=${encodeURIComponent(normalizedName)}`;
        const [promoted, demoted] = await Promise.all([
          this.rateLimiter.fetch(`${base}&search[body_matches]=promoted+to+from`).then((r) => r.json()),
          this.rateLimiter.fetch(`${base}&search[body_matches]=demoted+to+from`).then((r) => r.json())
        ]);
        const all = [
          ...Array.isArray(promoted) ? promoted : [],
          ...Array.isArray(demoted) ? demoted : []
        ];
        const events = [];
        for (const fb of all) {
          const body = fb.body || "";
          const parsed = parse(body);
          if (!parsed) continue;
          events.push({
            date: new Date(fb.created_at),
            fromLevel: parsed.fromLevel,
            toLevel: parsed.toLevel,
            isPromotion: parsed.isPromotion
          });
        }
        events.sort((a, b) => a.date.getTime() - b.date.getTime());
        const seen = new Set();
        const dedup = events.filter((e) => {
          const key = `${e.date.getTime()}-${e.fromLevel}-${e.toLevel}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (uploaderId) await this.saveStats(cacheKey, uploaderId, dedup);
        return dedup;
      } catch (e) {
        log$8.warn("Failed to fetch level change history", { error: e });
        return [];
      }
    }
async getTimelineMilestones(userInfo) {
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (!uploaderId) return [];
      const total = await this.db.posts.where("uploader_id").equals(uploaderId).count();
      if (total === 0) return [];
      const targets = [];
      if (total >= 100) targets.push(100);
      if (total >= 1e3) targets.push(1e3);
      for (let i = 1e4; i <= total; i += 1e4) targets.push(i);
      if (targets.length === 0) return [];
      const matches = await this.db.posts.where("[uploader_id+no]").anyOf(targets.map((no) => [uploaderId, no])).toArray();
      const map = new Map(matches.map((p) => [p.no, p]));
      return targets.map((t) => {
        const p = map.get(t);
        if (!p || !p.created_at) return null;
        return { index: t, date: new Date(p.created_at) };
      }).filter(Boolean);
    }
async getCommentaryDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      if (reportSubStatus) reportSubStatus("Fetching Commentary Distribution...");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "commentary_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const categories = [
        {
          name: "Commentary",
          tagName: "commentary",
          query: `user:${normalizedName} commentary`,
          color: "#007bff"
        },
        {
          name: "Requested",
          tagName: "commentary_request",
          query: `user:${normalizedName} commentary_request`,
          color: "#ffc107"
        },
        {
          name: "Untagged",
          tagName: "untagged_commentary",
          query: `user:${normalizedName} has:commentary -commentary -commentary_request`,
          color: "#6c757d"
        }
      ];
      const results = categories.map((cat) => ({
        name: cat.name,
        tagName: cat.tagName,
        count: 0,
        frequency: 0,
        thumb: null,
        isOther: false,
        color: cat.color
      }));
      await this.mapConcurrent(
        categories.map((cat, i) => ({ ...cat, idx: i })),
        3,
        async (item) => {
          if (reportSubStatus)
            reportSubStatus(`Fetching Commentary: ${item.name}`);
          try {
            const url = `/counts/posts.json?tags=${encodeURIComponent(item.query)}`;
            const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
            if (resp?.counts?.posts) results[item.idx].count = resp.counts.posts;
          } catch (e) {
            log$8.debug("Failed to fetch commentary count", { error: e });
          }
        }
      );
      const filtered = results.filter((r) => r.count > 0);
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);
      return filtered;
    }
async getTranslationDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      if (reportSubStatus)
        reportSubStatus("Fetching Translation Distribution...");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "translation_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const categories = [
        {
          name: "Translated",
          tagName: "translated",
          query: `user:${normalizedName} translated`,
          color: "#28a745"
        },
        {
          name: "Requested",
          tagName: "translation_request",
          query: `user:${normalizedName} translation_request`,
          color: "#ffc107"
        },
        {
          name: "Untagged",
          tagName: "untagged_translation",
          useInclusionExclusion: true,
          color: "#6c757d"
        }
      ];
      const results = categories.map((cat) => ({
        name: cat.name,
        tagName: cat.tagName,
        count: 0,
        frequency: 0,
        thumb: null,
        isOther: false,
        color: cat.color
      }));
      const fetchCount = async (query) => {
        try {
          const url = `/counts/posts.json?tags=${encodeURIComponent(query)}`;
          const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
          return resp?.counts?.posts ?? 0;
        } catch {
          return 0;
        }
      };
      await this.mapConcurrent(
        categories.map((cat, i) => ({ ...cat, idx: i })),
        3,
        async (item) => {
          if (reportSubStatus)
            reportSubStatus(`Fetching Translation: ${item.name}`);
          try {
            if (item.useInclusionExclusion) {
              const q = buildUntaggedTranslationQueries(normalizedName);
              const [t, a, b, c, ab, ac] = await Promise.all([
                fetchCount(q.t),
                fetchCount(q.a),
                fetchCount(q.b),
                fetchCount(q.c),
                fetchCount(q.ab),
                fetchCount(q.ac)
              ]);
              results[item.idx].count = computeUntaggedTranslation({
                t,
                a,
                b,
                c,
                ab,
                ac
              });
              fetchCount(q.bc).then((bc) => {
                const ratio = bc / Math.max(1, t);
                if (ratio > 5e-3) {
                  log$8.warn(
                    "Assumption-1 violation: R∩TR / T exceeds 0.5% threshold",
                    {
                      user: normalizedName,
                      ratio: `${(ratio * 100).toFixed(2)}%`,
                      bc,
                      t
                    }
                  );
                }
              }).catch(() => {
              });
            } else if (item.query) {
              const count = await fetchCount(item.query);
              if (count > 0) results[item.idx].count = count;
            }
          } catch (e) {
            log$8.debug("Failed to fetch translation count", { error: e });
          }
        }
      );
      const filtered = results.filter((r) => r.count > 0);
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);
      return filtered;
    }
async getGenderDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      if (reportSubStatus) reportSubStatus("Fetching Gender Distribution...");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "gender_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const genderCategories = [
        {
          name: "Girl",
          tagName: "girl",
          originalTag: "~1girl ~2girls ~3girls ~4girls ~5girls ~6+girls",
          subQueries: [
            "1girl",
            "2girls",
            "3girls",
            "4girls",
            "5girls",
            "6+girls"
          ].map((tag) => `user:${normalizedName} ${tag}`),
          color: "#e91e63"
        },
        {
          name: "Boy",
          tagName: "boy",
          originalTag: "~1boy ~2boys ~3boys ~4boys ~5boys ~6+boys",
          subQueries: ["1boy", "2boys", "3boys", "4boys", "5boys", "6+boys"].map(
            (tag) => `user:${normalizedName} ${tag}`
          ),
          color: "#2196f3"
        },
        {
          name: "Other",
          tagName: "other",
          originalTag: "~1other ~2others ~3others ~4others ~5others ~6+others",
          subQueries: [
            "1other",
            "2others",
            "3others",
            "4others",
            "5others",
            "6+others"
          ].map((tag) => `user:${normalizedName} ${tag}`),
          color: "#9c27b0"
        },
        {
          name: "No Humans",
          tagName: "no_humans",
          query: `user:${normalizedName} no_humans`,
          color: "#607d8b"
        }
      ];
      const results = genderCategories.map((cat) => ({
        name: cat.name,
        tagName: cat.tagName,
        originalTag: cat.originalTag,
        count: 0,
        frequency: 0,
        thumb: null,
        isOther: false,
        color: cat.color
      }));
      await this.mapConcurrent(
        genderCategories.map((cat, i) => ({ ...cat, idx: i })),
        3,
        async (item) => {
          if (reportSubStatus) reportSubStatus(`Fetching Gender: ${item.name}`);
          try {
            if (item.subQueries) {
              const counts = await Promise.all(
                item.subQueries.map(async (q) => {
                  try {
                    const url = `/counts/posts.json?tags=${encodeURIComponent(q)}`;
                    const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
                    return resp?.counts?.posts ?? 0;
                  } catch {
                    return 0;
                  }
                })
              );
              results[item.idx].count = counts.reduce((sum, n) => sum + n, 0);
            } else if (item.query) {
              const url = `/counts/posts.json?tags=${encodeURIComponent(item.query)}`;
              const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
              if (resp && resp.counts && typeof resp.counts.posts === "number") {
                results[item.idx].count = resp.counts.posts;
              }
            }
          } catch (e) {
            log$8.debug("Failed to fetch gender count", { error: e });
          }
        }
      );
      const filtered = results.filter((r) => r.count > 0);
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);
      return filtered;
    }
async getBreastsDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      if (reportSubStatus) reportSubStatus("Fetching Breasts Distribution...");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "breasts_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const breastTags = [
        "flat_chest",
        "small_breasts",
        "medium_breasts",
        "large_breasts",
        "huge_breasts",
        "gigantic_breasts"
      ];
      const results = breastTags.map((tag) => ({
        name: tag.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" "),
        tagName: tag,
        count: 0,
        frequency: 0,
        thumb: null,
        isOther: false
      }));
      await this.mapConcurrent(results, 3, async (obj) => {
        const tag = obj.tagName;
        if (reportSubStatus) reportSubStatus(`Fetching Breasts: ${obj.name}`);
        try {
          const uniqueTag = `user:${normalizedName} ${tag}`;
          const url = `/counts/posts.json?tags=${encodeURIComponent(uniqueTag)}`;
          const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
          let count = 0;
          if (resp && resp.counts && typeof resp.counts.posts === "number") {
            count = resp.counts.posts;
          }
          obj.count = count;
        } catch (e) {
          log$8.debug("Failed to fetch breasts count", { error: e });
        }
      });
      const filtered = results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);
      await this.enrichThumbnails(
        cacheKey,
        uploaderId,
        filtered,
        userInfo,
        reportSubStatus
      );
      return filtered;
    }
async getHairLengthDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      if (reportSubStatus)
        reportSubStatus("Fetching Hair Length Distribution...");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "hair_length_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const hairLengthTags = [
        "~bald ~bald_female",
        "very_short_hair",
        "short_hair",
        "medium_hair",
        "long_hair",
        "very_long_hair",
        "absurdly_long_hair"
      ];
      const results = hairLengthTags.map((tag) => {
        let label = tag;
        if (tag.includes("~bald")) label = "Bald";
        else
          label = tag.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
        return {
          name: label,
          count: 0,
          frequency: 0,
          originalTag: tag,
          thumb: null,
          isOther: false
        };
      });
      await this.mapConcurrent(results, 3, async (obj) => {
        if (reportSubStatus) reportSubStatus(`Fetching Hair Length: ${obj.name}`);
        try {
          const uniqueTag = `user:${normalizedName} ${obj.originalTag}`;
          const url = `/counts/posts.json?tags=${encodeURIComponent(uniqueTag)}`;
          const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (resp && resp.counts && typeof resp.counts.posts === "number") {
            obj.count = resp.counts.posts;
          }
        } catch (e) {
          log$8.debug("Failed to fetch count", { error: e });
        }
      });
      const filtered = results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);
      await this.enrichThumbnails(
        cacheKey,
        uploaderId,
        filtered,
        userInfo,
        reportSubStatus
      );
      return filtered;
    }
async getHairColorDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      if (reportSubStatus) reportSubStatus("Fetching Hair Color Distribution...");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "hair_color_dist";
      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const hairColorMap = [
        { tag: "black_hair", color: "#000000" },
        { tag: "brown_hair", color: "#A52A2A" },
        { tag: "blonde_hair", color: "#FFD700" },
        { tag: "red_hair", color: "#FF0000" },
        { tag: "orange_hair", color: "#FFA500" },
        { tag: "pink_hair", color: "#FFC0CB" },
        { tag: "purple_hair", color: "#800080" },
        { tag: "green_hair", color: "#008000" },
        { tag: "blue_hair", color: "#0000FF" },
        { tag: "aqua_hair", color: "#00FFFF" },
        { tag: "grey_hair", color: "#808080" },
        { tag: "white_hair", color: "#FFFFFF" }
      ];
      const results = hairColorMap.map((item) => ({
        name: item.tag.split("_")[0].charAt(0).toUpperCase() + item.tag.split("_")[0].slice(1) + " Hair",
        count: 0,
        frequency: 0,
        color: item.color,
        originalTag: item.tag,
        thumb: null,
        isOther: false
      }));
      await this.mapConcurrent(results, 3, async (obj) => {
        if (reportSubStatus) reportSubStatus(`Fetching Hair Color: ${obj.name}`);
        try {
          const uniqueTag = `user:${normalizedName} ${obj.originalTag}`;
          const url = `/counts/posts.json?tags=${encodeURIComponent(uniqueTag)}`;
          const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (resp && resp.counts && typeof resp.counts.posts === "number") {
            obj.count = resp.counts.posts;
          }
        } catch (e) {
          log$8.debug("Failed to fetch count", { error: e });
        }
      });
      const filtered = results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);
      await this.enrichThumbnails(
        cacheKey,
        uploaderId,
        filtered,
        userInfo,
        reportSubStatus
      );
      return filtered;
    }
    async enrichThumbnails(cacheKey, uploaderId, items, userInfo, _statusCallback = null) {
      let hasUpdates = false;
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const toFetch = items.filter((i) => !i.isOther && !i.thumb);
      if (toFetch.length === 0) return;
      await this.mapConcurrent(toFetch, 2, async (item) => {
        const tagPart = item.tagName || item.originalTag;
        if (!tagPart) return;
        let queryTags;
        if (cacheKey === "fav_copyright_dist") {
          queryTags = `fav:${normalizedName} ${tagPart} rating:g order:score`;
        } else {
          queryTags = `user:${normalizedName} ${tagPart} order:score rating:g`;
        }
        const thumb = await this.fetchThumbnailWithRetry(queryTags);
        if (thumb) {
          item.thumb = thumb;
          hasUpdates = true;
        }
      });
      if (hasUpdates && uploaderId) {
        await this.saveStats(cacheKey, uploaderId, items);
        window.dispatchEvent(
          new CustomEvent("DanbooruInsights:DataUpdated", {
            detail: { contentType: cacheKey, userId: uploaderId, data: items }
          })
        );
      }
    }
async getTotalPostCount(userInfo) {
      if (!userInfo.name) return 0;
      try {
        const normalizedName = userInfo.name.replace(/ /g, "_");
        const countUrl = `/counts/posts.json?tags=user:${encodeURIComponent(normalizedName)}`;
        const countData = await this.rateLimiter.fetch(countUrl).then((r) => r.json());
        if (countData && typeof countData.counts === "object" && typeof countData.counts.posts === "number") {
          return countData.counts.posts;
        }
      } catch (e) {
        log$8.warn("Counts API failed", { error: e });
      }
      try {
        const profileUrl = `/users/${userInfo.id}.json`;
        const profile = await this.rateLimiter.fetch(profileUrl).then((r) => r.json());
        if (profile && typeof profile.post_upload_count === "number") {
          return profile.post_upload_count;
        }
      } catch (_e2) {
        log$8.debug("Failed to fetch user profile", { error: _e2 });
      }
      try {
        const statsLink = document.querySelector(
          "#danbooru-grass-wrapper > div:nth-child(1) > table > tbody > tr:nth-child(6) > td > a:nth-child(1)"
        );
        if (statsLink) {
          return parseInt((statsLink.textContent ?? "").replace(/,/g, ""), 10);
        }
      } catch (_e3) {
        log$8.debug("Failed to parse DOM stats", { error: _e3 });
      }
      return 0;
    }
async syncAllPosts(userInfo, onProgress) {
      if (!userInfo.id) {
        log$8.error("User ID required for sync");
        return;
      }
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (AnalyticsDataManager.isGlobalSyncing) {
        log$8.warn("Sync already in progress");
        return;
      }
      AnalyticsDataManager.isGlobalSyncing = true;
      AnalyticsDataManager.syncProgress = { current: 0, total: 0, message: "" };
      AnalyticsDataManager.onProgressCallback = onProgress;
      const reportProgress = (c, t, msg = "") => {
        AnalyticsDataManager.syncProgress = { current: c, total: t, message: msg };
        if (AnalyticsDataManager.onProgressCallback) {
          AnalyticsDataManager.onProgressCallback(c, t, msg);
        }
        if (onProgress) onProgress(c, t, msg);
      };
      const perfStats = {
        totalPosts: 0,
        startId: 0,
        initialCurrentNo: 0,
        pagesCommitted: 0,
        finalCurrentNo: 0
      };
      perfLogger.start("dbi:db:sync:full:total");
      try {
        const total = await perfLogger.wrap(
          "dbi:db:sync:full:countQuery",
          () => this.getTotalPostCount(userInfo)
        );
        perfStats.totalPosts = total;
        perfLogger.start("dbi:db:sync:full:resumeCheck");
        const newestArr = await this.db.posts.where("uploader_id").equals(uploaderId).reverse().limit(1).toArray();
        let startId = 0;
        if (newestArr.length > 0) {
          const newest = newestArr[0];
          const newestDate = new Date(newest.created_at);
          const cutOffDate = new Date(newestDate);
          cutOffDate.setMonth(cutOffDate.getMonth() - 1);
          let cutOffFound = false;
          await this.db.posts.where("uploader_id").equals(uploaderId).reverse().until(() => cutOffFound).each((p) => {
            if (new Date(p["created_at"]) < cutOffDate) {
              startId = p["id"];
              cutOffFound = true;
            }
          });
        }
        let currentNo = 0;
        if (startId > 0) {
          currentNo = await this.db.posts.where("uploader_id").equals(uploaderId).filter((p) => p["id"] <= startId).count();
        }
        perfStats.startId = startId;
        perfStats.initialCurrentNo = currentNo;
        perfLogger.end("dbi:db:sync:full:resumeCheck", {
          startId,
          initialCurrentNo: currentNo,
          hasHistory: newestArr.length > 0
        });
        if (startId === 0 && total > 0 && currentNo >= total) {
          reportProgress(currentNo, total);
          return;
        }
        const limit = 200;
        let pageOffset = 1;
        const MAX_CONCURRENCY = 5;
        const WORKER_DELAY = 400;
        let hasMore = true;
        const buffer = new Map();
        let nextExpectedPage = 1;
        const worker = async (workerId) => {
          const workerLabel = `dbi:db:sync:full:worker.${workerId}`;
          const pageLabel = `dbi:db:sync:full:page.w${workerId}`;
          const bulkPutLabel = `dbi:db:sync:full:bulkPut.w${workerId}`;
          let pagesFetched = 0;
          let pagesCommittedByWorker = 0;
          perfLogger.start(workerLabel);
          if (workerId > 0) await new Promise((r) => setTimeout(r, workerId * 200));
          try {
            while (hasMore) {
              const currentPage = pageOffset++;
              perfLogger.start(pageLabel);
              let pageFetchedCount = 0;
              let pageAttempts = 0;
              try {
                const params = {
                  limit: String(limit),
                  page: String(currentPage),
                  tags: `user:${userInfo.name.replace(/ /g, "_")} order:id id:>${startId}`,
                  only: "id,uploader_id,created_at,up_score,down_score,is_deleted,is_banned,rating,tag_count_general,variants,preview_file_url"
                };
                const q = new URLSearchParams(params);
                const url = `/posts.json?${q.toString()}`;
                const pending = buffer.size;
                reportProgress(
                  currentNo,
                  total,
                  `Fetching Page ${currentPage} (Pending: ${pending})...`
                );
                let items = null;
                let attempts = 0;
                while (attempts < 3) {
                  try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3e4);
                    const fetchResp = await this.rateLimiter.fetch(url, {
                      signal: controller.signal
                    });
                    clearTimeout(timeoutId);
                    if (!fetchResp.ok)
                      throw new Error(`HTTP ${fetchResp.status}`);
                    items = await fetchResp.json();
                    break;
                  } catch (err) {
                    attempts++;
                    const errMsg = err instanceof Error ? err.message : String(err);
                    const isServerErr = errMsg.includes("500") || errMsg.includes("502") || errMsg.includes("503") || errMsg.includes("504");
                    workerLog.warn("Page fetch attempt failed", {
                      workerId,
                      page: currentPage,
                      attempt: attempts,
                      error: errMsg
                    });
                    if (attempts >= 3 || !isServerErr) throw err;
                    await new Promise(
                      (r) => setTimeout(r, 1e3 * Math.pow(2, attempts - 1))
                    );
                  }
                }
                pageAttempts = attempts + 1;
                if (!items || items.length === 0) {
                  hasMore = false;
                  return;
                }
                pageFetchedCount = items.length;
                pagesFetched++;
                buffer.set(currentPage, items);
                while (buffer.has(nextExpectedPage)) {
                  const batchItems = buffer.get(nextExpectedPage);
                  buffer.delete(nextExpectedPage);
                  if (batchItems && batchItems.length > 0) {
                    const bulkData = batchItems.map((p) => {
                      const ds = p.down_score ?? 0;
                      const us = p.up_score ?? 0;
                      return {
                        id: p.id,
                        uploader_id: p.uploader_id,
                        created_at: p.created_at,
                        score: us + ds,
                        up_score: us,
                        down_score: ds,
                        is_deleted: p.is_deleted ?? false,
                        is_banned: p.is_banned ?? false,
                        rating: p.rating,
                        tag_count_general: p.tag_count_general ?? 0,
                        variants: p.variants,
                        preview_file_url: p.preview_file_url,
                        no: ++currentNo
                      };
                    });
                    perfLogger.start(bulkPutLabel);
                    await bulkPutSafe(
                      this.db.posts,
                      bulkData,
                      () => evictOldestNonCurrentUser(this.db, uploaderId)
                    );
                    perfLogger.end(bulkPutLabel, {
                      workerId,
                      page: nextExpectedPage,
                      count: bulkData.length
                    });
                    pagesCommittedByWorker++;
                    perfStats.pagesCommitted++;
                    reportProgress(
                      currentNo,
                      total > currentNo ? total : currentNo
                    );
                  }
                  nextExpectedPage++;
                }
              } catch (e) {
                workerLog.error("Page failed, stopping sync", {
                  workerId,
                  page: currentPage,
                  error: e
                });
                hasMore = false;
              } finally {
                perfLogger.end(pageLabel, {
                  workerId,
                  page: currentPage,
                  fetched: pageFetchedCount,
                  attempts: pageAttempts
                });
              }
              if (hasMore) {
                await new Promise((r) => setTimeout(r, WORKER_DELAY));
              }
            }
          } finally {
            perfLogger.end(workerLabel, {
              workerId,
              pagesFetched,
              pagesCommittedByWorker
            });
          }
        };
        const workers = [];
        for (let i = 0; i < MAX_CONCURRENCY; i++) {
          workers.push(worker(i));
        }
        await Promise.all(workers);
        const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
        localStorage.setItem(lastSyncKey, ( new Date()).toISOString());
        if (startId === 0) {
          localStorage.setItem(`di_post_metadata_v2_${uploaderId}`, "1");
        }
        await this.cleanupStaleData(userInfo.id);
        reportProgress(total, total, "PREPARING");
        await this.refreshAllStats(userInfo, startId === 0);
        perfStats.finalCurrentNo = currentNo;
        await requestPersistence();
      } finally {
        perfLogger.end("dbi:db:sync:full:total", perfStats);
        AnalyticsDataManager.isGlobalSyncing = false;
        AnalyticsDataManager.onProgressCallback = null;
      }
    }
async quickSyncAllPosts(userInfo, onProgress) {
      if (!userInfo.id || !userInfo.name) return;
      if (AnalyticsDataManager.isGlobalSyncing) {
        log$8.warn("Sync already in progress");
        return;
      }
      AnalyticsDataManager.isGlobalSyncing = true;
      AnalyticsDataManager.syncProgress = { current: 0, total: 0, message: "" };
      AnalyticsDataManager.onProgressCallback = onProgress || null;
      const reportProgress = (c, t, msg = "") => {
        AnalyticsDataManager.syncProgress = { current: c, total: t, message: msg };
        if (AnalyticsDataManager.onProgressCallback) {
          AnalyticsDataManager.onProgressCallback(c, t, msg);
        }
        if (onProgress) onProgress(c, t, msg);
      };
      const perfStats = { totalPosts: 0, pages: 0, writtenPosts: 0 };
      perfLogger.start("dbi:db:sync:quick:total");
      try {
        const uploaderId = parseInt(userInfo.id ?? "0");
        const normalizedName = userInfo.name.replace(/ /g, "_");
        const total = await perfLogger.wrap(
          "dbi:db:sync:quick:countQuery",
          () => this.getTotalPostCount(userInfo)
        );
        perfStats.totalPosts = total;
        reportProgress(0, total, "Fetching posts...");
        await this.db.posts.where("uploader_id").equals(uploaderId).delete();
        const limit = 200;
        let page = "a0";
        let hasMore = true;
        let no = 0;
        while (hasMore) {
          perfLogger.start("dbi:db:sync:quick:page");
          const pageIndex = perfStats.pages;
          const params = new URLSearchParams({
            tags: `user:${normalizedName}`,
            limit: String(limit),
            page,
            only: "id,uploader_id,created_at,up_score,down_score,is_deleted,is_banned,rating,tag_count_general,variants,preview_file_url"
          });
          const url = `/posts.json?${params.toString()}`;
          reportProgress(no, total, `Fetching posts (${no}/${total})...`);
          const batch = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (!Array.isArray(batch) || batch.length === 0) {
            perfLogger.end("dbi:db:sync:quick:page", {
              page: pageIndex,
              cursor: page,
              fetched: 0,
              empty: true
            });
            hasMore = false;
            break;
          }
          if (batch.length > 1 && batch[0].id > batch[batch.length - 1].id) {
            batch.reverse();
          }
          const bulkData = batch.map((p) => {
            const ds = p.down_score ?? 0;
            const us = p.up_score ?? 0;
            return {
              id: p.id,
              uploader_id: p.uploader_id,
              created_at: p.created_at,
              score: us + ds,
              up_score: us,
              down_score: ds,
              is_deleted: p.is_deleted ?? false,
              is_banned: p.is_banned ?? false,
              rating: p.rating,
              tag_count_general: p.tag_count_general ?? 0,
              variants: p.variants,
              preview_file_url: p.preview_file_url,
              no: ++no
            };
          });
          perfLogger.start("dbi:db:sync:quick:bulkPut");
          await bulkPutSafe(
            this.db.posts,
            bulkData,
            () => evictOldestNonCurrentUser(this.db, uploaderId)
          );
          perfLogger.end("dbi:db:sync:quick:bulkPut", { count: bulkData.length });
          reportProgress(no, total);
          perfStats.pages++;
          perfStats.writtenPosts += bulkData.length;
          perfLogger.end("dbi:db:sync:quick:page", {
            page: pageIndex,
            cursor: page,
            fetched: batch.length
          });
          if (batch.length < limit) {
            hasMore = false;
          } else {
            page = `a${batch[batch.length - 1].id}`;
          }
        }
        const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
        localStorage.setItem(lastSyncKey, ( new Date()).toISOString());
        localStorage.setItem(`di_post_metadata_v2_${uploaderId}`, "1");
        await this.cleanupStaleData(userInfo.id);
        reportProgress(no, no, "PREPARING");
        await this.refreshAllStats(userInfo, true);
        await requestPersistence();
      } finally {
        perfLogger.end("dbi:db:sync:quick:total", perfStats);
        AnalyticsDataManager.isGlobalSyncing = false;
        AnalyticsDataManager.onProgressCallback = null;
      }
    }
async cleanupStaleData(currentUserId) {
      const currentId = typeof currentUserId === "number" ? currentUserId : parseInt(currentUserId);
      const THRESHOLD = CONFIG.ANALYTICS_CLEANUP_THRESHOLD_MS;
      const now = ( new Date()).getTime();
      try {
        const allIds = await this.db.posts.orderBy("uploader_id").uniqueKeys();
        for (const uid of allIds) {
          if (uid === currentId) continue;
          const syncKey = `danbooru_grass_last_sync_${uid}`;
          const lastSyncStr = localStorage.getItem(syncKey);
          let shouldDelete = false;
          if (!lastSyncStr) {
            shouldDelete = true;
          } else {
            const lastDate = new Date(lastSyncStr).getTime();
            if (now - lastDate > THRESHOLD) {
              shouldDelete = true;
            }
          }
          if (shouldDelete) {
            await this.db.posts.where("uploader_id").equals(uid).delete();
            await this.db.piestats.where("userId").equals(uid).delete();
            localStorage.removeItem(syncKey);
          }
        }
      } catch (e) {
        log$8.warn("Stale data cleanup failed", { error: e });
      }
    }
async refreshAllStats(userInfo, isFullSync = false) {
      const forceRefresh = true;
      const progressReporter = (msg) => {
        const { current, total } = AnalyticsDataManager.syncProgress;
        if (typeof AnalyticsDataManager.onProgressCallback === "function") {
          AnalyticsDataManager.onProgressCallback(current, total, msg);
        }
      };
      perfLogger.start("dbi:db:refresh:total");
      try {
        await Promise.all([
          perfLogger.wrap(
            "dbi:db:refresh:status",
            () => this.getStatusDistribution(userInfo, null, true)
          ),
          perfLogger.wrap(
            "dbi:db:refresh:rating",
            () => this.getRatingDistribution(userInfo, null, true)
          ),
          perfLogger.wrap(
            "dbi:db:refresh:character",
            () => this.getCharacterDistribution(
              userInfo,
              forceRefresh,
              progressReporter
            )
          ),
          perfLogger.wrap(
            "dbi:db:refresh:copyright",
            () => this.getCopyrightDistribution(
              userInfo,
              forceRefresh,
              progressReporter
            )
          ),
          perfLogger.wrap(
            "dbi:db:refresh:favCopyright",
            () => this.getFavCopyrightDistribution(userInfo, forceRefresh)
          ),
          perfLogger.wrap(
            "dbi:db:refresh:breasts",
            () => this.getBreastsDistribution(userInfo, forceRefresh, progressReporter)
          ),
          perfLogger.wrap(
            "dbi:db:refresh:hairLength",
            () => this.getHairLengthDistribution(
              userInfo,
              forceRefresh,
              progressReporter
            )
          ),
          perfLogger.wrap(
            "dbi:db:refresh:hairColor",
            () => this.getHairColorDistribution(
              userInfo,
              forceRefresh,
              progressReporter
            )
          ),
perfLogger.wrap(
            "dbi:db:refresh:randomPosts",
            () => this.getRandomPosts(userInfo)
          ),


perfLogger.wrap(
            "dbi:db:refresh:levelChanges",
            () => this.getLevelChangeHistory(userInfo, true)
          ),

perfLogger.wrap(
            "dbi:db:refresh:milestonesSfw",
            () => this.getMilestones(userInfo, false, 1e3, true)
          ),
          perfLogger.wrap(
            "dbi:db:refresh:milestonesNsfw",
            () => this.getMilestones(userInfo, true, 1e3, true)
          ),
...isFullSync ? [
            perfLogger.wrap(
              "dbi:db:refresh:topPostsByType",
              () => this.getTopPostsByType(userInfo, true)
            ),
            perfLogger.wrap(
              "dbi:db:refresh:recentPopular",
              () => this.getRecentPopularPosts(userInfo, true)
            ),
            perfLogger.wrap(
              "dbi:db:refresh:topScoreSfw",
              () => this.getTopScorePost(userInfo, "sfw")
            ),
            perfLogger.wrap(
              "dbi:db:refresh:topScoreNsfw",
              () => this.getTopScorePost(userInfo, "nsfw")
            )
          ] : []
        ]);
      } catch (e) {
        log$8.warn("Failed to refresh stats", { error: e });
      } finally {
        perfLogger.end("dbi:db:refresh:total", { isFullSync });
      }
    }
async clearUserData(userInfo) {
      if (!userInfo.id) return;
      const uploaderId = parseInt(userInfo.id ?? "0");
      await this.db.posts.where("uploader_id").equals(uploaderId).delete();
      await this.db.piestats.where("userId").equals(uploaderId).delete();
      const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
      localStorage.removeItem(lastSyncKey);
    }
  }
  async function swrStats(dataManager, cacheKey, uploaderId, freshFetch, label) {
    if (!uploaderId) {
      const data2 = await perfLogger.wrap(label, freshFetch);
      return { data: data2 };
    }
    const cached = await dataManager.getStats(cacheKey, uploaderId);
    if (cached !== null) {
      const startRevalidate = () => perfLogger.wrap(`${label}.revalidate`, freshFetch).then((fresh) => {
        const same = JSON.stringify(fresh) === JSON.stringify(cached);
        return same ? null : fresh;
      });
      return { data: cached, startRevalidate };
    }
    const data = await perfLogger.wrap(label, freshFetch);
    return { data };
  }
  class UserAnalyticsDataService {
    db;
    constructor(db) {
      this.db = db;
    }
async fetchDashboardData(context, prefetched) {
      const dataManager = new AnalyticsDataManager(this.db);
      const user = context.targetUser;
      const nsfwKey = "danbooru_grass_nsfw_enabled";
      const isNsfwEnabled = localStorage.getItem(nsfwKey) === "true";
      const summaryStats = await perfLogger.wrap(
        "dbi:net:fetchData:summaryStats",
        () => dataManager.getSummaryStats(user)
      );
      const { firstUploadDate } = summaryStats;
      const randomPostsPromise = perfLogger.wrap(
        "dbi:net:fetchData:randomPosts",
        () => dataManager.getRandomPosts(user)
      );
      const uploaderId = parseInt(user.id ?? "0");
      const [
        stats,
        total,
        otherDistributions,
        statusSwr,
        ratingSwr,
        topPostsSwr,
        recentPopularSwr,
        milestones1kSwr,
        scatterData,
        levelChangesSwr,
        timelineMilestones,
        tagCloudGeneral,
        userStats,
        needsBackfill
      ] = await Promise.all([
        prefetched ? Promise.resolve(prefetched.syncStats) : perfLogger.wrap(
          "dbi:net:fetchData:syncStats",
          () => dataManager.getSyncStats(user)
        ),
        prefetched ? Promise.resolve(prefetched.totalCount) : perfLogger.wrap(
          "dbi:net:fetchData:totalCount",
          () => dataManager.getTotalPostCount(user)
        ),


perfLogger.wrap(
          "dbi:net:fetchData:distributions",
          () => Promise.all([
            dataManager.getCharacterDistribution(user),
            dataManager.getCopyrightDistribution(user),
            dataManager.getFavCopyrightDistribution(user),
            dataManager.getBreastsDistribution(user),
            dataManager.getHairLengthDistribution(user),
            dataManager.getHairColorDistribution(user),
            dataManager.getGenderDistribution(user),
            dataManager.getCommentaryDistribution(user),
            dataManager.getTranslationDistribution(user)
          ]).then(
            ([
              char,
              copy,
              favCopy,
              breasts,
              hairL,
              hairC,
              gender,
              commentary,
              translation
            ]) => ({
              character: char,
              copyright: copy,
              fav_copyright: favCopy,
              breasts,
              hair_length: hairL,
              hair_color: hairC,
              gender,
              commentary,
              translation
            })
          )
        ),


swrStats(
          dataManager,
          "status_dist",
          uploaderId,
          () => dataManager.getStatusDistribution(user, firstUploadDate, true),
          "dbi:net:fetchData:status"
        ),
        swrStats(
          dataManager,
          "rating_dist",
          uploaderId,
          () => dataManager.getRatingDistribution(user, firstUploadDate, true),
          "dbi:net:fetchData:rating"
        ),


swrStats(
          dataManager,
          "top_posts_by_type",
          uploaderId,
          () => dataManager.getTopPostsByType(user, true),
          "dbi:net:fetchData:topPosts"
        ),
        swrStats(
          dataManager,
          "recent_popular_posts",
          uploaderId,
          () => dataManager.getRecentPopularPosts(user, true),
          "dbi:net:fetchData:recentPopular"
        ),
        swrStats(
          dataManager,
          `milestones_1000_${isNsfwEnabled ? "1" : "0"}`,
          uploaderId,
          () => dataManager.getMilestones(user, isNsfwEnabled, 1e3, true),
          "dbi:net:fetchData:milestones1k"
        ),
        perfLogger.wrap(
          "dbi:net:fetchData:scatterData",
          () => dataManager.getScatterData(user)
        ),
        swrStats(
          dataManager,
          "level_change_history",
          uploaderId,
          () => dataManager.getLevelChangeHistory(user, true),
          "dbi:net:fetchData:levelChanges"
        ),
        perfLogger.wrap(
          "dbi:net:fetchData:timelineMilestones",
          () => dataManager.getTimelineMilestones(user)
        ),
        perfLogger.wrap(
          "dbi:net:fetchData:tagCloudGeneral",
          () => dataManager.getTagCloudData(user, 0)
        ),
        perfLogger.wrap(
          "dbi:net:fetchData:userStats",
          () => dataManager.getUserStats(user)
        ),
        perfLogger.wrap(
          "dbi:net:fetchData:needsBackfill",
          () => dataManager.needsPostMetadataBackfill(user)
        )
      ]);
      const distributions = {
        status: statusSwr.data,
        rating: ratingSwr.data,
        ...otherDistributions
      };
      return {
        stats,
        total,
        summaryStats,
        distributions,
        statusStartRevalidate: statusSwr.startRevalidate,
        ratingStartRevalidate: ratingSwr.startRevalidate,
        topPosts: topPostsSwr.data,
        topPostsStartRevalidate: topPostsSwr.startRevalidate,
        recentPopularPosts: recentPopularSwr.data,
        recentPopularStartRevalidate: recentPopularSwr.startRevalidate,
        randomPostsPromise,
        milestones1k: milestones1kSwr.data,
        milestones1kStartRevalidate: milestones1kSwr.startRevalidate,
        scatterData,
        levelChanges: levelChangesSwr.data,
        levelChangesStartRevalidate: levelChangesSwr.startRevalidate,
        timelineMilestones,
        tagCloudGeneral,
        userStats,
        needsBackfill,
        dataManager
      };
    }
  }
  function buildSearchQuery(details, fallbackLabel, targetName, tab) {
    if (!targetName) return null;
    switch (details.kind) {
      case "rating":
        if (!details.rating) return null;
        return `user:${targetName} rating:${details.rating}`;
      case "status":
        if (!details.name) return null;
        return `user:${targetName} status:${details.name}`;
      case "tag": {
        if (tab === "fav_copyright") {
          const tag2 = details.tagName || fallbackLabel;
          if (!tag2) return null;
          return `ordfav:${targetName} ${tag2}`;
        }
        let tag;
        if (details.originalTag) tag = details.originalTag;
        else if (details.tagName === "untagged_commentary")
          tag = "has:commentary -commentary -commentary_request";
        else if (details.tagName === "untagged_translation")
          tag = "*_text -english_text -translation_request -translated";
        else if (details.tagName) tag = details.tagName;
        else tag = fallbackLabel.toLowerCase().replace(/ /g, "_");
        if (!tag) return null;
        return `user:${targetName} ${tag}`;
      }
    }
  }
  function computePercentages(values, decimals = 1) {
    const n = values.length;
    if (n === 0) return [];
    const total = values.reduce(
      (acc, v) => acc + (Number.isFinite(v) ? v : 0),
      0
    );
    if (total <= 0) return values.map(() => 0 .toFixed(decimals) + "%");
    const factor = 10 ** decimals;
    const target = 100 * factor;
    const scaled = values.map((v) => {
      if (!Number.isFinite(v) || v < 0) return 0;
      return v / total * target;
    });
    const floored = scaled.map((s) => Math.floor(s));
    const sum = floored.reduce((a, b) => a + b, 0);
    let remainder = target - sum;
    const order = scaled.map((s, i) => ({ i, frac: s - Math.floor(s) })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < order.length && remainder > 0; k++) {
      floored[order[k].i] += 1;
      remainder--;
    }
    return floored.map((v) => (v / factor).toFixed(decimals) + "%");
  }
  function safeColor(c) {
    const s = String(c ?? "");
    return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : "#999";
  }
  function safeThumbUrl(u) {
    const s = String(u ?? "");
    return /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*donmai\.us\/[^\s"'<>]+$/i.test(
      s
    ) ? s : null;
  }
  function pickFittingPosition(candidates, width, height, bounds) {
    for (const c of candidates) {
      if (c.left >= bounds.minLeft && c.left + width <= bounds.maxRight && c.top >= bounds.minTop && c.top + height <= bounds.maxBottom) {
        return c;
      }
    }
    return null;
  }
  const log$7 = createLogger("UserAnalyticsCharts");
  const PIE_SVG_SIZE = 220;
  const PIE_RADIUS = 70;
  function renderPieWidget(container2, distributions, initialNsfwEnabled, dataManager, context, firstUploadDate) {
    const pieData = { ...distributions };
    let currentPieTab = "copyright";
    let renderPending = false;
    let isNsfwEnabled = initialNsfwEnabled;
    for (const key of ["breasts", "gender", "commentary", "translation"]) {
      if (pieData[key]) {
        const data = pieData[key];
        const total = data.reduce(
          (acc, c) => acc + c.count,
          0
        );
        pieData[key] = data.map((d) => ({
          ...d,
          frequency: total > 0 ? d.count / total : 0,
          value: total > 0 ? d.count / total : 0,
          label: d.name,
          details: { ...d, thumb: null }
        }));
      }
    }
    const requestRender = () => {
      if (renderPending) return;
      renderPending = true;
      requestAnimationFrame(() => {
        renderPieContent();
        renderPending = false;
      });
    };
    const onPieDataUpdate = (e) => {
      if (!document.body.contains(container2)) {
        window.removeEventListener(
          "DanbooruInsights:DataUpdated",
          onPieDataUpdate
        );
        return;
      }
      const { contentType, data } = e.detail;
      const keyMap = {
        character_dist: "character",
        copyright_dist: "copyright",
        fav_copyright_dist: "fav_copyright",
        breasts_dist: "breasts",
        hair_length_dist: "hair_length",
        hair_color_dist: "hair_color",
        rating_dist: "rating"
      };
      const key = keyMap[contentType];
      if (key && pieData[key]) {
        const incomingMap = new Map(
          data.map((d) => [d.name, d])
        );
        const currentData = pieData[key];
        currentData.forEach((item) => {
          const update = incomingMap.get(item.name);
          if (update && update.thumb && item.thumb !== update.thumb) {
            item.thumb = update.thumb;
            const withDetails = item;
            if (withDetails.details) withDetails.details.thumb = update.thumb;
          }
        });
        if (currentPieTab === key) {
          requestRender();
        }
      }
    };
    window.addEventListener("DanbooruInsights:DataUpdated", onPieDataUpdate);
    const handlePieClick = (d) => {
      const targetName = context.targetUser.normalizedName || context.targetUser.name.replace(/ /g, "_") || "";
      const query = buildSearchQuery(
        d.data.details,
        d.data.label,
        targetName,
        currentPieTab
      );
      if (!query) return;
      window.open(
        `/posts?tags=${encodeURIComponent(query)}`,
        "_blank",
        "noopener,noreferrer"
      );
    };
    const renderPieContent = () => {
      const isTouch = isTouchDevice();
      const contextUser = context.targetUser;
      const data = pieData[currentPieTab];
      const pieContent = container2.querySelector(".pie-content");
      if (!data) {
        pieContent.innerHTML = '<div style="color:var(--di-text-muted, #888); padding:30px; text-align:center;">Loading...</div>';
        return;
      }
      if (data.length === 0) {
        pieContent.innerHTML = '<div style="color:var(--di-text-muted, #888); padding:30px; text-align:center;">No data available</div>';
        return;
      }
      if (!contextUser.normalizedName && contextUser.name) {
        contextUser.normalizedName = contextUser.name.replace(/ /g, "_");
      }
      if (currentPieTab === "hair_length") {
        const order = [
          "Bald",
          "Very Short Hair",
          "Short Hair",
          "Medium Hair",
          "Long Hair",
          "Very Long Hair",
          "Absurdly Long Hair"
        ];
        data.sort(
          (a, b) => order.indexOf(a.name ?? "") - order.indexOf(b.name ?? "")
        );
      }
      pieContent.style.display = "flex";
      pieContent.style.flexDirection = "row";
      pieContent.style.alignItems = "center";
      pieContent.style.justifyContent = "space-around";
      const isFirefox = navigator.userAgent.includes("Firefox");
      if (!isFirefox) {
        pieContent.style.perspective = "1000px";
      }
      const ratingColors = {
        g: "#28a745",
        s: "#fd7e14",
        q: "#6f42c1",
        e: "#dc3545"
      };
      const ratingLabels = {
        g: "General",
        s: "Sensitive",
        q: "Questionable",
        e: "Explicit"
      };
      const palette = [
        "#e91e63",
        "#9c27b0",
        "#673ab7",
        "#3f51b5",
        "#2196f3",
        "#03a9f4",
        "#00bcd4",
        "#009688",
        "#4caf50",
        "#8bc34a",
        "#cddc39",
        "#ffeb3b",
        "#ffc107",
        "#ff9800",
        "#ff5722",
        "#795548"
      ];
      const processedData = data.map((d, i) => {
        const item = d;
        const tagDetails = () => ({
          kind: "tag",
          tagName: item.tagName,
          originalTag: item.originalTag,
          isOther: item.isOther,
          count: item.count,
          thumb: item.thumb,
          color: item.color,
          frequency: item.frequency,
          name: item.name
        });
        if ([
          "rating",
          "status",
          "breasts",
          "hair_length",
          "hair_color",
          "gender",
          "commentary",
          "translation"
        ].includes(currentPieTab)) {
          let details;
          if (currentPieTab === "rating") {
            details = {
              kind: "rating",
              rating: item.rating ?? "",
              count: item.count,
              label: item.label,
              thumb: item.thumb
            };
          } else if (currentPieTab === "status") {
            details = {
              kind: "status",
              name: item.name ?? "",
              count: item.count,
              label: item.label,
              thumb: item.thumb
            };
          } else {
            details = tagDetails();
          }
          return {
            value: item.count,
            label: currentPieTab === "rating" ? ratingLabels[item.rating] || item.rating || "" : item.label || item.name || "",
            color: currentPieTab === "rating" ? ratingColors[item.rating] || "#999" : currentPieTab === "hair_color" && item.color ? item.color : item.color || (item.isOther ? "#bdbdbd" : palette[i % palette.length]),
            details
          };
        } else {
          let sliceColor = item.isOther ? "#bdbdbd" : palette[i % palette.length];
          if (currentPieTab === "hair_color" && item.color) {
            sliceColor = item.color;
          }
          return {
            value: item.frequency ?? 0,
            label: item.name ?? "",
            color: sliceColor,
            details: tagDetails()
          };
        }
      });
      const validData = processedData.filter(
        (d) => Number.isFinite(d.value) && d.value > 0
      );
      const totalValue = validData.reduce(
        (acc, curr) => acc + curr.value,
        0
      );
      if (validData.length === 0 || totalValue === 0) {
        pieContent.innerHTML = '<div style="color:var(--di-text-muted, #888); padding:30px; text-align:center;">No data available (Total count is 0)</div>';
        return;
      }
      const pctStrings = computePercentages(
        validData.map((s) => s.value),
        1
      );
      const pctByLabel = new Map(
        validData.map((s, i) => [s.label, pctStrings[i]])
      );
      const pctFor = (label) => pctByLabel.get(label) ?? "0.0%";
      let chartWrapper = pieContent.querySelector(
        ".pie-chart-wrapper"
      );
      if (!chartWrapper) {
        pieContent.innerHTML = "";
        chartWrapper = document.createElement("div");
        chartWrapper.className = "pie-chart-wrapper";
        chartWrapper.style.width = `${PIE_SVG_SIZE}px`;
        chartWrapper.style.height = `${PIE_SVG_SIZE}px`;
        chartWrapper.style.cursor = "pointer";
        if (!isFirefox) {
          chartWrapper.style.transformStyle = "preserve-3d";
          chartWrapper.style.transform = "rotateX(40deg) rotateY(0deg)";
          chartWrapper.style.transition = "transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
          const shadow = document.createElement("div");
          shadow.style.position = "absolute";
          shadow.style.top = "50%";
          shadow.style.left = "50%";
          shadow.style.width = "140px";
          shadow.style.height = "140px";
          shadow.style.transform = "translate(-50%, -50%) translateZ(-10px)";
          shadow.style.borderRadius = "50%";
          shadow.style.background = "var(--di-shadow, rgba(0,0,0,0.2))";
          shadow.style.filter = "blur(5px)";
          chartWrapper.appendChild(shadow);
          chartWrapper.addEventListener("mouseenter", () => {
            chartWrapper.style.transform = "rotateX(0deg) scale(1.1)";
            shadow.style.transform = "translate(-50%, -50%) translateZ(-30px) scale(0.9)";
            shadow.style.opacity = "0.5";
          });
          chartWrapper.addEventListener("mouseleave", () => {
            chartWrapper.style.transform = "rotateX(40deg)";
            shadow.style.transform = "translate(-50%, -50%) translateZ(-10px)";
            shadow.style.opacity = "1";
          });
        } else {
          chartWrapper.style.transition = "transform 0.3s ease";
          chartWrapper.addEventListener("mouseenter", () => {
            chartWrapper.style.transform = "scale(1.05)";
          });
          chartWrapper.addEventListener("mouseleave", () => {
            chartWrapper.style.transform = "none";
          });
        }
        pieContent.appendChild(chartWrapper);
        d3__namespace.select(chartWrapper).append("svg").attr("width", PIE_SVG_SIZE).attr("height", PIE_SVG_SIZE).style("overflow", "visible").append("g").attr(
          "transform",
          `translate(${PIE_SVG_SIZE / 2},${PIE_SVG_SIZE / 2})`
        );
        const legendDiv2 = document.createElement("div");
        legendDiv2.className = "danbooru-grass-legend-scroll";
        legendDiv2.style.display = "flex";
        legendDiv2.style.flexDirection = "column";
        legendDiv2.style.marginLeft = "20px";
        legendDiv2.style.maxHeight = `${PIE_SVG_SIZE}px`;
        legendDiv2.style.overflowY = "auto";
        legendDiv2.style.paddingRight = "5px";
        const scrollbarStyle = document.createElement("style");
        scrollbarStyle.innerHTML = `
          .danbooru-grass-legend-scroll::-webkit-scrollbar { width: 6px; }
          .danbooru-grass-legend-scroll::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 3px; }
          .danbooru-grass-legend-scroll::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 3px; }
          .danbooru-grass-legend-scroll::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
       `;
        legendDiv2.appendChild(scrollbarStyle);
        pieContent.appendChild(legendDiv2);
      }
      const radius = PIE_RADIUS;
      const svg = d3__namespace.select(chartWrapper).select("svg g");
      const pie = d3__namespace.pie().value((d) => d.value).sort(null);
      const arc = d3__namespace.arc().innerRadius(0).outerRadius(radius);
      const arcHover = d3__namespace.arc().innerRadius(0).outerRadius(radius * 1.2);
      const tooltip = d3__namespace.select("body").selectAll(".danbooru-grass-pie-tooltip").data([0]).join("div").attr("class", "danbooru-grass-pie-tooltip").style("position", "absolute").style("background", "rgba(30, 30, 30, 0.95)").style("color", "#fff").style("padding", "8px 12px").style("border-radius", "6px").style("font-size", "12px").style("pointer-events", "none").style("cursor", isTouch ? "pointer" : "default").style("z-index", "2147483647").style("opacity", "0");
      const hideTooltip = () => {
        tooltip.style("opacity", 0).style("pointer-events", "none");
      };
      svg.selectAll("path").data(pie(validData), (d) => d.data.label).join(
        (enter) => enter.append("path").attr("class", "danbooru-grass-pie-path").attr("d", arc).attr("fill", (d) => d.data.color).style("opacity", "0.9").style("cursor", "pointer"),
        (update) => update.attr("class", "danbooru-grass-pie-path").attr("d", arc).call(
          (update2) => update2.transition().duration(500).attr("fill", (d) => d.data.color)
        )
      ).attr("stroke", "var(--di-chart-bg, #fff)").style("stroke-width", "1px").on("mouseover", function(event, d) {
        if (isTouch) return;
        d3__namespace.select(this).transition().duration(200).attr(
          "d",
          (td) => arcHover(td) ?? ""
        ).style("opacity", "1").style("filter", "drop-shadow(0px 0px 8px rgba(255,255,255,0.4))");
        let html = "";
        const details = d.data.details;
        const safeThumb = safeThumbUrl(details.thumb);
        const thumbHtml = safeThumb ? `
        <div style="width: 80px; height: 80px; border-radius: 4px; overflow: hidden; background: #333; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
          <img src="${escapeHtml$1(safeThumb)}" style="width: 100%; height: 100%; object-fit: cover;">
        </div>` : "";
        const sliceColor = safeColor(d.data.color);
        const safeLabel = escapeHtml$1(d.data.label);
        const isOtherSlice = details.kind === "tag" && !!details.isOther;
        if (currentPieTab === "rating") {
          html = `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div>
              <div style="font-weight: bold; color: ${sliceColor}; margin-bottom: 4px; font-size: 14px;">${safeLabel}</div>
              <div style="font-size: 11px; color: #ccc;">Count: <strong style="color:#fff;">${details.count.toLocaleString()}</strong></div>
              <div style="font-size: 11px; color: #ccc;">Ratio: <strong style="color:#fff;">${pctFor(d.data.label)}</strong></div>
            </div>
          </div>
        `;
        } else {
          const percentage = pctFor(d.data.label);
          html = `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div style="max-width: 180px;">
              <div style="font-weight: bold; color: ${sliceColor}; margin-bottom: 4px; font-size: 14px; word-wrap: break-word;">${safeLabel}</div>
              <div style="font-size: 11px; color: #ccc;">Freq: <strong style="color:#fff;">${percentage}</strong></div>
              ${!isOtherSlice ? `<div style="font-size: 11px; color: #ccc;">Posts: <strong style="color:#fff;">${details.count ? details.count.toLocaleString() : "?"}</strong></div>` : ""}
            </div>
          </div>
        `;
        }
        tooltip.html(html).style("left", event.pageX + 15 + "px").style("top", event.pageY + 15 + "px").style("opacity", 1);
      }).on("mousemove", (event) => {
        if (isTouch) return;
        tooltip.style("left", event.pageX + 15 + "px").style("top", event.pageY + 15 + "px");
      }).on("mouseout", function() {
        if (isTouch) return;
        d3__namespace.select(this).transition().duration(200).attr("d", (td) => arc(td) ?? "").style("opacity", "0.9").style("filter", "none");
        tooltip.style("opacity", 0);
      }).on("click", (_event, d) => {
        if (isTouch) return;
        handlePieClick(d);
      });
      if (isTouch) {
        const resetSlices = () => {
          svg.selectAll("path.danbooru-grass-pie-path").transition().duration(200).attr("d", (td) => arc(td) ?? "").style("opacity", "0.9").style("filter", "none");
        };
        const pieTap = createTwoStepTap({
          insideElements: () => [
            tooltip.node(),
            svg.node()
          ],
          onFirstTap: () => {
          },
          onSecondTap: (datum) => {
            handlePieClick(datum);
            hideTooltip();
            resetSlices();
          },
          onReset: () => {
            hideTooltip();
            resetSlices();
          },
          navigateOnSameTap: false
        });
        const handleSliceTouch = (event, datum) => {
          const touch = event.changedTouches[0] ?? event.touches[0];
          if (!touch || !datum.data) return;
          const target = svg.selectAll(
            "path.danbooru-grass-pie-path"
          ).filter((d) => d === datum).node();
          if (!target) return;
          resetSlices();
          pieTap.tap(datum);
          d3__namespace.select(target).transition().duration(200).attr(
            "d",
            (td) => arcHover(td) ?? ""
          ).style("opacity", "1");
          let html = "";
          const details = datum.data.details;
          const safeThumb = safeThumbUrl(details.thumb);
          const thumbHtml = safeThumb ? `
        <div style="width: 80px; height: 80px; border-radius: 4px; overflow: hidden; background: #333; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
          <img src="${escapeHtml$1(safeThumb)}" style="width: 100%; height: 100%; object-fit: cover;">
        </div>` : "";
          const sliceColor = safeColor(datum.data.color);
          const safeLabel = escapeHtml$1(datum.data.label);
          const isOtherSlice = details.kind === "tag" && !!details.isOther;
          if (currentPieTab === "rating") {
            html = `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div>
              <div style="font-weight: bold; color: ${sliceColor}; margin-bottom: 4px; font-size: 14px;">${safeLabel}</div>
              <div style="font-size: 11px; color: #ccc;">Count: <strong style="color:#fff;">${details.count.toLocaleString()}</strong></div>
              <div style="font-size: 11px; color: #ccc;">Ratio: <strong style="color:#fff;">${pctFor(datum.data.label)}</strong></div>
            </div>
          </div>`;
          } else {
            const percentage = pctFor(datum.data.label);
            html = `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div style="max-width: 180px;">
              <div style="font-weight: bold; color: ${sliceColor}; margin-bottom: 4px; font-size: 14px; word-wrap: break-word;">${safeLabel}</div>
              <div style="font-size: 11px; color: #ccc;">Freq: <strong style="color:#fff;">${percentage}</strong></div>
              ${!isOtherSlice ? `<div style="font-size: 11px; color: #ccc;">Posts: <strong style="color:#fff;">${details.count ? details.count.toLocaleString() : "?"}</strong></div>` : ""}
            </div>
          </div>`;
          }
          tooltip.html(html);
          const tooltipNode = tooltip.node();
          const tw = tooltipNode?.offsetWidth ?? 0;
          const th = tooltipNode?.offsetHeight ?? 0;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const margin = 8;
          const cardRect = container2.getBoundingClientRect();
          const wrapperRect = chartWrapper.getBoundingClientRect();
          const bounds = {
            minLeft: Math.max(
              cardRect.left + window.scrollX + margin,
              window.scrollX + margin
            ),
            maxRight: Math.min(
              cardRect.right + window.scrollX - margin,
              window.scrollX + vw - margin
            ),
            minTop: Math.max(
              wrapperRect.top + window.scrollY + margin,
              window.scrollY + margin
            ),
            maxBottom: Math.min(
              wrapperRect.bottom + window.scrollY - margin,
              window.scrollY + vh - margin
            )
          };
          const cardCenterDocX = cardRect.left + cardRect.width / 2 + window.scrollX;
          const farSideLeft = touch.pageX > cardCenterDocX ? bounds.minLeft : bounds.maxRight - tw;
          const candidates = [
{ left: touch.pageX - tw - 15, top: touch.pageY - th - 15 },
            { left: touch.pageX + 15, top: touch.pageY - th - 15 },
            { left: touch.pageX - tw - 15, top: touch.pageY + 15 },
            { left: touch.pageX + 15, top: touch.pageY + 15 },





{ left: farSideLeft, top: touch.pageY - th / 2 },
            { left: farSideLeft, top: touch.pageY + 15 },
            { left: farSideLeft, top: touch.pageY - th - 15 },
            { left: farSideLeft, top: bounds.maxBottom - th },
            { left: farSideLeft, top: bounds.minTop }
          ];
          const chosen = pickFittingPosition(candidates, tw, th, bounds) ?? {


left: Math.max(
              bounds.minLeft,
              Math.min(bounds.maxRight - tw, farSideLeft)
            ),
            top: Math.max(
              bounds.minTop,
              Math.min(bounds.maxBottom - th, touch.pageY + 15)
            )
          };
          tooltip.style("left", chosen.left + "px").style("top", chosen.top + "px").style("opacity", 1).style("pointer-events", "auto");
        };
        const sliceTapTracker = new TapTracker();
        let sliceTouchDatum = null;
        svg.selectAll(
          "path.danbooru-grass-pie-path"
        ).on("touchstart", (event, datum) => {
          sliceTapTracker.onTouchStart(event);
          sliceTouchDatum = datum;
        }).on("touchmove", (event) => {
          sliceTapTracker.onTouchMove(event);
        }).on("touchend", (event) => {
          const isTap = sliceTapTracker.onTouchEnd(event);
          const datum = sliceTouchDatum;
          sliceTouchDatum = null;
          if (isTap && datum) {
            handleSliceTouch(event, datum);
          }
        });
        const tooltipTapTracker = new TapTracker();
        tooltip.on("touchstart", (event) => {
          tooltipTapTracker.onTouchStart(event);
        }).on("touchmove", (event) => {
          tooltipTapTracker.onTouchMove(event);
        }).on("touchend", (event) => {
          if (tooltipTapTracker.onTouchEnd(event)) {
            pieTap.navigateActive();
          }
        });
      }
      const legendDiv = pieContent.querySelector(".danbooru-grass-legend-scroll");
      if (legendDiv) {
        let legendTitle = "DIST.";
        if (currentPieTab === "copyright") legendTitle = "COPYRIGHTS";
        else if (currentPieTab === "character") legendTitle = "CHARACTERS";
        else if (currentPieTab === "fav_copyright")
          legendTitle = "FAVORITE COPYRIGHTS";
        else if (currentPieTab === "status") legendTitle = "STATUS";
        else if (currentPieTab === "rating") legendTitle = "RATINGS";
        else if (currentPieTab === "hair_length") legendTitle = "HAIR LENGTH";
        else if (currentPieTab === "hair_color") legendTitle = "HAIR COLOR";
        else if (currentPieTab === "breasts") legendTitle = "BREASTS";
        else if (currentPieTab === "gender") legendTitle = "GENDER";
        else if (currentPieTab === "commentary") legendTitle = "COMMENTARY";
        else if (currentPieTab === "translation") legendTitle = "TRANSLATION";
        const styleTag = legendDiv.querySelector("style")?.outerHTML ?? "";
        const listHtml = processedData.map((d) => {
          const pct = pctFor(d.label);
          const isOtherSlice = d.details.kind === "tag" && !!d.details.isOther;
          let targetUrl = "#";
          if (!isOtherSlice) {
            const query = buildSearchQuery(
              d.details,
              d.label,
              contextUser.normalizedName ?? "",
              currentPieTab
            );
            if (query) {
              targetUrl = `/posts?tags=${encodeURIComponent(query)}`;
            }
          }
          const swatchColor = safeColor(d.color);
          const safeLabel = escapeHtml$1(d.label);
          const safeUrl = escapeHtml$1(targetUrl);
          const countTitle = d.details.count ? escapeHtml$1(d.details.count.toLocaleString()) : "";
          return `
               <div style="display:flex; align-items:center; font-size:0.85em; margin-bottom:5px;">
                  <div style="width:12px; height:12px; background:${swatchColor}; border-radius:2px; margin-right:8px; border:1px solid var(--di-shadow-light, rgba(0,0,0,0.1)); flex-shrink:0;"></div>
                  ${isOtherSlice ? `<div style="color:var(--di-text-secondary, #666); width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${safeLabel}">${safeLabel}</div>` : `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="di-hover-underline" style="color:var(--di-text-secondary, #666); width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:none;" title="${safeLabel}">${safeLabel}</a>`}
                  <div style="font-weight:bold; color:var(--di-text, #333); margin-left:auto;" title="${countTitle}">${pct}</div>
               </div>`;
        }).join("");
        legendDiv.innerHTML = styleTag + `
           <div style="font-size:0.8em; color:var(--di-text-muted, #888); margin-bottom:8px; text-transform:uppercase; position:sticky; top:0; background:var(--di-chart-bg, #fff); padding-bottom:4px; border-bottom:1px solid var(--di-border-light, #eee);">${legendTitle}</div>
           ${listHtml}
      `;
      }
    };
    const updatePieTabs = () => {
      const btns = container2.querySelectorAll(".di-pie-tab");
      btns.forEach((btn) => {
        const el = btn;
        const mode = el.getAttribute("data-mode");
        if (mode === currentPieTab) {
          el.style.background = "var(--di-text-secondary, #666)";
          el.style.color = "var(--di-bg, #fff)";
          el.style.boxShadow = "0 1px 3px var(--di-shadow-light, rgba(0,0,0,0.1))";
        } else {
          el.style.background = "var(--di-bg-tertiary, #f0f0f0)";
          el.style.color = "var(--di-text-secondary, #666)";
          el.style.boxShadow = "none";
        }
      });
    };
    container2.innerHTML = `
     <div style="width:100%; display:flex; flex-direction:column;">
         <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; width:100%;">
             <div style="display:flex; flex-direction:column; gap:4px; max-width:100%;">
                 <div style="display:flex; flex-wrap:wrap; gap:4px;">
                     <button class="di-pie-tab" data-mode="copyright" title="Copyright">Copy</button>
                     <button class="di-pie-tab" data-mode="character" title="Character">Char</button>
                     <button class="di-pie-tab" data-mode="fav_copyright" title="Favorite Copyright">Fav_Copy</button>
                     <button class="di-pie-tab" data-mode="status" title="Post Status">Status</button>
                     <button class="di-pie-tab" data-mode="rating" title="Content Rating">Rate</button>
                     <button class="di-pie-tab" data-mode="commentary" title="Commentary">Cmnt</button>
                     <button class="di-pie-tab" data-mode="translation" title="Translation">Tran</button>
                 </div>
                 <div style="display:flex; flex-wrap:wrap; gap:4px;">
                     <button class="di-pie-tab" data-mode="gender" title="Gender Distribution">Gender</button>
                     <button class="di-pie-tab" data-mode="breasts" style="display:${isNsfwEnabled ? "block" : "none"};" title="Breast Size">Boobs</button>
                     <button class="di-pie-tab" data-mode="hair_length" title="Hair Length">Hair_L</button>
                     <button class="di-pie-tab" data-mode="hair_color" title="Hair Color">Hair_C</button>
                 </div>
             </div>
         </div>
         <div class="pie-content" style="flex:1; display:flex; justify-content:center; align-items:center; min-height:160px;">
             Loading...
         </div>
     </div>
  `;
    const loadTab = async (tabName) => {
      if (pieData[tabName]) {
        renderPieContent();
        return;
      }
      const pieContent = container2.querySelector(".pie-content");
      if (pieContent)
        pieContent.innerHTML = '<div style="color:var(--di-chart-axis-secondary, #666);">Loading...</div>';
      try {
        let data = [];
        const user = context.targetUser;
        if (tabName === "rating") {
          data = await dataManager.getRatingDistribution(user, firstUploadDate);
        } else if (tabName === "status") {
          data = await dataManager.getStatusDistribution(user, firstUploadDate);
          const statusColors = {
            active: "#2da44e",
            deleted: "#d73a49",
            pending: "#0969da",
            flagged: "#cf222e",
            banned: "#6e7781",
            appealed: "#bf3989"
          };
          data = data.map((d) => ({
            ...d,
            color: statusColors[d.name] || "#888"
          }));
        } else if (tabName === "character") {
          data = await dataManager.getCharacterDistribution(user);
        } else if (tabName === "copyright") {
          data = await dataManager.getCopyrightDistribution(user);
        } else if (tabName === "fav_copyright") {
          data = await dataManager.getFavCopyrightDistribution(user);
        } else if (tabName === "breasts") {
          data = await dataManager.getBreastsDistribution(user);
          const total = data.reduce(
            (acc, c) => acc + c.count,
            0
          );
          data = data.map((d) => ({
            ...d,
            frequency: total > 0 ? d.count / total : 0,
            value: total > 0 ? d.count / total : 0,
            label: d.name,
            details: { ...d, thumb: null }
          }));
        } else if (tabName === "gender") {
          data = await dataManager.getGenderDistribution(user);
          const total = data.reduce(
            (acc, c) => acc + c.count,
            0
          );
          data = data.map((d) => ({
            ...d,
            frequency: total > 0 ? d.count / total : 0,
            value: total > 0 ? d.count / total : 0,
            label: d.name,
            details: { ...d, thumb: null }
          }));
        } else if (tabName === "commentary") {
          data = await dataManager.getCommentaryDistribution(user);
          const total = data.reduce(
            (acc, c) => acc + c.count,
            0
          );
          data = data.map((d) => ({
            ...d,
            frequency: total > 0 ? d.count / total : 0,
            value: total > 0 ? d.count / total : 0,
            label: d.name,
            details: { ...d, thumb: null }
          }));
        } else if (tabName === "translation") {
          data = await dataManager.getTranslationDistribution(user);
          const total = data.reduce(
            (acc, c) => acc + c.count,
            0
          );
          data = data.map((d) => ({
            ...d,
            frequency: total > 0 ? d.count / total : 0,
            value: total > 0 ? d.count / total : 0,
            label: d.name,
            details: { ...d, thumb: null }
          }));
        }
        pieData[tabName] = data;
        if (currentPieTab === tabName) {
          renderPieContent();
          updatePieTabs();
        }
      } catch (e) {
        log$7.error("Failed to load pie chart data", { error: e });
        const pieContent2 = container2.querySelector(".pie-content");
        if (pieContent2) pieContent2.innerHTML = "Error loading data.";
      }
    };
    container2.addEventListener("click", (e) => {
      if (e.target.classList.contains("di-pie-tab")) {
        const mode = e.target.getAttribute("data-mode") ?? "";
        if (mode && currentPieTab !== mode) {
          currentPieTab = mode;
          updatePieTabs();
          const pieContent = container2.querySelector(
            ".pie-content"
          );
          if (!pieContent) {
            void loadTab(mode);
            return;
          }
          const TRANSITION_MS2 = 350;
          pieContent.querySelectorAll(".di-pie-snapshot").forEach((n) => n.remove());
          const piStyles = window.getComputedStyle(pieContent);
          const snapshot = document.createElement("div");
          snapshot.className = "di-pie-snapshot";
          snapshot.style.position = "absolute";
          snapshot.style.top = "0";
          snapshot.style.left = "0";
          snapshot.style.width = "100%";
          snapshot.style.height = "100%";
          snapshot.style.display = piStyles.display;
          snapshot.style.flexDirection = piStyles.flexDirection;
          snapshot.style.alignItems = piStyles.alignItems;
          snapshot.style.justifyContent = piStyles.justifyContent;
          snapshot.style.transformStyle = "preserve-3d";
          snapshot.style.perspective = piStyles.perspective;
          snapshot.style.pointerEvents = "none";
          snapshot.style.transition = `opacity ${TRANSITION_MS2}ms ease`;
          snapshot.style.opacity = "1";
          for (const child of Array.from(pieContent.children)) {
            snapshot.appendChild(child.cloneNode(true));
          }
          pieContent.style.position = "relative";
          pieContent.appendChild(snapshot);
          void snapshot.getBoundingClientRect();
          void loadTab(mode).then(() => {
            if (currentPieTab !== mode) {
              snapshot.remove();
              return;
            }
            requestAnimationFrame(() => {
              snapshot.style.opacity = "0";
              setTimeout(() => snapshot.remove(), TRANSITION_MS2);
            });
          });
        }
      }
    });
    updatePieTabs();
    void loadTab(currentPieTab);
    return {
      onNsfwChange: (enabled) => {
        isNsfwEnabled = enabled;
        const boobsBtn = container2.querySelector(
          '.di-pie-tab[data-mode="breasts"]'
        );
        if (boobsBtn) {
          boobsBtn.style.display = isNsfwEnabled ? "block" : "none";
        }
        if (!isNsfwEnabled && currentPieTab === "breasts") {
          currentPieTab = "copyright";
          updatePieTabs();
          void loadTab("copyright");
        }
      }
    };
  }
  function renderTopPostsWidget(container2, topPosts, recentPopularPosts, randomPosts, initialNsfwEnabled, db, context) {
    let isNsfwEnabled = initialNsfwEnabled;
    const topPostGroups = {
      most: topPosts,
      recent: recentPopularPosts,
      random: randomPosts && !(randomPosts instanceof Promise) ? randomPosts : null
    };
    if (randomPosts instanceof Promise) {
      void randomPosts.then((resolved) => {
        topPostGroups.random = resolved;
        if (currentWidgetMode === "random") renderTopPostContent();
      });
    }
    let currentWidgetMode = "recent";
    let currentMostTab = "g";
    let currentSfwTab = "sfw";
    const renderTopPostContent = () => {
      const group = topPostGroups[currentWidgetMode];
      const tabKey = currentWidgetMode === "most" ? currentMostTab : currentSfwTab;
      const data = group ? group[tabKey] : null;
      const contentDiv = container2.querySelector(
        ".top-post-content"
      );
      if (!contentDiv) return;
      if (!data) {
        contentDiv.innerHTML = '<div style="color:var(--di-text-muted, #888); padding:20px 0;">No posts found or loading...</div>';
        return;
      }
      const thumbUrl = getBestThumbnailUrl(data);
      const dateStr = data.created_at ? new Date(data.created_at).toISOString().split("T")[0] : "N/A";
      const link = `/posts/${data.id}`;
      const ratingMap = {
        g: "General",
        s: "Sensitive",
        q: "Questionable",
        e: "Explicit"
      };
      const ratingLabel = ratingMap[data.rating] || data.rating;
      const refreshBtn2 = container2.querySelector(
        "#analytics-random-refresh"
      );
      if (refreshBtn2) {
        refreshBtn2.style.display = currentWidgetMode === "random" ? "inline-block" : "none";
      }
      const searchLinkBtn = container2.querySelector(
        "#analytics-more-post-link"
      );
      if (searchLinkBtn) {
        searchLinkBtn.style.display = currentWidgetMode === "recent" ? "inline-block" : "none";
        const normalizedName = context.targetUser.normalizedName;
        const ratingTag = currentSfwTab === "sfw" ? "is:sfw" : "is:nsfw";
        const searchQuery = `user:${normalizedName} order:score age:<1w ${ratingTag}`;
        searchLinkBtn.onclick = () => {
          window.open(`/posts?tags=${encodeURIComponent(searchQuery)}`, "_blank");
        };
      }
      const createTagLine = (label, icon, tags) => {
        if (!tags) return "";
        const tagList = tags.replace(/_/g, " ");
        const displayTags = label === "Char" && tags.split(" ").length > 5 ? tagList.split(" ").slice(0, 5).join(", ") + "..." : tagList;
        return `<div>${icon} <strong>${label}:</strong> ${displayTags}</div>`;
      };
      const artistLine = createTagLine(
        "Artist",
        "🎨",
        data.tag_string_artist ?? ""
      );
      const copyrightLine = createTagLine(
        "Copy",
        "©️",
        data.tag_string_copyright ?? ""
      );
      const charLine = createTagLine(
        "Char",
        "👤",
        data.tag_string_character ?? ""
      );
      contentDiv.innerHTML = `
      <div class="di-top-post-layout" style="display:flex; gap:15px; align-items:flex-start;">
          <a class="di-top-post-thumb" href="${link}" target="_blank" style="display:block; width:150px; height:150px; flex-shrink:0; background:var(--di-bg-tertiary, #f0f0f0); border-radius:4px; overflow:hidden; position:relative;">
              <img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;" alt="#${data.id}">
          </a>
          <div style="flex:1;">
              <div style="font-weight:bold; font-size:1.1em; color:var(--di-link, #007bff); margin-bottom:4px;">
                  <a href="${link}" target="_blank" style="text-decoration:none; color:inherit;">Post #${data.id}</a>
              </div>
              <div style="font-size:0.9em; color:var(--di-text-secondary, #666); line-height:1.5;">
                  📅 ${dateStr}<br>
                  ❤️ Score: <strong>${data.score}</strong><br>
                  ⭐ Favs: <strong>${data.fav_count || "?"}</strong><br>
                  🤔 Rating: <strong>${ratingLabel}</strong>

                  <div style="margin-top:8px; border-top:1px solid var(--di-border-light, #eee); padding-top:6px;">
                      ${artistLine}
                      ${copyrightLine}
                      ${charLine}
                  </div>
              </div>
          </div>
      </div>
   `;
    };
    const updateTabs = () => {
      const setStyle = (btn, isActive) => {
        if (!btn) return;
        btn.style.background = isActive ? "var(--di-link, #007bff)" : "var(--di-bg-tertiary, #f0f0f0)";
        btn.style.color = isActive ? "var(--di-bg, #fff)" : "var(--di-text, #333)";
      };
      const gsqeGroup = container2.querySelector(
        "#top-post-tabs-gsqe"
      );
      const sfwnsfwGroup = container2.querySelector(
        "#top-post-tabs-sfwnsfw"
      );
      if (currentWidgetMode === "most") {
        if (gsqeGroup) gsqeGroup.style.display = "flex";
        if (sfwnsfwGroup) sfwnsfwGroup.style.display = "none";
        for (const mode of ["g", "s", "q", "e"]) {
          const btn = container2.querySelector(
            `button[data-mode="${mode}"]`
          );
          setStyle(btn, currentMostTab === mode);
        }
      } else {
        if (gsqeGroup) gsqeGroup.style.display = "none";
        if (sfwnsfwGroup) sfwnsfwGroup.style.display = "flex";
        for (const mode of ["sfw", "nsfw"]) {
          const btn = container2.querySelector(
            `button[data-mode="${mode}"]`
          );
          setStyle(btn, currentSfwTab === mode);
        }
      }
    };
    container2.style.padding = "15px";
    container2.innerHTML = `
     <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div style="font-size:0.85em; color:var(--di-chart-axis-secondary, #666); letter-spacing:0.5px; display:flex; align-items:center; gap:5px;">
           <select id="analytics-top-post-select" style="border:none; background:transparent; font-weight:bold; color:var(--di-chart-axis-secondary, #666); cursor:pointer; text-transform:uppercase; font-size:1em; outline:none;">
              <option value="recent">🔥 Recent Popular Post</option>
              <option value="most">🏆 Most Popular Post</option>
              <option value="random">🎲 Random Post</option>
           </select>
            <button id="analytics-random-refresh" style="display:none; border:none; background:transparent; cursor:pointer; font-size:1.2em; padding:0 4px; margin-left:5px; filter: grayscale(100%); opacity: 0.6;" title="Load New Random Post">
                 🔄
             </button>
            <button id="analytics-more-post-link" style="border:none; background:transparent; cursor:pointer; font-size:1.1em; padding:0 4px; margin-left:2px; filter: grayscale(100%); opacity: 0.6;" title="See more posts">
                 ↗️
             </button>
         </div>
        <div id="top-post-tabs-sfwnsfw" style="display:flex; gap:0px; border:1px solid var(--di-border-input, #ddd); border-radius:6px; overflow:hidden;">
           <button class="top-post-tab" data-mode="sfw" style="border:none; background:var(--di-link, #007bff); color:var(--di-bg, #fff); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">SFW</button>
           <button class="top-post-tab" id="analytics-top-nsfw-btn" data-mode="nsfw" style="border:none; border-left:1px solid var(--di-border-input, #ddd); background:var(--di-bg-tertiary, #f0f0f0); color:var(--di-text, #333); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s; display: ${isNsfwEnabled ? "inline-block" : "none"};">NSFW</button>
        </div>
        <div id="top-post-tabs-gsqe" style="display:none; gap:0px; border:1px solid var(--di-border-input, #ddd); border-radius:6px; overflow:hidden;">
           <button class="top-post-tab" data-mode="g" style="border:none; background:var(--di-bg-tertiary, #f0f0f0); color:var(--di-text, #333); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">G</button>
           <button class="top-post-tab" data-mode="s" style="border:none; border-left:1px solid var(--di-border-input, #ddd); background:var(--di-bg-tertiary, #f0f0f0); color:var(--di-text, #333); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">S</button>
           <button class="top-post-tab" id="analytics-top-q-btn" data-mode="q" style="border:none; border-left:1px solid var(--di-border-input, #ddd); background:var(--di-bg-tertiary, #f0f0f0); color:var(--di-text, #333); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s; display: ${isNsfwEnabled ? "inline-block" : "none"};">Q</button>
           <button class="top-post-tab" id="analytics-top-e-btn" data-mode="e" style="border:none; border-left:1px solid var(--di-border-input, #ddd); background:var(--di-bg-tertiary, #f0f0f0); color:var(--di-text, #333); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s; display: ${isNsfwEnabled ? "inline-block" : "none"};">E</button>
        </div>
     </div>
     <div class="top-post-content">
         <div style="color:var(--di-chart-axis-secondary, #666); font-size:0.9em;">Loading stats...</div>
     </div>
  `;
    const modeSelect = container2.querySelector(
      "#analytics-top-post-select"
    );
    if (modeSelect) {
      modeSelect.addEventListener("change", (e) => {
        currentWidgetMode = e.target.value;
        updateTabs();
        renderTopPostContent();
      });
    }
    const refreshBtn = container2.querySelector(
      "#analytics-random-refresh"
    );
    if (refreshBtn) {
      refreshBtn.onclick = async (e) => {
        e.stopPropagation();
        refreshBtn.style.transform = "rotate(360deg)";
        setTimeout(() => refreshBtn.style.transform = "rotate(0deg)", 400);
        const contentDiv = container2.querySelector(
          ".top-post-content"
        );
        contentDiv.style.opacity = "0.5";
        try {
          const newRandoms = await new AnalyticsDataManager(db).getRandomPosts(
            context.targetUser
          );
          topPostGroups["random"] = newRandoms;
          renderTopPostContent();
        } catch (err) {
          log$7.error("Failed to refresh random post", { error: err });
        } finally {
          contentDiv.style.opacity = "1";
        }
      };
    }
    container2.addEventListener("click", (e) => {
      if (e.target.classList.contains("top-post-tab")) {
        const mode = e.target.getAttribute("data-mode") ?? "";
        if (currentWidgetMode === "most") {
          currentMostTab = mode || "g";
        } else {
          currentSfwTab = mode || "sfw";
        }
        updateTabs();
        renderTopPostContent();
      }
    });
    updateTabs();
    renderTopPostContent();
    return {
      onNsfwChange: (enabled) => {
        isNsfwEnabled = enabled;
        for (const id of [
          "analytics-top-q-btn",
          "analytics-top-e-btn",
          "analytics-top-nsfw-btn"
        ]) {
          const btn = document.getElementById(id);
          if (btn) btn.style.display = isNsfwEnabled ? "inline-block" : "none";
        }
        if (!isNsfwEnabled && (currentMostTab === "q" || currentMostTab === "e")) {
          currentMostTab = "g";
          updateTabs();
          if (currentWidgetMode === "most") renderTopPostContent();
        }
        if (!isNsfwEnabled && currentSfwTab === "nsfw") {
          currentSfwTab = "sfw";
          updateTabs();
          if (currentWidgetMode !== "most") renderTopPostContent();
        }
      }
    };
  }
  async function renderMilestonesWidget(container2, db, context, initialNsfwEnabled) {
    let isNsfwEnabled = initialNsfwEnabled;
    let currentMilestoneStep = "auto";
    let isMilestoneExpanded = false;
    const renderMilestones = async () => {
      const dm = new AnalyticsDataManager(db);
      const milestones = await dm.getMilestones(
        context.targetUser,
        isNsfwEnabled,
        currentMilestoneStep
      );
      const uploaderId = parseInt(context.targetUser?.id ?? "0");
      const totalPosts = uploaderId ? await db.posts.where("uploader_id").equals(uploaderId).count() : 0;
      const nextTarget = dm.getNextMilestone(totalPosts, currentMilestoneStep);
      let msHtml = '<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--di-border-light, #eee); padding-bottom:8px; margin-bottom:10px;">';
      msHtml += '<h3 style="color:var(--di-text, #333); margin:0;">🏆 Milestones</h3>';
      msHtml += '<div style="display:flex; align-items:center; gap:10px;">';
      msHtml += `<select id="analytics-milestone-step" style="border:1px solid var(--di-border-input, #ddd); border-radius:4px; padding:2px 4px; font-size:0.85em; color:var(--di-text-secondary, #666); background-color:var(--di-bg-tertiary, #f0f0f0);">
      <option value="auto" ${currentMilestoneStep === "auto" ? "selected" : ""}>Auto</option>
      <option value="1000" ${currentMilestoneStep === 1e3 || String(currentMilestoneStep) === "1000" ? "selected" : ""}>Every 1k</option>
      <option value="2500" ${currentMilestoneStep === 2500 || String(currentMilestoneStep) === "2500" ? "selected" : ""}>Every 2.5k</option>
      <option value="5000" ${currentMilestoneStep === 5e3 || String(currentMilestoneStep) === "5000" ? "selected" : ""}>Every 5k</option>
      <option value="10000" ${currentMilestoneStep === 1e4 || String(currentMilestoneStep) === "10000" ? "selected" : ""}>Every 10k</option>
      <option value="repdigit" ${currentMilestoneStep === "repdigit" ? "selected" : ""}>Repdigit</option>
    </select>`;
      msHtml += '<button id="analytics-milestone-toggle" style="background:none; border:none; color:var(--di-link, #007bff); cursor:pointer; font-size:0.9em; display:none;">Show More</button>';
      msHtml += "</div>";
      msHtml += "</div>";
      if (milestones.length === 0) {
        container2.innerHTML = msHtml + '<div style="color:var(--di-text-muted, #888); font-size:0.9em;">No milestones found.</div>';
        const sel = container2.querySelector(
          "#analytics-milestone-step"
        );
        if (sel) {
          sel.onchange = (e) => {
            const v = e.target.value;
            currentMilestoneStep = v === "auto" ? "auto" : v === "repdigit" ? "repdigit" : parseInt(v);
            void renderMilestones();
          };
        }
        return;
      }
      const containerId = "analytics-milestone-container";
      msHtml += `<div id="${containerId}" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap:10px; max-height:110px; overflow:hidden; transition: max-height 0.3s ease;">`;
      milestones.forEach((m) => {
        const p = m.post;
        const isSafe = p.rating === "s" || p.rating === "g";
        const thumbUrl = getBestThumbnailUrl(p);
        const showThumb = isNsfwEnabled || isSafe;
        msHtml += `
      <a href="/posts/${p.id}" target="_blank" class="di-hover-scale" style="
         display:flex; justify-content:space-between; align-items:center; text-decoration:none; color:inherit;
         background:var(--di-chart-bg, #fff); border:1px solid var(--di-border-light, #eee); border-radius:6px; padding:10px;
      ">
         <div>
             <div style="font-size:0.8em; color:var(--di-text-muted, #888); letter-spacing:0.5px;">#${p.id}</div>
             <div style="font-size:1.1em; font-weight:bold; color:var(--di-link, #007bff); margin-top:4px;">${m.type}</div>
             <div style="font-size:0.8em; color:var(--di-text-secondary, #666); margin-top:2px;">${new Date(p.created_at).toLocaleDateString()}</div>
             <div style="font-size:0.75em; color:var(--di-text-faint, #999); margin-top:4px;">Score: ${p.score}</div>
         </div>
         ${showThumb && thumbUrl ? `<div style="width:60px; height:60px; margin-left:10px; flex-shrink:0; background:var(--di-bg-tertiary, #f0f0f0); border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center;"><img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;"></div>` : ""}
      </a>
    `;
      });
      if (nextTarget !== null && nextTarget > totalPosts) {
        const remaining = nextTarget - totalPosts;
        const prevTarget = milestones.length > 0 ? milestones[milestones.length - 1].milestone : 0;
        const span = nextTarget - prevTarget;
        const progressPct = span > 0 ? Math.max(0, Math.min(100, (totalPosts - prevTarget) / span * 100)) : 0;
        const nextLabel = nextTarget === 1 ? "First" : nextTarget >= 1e3 && nextTarget % 1e3 === 0 ? `${nextTarget / 1e3} k` : nextTarget.toLocaleString();
        msHtml += `
      <div class="di-next-milestone-card" style="
         display:flex; flex-direction:column; justify-content:space-between;
         background:var(--di-bg-tertiary, #f0f0f0); border:1px dashed var(--di-border-input, #ddd); border-radius:6px; padding:10px;
         color:var(--di-text-secondary, #666);
      ">
         <div>
             <div style="font-size:0.7em; color:var(--di-text-muted, #888); letter-spacing:0.5px; text-transform:uppercase;">Next</div>
             <div style="font-size:1.1em; font-weight:bold; color:var(--di-text-secondary, #666); margin-top:4px;">${nextLabel}</div>
             <div style="font-size:0.8em; color:var(--di-chart-axis-secondary, #666); margin-top:6px;">${remaining.toLocaleString()} remaining</div>
         </div>
         <div style="margin-top:8px;">
             <div style="height:6px; background:var(--di-border-light, #eee); border-radius:3px; overflow:hidden;">
                 <div style="width:${progressPct.toFixed(1)}%; height:100%; background:var(--di-link, #007bff);"></div>
             </div>
             <div style="font-size:0.7em; color:var(--di-text-muted, #888); margin-top:3px; text-align:right;">${progressPct.toFixed(0)}%</div>
         </div>
      </div>
    `;
      }
      msHtml += "</div>";
      container2.innerHTML = msHtml;
      const stepSelect = container2.querySelector(
        "#analytics-milestone-step"
      );
      if (stepSelect) {
        stepSelect.onchange = (e) => {
          const v = e.target.value;
          currentMilestoneStep = v === "auto" ? "auto" : v === "repdigit" ? "repdigit" : parseInt(v);
          void renderMilestones();
        };
      }
      if (milestones.length > 6) {
        const btn = container2.querySelector(
          "#analytics-milestone-toggle"
        );
        const milestoneContainer = container2.querySelector(
          `#${containerId}`
        );
        btn.style.display = "block";
        if (isMilestoneExpanded) {
          milestoneContainer.style.maxHeight = "2000px";
          btn.textContent = "Show Less";
        }
        btn.onclick = () => {
          isMilestoneExpanded = !isMilestoneExpanded;
          if (isMilestoneExpanded) {
            milestoneContainer.style.maxHeight = "2000px";
            btn.textContent = "Show Less";
          } else {
            milestoneContainer.style.maxHeight = "110px";
            btn.textContent = "Show More";
          }
        };
      }
    };
    await renderMilestones();
    return {
      onNsfwChange: async (enabled) => {
        isNsfwEnabled = enabled;
        await renderMilestones();
      }
    };
  }
  async function renderHistoryChart(container2, db, context, milestones1k, levelChanges) {
    let minDate = null;
    if (levelChanges.length > 0) {
      minDate = levelChanges[0].date;
    }
    const isTouch2 = isTouchDevice();
    const monthly = await new AnalyticsDataManager(db).getMonthlyStats(
      context.targetUser,
      minDate
    );
    if (monthly.length === 0) return;
    const chartDiv = document.createElement("div");
    chartDiv.style.marginTop = "24px";
    const chartHtml = '<h3 style="color:var(--di-chart-axis, #333); border-bottom:1px solid var(--di-border-light, #eee); padding-bottom:10px; margin-bottom:15px;">📅 Monthly Activity</h3>';
    const minBarWidth = 25;
    const padLeftScroll = 10;
    const padRight = 20;
    const padBottom = 25;
    const padTop = 20;
    const yAxisWidth = 45;
    const maxCount = Math.max(...monthly.map((m) => m.count));
    const requiredWidth = padLeftScroll + padRight + monthly.length * minBarWidth;
    const vWidth = Math.max(800, requiredWidth);
    const vHeight = 200;
    const mainWrapper = document.createElement("div");
    mainWrapper.className = "chart-flex-wrapper";
    mainWrapper.style.display = "flex";
    mainWrapper.style.width = "100%";
    mainWrapper.style.position = "relative";
    mainWrapper.style.border = "1px solid var(--di-border-light, #eee)";
    mainWrapper.style.borderRadius = "8px";
    mainWrapper.style.backgroundColor = "var(--di-chart-bg, #fff)";
    mainWrapper.style.overflow = "hidden";
    const yAxisWrapper = document.createElement("div");
    yAxisWrapper.style.width = `${yAxisWidth}px`;
    yAxisWrapper.style.flexShrink = "0";
    yAxisWrapper.style.borderRight = "1px solid var(--di-bg-tertiary, #f0f0f0)";
    yAxisWrapper.style.zIndex = "5";
    yAxisWrapper.style.backgroundColor = "var(--di-chart-bg, #fff)";
    mainWrapper.appendChild(yAxisWrapper);
    const chartWrapper = document.createElement("div");
    chartWrapper.className = "scroll-wrapper";
    chartWrapper.style.flex = "1";
    chartWrapper.style.overflowX = "auto";
    chartWrapper.style.overflowY = "hidden";
    mainWrapper.appendChild(chartWrapper);
    let tickMax = Math.ceil(maxCount / 500) * 500;
    if (tickMax < 500) tickMax = 500;
    let tickStep = 500;
    if (tickMax <= 2e3) {
      tickStep = tickMax / 4;
    }
    const numTicks = Math.round(tickMax / tickStep);
    let ySvg = `<svg width="${yAxisWidth}" height="${vHeight}">`;
    for (let i = 0; i <= numTicks; i++) {
      const val = i * tickStep;
      const y = vHeight - padBottom - val / tickMax * (vHeight - padBottom - padTop);
      ySvg += `<text x="${yAxisWidth - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--di-chart-axis-secondary, #666)">${val}</text>`;
    }
    ySvg += "</svg>";
    yAxisWrapper.innerHTML = ySvg;
    let svg = `<svg width="${vWidth}" height="${vHeight}">`;
    for (let i = 1; i <= numTicks; i++) {
      const val = i * tickStep;
      const y = vHeight - padBottom - val / tickMax * (vHeight - padBottom - padTop);
      svg += `<line x1="0" y1="${y}" x2="${vWidth}" y2="${y}" stroke="var(--di-chart-grid, #eee)" stroke-width="1" />`;
    }
    svg += `<line x1="0" y1="${vHeight - padBottom}" x2="${vWidth}" y2="${vHeight - padBottom}" stroke="var(--di-border, #e1e4e8)" />`;
    const barAreaWidth = vWidth - padLeftScroll - padRight;
    const step = barAreaWidth / monthly.length;
    const barWidth = step * 0.75;
    monthly.forEach((m, idx) => {
      const x = padLeftScroll + step * idx + (step - barWidth) / 2;
      const barH = m.count / tickMax * (vHeight - padBottom - padTop);
      const y = vHeight - padBottom - barH;
      const colX = padLeftScroll + step * idx;
      const colWidth = step;
      const nextDate = idx < monthly.length - 1 ? monthly[idx + 1].date : null;
      let dateFilter = `date:${m.date}-01`;
      if (nextDate) {
        dateFilter = `date:${m.date}-01...${nextDate}-01`;
      } else {
        const [yy, mm] = m.date.split("-").map(Number);
        const nextMonth = new Date(yy, mm, 1);
        const nextY = nextMonth.getFullYear();
        const nextM = String(nextMonth.getMonth() + 1).padStart(2, "0");
        dateFilter = `date:${m.date}-01...${nextY}-${nextM}-01`;
      }
      const searchUrl = `/posts?tags=user:${encodeURIComponent(context.targetUser.normalizedName)}+${dateFilter}`;
      svg += `
      <g class="month-column" style="cursor: pointer;" onclick="window.open('${searchUrl}', '_blank')">
        <rect class="column-overlay" x="${colX}" y="0" width="${colWidth}" height="${vHeight - padBottom}" fill="transparent" />
        <rect class="monthly-bar" x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="#40c463" rx="2" style="pointer-events: none;" />
        <title>${m.label}: ${m.count} posts</title>
      </g>
    `;
      const [year, month] = m.date.split("-");
      const isJan = month === "01";
      if (isJan || idx === 0) {
        const tx = x + barWidth / 2;
        const ty = vHeight - 5;
        const text = isJan ? year : `${year}-${month}`;
        svg += `<text x="${tx}" y="${ty}" text-anchor="middle" font-size="10" fill="var(--di-chart-axis-secondary, #666)">${text}</text>`;
        svg += `<line x1="${tx}" y1="${vHeight - padBottom}" x2="${tx}" y2="${vHeight - padBottom + 3}" stroke="var(--di-border, #e1e4e8)" />`;
      }
    });
    if (levelChanges && levelChanges.length > 0) {
      const [sY, sM] = monthly[0].date.split("-").map(Number);
      levelChanges.forEach((lc) => {
        const pY = lc.date.getFullYear();
        const pM = lc.date.getMonth() + 1;
        const pD = lc.date.getDate();
        const monthDiff = (pY - sY) * 12 + (pM - sM);
        const daysInMonth = new Date(pY, pM, 0).getDate();
        const frac = (pD - 1) / daysInMonth;
        const idx = monthDiff + frac;
        if (idx < 0 || idx > monthly.length) return;
        const x = padLeftScroll + step * idx;
        svg += `
        <g class="promotion-marker">
           <line x1="${x}" y1="${padTop}" x2="${x}" y2="${vHeight - padBottom}" stroke="#ff5722" stroke-width="2" stroke-dasharray="4 2"></line>
           <rect x="${x - 4}" y="${padTop}" width="8" height="${vHeight - padBottom - padTop}" fill="transparent">
               <title>${lc.date.toLocaleDateString()}: ${lc.fromLevel} → ${lc.toLevel}</title>
           </rect>
        </g>
     `;
      });
    }
    monthly.forEach((mo, idx) => {
      const mKey = mo.date;
      const stars = milestones1k.filter((m) => {
        const pDate = new Date(m.post.created_at);
        const k = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, "0")}`;
        return k === mKey;
      });
      if (stars.length > 0) {
        const x = padLeftScroll + step * idx + step / 2;
        stars.forEach((m, si) => {
          const y = 14 + si * 18;
          let fill = "#ffd700";
          let stroke = "#b8860b";
          const style = "filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.3));";
          let animClass = "";
          if (m.milestone === 1) {
            fill = "#00e676";
            stroke = "#00a050";
          } else if (m.milestone % 1e4 === 0) {
            fill = "#ffb300";
            animClass = "star-shiny";
          }
          if (isTouch2) {
            svg += `
               <text class="${animClass}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${fill}" stroke="${stroke}" stroke-width="0.5" style="${style}; pointer-events: none;">
                   ★
                   <title>Milestone #${m.milestone} (${new Date(m.post.created_at).toLocaleDateString()})</title>
               </text>
             `;
          } else {
            svg += `
               <a href="/posts/${m.post.id}" target="_blank" style="cursor: pointer; pointer-events: all;" onclick="event.stopPropagation()">
                  <text class="${animClass}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${fill}" stroke="${stroke}" stroke-width="0.5" style="${style}">
                     ★
                     <title>Milestone #${m.milestone} (${new Date(m.post.created_at).toLocaleDateString()})</title>
                  </text>
               </a>
             `;
          }
        });
      }
    });
    svg += "</svg>";
    chartDiv.innerHTML = chartHtml;
    chartWrapper.innerHTML = svg;
    chartDiv.appendChild(mainWrapper);
    container2.appendChild(chartDiv);
    setTimeout(() => {
      if (chartWrapper) chartWrapper.scrollLeft = chartWrapper.scrollWidth;
    }, 100);
    requestAnimationFrame(() => {
      chartWrapper.scrollLeft = chartWrapper.scrollWidth;
    });
  }
  const VAR_MAP = {
    bg: "--di-bg",
    bgSecondary: "--di-bg-secondary",
    bgTertiary: "--di-bg-tertiary",
    text: "--di-text",
    textSecondary: "--di-text-secondary",
    textMuted: "--di-text-muted",
    textFaint: "--di-text-faint",
    textHeading: "--di-text-heading",
    border: "--di-border",
    borderLight: "--di-border-light",
    link: "--di-link",
    chartBg: "--di-chart-bg",
    chartGrid: "--di-chart-grid",
    chartAxis: "--di-chart-axis",
    chartAxisSecondary: "--di-chart-axis-secondary",
    shadow: "--di-shadow",
    tableRowHover: "--di-table-row-hover"
  };
  const LIGHT_FALLBACK = {
    bg: "#ffffff",
    bgSecondary: "#f9f9f9",
    bgTertiary: "#f0f0f0",
    text: "#333",
    textSecondary: "#666",
    textMuted: "#888",
    textFaint: "#999",
    textHeading: "#444",
    border: "#e1e4e8",
    borderLight: "#eee",
    link: "#007bff",
    chartBg: "#fff",
    chartGrid: "#eee",
    chartAxis: "#333",
    chartAxisSecondary: "#666",
    shadow: "rgba(0,0,0,0.2)",
    tableRowHover: "#f6f8fa"
  };
  function getPalette(el) {
    const target = el ?? document.documentElement;
    const style = getComputedStyle(target);
    const palette = {};
    for (const [key, cssVar] of Object.entries(VAR_MAP)) {
      const v = style.getPropertyValue(cssVar).trim();
      palette[key] = v || LIGHT_FALLBACK[key];
    }
    return palette;
  }
  const log$6 = createLogger("Scatter");
  function createInitialScatterState(options) {
    return {
      mode: "score",
      selectedYear: null,
      activeDownvoteFilter: null,
      activeRatingFilters: { g: true, s: true, q: true, e: true },
      y10Highlight: false,
      activeYThreshold: null,
      backfillInProgress: options.needsBackfill === true,
      backfillFailed: false,
      dragStart: null,
      lastDragEndTime: 0,
      ignoreNextClick: false,
      scale: {
        minDate: 0,
        maxDate: 0,
        maxVal: 0,
        timeRange: 0,
        padL: 0,
        padT: 0,
        drawW: 0,
        drawH: 0,
        mode: "score",
        stepY: 0
      }
    };
  }
  function buildScatterDom() {
    const wrapper = document.createElement("div");
    wrapper.style.marginTop = "24px";
    wrapper.style.marginBottom = "20px";
    const headerContainer = document.createElement("div");
    headerContainer.style.display = "flex";
    headerContainer.style.alignItems = "center";
    headerContainer.style.borderBottom = "1px solid var(--di-border-light, #eee)";
    headerContainer.style.paddingBottom = "10px";
    headerContainer.style.marginBottom = "15px";
    const headerEl = document.createElement("h3");
    headerEl.textContent = "📊 Post Performance";
    headerEl.style.color = "var(--di-text, #333)";
    headerEl.style.margin = "0";
    headerContainer.appendChild(headerEl);
    wrapper.appendChild(headerContainer);
    const scatterDiv = document.createElement("div");
    scatterDiv.className = "dashboard-widget";
    scatterDiv.style.background = "var(--di-chart-bg, #fff)";
    scatterDiv.style.border = "1px solid #e1e4e8";
    scatterDiv.style.borderRadius = "6px";
    scatterDiv.style.padding = "15px";
    scatterDiv.style.position = "relative";
    wrapper.appendChild(scatterDiv);
    const toggleContainer = document.createElement("div");
    toggleContainer.className = "di-scatter-toggle";
    toggleContainer.style.position = "absolute";
    toggleContainer.style.top = "15px";
    toggleContainer.style.left = "15px";
    toggleContainer.style.zIndex = "5";
    toggleContainer.style.display = "flex";
    toggleContainer.style.gap = "10px";
    toggleContainer.style.fontSize = "0.9em";
    const toggleSpecs = [
      { id: "score", label: "Score" },
      { id: "tags", label: "Tag Count", tooltip: "General Tags Only" }
    ];
    const toggleButtons = [];
    toggleSpecs.forEach((spec, i) => {
      const btn = document.createElement("button");
      btn.style.border = "1px solid #d0d7de";
      btn.style.borderRadius = "20px";
      btn.style.padding = "2px 10px";
      const isActive = i === 0;
      btn.style.background = isActive ? "var(--di-link, #007bff)" : "var(--di-bg, #fff)";
      btn.style.color = isActive ? "var(--di-btn-active-text, #fff)" : "var(--di-text, #333)";
      btn.style.cursor = "pointer";
      btn.style.transition = "all 0.2s";
      btn.style.fontSize = "12px";
      btn.dataset.mode = spec.id;
      btn.style.display = "flex";
      btn.style.alignItems = "center";
      btn.style.gap = "5px";
      const span = document.createElement("span");
      span.textContent = spec.label;
      btn.appendChild(span);
      if (spec.tooltip) {
        const help = document.createElement("span");
        help.textContent = "❔";
        help.style.cursor = "help";
        help.title = spec.tooltip;
        help.style.fontSize = "0.9em";
        help.style.opacity = "0.8";
        btn.appendChild(help);
      }
      toggleContainer.appendChild(btn);
      toggleButtons.push(btn);
    });
    scatterDiv.appendChild(toggleContainer);
    const downvoteThresholds = [0, 2, 5, 10];
    const downvoteContainer = document.createElement("div");
    downvoteContainer.className = "di-scatter-downvote";
    downvoteContainer.style.position = "absolute";
    downvoteContainer.style.top = "45px";
    downvoteContainer.style.right = "15px";
    downvoteContainer.style.zIndex = "5";
    downvoteContainer.style.display = "flex";
    downvoteContainer.style.alignItems = "center";
    downvoteContainer.style.gap = "5px";
    downvoteContainer.style.background = "var(--di-bg-glass, rgba(255, 255, 255, 0.9))";
    downvoteContainer.style.padding = "2px 8px";
    downvoteContainer.style.borderRadius = "12px";
    downvoteContainer.style.border = "1px solid var(--di-border-light, #eee)";
    const downvoteLabel = document.createElement("span");
    downvoteLabel.textContent = "👎";
    downvoteLabel.style.fontSize = "11px";
    downvoteLabel.style.marginRight = "3px";
    downvoteLabel.title = "Downvote filter";
    downvoteContainer.appendChild(downvoteLabel);
    const downvoteButtons = [];
    downvoteThresholds.forEach((t) => {
      const btn = document.createElement("button");
      btn.textContent = `>${t}`;
      btn.dataset.threshold = String(t);
      btn.style.border = "1px solid var(--di-border-input, #ddd)";
      btn.style.borderRadius = "12px";
      btn.style.padding = "1px 8px";
      btn.style.background = "var(--di-bg, #fff)";
      btn.style.color = "var(--di-text, #333)";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "11px";
      btn.style.transition = "all 0.2s";
      downvoteContainer.appendChild(btn);
      downvoteButtons.push(btn);
    });
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "<";
    resetBtn.style.position = "absolute";
    resetBtn.style.bottom = "10px";
    resetBtn.style.left = "15px";
    resetBtn.style.zIndex = "5";
    resetBtn.style.border = "1px solid var(--di-border-input, #ddd)";
    resetBtn.style.background = "var(--di-bg, #fff)";
    resetBtn.style.color = "var(--di-text, #333)";
    resetBtn.style.borderRadius = "4px";
    resetBtn.style.padding = "2px 8px";
    resetBtn.style.cursor = "pointer";
    resetBtn.style.fontSize = "11px";
    resetBtn.style.display = "none";
    scatterDiv.appendChild(resetBtn);
    const yearLabel = document.createElement("div");
    yearLabel.style.position = "absolute";
    yearLabel.style.bottom = "40px";
    yearLabel.style.left = "15px";
    yearLabel.style.zIndex = "4";
    yearLabel.style.fontSize = "16px";
    yearLabel.style.fontWeight = "bold";
    yearLabel.style.color = "var(--di-text, #333)";
    yearLabel.style.pointerEvents = "none";
    yearLabel.style.display = "none";
    scatterDiv.appendChild(yearLabel);
    const filterContainer = document.createElement("div");
    filterContainer.className = "di-scatter-filter";
    filterContainer.style.position = "absolute";
    filterContainer.style.top = "15px";
    filterContainer.style.right = "15px";
    filterContainer.style.zIndex = "5";
    filterContainer.style.background = "var(--di-bg-glass, rgba(255, 255, 255, 0.9))";
    filterContainer.style.padding = "2px 8px";
    filterContainer.style.borderRadius = "12px";
    filterContainer.style.border = "1px solid var(--di-border-light, #eee)";
    filterContainer.style.display = "flex";
    filterContainer.style.alignItems = "center";
    filterContainer.style.gap = "15px";
    const countLabel = document.createElement("span");
    countLabel.textContent = "...";
    countLabel.style.fontSize = "12px";
    countLabel.style.fontWeight = "bold";
    countLabel.style.color = "var(--di-text, #333)";
    countLabel.style.marginRight = "5px";
    filterContainer.appendChild(countLabel);
    const ratingSpecs = [
      { key: "g", label: "G", color: "#4caf50" },
      { key: "s", label: "S", color: "#ffb74d" },
      { key: "q", label: "Q", color: "#ab47bc" },
      { key: "e", label: "E", color: "#f44336" }
    ];
    const ratingButtons = [];
    ratingSpecs.forEach(({ key, label, color }) => {
      const root = document.createElement("div");
      root.style.display = "flex";
      root.style.alignItems = "center";
      root.style.cursor = "pointer";
      root.style.userSelect = "none";
      root.style.gap = "4px";
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      labelEl.style.fontWeight = "normal";
      labelEl.style.color = "var(--di-text, #333)";
      labelEl.style.fontSize = "12px";
      const circle = document.createElement("div");
      circle.style.width = "16px";
      circle.style.height = "16px";
      circle.style.borderRadius = "50%";
      circle.style.background = color;
      circle.style.boxShadow = "0 1px 3px var(--di-shadow, rgba(0,0,0,0.2))";
      circle.style.transition = "background 0.3s, transform 0.3s";
      root.appendChild(labelEl);
      root.appendChild(circle);
      filterContainer.appendChild(root);
      ratingButtons.push({ key, root, circle, color });
    });
    const canvasContainer = document.createElement("div");
    canvasContainer.style.width = "100%";
    canvasContainer.style.height = "300px";
    canvasContainer.style.position = "relative";
    scatterDiv.appendChild(canvasContainer);
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvasContainer.appendChild(canvas);
    scatterDiv.appendChild(filterContainer);
    scatterDiv.appendChild(downvoteContainer);
    const ctx = canvas.getContext("2d", { alpha: false });
    const overlayDiv = document.createElement("div");
    overlayDiv.style.position = "absolute";
    overlayDiv.style.top = "0";
    overlayDiv.style.left = "0";
    overlayDiv.style.width = "100%";
    overlayDiv.style.height = "100%";
    overlayDiv.style.pointerEvents = "none";
    canvasContainer.appendChild(overlayDiv);
    const y10Hit = document.createElement("div");
    y10Hit.style.cssText = "position:absolute;left:0;width:36px;height:18px;cursor:pointer;display:none;z-index:6;";
    y10Hit.setAttribute("aria-label", "Show posts with less than 10 tags");
    canvasContainer.appendChild(y10Hit);
    const gridHitsContainer = document.createElement("div");
    gridHitsContainer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:6;";
    canvasContainer.appendChild(gridHitsContainer);
    const y10Tooltip = document.createElement("div");
    y10Tooltip.style.cssText = "position:absolute;background:rgba(30,30,30,0.95);color:#fff;padding:10px 14px;border-radius:6px;font-size:12px;z-index:10001;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.2);min-width:200px;";
    document.body.appendChild(y10Tooltip);
    const selectionDiv = document.createElement("div");
    selectionDiv.style.position = "absolute";
    selectionDiv.style.border = "1px dashed #007bff";
    selectionDiv.style.backgroundColor = "rgba(0, 123, 255, 0.2)";
    selectionDiv.style.display = "none";
    selectionDiv.style.pointerEvents = "none";
    canvasContainer.appendChild(selectionDiv);
    const rangeLabel = document.createElement("div");
    rangeLabel.style.cssText = "position:absolute;top:-38px;left:0;right:0;text-align:center;font-size:11px;color:#fff;background:rgba(0,0,0,0.75);padding:3px 10px;border-radius:4px;pointer-events:none;white-space:nowrap;display:none;width:fit-content;margin:0 auto;line-height:1.5;";
    selectionDiv.appendChild(rangeLabel);
    const popover = document.createElement("div");
    popover.id = "scatter-popover-ui";
    popover.style.cssText = "position: fixed; z-index: 10000; background: var(--di-bg, #fff); border: 1px solid var(--di-border, #e1e4e8); border-radius: 4px; box-shadow: 0 4px 12px var(--di-shadow, rgba(0,0,0,0.2)); display: none; max-height: 300px; width: 320px; flex-direction: column; font-family: sans-serif; color: var(--di-text, #333);";
    document.body.appendChild(popover);
    return {
      wrapper,
      scatterDiv,
      canvasContainer,
      canvas,
      ctx,
      overlayDiv,
      toggleContainer,
      toggleButtons,
      downvoteContainer,
      downvoteButtons,
      filterContainer,
      countLabel,
      ratingButtons,
      resetBtn,
      yearLabel,
      y10Hit,
      y10Tooltip,
      gridHitsContainer,
      selectionDiv,
      rangeLabel,
      popover
    };
  }
  function computeScatterScale(state, scatterData, w, h) {
    const padL = 40;
    const padR = 20;
    const padT = 60;
    const padB = 50;
    const drawW = w - padL - padR;
    const drawH = h - padT - padB;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxVal = 0;
    if (state.selectedYear) {
      minX = new Date(state.selectedYear, 0, 1).getTime();
      maxX = new Date(state.selectedYear, 11, 31, 23, 59, 59).getTime();
    } else {
      for (const d of scatterData) {
        if (d.d < minX) minX = d.d;
        if (d.d > maxX) maxX = d.d;
      }
      if (minX === Infinity) {
        minX = Date.now();
        maxX = minX + 864e5;
      } else {
        const startY = new Date(minX).getFullYear();
        minX = new Date(startY, 0, 1).getTime();
      }
    }
    const xRange = maxX - minX || 1;
    for (const d of scatterData) {
      if (d.d >= minX && d.d <= maxX) {
        const val = state.mode === "tags" ? d.t || 0 : d.s;
        if (val > maxVal) maxVal = val;
      }
    }
    if (maxVal === 0) maxVal = 100;
    let stepY = 100;
    if (state.mode === "tags") {
      if (maxVal < 50) stepY = 10;
      else if (maxVal < 200) stepY = 25;
      else stepY = 50;
    } else {
      if (maxVal < 200) stepY = 50;
      else if (maxVal < 1e3) stepY = 100;
      else stepY = 500;
    }
    maxVal = Math.ceil(maxVal / stepY) * stepY;
    if (maxVal < stepY) maxVal = stepY;
    return {
      minDate: minX,
      maxDate: maxX,
      maxVal,
      timeRange: xRange,
      padL,
      padT,
      drawW,
      drawH,
      mode: state.mode,
      stepY
    };
  }
  function filterVisiblePoints(state, scatterData, scale) {
    const dvFilter = state.mode === "score" ? state.activeDownvoteFilter : null;
    return scatterData.filter((d) => {
      if (!state.activeRatingFilters[d.r]) return false;
      if (d.d < scale.minDate || d.d > scale.maxDate) return false;
      if (dvFilter !== null) {
        if (d.dn === void 0) return false;
        if (-d.dn <= dvFilter) return false;
      }
      return true;
    });
  }
  function getEligibleYThresholds(scale) {
    const out = [];
    if (scale.stepY <= 0 || scale.maxVal <= 0) return out;
    for (let val = scale.stepY; val < scale.maxVal; val += scale.stepY) {
      if (scale.mode === "tags" && val === 10) continue;
      out.push(val);
    }
    return out;
  }
  function buildPostsUrlForThreshold(userName, mode, value) {
    const field = mode === "score" ? "score" : "gentags";
    return `/posts?tags=${encodeURIComponent(`user:${userName} ${field}:>=${value}`)}`;
  }
  const PAD_R = 20;
  function drawScatterGrid(ctx, scale, w, canvas) {
    const pal = getPalette(canvas);
    ctx.beginPath();
    ctx.strokeStyle = pal.chartGrid;
    ctx.lineWidth = 1;
    let y10Pos = null;
    const y10Overlaps = scale.mode === "tags" && scale.maxVal >= 10 && 10 % scale.stepY === 0;
    for (let val = 0; val <= scale.maxVal; val += scale.stepY) {
      const y = scale.padT + scale.drawH - val / scale.maxVal * scale.drawH;
      ctx.moveTo(scale.padL, y);
      ctx.lineTo(w - PAD_R, y);
      if (!(y10Overlaps && val === 10)) {
        ctx.fillStyle = pal.textMuted;
        ctx.font = "10px Arial";
        ctx.textAlign = "right";
        ctx.fillText(String(val), scale.padL - 5, y + 3);
      }
      if (val === 10) y10Pos = y;
    }
    ctx.stroke();
    return { y10Pos };
  }
  function drawY10Emphasis(ctx, scale, w, y10Pos) {
    if (scale.mode !== "tags" || scale.maxVal < 10) return y10Pos;
    let actualY10 = y10Pos;
    if (actualY10 === null) {
      actualY10 = scale.padT + scale.drawH - 10 / scale.maxVal * scale.drawH;
    }
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(150, 150, 150, 0.5)";
    ctx.moveTo(scale.padL, actualY10);
    ctx.lineTo(w - PAD_R, actualY10);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#d73a49";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "right";
    ctx.fillText("10", scale.padL - 5, actualY10 + 3);
    return actualY10;
  }
  function drawYThresholdLine(ctx, scale, w, value) {
    if (scale.maxVal <= 0) return;
    const y = scale.padT + scale.drawH - value / scale.maxVal * scale.drawH;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(91, 173, 232, 0.85)";
    ctx.lineWidth = 1;
    ctx.moveTo(scale.padL, y);
    ctx.lineTo(w - PAD_R, y);
    ctx.stroke();
    ctx.restore();
  }
  function drawScatterAxis(ctx, state, scale, w, canvas) {
    const pal = getPalette(canvas);
    ctx.beginPath();
    ctx.strokeStyle = pal.border;
    ctx.moveTo(scale.padL, scale.padT + scale.drawH);
    ctx.lineTo(w - PAD_R, scale.padT + scale.drawH);
    ctx.stroke();
    ctx.fillStyle = pal.chartAxisSecondary;
    ctx.textAlign = "center";
    if (state.selectedYear) {
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec"
      ];
      months.forEach((m, i) => {
        const stepW = scale.drawW / 12;
        const x = scale.padL + stepW * i + stepW / 2;
        ctx.fillText(m, x, scale.padT + scale.drawH + 15);
        if (i > 0) {
          const tickX = scale.padL + stepW * i;
          ctx.beginPath();
          ctx.moveTo(tickX, scale.padT + scale.drawH);
          ctx.lineTo(tickX, scale.padT + scale.drawH + 5);
          ctx.stroke();
        }
      });
    } else {
      const startYear = new Date(scale.minDate).getFullYear();
      const endYear = new Date(scale.maxDate).getFullYear();
      const yearCount = endYear - startYear + 1;
      const useShortYear = yearCount > 0 && scale.drawW / yearCount < 32;
      for (let y = startYear; y <= endYear; y++) {
        const d = new Date(y, 0, 1).getTime();
        const x = scale.padL + (d - scale.minDate) / scale.timeRange * scale.drawW;
        if (x >= scale.padL - 5 && x <= w - PAD_R + 5) {
          const nextD = new Date(y + 1, 0, 1).getTime();
          const xNext = scale.padL + (nextD - scale.minDate) / scale.timeRange * scale.drawW;
          const xCenter = (x + xNext) / 2;
          if (xCenter > scale.padL - 10 && xCenter < w - PAD_R + 10) {
            const label = useShortYear ? String(y % 100).padStart(2, "0") : String(y);
            ctx.fillText(label, xCenter, scale.padT + scale.drawH + 15);
          }
          ctx.beginPath();
          ctx.moveTo(x, scale.padT + scale.drawH);
          ctx.lineTo(x, scale.padT + scale.drawH + 5);
          ctx.stroke();
        }
      }
    }
  }
  function drawScatterPoints(ctx, points, state, scale) {
    const thresholdActive = state.activeYThreshold !== null;
    const y10Active = !thresholdActive && state.y10Highlight && state.mode === "tags";
    const threshold = state.activeYThreshold ?? 0;
    const highlightedPoints = [];
    points.forEach((pt) => {
      const xVal = pt.d;
      const yVal = state.mode === "tags" ? pt.t || 0 : pt.s;
      if (xVal < scale.minDate || xVal > scale.maxDate) return;
      const x = scale.padL + (xVal - scale.minDate) / scale.timeRange * scale.drawW;
      const y = scale.padT + scale.drawH - yVal / scale.maxVal * scale.drawH;
      if (y10Active && (pt.t || 0) < 10) {
        highlightedPoints.push([x, y]);
        return;
      }
      let color = "#ccc";
      if (pt.r === "g") color = "#4caf50";
      else if (pt.r === "s") color = "#ffb74d";
      else if (pt.r === "q") color = "#ab47bc";
      else if (pt.r === "e") color = "#f44336";
      if (y10Active) {
        ctx.globalAlpha = 0.2;
      } else if (thresholdActive) {
        ctx.globalAlpha = yVal >= threshold ? 1 : 0.2;
      }
      ctx.fillStyle = color;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    });
    ctx.globalAlpha = 1;
    if (y10Active) {
      ctx.fillStyle = "#e0115f";
      highlightedPoints.forEach(([x, y]) => {
        ctx.fillRect(x - 2, y - 2, 4, 4);
      });
    }
  }
  function drawScatterOverlays(overlayDiv, scale, context, levelChanges) {
    const addOverlayLine = (dateObjOrStr, color, title, isDashed, thickness = "2px") => {
      const d = new Date(dateObjOrStr).getTime();
      if (d < scale.minDate || d > scale.maxDate) return;
      const x = scale.padL + (d - scale.minDate) / scale.timeRange * scale.drawW;
      const line = document.createElement("div");
      line.style.position = "absolute";
      line.style.left = x + "px";
      line.style.top = scale.padT + "px";
      line.style.height = scale.drawH + "px";
      line.style.borderLeft = `${thickness} ${"dashed"} ${color}`;
      line.style.width = "4px";
      line.style.cursor = "help";
      line.style.pointerEvents = "auto";
      line.title = title;
      overlayDiv.appendChild(line);
    };
    if (context.targetUser && context.targetUser.joinDate) {
      const jd = new Date(context.targetUser.joinDate);
      addOverlayLine(
        jd,
        "#00E676",
        `${jd.toLocaleDateString()}: Joined Danbooru`,
        true,
        "2px"
      );
    }
    if (levelChanges) {
      levelChanges.forEach((lc) => {
        addOverlayLine(
          lc.date,
          "#ff5722",
          `${lc.date.toLocaleDateString()}: ${lc.fromLevel} → ${lc.toLevel}`
        );
      });
    }
    if (scale.mode === "score") {
      addOverlayLine(
        "2021-11-24",
        "#bbb",
        "All users could vote since this day.",
        true,
        "1px"
      );
    }
  }
  function regenerateYGridHits(state, dom, scale, userName, twoStepTap, rerender) {
    dom.gridHitsContainer.innerHTML = "";
    const eligible = getEligibleYThresholds(scale);
    if (eligible.length === 0) return;
    const isTouch = isTouchDevice();
    const fieldLabel = scale.mode === "score" ? "score" : "tag count";
    for (const val of eligible) {
      const pixelY = scale.padT + scale.drawH - val / scale.maxVal * scale.drawH;
      const hit = document.createElement("div");
      hit.style.cssText = `position:absolute;left:0;width:${scale.padL}px;top:${pixelY - 9}px;height:18px;pointer-events:auto;cursor:pointer;`;
      hit.setAttribute("aria-label", `Filter posts with ${fieldLabel} >= ${val}`);
      hit.dataset.threshold = String(val);
      if (!isTouch) {
        hit.addEventListener("mouseenter", () => {
          if (state.activeYThreshold === val) return;
          state.activeYThreshold = val;
          rerender();
        });
        hit.addEventListener("mouseleave", () => {
          if (state.activeYThreshold !== val) return;
          state.activeYThreshold = null;
          rerender();
        });
        hit.addEventListener("click", (e) => {
          e.stopPropagation();
          const url = buildPostsUrlForThreshold(userName, state.mode, val);
          window.open(url, "_blank");
        });
      } else {
        hit.addEventListener("click", (e) => {
          e.stopPropagation();
          twoStepTap.tap(val);
        });
      }
      dom.gridHitsContainer.appendChild(hit);
    }
  }
  function renderScatterCanvas(state, dom, scatterData, context, levelChanges, options, userName, twoStepTap, rerender) {
    const { ctx, canvas, canvasContainer, scatterDiv, overlayDiv } = dom;
    if (!scatterDiv.isConnected || !ctx) return;
    if (!state.dragStart) {
      dom.selectionDiv.style.display = "none";
      dom.popover.style.display = "none";
      hidePostHoverCard();
    }
    const rect = canvasContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }
    const w = rect.width;
    const h = rect.height;
    ctx.fillStyle = getPalette(canvas).chartBg;
    ctx.fillRect(0, 0, w, h);
    overlayDiv.innerHTML = "";
    const newScale = computeScatterScale(state, scatterData, w, h);
    Object.assign(state.scale, newScale);
    if (state.selectedYear) {
      dom.resetBtn.style.display = "block";
      dom.yearLabel.textContent = String(state.selectedYear);
      dom.yearLabel.style.display = "block";
    } else {
      dom.resetBtn.style.display = "none";
      dom.yearLabel.style.display = "none";
    }
    const visiblePoints = filterVisiblePoints(state, scatterData, state.scale);
    if (state.activeYThreshold !== null) {
      const t = state.activeYThreshold;
      const matched = visiblePoints.reduce((acc, d) => {
        const yVal = state.mode === "tags" ? d.t || 0 : d.s;
        return yVal >= t ? acc + 1 : acc;
      }, 0);
      dom.countLabel.textContent = `${matched} items`;
    } else {
      dom.countLabel.textContent = `${visiblePoints.length} items`;
    }
    const { y10Pos } = drawScatterGrid(ctx, state.scale, w, canvas);
    const finalY10 = drawY10Emphasis(ctx, state.scale, w, y10Pos);
    if (state.scale.mode !== "tags" || finalY10 === null || !options.userStats) {
      dom.y10Hit.style.display = "none";
    } else {
      dom.y10Hit.style.display = "block";
      dom.y10Hit.style.top = `${finalY10 - 9}px`;
    }
    if (state.activeYThreshold !== null) {
      drawYThresholdLine(ctx, state.scale, w, state.activeYThreshold);
    }
    regenerateYGridHits(state, dom, state.scale, userName, twoStepTap, rerender);
    drawScatterAxis(ctx, state, state.scale, w, canvas);
    drawScatterPoints(ctx, visiblePoints, state, state.scale);
    drawScatterOverlays(overlayDiv, state.scale, context, levelChanges);
  }
  function updateDownvoteButtonStyles(state, dom) {
    dom.downvoteButtons.forEach((btn) => {
      const t = parseInt(btn.dataset.threshold ?? "0");
      const isActive = state.activeDownvoteFilter === t;
      const isDisabled = state.backfillInProgress || state.backfillFailed;
      btn.disabled = isDisabled;
      btn.style.opacity = isDisabled ? "0.5" : "1";
      btn.style.cursor = isDisabled ? "not-allowed" : "pointer";
      btn.style.background = isActive ? "#d73a49" : "var(--di-bg, #fff)";
      btn.style.color = isActive ? "#fff" : "var(--di-text, #333)";
      btn.style.borderColor = isActive ? "#d73a49" : "var(--di-border-input, #ddd)";
      btn.title = isDisabled ? state.backfillFailed ? "Downvote data unavailable (fetch failed)" : "Backfilling downvote data..." : `Show only posts with more than ${t} downvotes`;
    });
  }
  function updateDownvoteVisibility(state, dom) {
    dom.downvoteContainer.style.display = state.mode === "score" ? "flex" : "none";
  }
  function wireModeToggle(state, dom, rerender, clearYThreshold) {
    dom.toggleButtons.forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.mode;
        if (state.mode === id) return;
        state.mode = id;
        Array.from(dom.toggleContainer.children).forEach((b) => {
          const bEl = b;
          bEl.style.background = bEl.dataset.mode === id ? "var(--di-link, #007bff)" : "var(--di-bg, #fff)";
          bEl.style.color = bEl.dataset.mode === id ? "var(--di-btn-active-text, #fff)" : "var(--di-text, #333)";
        });
        if (id !== "score" && state.activeDownvoteFilter !== null) {
          state.activeDownvoteFilter = null;
          updateDownvoteButtonStyles(state, dom);
        }
        updateDownvoteVisibility(state, dom);
        clearYThreshold();
        rerender();
      };
    });
  }
  function wireDownvoteFilter(state, dom, rerender) {
    dom.downvoteButtons.forEach((btn) => {
      btn.onclick = () => {
        if (btn.disabled) return;
        const t = parseInt(btn.dataset.threshold ?? "0");
        if (state.activeDownvoteFilter === t) {
          state.activeDownvoteFilter = null;
        } else {
          state.activeDownvoteFilter = t;
        }
        updateDownvoteButtonStyles(state, dom);
        rerender();
      };
    });
    updateDownvoteButtonStyles(state, dom);
  }
  function wireRatingFilter(state, dom, rerender) {
    dom.ratingButtons.forEach(({ key, root, circle, color }) => {
      root.onclick = () => {
        state.activeRatingFilters[key] = !state.activeRatingFilters[key];
        if (state.activeRatingFilters[key]) {
          circle.style.background = color;
          circle.style.opacity = "1";
        } else {
          circle.style.background = "#e0e0e0";
          circle.style.opacity = "0.7";
        }
        rerender();
      };
    });
  }
  function wireYearReset(state, dom, rerender, clearYThreshold) {
    dom.resetBtn.onclick = () => {
      state.selectedYear = null;
      dom.resetBtn.style.display = "none";
      dom.yearLabel.style.display = "none";
      clearYThreshold();
      rerender();
    };
  }
  function wireY10Tooltip(state, dom, options, context, rerender) {
    const closeY10Tooltip = () => {
      dom.y10Tooltip.style.display = "none";
      state.y10Highlight = false;
      rerender();
    };
    document.addEventListener("click", (e) => {
      if (dom.y10Tooltip.style.display === "none") return;
      if (e.target === dom.y10Hit || dom.y10Tooltip.contains(e.target))
        return;
      closeY10Tooltip();
    });
    dom.y10Hit.addEventListener("mouseenter", () => {
      if (dom.y10Tooltip.style.display !== "none") return;
      state.y10Highlight = true;
      rerender();
    });
    dom.y10Hit.addEventListener("mouseleave", () => {
      if (dom.y10Tooltip.style.display !== "none") return;
      state.y10Highlight = false;
      rerender();
    });
    dom.y10Hit.onclick = (e) => {
      e.stopPropagation();
      if (!options.userStats) return;
      state.y10Highlight = true;
      rerender();
      const { gentags_lt_10, tagcount_lt_10 } = options.userStats;
      const userName = context.targetUser?.normalizedName ?? "";
      const gentagsUrl = `/posts?tags=${encodeURIComponent(`user:${userName} gentags:<10`)}`;
      const tagcountUrl = `/posts?tags=${encodeURIComponent(`user:${userName} tagcount:<10`)}`;
      dom.y10Tooltip.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:4px;">Posts with &lt; 10 tags</div>
      <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:4px;">
        <span style="color:#ccc;">General &lt; 10:</span>
        <a href="${gentagsUrl}" target="_blank" style="color:#5dade2;font-weight:bold;text-decoration:none;">${gentags_lt_10.toLocaleString()} →</a>
      </div>
      <div style="display:flex;justify-content:space-between;gap:12px;">
        <span style="color:#ccc;">Total &lt; 10:</span>
        <a href="${tagcountUrl}" target="_blank" style="color:#5dade2;font-weight:bold;text-decoration:none;">${tagcount_lt_10.toLocaleString()} →</a>
      </div>
    `;
      const rect = dom.y10Hit.getBoundingClientRect();
      dom.y10Tooltip.style.display = "block";
      dom.y10Tooltip.style.left = `${rect.right + window.scrollX + 8}px`;
      dom.y10Tooltip.style.top = `${rect.top + window.scrollY + rect.height / 2 - dom.y10Tooltip.offsetHeight / 2}px`;
      const tt = dom.y10Tooltip.getBoundingClientRect();
      if (tt.right > window.innerWidth - 8) {
        dom.y10Tooltip.style.left = `${rect.left + window.scrollX - tt.width - 8}px`;
      }
      if (tt.top < 8) dom.y10Tooltip.style.top = `${window.scrollY + 8}px`;
    };
  }
  function wireBackfillUi(state, dom, options, scatterData, rerender) {
    if (!options.needsBackfill || !options.runBackfill) return;
    const progressLabel = document.createElement("span");
    progressLabel.style.cssText = "font-size:10px;color:var(--di-text-secondary, #666);margin-left:6px;";
    progressLabel.textContent = "updating…";
    dom.downvoteContainer.appendChild(progressLabel);
    options.runBackfill((cur, total) => {
      if (total > 0) {
        const pct = Math.round(cur / total * 100);
        progressLabel.textContent = `${pct}%`;
      }
    }).then(async () => {
      state.backfillInProgress = false;
      progressLabel.remove();
      updateDownvoteButtonStyles(state, dom);
      if (options.refreshScatterData) {
        try {
          const fresh = await options.refreshScatterData();
          scatterData.length = 0;
          scatterData.push(...fresh);
          rerender();
        } catch (e) {
          log$6.warn("Refresh after backfill failed", { error: e });
        }
      }
    }).catch((e) => {
      log$6.warn("Backfill failed", { error: e });
      state.backfillInProgress = false;
      state.backfillFailed = true;
      progressLabel.textContent = "failed";
      updateDownvoteButtonStyles(state, dom);
    });
  }
  function wireYearZoom(state, dom, rerender, clearYThreshold) {
    dom.canvas.addEventListener("click", (e) => {
      if (Date.now() - state.lastDragEndTime < 100) return;
      const rect = dom.canvasContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const axisY = state.scale.padT + state.scale.drawH;
      if (y > axisY && y < axisY + 40 && !state.selectedYear) {
        const t = (x - state.scale.padL) / state.scale.drawW * state.scale.timeRange + state.scale.minDate;
        const clickedDate = new Date(t);
        const clickedYear = clickedDate.getFullYear();
        if (clickedYear >= new Date(state.scale.minDate).getFullYear() && clickedYear <= new Date(state.scale.maxDate).getFullYear()) {
          clearYThreshold();
          state.selectedYear = clickedYear;
          rerender();
        }
      }
    });
    dom.canvas.addEventListener("mousemove", (e) => {
      if (state.dragStart) return;
      const rect = dom.canvasContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let isHand = false;
      const axisY = state.scale.padT + state.scale.drawH;
      if (y > axisY && y < axisY + 40 && !state.selectedYear) {
        const t = (x - state.scale.padL) / state.scale.drawW * state.scale.timeRange + state.scale.minDate;
        const hoveredYear = new Date(t).getFullYear();
        if (hoveredYear >= new Date(state.scale.minDate).getFullYear() && hoveredYear <= new Date(state.scale.maxDate).getFullYear()) {
          isHand = true;
        }
      }
      dom.canvas.style.cursor = isHand ? "pointer" : "crosshair";
    });
  }
  function wireDragSelection(state, dom, scatterData, showPopover, clearYThreshold) {
    const isTouch = isTouchDevice();
    dom.canvas.style.cursor = isTouch ? "default" : "crosshair";
    if (isTouch) return;
    dom.canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      state.ignoreNextClick = false;
      const rect = dom.canvasContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < state.scale.padL || x > state.scale.padL + state.scale.drawW || y < state.scale.padT || y > state.scale.padT + state.scale.drawH)
        return;
      state.dragStart = { x, y };
      dom.selectionDiv.style.left = x + "px";
      dom.selectionDiv.style.top = y + "px";
      dom.selectionDiv.style.width = "0px";
      dom.selectionDiv.style.height = "0px";
      dom.selectionDiv.style.display = "block";
    });
    let rangeLabelTimer = null;
    const updateRangeLabel = (x1, x2, y1, y2) => {
      if (rangeLabelTimer) clearTimeout(rangeLabelTimer);
      rangeLabelTimer = setTimeout(() => {
        const xMin = (Math.min(x1, x2) - state.scale.padL) / state.scale.drawW * state.scale.timeRange + state.scale.minDate;
        const xMax = (Math.max(x1, x2) - state.scale.padL) / state.scale.drawW * state.scale.timeRange + state.scale.minDate;
        const valMin = (state.scale.padT + state.scale.drawH - Math.max(y1, y2)) / state.scale.drawH * state.scale.maxVal;
        const valMax = (state.scale.padT + state.scale.drawH - Math.min(y1, y2)) / state.scale.drawH * state.scale.maxVal;
        const dvSel = state.scale.mode === "score" ? state.activeDownvoteFilter : null;
        const count = scatterData.filter((d) => {
          if (!state.activeRatingFilters[d.r]) return false;
          if (dvSel !== null) {
            if (d.dn === void 0) return false;
            if (-d.dn <= dvSel) return false;
          }
          const yVal = state.scale.mode === "tags" ? d.t || 0 : d.s;
          return d.d >= xMin && d.d <= xMax && yVal >= valMin && yVal <= valMax;
        }).length;
        const d1 = new Date(xMin).toISOString().slice(0, 10);
        const d2 = new Date(xMax).toISOString().slice(0, 10);
        const valLabel = state.scale.mode === "tags" ? "Tags" : "Score";
        dom.rangeLabel.innerHTML = `${d1} ~ ${d2}<br>${valLabel}: ${Math.round(valMin)} ~ ${Math.round(valMax)} · ${count.toLocaleString()} posts`;
        dom.rangeLabel.style.display = "block";
      }, 50);
    };
    window.addEventListener("mousemove", (e) => {
      if (!state.dragStart) return;
      const rect = dom.canvasContainer.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const rL = state.scale.padL;
      const rT = state.scale.padT;
      const rW = state.scale.drawW;
      const currentX = Math.max(rL, Math.min(rL + rW, mx));
      const currentY = Math.max(rT, Math.min(rect.height, my));
      const x = Math.min(state.dragStart.x, currentX);
      const y = Math.min(state.dragStart.y, currentY);
      const w = Math.abs(currentX - state.dragStart.x);
      const h = Math.abs(currentY - state.dragStart.y);
      dom.selectionDiv.style.left = x + "px";
      dom.selectionDiv.style.top = y + "px";
      dom.selectionDiv.style.width = w + "px";
      dom.selectionDiv.style.height = h + "px";
      updateRangeLabel(state.dragStart.x, currentX, state.dragStart.y, currentY);
    });
    window.addEventListener("mouseup", (e) => {
      if (!state.dragStart) return;
      const ds = state.dragStart;
      state.dragStart = null;
      dom.rangeLabel.style.display = "none";
      if (rangeLabelTimer) {
        clearTimeout(rangeLabelTimer);
        rangeLabelTimer = null;
      }
      const rect = dom.canvasContainer.getBoundingClientRect();
      const endX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const endY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      if (Math.abs(endX - ds.x) >= 5 || Math.abs(endY - ds.y) >= 5) {
        state.ignoreNextClick = true;
        state.lastDragEndTime = Date.now();
        clearYThreshold();
      }
      if (Math.abs(endX - ds.x) < 5 && Math.abs(endY - ds.y) < 5) {
        dom.selectionDiv.style.display = "none";
        return;
      }
      const x1 = Math.min(ds.x, endX);
      const x2 = Math.max(ds.x, endX);
      const y1 = Math.min(ds.y, endY);
      const y2 = Math.max(ds.y, endY);
      const xMin = (x1 - state.scale.padL) / state.scale.drawW * state.scale.timeRange + state.scale.minDate;
      const xMax = (x2 - state.scale.padL) / state.scale.drawW * state.scale.timeRange + state.scale.minDate;
      const valMin = (state.scale.padT + state.scale.drawH - y2) / state.scale.drawH * state.scale.maxVal;
      const valMax = (state.scale.padT + state.scale.drawH - y1) / state.scale.drawH * state.scale.maxVal;
      const dvRes = state.scale.mode === "score" ? state.activeDownvoteFilter : null;
      const result = scatterData.filter((d) => {
        if (!state.activeRatingFilters[d.r]) return false;
        if (dvRes !== null) {
          if (d.dn === void 0) return false;
          if (-d.dn <= dvRes) return false;
        }
        const yVal = state.scale.mode === "tags" ? d.t || 0 : d.s;
        return d.d >= xMin && d.d <= xMax && yVal >= valMin && yVal <= valMax;
      });
      if (result.length === 0) {
        dom.selectionDiv.style.display = "none";
        return;
      }
      const sortedList = result.sort((a, b) => {
        const vA = state.scale.mode === "tags" ? a.t || 0 : a.s;
        const vB = state.scale.mode === "tags" ? b.t || 0 : b.s;
        return vB - vA;
      });
      let aDMin = Infinity, aDMax = -Infinity;
      let aVMin = Infinity, aVMax = -Infinity;
      sortedList.forEach((d) => {
        if (d.d < aDMin) aDMin = d.d;
        if (d.d > aDMax) aDMax = d.d;
        const v = state.scale.mode === "tags" ? d.t || 0 : d.s;
        if (v < aVMin) aVMin = v;
        if (v > aVMax) aVMax = v;
      });
      showPopover(e.clientX, e.clientY, sortedList, aDMin, aDMax, aVMin, aVMax);
    });
  }
  function createScatterPopover(state, dom, options) {
    document.addEventListener("mousedown", (e) => {
      if (dom.popover.style.display !== "none" && !dom.popover.contains(e.target)) {
        dom.popover.style.display = "none";
        dom.selectionDiv.style.display = "none";
        hidePostHoverCard();
      }
    });
    return (mx, my, items, dMin, dMax, sMin, sMax) => {
      const xLabel = `${new Date(dMin).toLocaleDateString()} ~ ${new Date(dMax).toLocaleDateString()}`;
      const sm1 = Math.floor(sMin);
      const sm2 = Math.ceil(sMax);
      const totalCount = items.length;
      const isTags = state.scale.mode === "tags";
      let visibleLimit = 50;
      const renderItems = (start, limit) => {
        let chunkHtml = "";
        const slice = items.slice(start, start + limit);
        slice.forEach((it) => {
          const itDate = new Date(it.d).toLocaleDateString();
          const val = isTags ? it.t || 0 : it.s;
          const isRemoved = it.del === true || it.ban === true;
          let color = "#ccc";
          if (isRemoved) {
            color = "#9ca3af";
          } else if (it.r === "g") color = "#4caf50";
          else if (it.r === "s") color = "#ffb74d";
          else if (it.r === "q") color = "#ab47bc";
          else if (it.r === "e") color = "#f44336";
          const statusTitle = it.ban === true ? "Banned" : it.del === true ? "Deleted" : "";
          const titleAttr = statusTitle ? ` title="${statusTitle}"` : "";
          chunkHtml += `
         <div class="pop-item" data-id="${it.id}" style="padding: 8px 15px; border-bottom: 1px solid var(--di-table-border, #f0f0f0); display: flex; align-items: center; cursor: pointer; transition: bg 0.2s;">
           <div${titleAttr} style="width: 10px; height: 10px; border-radius: 50%; background: ${color}; margin-right: 10px;"></div>
           <span style="width: 60px; color: var(--di-link, #007bff); font-weight: 500; font-size: 13px; margin-right: 10px;">#${it.id}</span>
           <span style="flex: 1; color: var(--di-text-secondary, #666); font-size: 12px;">${itDate}</span>
           <span style="font-weight: bold; color: var(--di-text, #333); font-size: 13px;">${val}</span>
         </div>
       `;
        });
        return chunkHtml;
      };
      const headerHtml = `
     <div style="padding: 10px 15px; background: var(--di-bg-secondary, #f9f9f9); border-bottom: 1px solid var(--di-border-light, #eee); display: flex; justify-content: space-between; align-items: start;">
       <div style="display:flex; flex-direction:column;">
          <span style="font-weight: 600; font-size: 13px; color: var(--di-text, #333);">${xLabel}</span>
          <span style="font-size: 11px; color: var(--di-text-secondary, #666); margin-top:2px;">${isTags ? "Tag Count" : "Score"}: ${sm1} ~ ${sm2}</span>
       </div>
       <div style="display:flex; align-items:center; gap: 10px; margin-top:2px;">
         <span id="pop-count-label" style="font-size: 12px; color: var(--di-text-muted, #888);">${Math.min(visibleLimit, totalCount)} / ${totalCount} items</span>
         <button id="scatter-pop-close" style="background:none; border:none; color:var(--di-text-faint, #999); font-size:16px; cursor:pointer; line-height:1; padding:0;">&times;</button>
       </div>
     </div>
     <div id="pop-list-container" style="flex: 1; overflow-y: auto;">
       ${renderItems(0, visibleLimit)}
     </div>
     <div id="pop-load-more" style="display: ${totalCount > visibleLimit ? "block" : "none"}; padding: 10px; text-align: center; border-top: 1px solid var(--di-border-light, #eee); background: var(--di-bg, #fff);">
        <button id="btn-load-more" style="width: 100%; padding: 6px; background: var(--di-bg-tertiary, #f0f0f0); border: none; border-radius: 4px; color: var(--di-text-secondary, #666); cursor: pointer; font-size: 12px;">Load More (+50)</button>
     </div>
   `;
      dom.popover.innerHTML = headerHtml;
      const attachEvents = (parent) => {
        if (!parent) return;
        parent.querySelectorAll(".pop-item").forEach((el) => {
          const htmlEl = el;
          htmlEl.onmouseover = () => htmlEl.style.backgroundColor = "#f5f9ff";
          htmlEl.onmouseout = () => htmlEl.style.backgroundColor = "transparent";
          htmlEl.onclick = () => window.open(`/posts/${htmlEl.dataset.id}`, "_blank");
          if (options.fetchPostDetails) {
            const postId = parseInt(htmlEl.dataset.id ?? "0");
            if (postId)
              attachPostHoverCard(
                htmlEl,
                postId,
                options.fetchPostDetails,
                dom.popover
              );
          }
        });
      };
      attachEvents(dom.popover.querySelector("#pop-list-container"));
      const closeBtn = dom.popover.querySelector(
        "#scatter-pop-close"
      );
      if (closeBtn) {
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          dom.popover.style.display = "none";
          dom.selectionDiv.style.display = "none";
          hidePostHoverCard();
        };
      }
      const loadMoreContainer = dom.popover.querySelector(
        "#pop-load-more"
      );
      const loadMoreBtn = dom.popover.querySelector(
        "#btn-load-more"
      );
      const listContainer = dom.popover.querySelector(
        "#pop-list-container"
      );
      const popCountLabel = dom.popover.querySelector(
        "#pop-count-label"
      );
      if (loadMoreBtn) {
        loadMoreBtn.onclick = () => {
          const start = visibleLimit;
          visibleLimit += 50;
          const newHtml = renderItems(start, 50);
          listContainer.insertAdjacentHTML("beforeend", newHtml);
          attachEvents(listContainer);
          popCountLabel.textContent = `${Math.min(visibleLimit, totalCount)} / ${totalCount} items`;
          if (visibleLimit >= totalCount) {
            loadMoreContainer.style.display = "none";
          }
        };
      }
      const themedAncestor = dom.wrapper.closest("[data-di-theme]");
      if (themedAncestor?.getAttribute("data-di-theme") === "dark") {
        dom.popover.setAttribute("data-di-theme", "dark");
      } else {
        dom.popover.removeAttribute("data-di-theme");
      }
      dom.popover.style.display = "flex";
      const pH = dom.popover.offsetHeight || 300;
      let posX = mx + 15;
      let posY = my + 15;
      if (posX + 320 > window.innerWidth) posX = window.innerWidth - 320 - 10;
      if (posX < 10) posX = 10;
      if (posY + pH > window.innerHeight) posY = window.innerHeight - pH - 10;
      if (posY < 10) posY = 10;
      dom.popover.style.left = posX + "px";
      dom.popover.style.top = posY + "px";
    };
  }
  function renderScatterPlot(container2, scatterData, context, levelChanges, options = {}) {
    const dom = buildScatterDom();
    const state = createInitialScatterState(options);
    const userName = context.targetUser?.normalizedName ?? "";
    const twoStepTap = createTwoStepTap({
      insideElements: () => Array.from(dom.gridHitsContainer.children),
      onFirstTap: (val) => {
        state.activeYThreshold = val;
        rerender();
      },
      onSecondTap: (val) => {
        const url = buildPostsUrlForThreshold(userName, state.mode, val);
        state.activeYThreshold = null;
        rerender();
        window.open(url, "_blank");
      },
      onReset: () => {
        state.activeYThreshold = null;
        rerender();
      }
    });
    const clearYThreshold = () => {
      if (state.activeYThreshold !== null) {
        state.activeYThreshold = null;
        twoStepTap.reset();
      }
    };
    const rerender = () => renderScatterCanvas(
      state,
      dom,
      scatterData,
      context,
      levelChanges,
      options,
      userName,
      twoStepTap,
      rerender
    );
    wireModeToggle(state, dom, rerender, clearYThreshold);
    wireDownvoteFilter(state, dom, rerender);
    wireRatingFilter(state, dom, rerender);
    wireYearReset(state, dom, rerender, clearYThreshold);
    wireY10Tooltip(state, dom, options, context, rerender);
    const showPopover = createScatterPopover(state, dom, options);
    wireYearZoom(state, dom, rerender, clearYThreshold);
    wireDragSelection(state, dom, scatterData, showPopover, clearYThreshold);
    updateDownvoteVisibility(state, dom);
    container2.appendChild(dom.wrapper);
    wireBackfillUi(state, dom, options, scatterData, rerender);
    requestAnimationFrame(rerender);
    window.addEventListener("resize", rerender);
  }
  const log$5 = createLogger("TagCloud");
  const CLOUD_HEIGHT = 320;
  const TOP_WEIGHT_PERCENTILE = 0.2;
  const TRANSITION_MS = 350;
  function computeFontSizes(items, minFont = 11, maxFont = 38) {
    if (items.length === 0) return [];
    const freqs = items.map((d) => d.frequency);
    const minFreq = Math.min(...freqs);
    const maxFreq = Math.max(...freqs);
    const logMin = Math.log(minFreq);
    const logMax = Math.log(maxFreq);
    const logRange = logMax - logMin;
    const boldThreshold = Math.ceil(items.length * TOP_WEIGHT_PERCENTILE);
    return items.map((item, i) => ({
      text: item.name,
      tagName: item.tagName,
      frequency: item.frequency,
      count: item.count,
      size: logRange > 0 ? minFont + (Math.log(item.frequency) - logMin) / logRange * (maxFont - minFont) : (minFont + maxFont) / 2,
      bold: i < boldThreshold
    }));
  }
  function renderTagCloudWidget(container2, options) {
    const { initialData, fetchData, userName, categories } = options;
    const isMobile = window.innerWidth <= 768;
    const MIN_FONT = isMobile ? 10 : 11;
    const MAX_FONT = isMobile ? 26 : 38;
    const isTouch = isTouchDevice();
    const cloudData = {};
    const layoutCache = {};
    let currentTab = categories[0]?.id ?? 0;
    cloudData[currentTab] = initialData;
    container2.style.background = "var(--di-bg, #fff)";
    container2.style.border = "1px solid var(--di-border, #e1e4e8)";
    container2.style.borderRadius = "8px";
    container2.style.padding = "15px";
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";
    const title = document.createElement("div");
    title.style.cssText = "font-size:0.9em;color:var(--di-text-secondary, #666);font-weight:bold;";
    title.textContent = "🏷️ Tag Cloud";
    const tabsDiv = document.createElement("div");
    tabsDiv.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";
    for (const cat of categories) {
      const btn = document.createElement("button");
      btn.className = "di-pie-tab";
      btn.dataset.catId = String(cat.id);
      btn.textContent = cat.label;
      if (cat.id === currentTab) btn.classList.add("active");
      tabsDiv.appendChild(btn);
    }
    header.appendChild(title);
    header.appendChild(tabsDiv);
    container2.appendChild(header);
    const cloudContainer = document.createElement("div");
    cloudContainer.className = "di-tag-cloud-container";
    cloudContainer.style.position = "relative";
    cloudContainer.style.minHeight = `${CLOUD_HEIGHT}px`;
    container2.appendChild(cloudContainer);
    const cloudTooltip = document.createElement("div");
    cloudTooltip.className = "di-tag-cloud-mobile-tooltip";
    cloudTooltip.style.cssText = `position:absolute;background:rgba(30,30,30,0.95);color:#fff;padding:8px 12px;border-radius:6px;font-size:12px;pointer-events:${isTouch ? "auto" : "none"};cursor:${isTouch ? "pointer" : "default"};opacity:0;z-index:99999;transition:opacity 0.15s;white-space:nowrap;`;
    document.body.appendChild(cloudTooltip);
    const tooltip = d3__namespace.select("body").selectAll(".di-tag-cloud-tooltip").data([0]).join("div").attr("class", "di-tag-cloud-tooltip").style("position", "absolute").style("background", "rgba(30, 30, 30, 0.95)").style("color", "#fff").style("padding", "5px 10px").style("border-radius", "6px").style("font-size", "12px").style("pointer-events", "none").style("z-index", "2147483647").style("opacity", "0").style("white-space", "nowrap");
    let tapController = null;
    if (isTouch) {
      const resetCloudVisuals = () => {
        cloudTooltip.style.opacity = "0";
        d3__namespace.select(cloudContainer).selectAll("text").style("opacity", 1).style("font-size", (d) => `${d.size}px`);
      };
      tapController = createTwoStepTap({
        insideElements: () => [cloudContainer.querySelector("svg"), cloudTooltip],
        onFirstTap: () => {
        },
        onSecondTap: (tagName) => {
          const query = `user:${userName} ${tagName}`;
          window.open(`/posts?tags=${encodeURIComponent(query)}`, "_blank");
          resetCloudVisuals();
        },
        onReset: resetCloudVisuals,
        resetOnScroll: true,
        isEqual: (a, b) => a === b
      });
      cloudTooltip.addEventListener("click", () => {
        tapController?.navigateActive();
      });
    }
    const getCurrentColor = () => {
      return categories.find((c) => c.id === currentTab)?.color ?? "#0075f8";
    };
    const createCloudSvg = (placedWords, width, color, startOpacity) => {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;opacity:${startOpacity};transition:opacity ${TRANSITION_MS}ms ease;`;
      const svg = d3__namespace.select(wrapper).append("svg").attr("width", width).attr("height", CLOUD_HEIGHT).style("overflow", "hidden");
      const g = svg.append("g").attr("transform", `translate(${width / 2},${CLOUD_HEIGHT / 2})`);
      g.selectAll("text").data(placedWords).join("text").attr("class", "di-tag-cloud-word").style("font-size", (d) => `${d.size}px`).style("font-weight", (d) => d.bold ? "700" : "500").style("font-family", "sans-serif").style("fill", color).attr("text-anchor", "middle").attr(
        "transform",
        (d) => `translate(${d.x},${d.y})rotate(${d.rotate || 0})`
      ).text((d) => d.text).style("pointer-events", "all").style("paint-order", "stroke").style("stroke", "transparent").style("stroke-width", isTouch ? "8px" : "0px").on("mouseover", function(event, d) {
        if (isTouch) return;
        g.selectAll("text").style("opacity", 0.25);
        d3__namespace.select(this).style("opacity", 1).style("font-size", `${d.size * 1.08}px`);
        tooltip.html(
          `<strong>${d.text}</strong> — ${(d.frequency * 100).toFixed(2)}% · ${d.count.toLocaleString()} posts`
        ).style("left", `${event.pageX + 15}px`).style("top", `${event.pageY + 15}px`).style("opacity", "1");
      }).on("mousemove", (event) => {
        if (isTouch) return;
        tooltip.style("left", `${event.pageX + 15}px`).style("top", `${event.pageY + 15}px`);
      }).on("mouseout", function(_event, d) {
        if (isTouch) return;
        g.selectAll("text").style("opacity", 1);
        d3__namespace.select(this).style("font-size", `${d.size}px`);
        tooltip.style("opacity", "0");
      }).on("click", function(_event, d) {
        if (tapController) {
          const tagName = d.tagName;
          if (tapController.active === tagName) {
            tapController.reset();
            return;
          }
          tapController.tap(tagName);
          g.selectAll("text").style("opacity", 0.2).style("font-size", (wd) => `${wd.size}px`);
          d3__namespace.select(this).style("opacity", 1).style("font-size", `${d.size * 1.08}px`);
          cloudTooltip.innerHTML = `<strong>${d.text}</strong> — ${(d.frequency * 100).toFixed(2)}% · ${d.count.toLocaleString()} posts`;
          cloudTooltip.style.opacity = "1";
          const rect = this.getBoundingClientRect();
          cloudTooltip.style.left = `${rect.left + window.scrollX + rect.width / 2 - cloudTooltip.offsetWidth / 2}px`;
          cloudTooltip.style.top = `${rect.top + window.scrollY - cloudTooltip.offsetHeight - 8}px`;
          return;
        }
        const query = `user:${userName} ${d.tagName}`;
        window.open(`/posts?tags=${encodeURIComponent(query)}`, "_blank");
      });
      return wrapper;
    };
    const crossfadeTo = (placedWords, width, color) => {
      const oldChildren = Array.from(cloudContainer.children);
      const newWrapper = createCloudSvg(placedWords, width, color, "0");
      cloudContainer.appendChild(newWrapper);
      requestAnimationFrame(() => {
        for (const el of oldChildren) {
          el.style.transition = `opacity ${TRANSITION_MS}ms ease`;
          el.style.opacity = "0";
        }
        newWrapper.style.opacity = "1";
        setTimeout(() => {
          for (const el of oldChildren) {
            if (el.parentNode === cloudContainer) cloudContainer.removeChild(el);
          }
        }, TRANSITION_MS);
      });
    };
    const computeAndRender = (data, crossfade) => {
      const width = Math.max(container2.clientWidth - 30, 300);
      const color = getCurrentColor();
      if (layoutCache[currentTab]) {
        if (crossfade) {
          crossfadeTo(layoutCache[currentTab], width, color);
        } else {
          cloudContainer.innerHTML = "";
          const wrapper = createCloudSvg(
            layoutCache[currentTab],
            width,
            color,
            "1"
          );
          cloudContainer.appendChild(wrapper);
        }
        return;
      }
      const words = computeFontSizes(data, MIN_FONT, MAX_FONT);
      const cloud = d3__namespace.layout.cloud;
      if (!cloud) {
        cloudContainer.innerHTML = '<div style="color:#c00;">d3-cloud library not loaded</div>';
        return;
      }
      cloud().size([width, CLOUD_HEIGHT]).words(words.map((w) => ({ ...w }))).padding(4).rotate(() => 0).font("sans-serif").fontSize((d) => d.size).on("end", (placedWords) => {
        layoutCache[currentTab] = placedWords;
        if (crossfade) {
          crossfadeTo(placedWords, width, color);
        } else {
          cloudContainer.innerHTML = "";
          const wrapper = createCloudSvg(placedWords, width, color, "1");
          cloudContainer.appendChild(wrapper);
        }
      }).start();
    };
    const loadTab = async (categoryId, crossfade) => {
      if (cloudData[categoryId]) {
        computeAndRender(cloudData[categoryId], crossfade);
        return;
      }
      const oldChildren = Array.from(cloudContainer.children);
      const loadingDiv = document.createElement("div");
      loadingDiv.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity ${TRANSITION_MS}ms ease;`;
      loadingDiv.innerHTML = '<span style="color:var(--di-text-muted, #888);font-size:0.9em;">Loading...</span>';
      cloudContainer.appendChild(loadingDiv);
      requestAnimationFrame(() => {
        for (const el of oldChildren) {
          el.style.transition = `opacity ${TRANSITION_MS}ms ease`;
          el.style.opacity = "0";
        }
        loadingDiv.style.opacity = "1";
        setTimeout(() => {
          for (const el of oldChildren) {
            if (el.parentNode === cloudContainer) cloudContainer.removeChild(el);
          }
        }, TRANSITION_MS);
      });
      try {
        const data = await fetchData(categoryId);
        cloudData[categoryId] = data;
        if (currentTab === categoryId) {
          computeAndRender(data, true);
        }
      } catch (e) {
        log$5.debug("Tag cloud tab load failed", { error: e });
        if (currentTab === categoryId) {
          cloudContainer.innerHTML = '<div style="color:#c00;font-size:0.9em;">Failed to load data</div>';
        }
      }
    };
    tabsDiv.addEventListener("click", (e) => {
      const btn = e.target.closest(
        ".di-pie-tab"
      );
      if (!btn || !btn.dataset.catId) return;
      const catId = parseInt(btn.dataset.catId);
      if (catId === currentTab) return;
      currentTab = catId;
      if (tapController) tapController.reset();
      tabsDiv.querySelectorAll(".di-pie-tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      void loadTab(catId, true);
    });
    void loadTab(currentTab, false);
  }
  const log$4 = createLogger("CreatedTags");
  const PAGE_SIZE = 20;
  const SORT_LABELS = {
    posts: "Posts",
    name: "Name",
    date: "Date"
  };
  const SORT_DEFAULT_DIR = {
    posts: "desc",
    name: "asc",
    date: "desc"
  };
  function renderCreatedTagsWidget(container2, dataManager, targetUser) {
    let items = [];
    let sortMode = "posts";
    let sortDir = SORT_DEFAULT_DIR.posts;
    let currentPage = 0;
    container2.style.background = "var(--di-bg, #fff)";
    container2.style.border = "1px solid var(--di-border, #e1e4e8)";
    container2.style.borderRadius = "8px";
    container2.style.padding = "15px";
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";
    const titleDiv = document.createElement("div");
    titleDiv.style.cssText = "font-size:0.9em;color:var(--di-text-secondary, #666);font-weight:bold;";
    titleDiv.textContent = `🏷️ Tags created by ${targetUser.name}`;
    const controlsDiv = document.createElement("div");
    controlsDiv.style.cssText = "display:flex;align-items:center;gap:8px;";
    controlsDiv.style.display = "none";
    const sortButtons = {};
    const updateSortButtons = () => {
      Object.keys(sortButtons).forEach((mode) => {
        const btn = sortButtons[mode];
        const isActive = mode === sortMode;
        const arrow = isActive ? sortDir === "desc" ? " ▼" : " ▲" : "";
        btn.textContent = SORT_LABELS[mode] + arrow;
        btn.style.background = isActive ? "var(--di-link, #007bff)" : "var(--di-bg, #fff)";
        btn.style.color = isActive ? "#fff" : "var(--di-text-secondary, #666)";
        btn.style.borderColor = isActive ? "var(--di-link, #007bff)" : "var(--di-border-input, #ddd)";
        btn.title = isActive ? `Sorted by ${SORT_LABELS[mode]} (${sortDir === "desc" ? "descending" : "ascending"}). Click to toggle direction.` : `Sort by ${SORT_LABELS[mode]}`;
      });
    };
    ["posts", "name", "date"].forEach((mode) => {
      const btn = document.createElement("button");
      btn.style.cssText = "font-size:11px;padding:2px 8px;border:1px solid var(--di-border-input, #ddd);border-radius:4px;background:var(--di-bg, #fff);color:var(--di-text-secondary, #666);cursor:pointer;transition:all 0.15s;";
      btn.onclick = () => {
        if (sortMode === mode) {
          sortDir = sortDir === "desc" ? "asc" : "desc";
        } else {
          sortMode = mode;
          sortDir = SORT_DEFAULT_DIR[mode];
        }
        currentPage = 0;
        updateSortButtons();
        sortItems();
        renderTable();
      };
      sortButtons[mode] = btn;
      controlsDiv.appendChild(btn);
    });
    header.appendChild(titleDiv);
    header.appendChild(controlsDiv);
    container2.appendChild(header);
    const contentDiv = document.createElement("div");
    contentDiv.className = "di-created-tags-wrap";
    container2.appendChild(contentDiv);
    const getStatusHtml = (item) => {
      if (item.aliasedTo) {
        const aliasDisplay = item.aliasedTo.replace(/_/g, " ");
        return `<span class="di-created-tags-status" style="color:#8250df;background:#f3e8ff;">🔀 <a href="/wiki_pages/${item.aliasedTo}" target="_blank" style="color:#8250df;">${aliasDisplay}</a></span>`;
      }
      if (item.isDeprecated) {
        return '<span class="di-created-tags-status" style="color:#cf222e;background:#ffebe9;">⚠️ Deprecated</span>';
      }
      if (item.postCount === 0) {
        return '<span class="di-created-tags-status" style="color:var(--di-text-muted, #888);background:var(--di-bg-tertiary, #f0f0f0);">➖ Empty</span>';
      }
      return '<span class="di-created-tags-status" style="color:#1a7f37;background:#dafbe1;">✅ Active</span>';
    };
    const sortItems = () => {
      const dir = sortDir === "desc" ? -1 : 1;
      if (sortMode === "posts") {
        items.sort((a, b) => dir * (a.postCount - b.postCount));
      } else if (sortMode === "name") {
        items.sort((a, b) => dir * a.displayName.localeCompare(b.displayName));
      } else if (sortMode === "date") {
        items.sort((a, b) => dir * a.reportDate.localeCompare(b.reportDate));
      }
    };
    const renderTable = () => {
      const totalPages = Math.ceil(items.length / PAGE_SIZE);
      const start = currentPage * PAGE_SIZE;
      const pageItems = items.slice(start, start + PAGE_SIZE);
      let html = `<table class="di-created-tags-table">
      <thead><tr>
        <th>Tag Name</th>
        <th style="text-align:right;">Posts</th>
        <th>Status</th>
        <th>Date</th>
      </tr></thead>
      <tbody>`;
      for (const item of pageItems) {
        const wikiTarget = item.aliasedTo ?? item.tagName;
        html += `<tr class="di-created-tags-row">
        <td><a href="/wiki_pages/${wikiTarget}" target="_blank" style="color:#0075f8;">${item.displayName}</a></td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${item.postCount.toLocaleString()}</td>
        <td>${getStatusHtml(item)}</td>
        <td style="color:var(--di-text-muted, #888);font-size:0.85em;">${item.reportDate}</td>
      </tr>`;
      }
      html += "</tbody></table>";
      if (totalPages > 1) {
        html += '<div style="display:flex;justify-content:center;gap:4px;margin-top:10px;">';
        for (let i = 0; i < totalPages; i++) {
          const active = i === currentPage;
          html += `<button class="di-pie-tab${active ? " active" : ""}" data-page="${i}" style="min-width:28px;">${i + 1}</button>`;
        }
        html += "</div>";
      }
      contentDiv.innerHTML = html;
      contentDiv.querySelectorAll("[data-page]").forEach((btn) => {
        btn.onclick = () => {
          currentPage = parseInt(btn.dataset.page || "0");
          renderTable();
        };
      });
    };
    const loadData = async () => {
      const progressId = "di-created-tags-progress";
      contentDiv.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;padding:30px;color:var(--di-text-muted, #888);">
        <div class="di-spinner" style="width:24px;height:24px;border-width:3px;margin-right:10px;"></div>
        <span id="${progressId}">Initializing...</span>
      </div>`;
      const progressEl = document.getElementById(progressId);
      const onProgress = (msg) => {
        if (progressEl) progressEl.textContent = msg;
      };
      try {
        items = await dataManager.getCreatedTags(targetUser, onProgress);
        if (items.length === 0) {
          contentDiv.innerHTML = '<div style="color:var(--di-text-muted, #888);text-align:center;padding:20px;font-size:0.9em;">No created tags found in NNTBot reports.</div>';
          return;
        }
        titleDiv.textContent = `🏷️ Tags created by ${targetUser.name} (${items.length})`;
        controlsDiv.style.display = "flex";
        updateSortButtons();
        sortItems();
        renderTable();
      } catch (e) {
        log$4.debug("Created tags load failed", { error: e });
        contentDiv.innerHTML = '<div style="color:#c00;text-align:center;padding:20px;font-size:0.9em;">Failed to load created tags.</div>';
      }
    };
    contentDiv.innerHTML = `
    <div style="text-align:center;padding:20px;">
      <button id="di-load-created-tags" style="
        background:var(--di-card-bg, #f9f9f9);border:1px solid var(--di-border-input, #ddd);border-radius:6px;
        padding:8px 16px;cursor:pointer;color:var(--di-text, #333);font-size:13px;
        transition:background 0.2s;
      ">Load Created Tags</button>
      <div style="font-size:0.8em;color:var(--di-text-muted, #888);margin-top:6px;">Searches NNTBot tag reports for tags created by this user</div>
    </div>`;
    const loadBtn = contentDiv.querySelector(
      "#di-load-created-tags"
    );
    if (loadBtn) {
      loadBtn.onmouseover = () => {
        loadBtn.style.background = "var(--di-bg-tertiary, #f0f0f0)";
      };
      loadBtn.onmouseout = () => {
        loadBtn.style.background = "var(--di-card-bg, #f9f9f9)";
      };
      loadBtn.onclick = () => loadData();
    }
  }
  const APP_VERSION = "9.4.5";
  const APP_REPO_URL = "https://github.com/AkaringoP/Danbooru-Insights";
  const APP_AUTHOR = "AkaringoP";
  const APP_AUTHOR_URL = "https://danbooru.donmai.us/users/701499";
  function dashboardFooterHtml() {
    return `
    <div class="di-dashboard-footer" style="
      margin-top: 30px;
      padding: 16px 0 8px;
      border-top: 1px solid var(--di-border-light, #eee);
      text-align: center;
      font-size: 11px;
      color: var(--di-text-muted, #888);
      line-height: 1.5;
    ">
      <a href="${APP_REPO_URL}" target="_blank" rel="noopener" style="color: var(--di-text-muted, #888); text-decoration: none;">
        DanbooruInsights v${APP_VERSION}
      </a>
      <span style="margin: 0 6px; opacity: 0.6;">·</span>
      <span>made by <a href="${APP_AUTHOR_URL}" target="_blank" rel="noopener" style="color: var(--di-text-muted, #888); text-decoration: none;">${APP_AUTHOR}</a></span>
    </div>
  `;
  }
  let savedScrollY = 0;
  let lockCount = 0;
  let savedBody = null;
  let savedHtml = null;
  function lockBodyScroll() {
    if (lockCount++ > 0) return;
    savedScrollY = window.scrollY;
    savedBody = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow
    };
    savedHtml = { overflow: document.documentElement.style.overflow };
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }
  function unlockBodyScroll() {
    if (lockCount === 0) return;
    if (--lockCount > 0) return;
    if (savedBody) {
      document.body.style.position = savedBody.position;
      document.body.style.top = savedBody.top;
      document.body.style.width = savedBody.width;
      document.body.style.overflow = savedBody.overflow;
    }
    if (savedHtml) {
      document.documentElement.style.overflow = savedHtml.overflow;
    }
    window.scrollTo(0, savedScrollY);
    savedBody = null;
    savedHtml = null;
  }
  const log$3 = createLogger("UserAnalytics");
  class UserAnalyticsApp {
    db;
    settings;
    context;
    rateLimiter;
    dataManager;
    dataService;
    modalId;
    btnId;
    isFullySynced;
    isRendering;
initialStatusCheck = null;
constructor(db, settings, context, rateLimiter) {
      this.db = db;
      this.settings = settings;
      this.context = context;
      const rl = CONFIG.RATE_LIMITER;
      this.rateLimiter = rateLimiter ?? new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);
      this.dataManager = new AnalyticsDataManager(db, this.rateLimiter);
      this.dataService = new UserAnalyticsDataService(db);
      this.modalId = "danbooru-grass-modal";
      this.btnId = "danbooru-grass-analytics-btn";
      this.isFullySynced = false;
      this.isRendering = false;
    }
run() {
      this.createModal();
      this.injectButton();
    }
createModal() {
      if (document.getElementById(`${this.modalId}-overlay`)) return;
      const overlay = document.createElement("div");
      overlay.id = `${this.modalId}-overlay`;
      const effective = resolveEffectiveDashboardTheme(
        this.settings.getDarkMode()
      );
      if (effective === "dark") overlay.setAttribute("data-di-theme", "dark");
      const windowDiv = document.createElement("div");
      windowDiv.id = `${this.modalId}-window`;
      const closeBtn = document.createElement("div");
      closeBtn.id = `${this.modalId}-close`;
      closeBtn.innerHTML = "&times;";
      closeBtn.onclick = () => this.toggleModal(false);
      windowDiv.appendChild(closeBtn);
      const content = document.createElement("div");
      content.id = `${this.modalId}-content`;
      content.innerHTML = `
      <h1 style="margin-top:0; color:var(--di-text, #333);">Analytics Dashboard</h1>
      <p style="color:var(--di-text-secondary, #666);">Select a metric to view detailed reports.</p>
      <!-- Placeholder for future charts -->
    `;
      windowDiv.appendChild(content);
      overlay.appendChild(windowDiv);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          this.toggleModal(false);
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && overlay.classList.contains("visible")) {
          this.toggleModal(false);
        }
      });
      window.addEventListener("popstate", () => {
        if (overlay.classList.contains("visible") && history.state?.diModalOpen !== this.modalId) {
          this.toggleModal(false);
        }
      });
      document.body.appendChild(overlay);
    }
injectButton() {
      let targetElement = null;
      const h1s = document.querySelectorAll("h1");
      for (const h1 of h1s) {
        if (h1.textContent.includes(this.context.targetUser.name)) {
          targetElement = h1;
          break;
        }
      }
      if (!targetElement && h1s.length > 0) {
        targetElement = h1s[0];
      }
      if (targetElement) {
        const container2 = document.createElement("span");
        container2.style.display = "inline-flex";
        container2.style.alignItems = "center";
        container2.style.marginLeft = "10px";
        container2.style.verticalAlign = "middle";
        const btn = document.createElement("span");
        btn.className = "di-analytics-entry-btn";
        btn.title = "Open Analytics Report";
        btn.setAttribute("role", "button");
        btn.setAttribute("aria-label", "Open user analytics report");
        btn.innerHTML = "📊";
        btn.style.margin = "0";
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (this.initialStatusCheck) {
            try {
              await this.initialStatusCheck;
            } catch {
            }
          }
          if (this.isFullySynced === false) {
            try {
              await this.performPartialSync(btn, false);
            } catch (err) {
              log$3.error("Auto-sync failed", { error: err });
            }
          }
          this.toggleModal(true);
        };
        container2.appendChild(btn);
        const statusText = document.createElement("div");
        statusText.id = `${this.modalId}-header-status`;
        statusText.style.fontSize = "0.5em";
        statusText.style.fontWeight = "normal";
        statusText.style.color = "var(--di-text-muted, #888)";
        statusText.style.marginLeft = "12px";
        statusText.style.lineHeight = "1.2";
        statusText.innerHTML = "";
        container2.appendChild(statusText);
        targetElement.appendChild(container2);
        this.initialStatusCheck = this.updateHeaderStatus();
        void this.initialStatusCheck;
      } else {
        log$3.warn("Could not find H1 to inject analytics button");
      }
    }
async performPartialSync(btn = null, shouldRender = true) {
      if (AnalyticsDataManager.isGlobalSyncing) return;
      const originalText = btn ? btn.innerHTML : "";
      let animInterval = null;
      let dotCount = 0;
      const state = {
        current: 0,
        total: 0,
        phase: "FETCHING",
message: ""
      };
      if (btn) {
        btn.disabled = true;
        btn.style.cursor = "wait";
      }
      const render = () => {
        dotCount = dotCount % 3 + 1;
        const dotStr = ".".repeat(dotCount);
        const percent = state.total > 0 ? Math.floor(state.current / state.total * 100) : 0;
        let headerHtml = "";
        let subHtml = "";
        let containerColor = "#ff4444";
        if (state.phase === "PREPARING") {
          containerColor = "inherit";
          headerHtml = `<div style="color:#00ba7c; font-weight:bold;">Synced: ${state.current.toLocaleString()} / ${state.total.toLocaleString()} (${percent}%)</div>`;
          subHtml = `<div style="font-size:0.8em; color:#ffeb3b; margin-top:2px;">${state.message || "Preparing Report"}${dotStr}</div>`;
        } else {
          containerColor = "#ff4444";
          headerHtml = `<div style="font-weight:bold;">Synced: ${state.current.toLocaleString()} / ${state.total.toLocaleString()} (${percent}%)</div>`;
          subHtml = `<div style="font-size:0.8em; color:var(--di-text-muted, #888); margin-top:2px;">${state.message || `Fetching data${dotStr}`}</div>`;
        }
        void this.updateHeaderStatus(headerHtml + subHtml, containerColor);
      };
      render();
      animInterval = setInterval(render, 500);
      const onProgress = (current, total, msg) => {
        state.current = current;
        state.total = total;
        if (msg) state.message = msg;
        const isComplete = total > 0 && current >= total;
        if (msg === "PREPARING" || isComplete) {
          state.phase = "PREPARING";
        } else {
          state.phase = "FETCHING";
        }
      };
      try {
        const MAX_QUICK_SYNC_POSTS = CONFIG.MAX_OPTIMIZED_POSTS;
        const syncTotal = await this.dataManager.getTotalPostCount(
          this.context.targetUser
        );
        if (syncTotal === 0) {
          if (animInterval) clearInterval(animInterval);
          this.isFullySynced = true;
          void this.updateHeaderStatus();
          if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
            btn.style.cursor = "pointer";
          }
          if (shouldRender) this.toggleModal(true);
          return;
        }
        if (syncTotal <= MAX_QUICK_SYNC_POSTS) {
          await this.dataManager.quickSyncAllPosts(
            this.context.targetUser,
            onProgress
          );
        } else {
          await this.dataManager.syncAllPosts(
            this.context.targetUser,
            onProgress
          );
        }
        if (animInterval) clearInterval(animInterval);
        if (shouldRender) {
          const finalStats = await this.dataManager.getSyncStats(
            this.context.targetUser
          );
          void this.updateHeaderStatus(
            `Synced: ${finalStats.count.toLocaleString()} / ${finalStats.count.toLocaleString()}`,
            "#00ba7c"
          );
        }
        if (btn) {
          btn.innerHTML = originalText;
          btn.disabled = false;
          btn.style.cursor = "pointer";
        }
        if (shouldRender) {
          this.toggleModal(true);
        }
      } catch (e) {
        if (animInterval) clearInterval(animInterval);
        log$3.error("Sync failed", { error: e });
        if (btn) {
          btn.innerHTML = "ERR";
          btn.disabled = false;
          btn.style.cursor = "pointer";
        }
        void this.updateHeaderStatus("Sync Failed", "#ff4444");
      }
    }
async updateHeaderStatus(progressText = null, customColor = null) {
      const el = document.getElementById(`${this.modalId}-header-status`);
      if (!el) return;
      if (progressText) {
        el.innerHTML = progressText;
        el.style.color = customColor || "#d73a49";
        return;
      }
      const dataManager = new AnalyticsDataManager(this.db);
      const stats = await dataManager.getSyncStats(this.context.targetUser);
      const total = await dataManager.getTotalPostCount(this.context.targetUser);
      const count = stats.count;
      const lastSyncKey = `danbooru_grass_last_sync_${this.context.targetUser.id}`;
      const lastSync = localStorage.getItem(lastSyncKey);
      const lastSyncText = lastSync ? new Date(lastSync).toLocaleDateString() : "Never";
      const settingsManager = new SettingsManager();
      const tolerance = settingsManager.getSyncThreshold();
      const isSynced = total === 0 || count >= total - tolerance;
      this.isFullySynced = isSynced;
      const statusColor = total === 0 || stats.lastSync && isSynced ? "#28a745" : "#d73a49";
      el.innerHTML = "";
      el.style.color = statusColor;
      el.title = `Last synced: ${lastSyncText}`;
      const row1 = document.createElement("div");
      row1.style.display = "flex";
      row1.style.alignItems = "center";
      const text1 = document.createElement("span");
      text1.textContent = total === 0 ? "No uploads" : `Synced: ${count.toLocaleString()} / ${total.toLocaleString()}`;
      text1.style.color = statusColor;
      text1.style.fontWeight = "bold";
      row1.appendChild(text1);
      const settingBtn = document.createElement("span");
      settingBtn.innerHTML = "⚙️";
      settingBtn.style.cursor = "pointer";
      settingBtn.style.marginLeft = "6px";
      settingBtn.style.fontSize = "12px";
      settingBtn.title = "Configure Sync Threshold";
      settingBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.showSyncSettingsPopover(settingBtn);
      };
      row1.appendChild(settingBtn);
      el.appendChild(row1);
      const row2 = document.createElement("div");
      if (stats.lastSync && isSynced) {
        row2.innerHTML = `<span style="font-size:1em; font-weight:normal; color:#28a745;">${lastSyncText}</span>`;
      } else {
        row2.textContent = "Not fully synced";
      }
      el.appendChild(row2);
    }
showSyncSettingsPopover(target) {
      const existing = document.getElementById("danbooru-grass-sync-settings");
      if (existing) {
        existing.remove();
        return;
      }
      const settingsManager = new SettingsManager();
      const currentVal = settingsManager.getSyncThreshold();
      const popover = document.createElement("div");
      popover.id = "danbooru-grass-sync-settings";
      const effective = resolveEffectiveDashboardTheme(
        settingsManager.getDarkMode()
      );
      if (effective === "dark") popover.setAttribute("data-di-theme", "dark");
      popover.style.position = "absolute";
      popover.style.zIndex = "10001";
      popover.style.background = "var(--di-bg, #fff)";
      popover.style.border = "1px solid var(--di-border, #e1e4e8)";
      popover.style.borderRadius = "6px";
      popover.style.padding = "12px";
      popover.style.boxShadow = "0 2px 10px var(--di-shadow-light, rgba(0,0,0,0.1))";
      popover.style.fontSize = "11px";
      popover.style.color = "var(--di-text, #333)";
      popover.style.width = "220px";
      const rect = target.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      popover.style.top = `${rect.top + scrollTop}px`;
      popover.style.left = `${rect.right + scrollLeft + 10}px`;
      popover.innerHTML = `
      <div style="margin-bottom:8px; line-height:1.4;">
        <strong>Partial Sync Threshold</strong><br>
        Allow report view without sync if: <br>
        (Total - Synced) <= Threshold
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between;">
         <input type="number" id="sync-thresh-input" value="${currentVal}" min="0" style="width:60px; padding:3px; border:1px solid var(--di-border-input, #ddd); border-radius:3px; background:var(--di-bg, #fff); color:var(--di-text, #333);">
         <button id="sync-thresh-save" style="background:none; border:1px solid #28a745; color:#28a745; border-radius:4px; cursor:pointer; padding:2px 8px; font-size:11px;">✅ Save</button>
      </div>
      <div style="margin-top:10px; padding-top:8px; border-top:1px solid var(--di-border-light, #eee);">
        <strong>Dashboard Theme</strong>
        <select id="dark-mode-select" style="width:100%; margin-top:4px; padding:3px; border:1px solid var(--di-border-input, #ddd); border-radius:3px; background:var(--di-bg, #fff); color:var(--di-text, #333); font-size:11px;">
          <option value="auto">Auto (follow Danbooru)</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
    `;
      document.body.appendChild(popover);
      const darkModeSelect = popover.querySelector(
        "#dark-mode-select"
      );
      if (darkModeSelect) {
        darkModeSelect.value = settingsManager.getDarkMode();
        darkModeSelect.addEventListener("change", () => {
          const pref = darkModeSelect.value;
          settingsManager.setDarkMode(pref);
          applyDashboardTheme(settingsManager);
        });
      }
      const closeHandler = (e) => {
        if (!popover.contains(e.target) && e.target !== target) {
          popover.remove();
          document.removeEventListener("click", closeHandler);
        }
      };
      setTimeout(() => document.addEventListener("click", closeHandler), 0);
      const saveBtn = popover.querySelector("#sync-thresh-save");
      saveBtn.onclick = () => {
        const input = popover.querySelector("#sync-thresh-input");
        const val = parseInt(input.value, 10);
        if (!isNaN(val) && val >= 0) {
          settingsManager.setSyncThreshold(val);
          popover.remove();
          document.removeEventListener("click", closeHandler);
          void this.updateHeaderStatus();
        } else {
          showToast({ type: "warn", message: "Please enter a valid number." });
        }
      };
    }
toggleModal(show) {
      const overlay = document.getElementById(`${this.modalId}-overlay`);
      if (!overlay) return;
      if (show) {
        if (history.state?.diModalOpen !== this.modalId) {
          history.pushState({ diModalOpen: this.modalId }, "", location.href);
        }
        overlay.style.display = "flex";
        requestAnimationFrame(() => {
          overlay.classList.add("visible");
        });
        lockBodyScroll();
        void this.renderDashboard();
      } else {
        if (history.state?.diModalOpen === this.modalId) {
          history.back();
          return;
        }
        overlay.classList.remove("visible");
        setTimeout(() => {
          overlay.style.display = "none";
          unlockBodyScroll();
          void this.updateHeaderStatus();
        }, 200);
      }
    }
showSubModal(title, contentHtml, helpHtml = null) {
      let subOverlay = document.getElementById(`${this.modalId}-sub-overlay`);
      if (subOverlay) {
        subOverlay.remove();
      }
      subOverlay = document.createElement("div");
      subOverlay.id = `${this.modalId}-sub-overlay`;
      Object.assign(subOverlay.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(2px)",
        zIndex: "11000",
display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: "0",
        transition: "opacity 0.2s ease",
        cursor: "default"
});
      const subWindow = document.createElement("div");
      Object.assign(subWindow.style, {
        backgroundColor: "var(--di-bg, #fff)",
        borderRadius: "12px",
        boxShadow: "0 10px 25px var(--di-shadow, rgba(0,0,0,0.2))",
        width: "90%",
        maxWidth: "800px",
maxHeight: "90vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transform: "scale(0.95)",
        transition: "transform 0.2s ease"
      });
      const header = document.createElement("div");
      Object.assign(header.style, {
        padding: "15px 20px",
        borderBottom: "1px solid var(--di-border-light, #eee)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: "var(--di-card-bg, #f9f9f9)",
        position: "relative"
      });
      const titleWrapper = document.createElement("div");
      titleWrapper.style.display = "flex";
      titleWrapper.style.alignItems = "center";
      titleWrapper.innerHTML = `<h3 style="margin:0; font-size:1.2em; color:var(--di-text, #333);">${title}</h3>`;
      if (helpHtml) {
        const helpBtn = document.createElement("div");
        helpBtn.innerHTML = "❓";
        Object.assign(helpBtn.style, {
          marginLeft: "10px",
          cursor: "help",
          fontSize: "14px",
          color: "var(--di-text-muted, #888)",
position: "relative"
        });
        const tooltip = document.createElement("div");
        Object.assign(tooltip.style, {
          position: "absolute",
          top: "100%",
          left: "0",
width: "550px",
          background: "#000",
          color: "#fff",
          padding: "10px",
          borderRadius: "4px",
          fontSize: "12px",
          zIndex: "11001",
          display: "none",
          boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
          marginTop: "5px"
        });
        tooltip.innerHTML = helpHtml;
        helpBtn.appendChild(tooltip);
        helpBtn.onmouseover = () => tooltip.style.display = "block";
        helpBtn.onmouseout = () => tooltip.style.display = "none";
        titleWrapper.appendChild(helpBtn);
      }
      header.appendChild(titleWrapper);
      const closeBtn = document.createElement("button");
      closeBtn.innerHTML = "&times;";
      Object.assign(closeBtn.style, {
        background: "none",
        border: "none",
        fontSize: "1.5em",
        lineHeight: "1",
        cursor: "pointer",
        color: "var(--di-text-secondary, #666)"
      });
      closeBtn.onclick = () => closeSubModal();
      header.appendChild(closeBtn);
      subWindow.appendChild(header);
      const contentDiv = document.createElement("div");
      Object.assign(contentDiv.style, {
        padding: "20px",
        overflowY: "auto"
      });
      contentDiv.innerHTML = contentHtml;
      subWindow.appendChild(contentDiv);
      subOverlay.appendChild(subWindow);
      document.body.appendChild(subOverlay);
      requestAnimationFrame(() => {
        subOverlay.style.opacity = "1";
        subWindow.style.transform = "scale(1)";
      });
      const closeSubModal = () => {
        subOverlay.style.opacity = "0";
        subWindow.style.transform = "scale(0.95)";
        setTimeout(() => {
          if (subOverlay.parentElement) subOverlay.remove();
        }, 200);
      };
      subOverlay.addEventListener("click", (e) => {
        if (e.target === subOverlay) closeSubModal();
      });
    }
async renderDashboard() {
      if (this.isRendering) return;
      this.isRendering = true;
      const perfMeta = {
        path: "unknown",
        preTotal: 0
      };
      perfLogger.start("dbi:render:total");
      try {
        const content = document.getElementById(`${this.modalId}-content`);
        if (!content) return;
        content.innerHTML = `
        <div id="analytics-loading-report" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:100px 0; color:var(--di-text-secondary, #666);">
           <div class="di-spinner"></div>
           <div style="font-size:1.2em; font-weight:600; margin-top: 20px;">Generating Report...</div>
           <div style="font-size:0.9em; color:var(--di-text-muted, #888); margin-top:10px;">Analyzing contributions and trends</div>
        </div>
      `;
        const MAX_QUICK_SYNC_POSTS = CONFIG.MAX_OPTIMIZED_POSTS;
        perfLogger.start("dbi:render:precheck");
        const [preStats, preTotal] = await Promise.all([
          perfLogger.wrap(
            "dbi:render:precheck:syncStats",
            () => this.dataManager.getSyncStats(this.context.targetUser)
          ),
          perfLogger.wrap(
            "dbi:render:precheck:totalCount",
            () => this.dataManager.getTotalPostCount(this.context.targetUser)
          )
        ]);
        perfLogger.end("dbi:render:precheck", {
          total: preTotal,
          synced: preStats.count
        });
        perfMeta.preTotal = preTotal;
        if (preTotal === 0 && preStats.count === 0) {
          perfMeta.path = "syncSkipped";
          this.isFullySynced = true;
          content.innerHTML = "";
          const header2 = document.createElement("div");
          header2.style.marginBottom = "25px";
          header2.innerHTML = `
          <h2 style="margin-top:0; color:var(--di-text, #333); margin-bottom:4px;">Analytics Dashboard</h2>
          <p style="color:var(--di-text-secondary, #666); margin:0;">Detailed statistics and history for <span class="${getLevelClass(this.context.targetUser.level_string)}">${this.context.targetUser.name}</span></p>
        `;
          content.appendChild(header2);
          const empty = document.createElement("div");
          empty.style.cssText = "text-align:center; padding:60px 20px; color:var(--di-text-secondary, #666);";
          empty.innerHTML = `
          <div style="font-size:48px; margin-bottom:20px;">📭</div>
          <h3 style="margin-top:0;">No uploads to analyze</h3>
          <p>This user has not uploaded any posts yet, so there is nothing to report.</p>
        `;
          content.appendChild(empty);
          content.insertAdjacentHTML("beforeend", dashboardFooterHtml());
          return;
        }
        let didQuickSync = false;
        if (preTotal > 0 && preTotal <= MAX_QUICK_SYNC_POSTS && preStats.count < preTotal) {
          perfMeta.path = "quickSync";
          didQuickSync = true;
          content.innerHTML = `
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:100px 0; color:var(--di-text-secondary, #666);">
            <div class="di-spinner"></div>
            <div style="font-size:1.2em; font-weight:600; margin-top:20px;">Syncing Data...</div>
            <div id="analytics-quick-sync-msg" style="font-size:0.9em; color:var(--di-text-muted, #888); margin-top:10px;">Fetching posts...</div>
            <div style="width:300px; height:8px; background:var(--di-border-light, #eee); border-radius:4px; overflow:hidden; margin-top:15px;">
              <div id="analytics-quick-sync-bar" style="width:0%; height:100%; background:#2da44e; transition:width 0.2s;"></div>
            </div>
          </div>
        `;
          const qBar = content.querySelector(
            "#analytics-quick-sync-bar"
          );
          const qMsg = content.querySelector(
            "#analytics-quick-sync-msg"
          );
          await this.dataManager.quickSyncAllPosts(
            this.context.targetUser,
            (c, t, msg) => {
              if (qBar && t > 0)
                qBar.style.width = `${Math.round(c / t * 100)}%`;
              if (qMsg && msg && msg !== "PREPARING") qMsg.textContent = msg;
            }
          );
          this.isFullySynced = true;
          void this.updateHeaderStatus();
          content.innerHTML = `
          <div id="analytics-loading-report" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:100px 0; color:var(--di-text-secondary, #666);">
             <div class="di-spinner"></div>
             <div style="font-size:1.2em; font-weight:600; margin-top: 20px;">Generating Report...</div>
             <div style="font-size:0.9em; color:var(--di-text-muted, #888); margin-top:10px;">Analyzing contributions and trends</div>
          </div>
        `;
        } else {
          perfMeta.path = "syncSkipped";
        }
        const prefetched = didQuickSync ? void 0 : { syncStats: preStats, totalCount: preTotal };
        const dashboardData = await perfLogger.wrap(
          "dbi:net:fetchData:total",
          () => this.dataService.fetchDashboardData(this.context, prefetched)
        );
        const {
          stats,
          total,
          summaryStats,
          distributions,
          statusStartRevalidate,
          ratingStartRevalidate,
          topPosts,
          topPostsStartRevalidate,
          recentPopularPosts,
          recentPopularStartRevalidate,
          randomPostsPromise,
          milestones1k,
          milestones1kStartRevalidate,
          scatterData,
          levelChanges,
          levelChangesStartRevalidate,
          timelineMilestones,
          tagCloudGeneral,
          userStats,
          needsBackfill,
          dataManager
        } = dashboardData;
        const scheduleRevalidate = (name, starter) => {
          if (!starter) return;
          setTimeout(() => {
            starter().catch((e) => {
              log$3.warn(`SWR revalidate failed for ${name}`, { error: e });
            });
          }, 0);
        };
        const { maxUploads, maxDate, firstUploadDate, lastUploadDate } = summaryStats;
        const today = new Date();
        const oneDay = 1e3 * 60 * 60 * 24;
        const nsfwKey = "danbooru_grass_nsfw_enabled";
        let isNsfwEnabled = localStorage.getItem(nsfwKey) === "true";
        let applyNsfwUpdate = null;
        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "flex-start";
        header.style.marginBottom = "25px";
        header.innerHTML = `
      <div>
         <h2 style="margin-top:0; color:var(--di-text, #333); margin-bottom:4px;">Analytics Dashboard</h2>
         <p style="color:var(--di-text-secondary, #666); margin:0;">Detailed statistics and history for <span class="${getLevelClass(this.context.targetUser.level_string)}">${this.context.targetUser.name}</span></p>
      </div>
       <div id="analytics-header-controls" style="display:none; align-items:center;">
         <label style="display:flex; align-items:center; margin-right:15px; font-size:13px; color:var(--di-text-secondary, #666); cursor:pointer; user-select:none;">
            <input type="checkbox" id="user-analytics-nsfw-toggle" ${isNsfwEnabled ? "checked" : ""} style="margin-right:6px;">
            Enable NSFW
         </label>
          <button id="analytics-reset-btn" title="Full Reset (Delete All Data)" style="
             background: none; 
             border: 1px solid var(--di-border-light, #eee);
             border-radius: 6px;
             padding: 6px 10px;
             cursor: pointer;
             color: #d73a49;
             transition: all 0.2s;
          ">🗑️</button>
       </div>
    `;
        content.appendChild(header);
        const dBtn = header.querySelector("#analytics-reset-btn");
        setTimeout(() => {
          const nsfwToggle = header.querySelector(
            "#user-analytics-nsfw-toggle"
          );
          if (nsfwToggle) {
            nsfwToggle.onchange = (e) => {
              isNsfwEnabled = e.target.checked;
              localStorage.setItem(nsfwKey, String(isNsfwEnabled));
              if (applyNsfwUpdate) void applyNsfwUpdate();
            };
          }
          if (dBtn) {
            dBtn.onclick = async () => {
              if (confirm(
                "⚠ FULL RESET WARNING ⚠\n\nThis will DELETE all local analytics data for this user and require a full re-sync.\n\nContinue?"
              )) {
                dBtn.innerHTML = "⌛";
                await this.dataManager.clearUserData(this.context.targetUser);
                showToast({ type: "success", message: "Data cleared." });
                this.toggleModal(false);
              }
            };
            dBtn.onmouseover = () => {
              dBtn.style.background = "#ffeef0";
              dBtn.style.borderColor = "#d73a49";
            };
            dBtn.onmouseout = () => {
              dBtn.style.background = "none";
              dBtn.style.borderColor = "var(--di-border-light, #eee)";
            };
          }
          const lastSyncKey = `danbooru_grass_last_sync_${this.context.targetUser.id}`;
          const lastSyncStr = localStorage.getItem(lastSyncKey);
          if (lastSyncStr) {
            const lastSyncDate = new Date(lastSyncStr);
            const now = new Date();
            const diffTime = Math.abs(now.getTime() - lastSyncDate.getTime());
            const diffDays = Math.ceil(diffTime / (1e3 * 60 * 60 * 24));
            if (diffDays > 7 && dBtn) {
              const bubble = document.createElement("div");
              bubble.innerHTML = "Full data refresh recommended";
              bubble.style.cssText = `
              position: absolute;
              top: -45px;
              right: 0px; 
              background: #ffeb3b;
              color: var(--di-text, #333);
              padding: 8px 12px;
              border-radius: 6px;
              font-size: 12px;
              z-index: 10001;
              white-space: nowrap;
              box-shadow: 0 2px 8px var(--di-shadow, rgba(0,0,0,0.2));
            `;
              const arrow = document.createElement("div");
              arrow.style.cssText = `
              position: absolute;
              bottom: -6px;
              right: 12px;
              width: 0;
              height: 0;
              border-left: 6px solid transparent;
              border-right: 6px solid transparent;
              border-top: 6px solid #ffeb3b;
            `;
              bubble.appendChild(arrow);
              dBtn.parentNode.style.position = "relative";
              dBtn.parentNode?.appendChild(bubble);
              setTimeout(() => {
                if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
              }, 1e4);
            }
          }
        }, 0);
        content.innerHTML = "";
        content.appendChild(header);
        const tolerance = 10;
        const needsSync = total > 0 && stats.count < total - tolerance || total === 0 && stats.count === 0;
        if (needsSync) {
          const syncDiv = document.createElement("div");
          syncDiv.style.textAlign = "center";
          syncDiv.style.padding = "40px 20px";
          syncDiv.style.color = "var(--di-text-secondary, #666)";
          let msg = `We have <strong>${stats.count}</strong> posts synced, but the user has <strong>${total || "more"}</strong>.`;
          if (total === 0 && stats.count > 0)
            msg = `We have <strong>${stats.count}</strong> posts synced. Total count unavailable.`;
          if (stats.count === 0)
            msg = `To generate the report, we need to fetch all post metadata for <strong>${this.context.targetUser.name}</strong>.`;
          syncDiv.innerHTML = `
        <div style="font-size:48px; margin-bottom:20px;">💾</div>
        <h3 style="margin-top:0;">Data Synchronization Required</h3>
        <p>${msg}</p>
        <p style="font-size:0.9em; color:var(--di-text-muted, #888); margin-bottom:30px;">
           This one-time process might take a while depending on the post count.<br>
           You can close this window - data collection will continue in the background.
        </p>
        <button id="analytics-start-sync" style="
          background-color: var(--di-link, #007bff); color: white; border: none; padding: 10px 20px;
          font-size: 16px; font-weight: 600; border-radius: 6px; cursor: pointer;
          box-shadow: 0 1px 3px var(--di-shadow-light, rgba(0,0,0,0.1)); transition: background 0.2s;
        ">${stats.count > 0 ? "Resume Sync" : "Start Data Fetch"}</button>

        <div id="analytics-main-progress" style="margin-top:25px; display:none; max-width:400px; margin-left:auto; margin-right:auto;">
           <div style="display:flex; justify-content:space-between; font-size:0.85em; margin-bottom:5px; color:var(--di-text-secondary, #666);">
              <span>Fetching metadata...</span>
              <span id="analytics-main-percent">0%</span>
           </div>
           <div style="width:100%; height:8px; background:var(--di-border-light, #eee); border-radius:4px; overflow:hidden;">
              <div id="analytics-main-bar" style="width:0%; height:100%; background:#2da44e; transition: width 0.2s;"></div>
           </div>
           <div id="analytics-main-count" style="font-size:0.8em; color:var(--di-text-secondary, #666); margin-top:5px; text-align:right;"></div>
        </div>
      `;
          content.appendChild(syncDiv);
          const btn = syncDiv.querySelector(
            "#analytics-start-sync"
          );
          if (AnalyticsDataManager.isGlobalSyncing) {
            btn.innerHTML = "Fetching in background...";
            btn.disabled = true;
            btn.style.backgroundColor = "#94d3a2";
            btn.style.cursor = "not-allowed";
            const progressDiv = syncDiv.querySelector(
              "#analytics-main-progress"
            );
            const bar = syncDiv.querySelector(
              "#analytics-main-bar"
            );
            const percent = syncDiv.querySelector(
              "#analytics-main-percent"
            );
            const countText = syncDiv.querySelector(
              "#analytics-main-count"
            );
            progressDiv.style.display = "block";
            const { current, total: total2 } = AnalyticsDataManager.syncProgress;
            if (total2 > 0) {
              const p = Math.round(current / total2 * 100);
              bar.style.width = `${p}%`;
              percent.textContent = `${p}%`;
              countText.textContent = `${current} / ${total2}`;
            }
            AnalyticsDataManager.onProgressCallback = (c, max) => {
              const p = max > 0 ? Math.round(c / max * 100) : 0;
              bar.style.width = `${p}%`;
              percent.textContent = max > 0 ? `${p}%` : "Scanning...";
              countText.textContent = `${c} / ${max > 0 ? max : "?"}`;
            };
          }
          btn.onclick = async () => {
            btn.innerHTML = "Fetching...";
            btn.disabled = true;
            btn.style.opacity = "0.7";
            const progressDiv = syncDiv.querySelector(
              "#analytics-main-progress"
            );
            const bar = syncDiv.querySelector(
              "#analytics-main-bar"
            );
            const percent = syncDiv.querySelector(
              "#analytics-main-percent"
            );
            const countText = syncDiv.querySelector(
              "#analytics-main-count"
            );
            progressDiv.style.display = "block";
            AnalyticsDataManager.onProgressCallback = (c, max) => {
              const p = max > 0 ? Math.round(c / max * 100) : 0;
              bar.style.width = `${p}%`;
              percent.textContent = max > 0 ? `${p}%` : "Scanning...";
              countText.textContent = `${c} / ${max > 0 ? max : "?"}`;
            };
            await this.dataManager.syncAllPosts(
              this.context.targetUser,
              () => {
              }
            );
            void this.updateHeaderStatus();
            void this.renderDashboard();
          };
          return;
        }
        const headerControls = header.querySelector(
          "#analytics-header-controls"
        );
        if (headerControls) headerControls.style.display = "flex";
        const dashboardDiv = document.createElement("div");
        const summaryWrapper = document.createElement("div");
        summaryWrapper.className = "di-summary-grid";
        summaryWrapper.style.display = "grid";
        summaryWrapper.style.gridTemplateColumns = "repeat(auto-fit, minmax(300px, 1fr))";
        summaryWrapper.style.gap = "15px";
        summaryWrapper.style.marginBottom = "35px";
        const makeCard = (title, val, icon, details = "") => `
          <div style="background:var(--di-bg, #fff); border:1px solid var(--di-border-light, #eee); border-radius:8px; padding:15px; display:flex; align-items:flex-start;">
             <div style="font-size:2em; margin-right:15px; margin-top:5px;">${icon}</div>
             <div style="flex:1; min-width:0;">
                <div style="font-size:0.85em; color:var(--di-text-secondary, #666); text-transform:uppercase; letter-spacing:0.5px;">${title}</div>
                ${val ? `<div style="font-size:1.5em; font-weight:bold; color:var(--di-text, #333);">${val}</div>` : ""}
                ${details ? `<div style="font-size:0.85em; color:var(--di-text-secondary, #666);">${details}</div>` : ""}
             </div>
          </div>
       `;
        let avgUploads = 0;
        let daysSinceFirst = 0;
        if (firstUploadDate) {
          daysSinceFirst = Math.floor(
            (today.getTime() - firstUploadDate.getTime()) / oneDay
          );
          if (daysSinceFirst > 0) {
            avgUploads = (stats.count / daysSinceFirst).toFixed(2);
          }
        }
        const uploadDetailsAll = `
       <div style="display:flex; flex-direction:column; gap:4px; border-left:2px solid var(--di-border-light, #eee); padding-left:12px;">
           <div>📈 <strong>Average:</strong> ${avgUploads} posts / day</div>
           <div>🔥 <strong>Max:</strong> ${maxUploads} posts <span style="color:var(--di-text-muted, #888);">(${maxDate})</span></div>
       </div>
    `;
        const { count1Year, maxUploads1Year, maxDate1Year } = summaryStats;
        let avgUploads1Year = 0;
        const daysSinceFirst1Year = Math.min(daysSinceFirst, 365);
        if (daysSinceFirst1Year > 0) {
          avgUploads1Year = ((count1Year || 0) / daysSinceFirst1Year).toFixed(2);
        }
        const uploadDetails1Year = `
       <div style="display:flex; flex-direction:column; gap:4px; border-left:2px solid var(--di-border-light, #eee); padding-left:12px;">
           <div>📈 <strong>Average:</strong> ${avgUploads1Year} posts / day</div>
           <div>🔥 <strong>Max:</strong> ${maxUploads1Year || 0} posts <span style="color:var(--di-text-muted, #888);">(${maxDate1Year || "N/A"})</span></div>
       </div>
    `;
        const { maxStreak, maxStreakStart, maxStreakEnd, activeDays } = summaryStats;
        let activeRatio = "0.0";
        if (daysSinceFirst > 0) {
          activeRatio = (activeDays / daysSinceFirst * 100).toFixed(1);
        } else if (activeDays > 0) {
          activeRatio = "100.0";
        }
        let activeAvg = "0.0";
        if (activeDays > 0) {
          activeAvg = (stats.count / activeDays).toFixed(1);
        }
        const streakPeriod = maxStreakStart && maxStreakEnd ? ` <span style="color:var(--di-text-muted, #888);">(${maxStreakStart} ~ ${maxStreakEnd})</span>` : "";
        const consistencyDetails = `
       <div style="display:flex; flex-direction:column; gap:4px; border-left:2px solid var(--di-border-light, #eee); padding-left:12px;">
           <div>🏃‍♂️ <strong>Max Streak:</strong> ${maxStreak} days${streakPeriod}</div>
           <div>🌟 <strong>Active Ratio:</strong> ${activeRatio}% <span style="color:var(--di-text-muted, #888);">(${activeDays}/${daysSinceFirst.toLocaleString()} days)</span></div>
           <div>🎯 <strong>Active Avg:</strong> ${activeAvg} posts/day</div>
       </div>
    `;
        const uploadCardHtml = `
          <div id="danbooru-insights-upload-card" style="background:var(--di-bg, #fff); border:1px solid var(--di-border-light, #eee); border-radius:8px; padding:15px; display:flex; align-items:flex-start; overflow:hidden; position:relative; min-height:106px;">
                 <div style="font-size:2em; margin-right:15px; margin-top:5px; flex-shrink:0;">🖼️</div>
                 
                 <div style="position:relative; flex-grow:1; display:grid; height:100%;">
                     <!-- All Time Pane -->
                     <div class="di-upload-card-pane" style="grid-area: 1 / 1; animation-name: di-slide-in-out-a;">
                        <div style="font-size:0.85em; color:var(--di-text-secondary, #666); text-transform:uppercase; letter-spacing:0.5px;">TOTAL UPLOADS</div>
                        <div class="di-upload-card-inner" style="display:flex; align-items:center; gap:12px;">
                            <div style="font-size:1.5em; font-weight:bold; color:var(--di-text, #333);">${stats.count.toLocaleString()}</div>
                            <div style="font-size:0.85em; color:var(--di-text-secondary, #666);">${uploadDetailsAll}</div>
                        </div>
                     </div>

                     <!-- Last 1 Year Pane -->
                     <div class="di-upload-card-pane" style="grid-area: 1 / 1; animation-name: di-slide-in-out-b;">
                        <div style="font-size:0.85em; color:var(--di-text-secondary, #666); text-transform:uppercase; letter-spacing:0.5px;">LAST 1 YEAR</div>
                        <div class="di-upload-card-inner" style="display:flex; align-items:center; gap:12px;">
                            <div style="font-size:1.5em; font-weight:bold; color:var(--di-text, #333);">${(count1Year || 0).toLocaleString()}</div>
                            <div style="font-size:0.85em; color:var(--di-text-secondary, #666);">${uploadDetails1Year}</div>
                        </div>
                     </div>
                     
                     <!-- Consistency Pane -->
                     <div class="di-upload-card-pane" style="grid-area: 1 / 1; animation-name: di-slide-in-out-c;">
                        <div style="font-size:0.85em; color:var(--di-text-secondary, #666); text-transform:uppercase; letter-spacing:0.5px;">UPLOAD HABITS</div>
                        <div class="di-upload-card-inner" style="display:flex; align-items:center; gap:12px;">
                            <div style="font-size:0.85em; color:var(--di-text-secondary, #666); margin-left: -12px;">${consistencyDetails}</div>
                        </div>
                     </div>
                 </div>

                 <button id="analytics-upload-btn-play-pause" class="di-play-pause-btn" title="Pause Animation">
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                         <rect x="5" y="4" width="4" height="16"></rect>
                         <rect x="15" y="4" width="4" height="16"></rect>
                     </svg>
                 </button>
          </div>
      `;
        summaryWrapper.innerHTML += uploadCardHtml;
        const lastDate = lastUploadDate ? lastUploadDate.toISOString().split("T")[0] : "N/A";
        let daysSinceJoin = 0;
        let joinDateStr = "";
        if (this.context.targetUser.created_at) {
          const joinDate = new Date(this.context.targetUser.created_at);
          daysSinceJoin = Math.floor(
            (today.getTime() - joinDate.getTime()) / oneDay
          );
          joinDateStr = joinDate.toISOString().split("T")[0];
        }
        const firstUploadDateStr = firstUploadDate ? firstUploadDate.toISOString().split("T")[0] : "";
        const tlEvents = [];
        if (this.context.targetUser.created_at) {
          const joinDate = new Date(this.context.targetUser.created_at);
          tlEvents.push({
            date: joinDate,
            icon: "🎊",
            html: `🎊 <strong>Join:</strong> ${daysSinceJoin.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${joinDateStr})</span>`
          });
        }
        if (firstUploadDate) {
          tlEvents.push({
            date: firstUploadDate,
            icon: "🚀",
            html: `🚀 <strong>1st Post:</strong> ${daysSinceFirst.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${firstUploadDateStr})</span>`
          });
        }
        const milestoneIcons = { 100: "💯" };
        timelineMilestones.forEach((m) => {
          const icon = milestoneIcons[m.index] ?? "🏅";
          const label = `${m.index.toLocaleString()}th Post`;
          const dateStr = m.date.toISOString().split("T")[0];
          const daysAgo = Math.floor(
            (today.getTime() - m.date.getTime()) / oneDay
          );
          tlEvents.push({
            date: m.date,
            icon,
            html: `${icon} <strong>${label}:</strong> ${daysAgo.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${dateStr})</span>`
          });
        });
        levelChanges.forEach((lc) => {
          const icon = lc.isPromotion ? "⬆️" : "⬇️";
          const dateStr = lc.date.toISOString().split("T")[0];
          const daysAgo = Math.floor(
            (today.getTime() - lc.date.getTime()) / oneDay
          );
          const fromLevelClass = getLevelClass(lc.fromLevel);
          const toLevelClass = getLevelClass(lc.toLevel);
          tlEvents.push({
            date: lc.date,
            icon,
            html: `${icon} <strong class="${fromLevelClass}">${lc.fromLevel}</strong> → <strong class="${toLevelClass}">${lc.toLevel}</strong> ${daysAgo.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${dateStr})</span>`
          });
        });
        if (lastUploadDate) {
          const daysAgoLast = Math.floor(
            (today.getTime() - lastUploadDate.getTime()) / oneDay
          );
          const latestLabel = total > 0 ? `${total.toLocaleString()}th Post` : "Latest Post";
          tlEvents.push({
            date: lastUploadDate,
            icon: "📌",
            html: `📌 <strong>${latestLabel}:</strong> ${daysAgoLast.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${lastDate})</span>`
          });
        }
        tlEvents.sort((a, b) => a.date.getTime() - b.date.getTime());
        const timelineRows = tlEvents.map(
          (ev) => `<div class="di-timeline-row" style="white-space:nowrap;">${ev.html}</div>`
        ).join("");
        const dateDetails = `
       <div class="di-user-history-wrap">
         <div class="di-user-history-timeline" style="display:flex; flex-direction:column; gap:4px; border-left:2px solid var(--di-border-light, #eee); padding-left:12px; max-height:66px; overflow-y:auto;">
             ${timelineRows}
         </div>
       </div>
    `;
        summaryWrapper.innerHTML += makeCard(
          "User History",
          "",
          "📅",
          dateDetails
        );
        dashboardDiv.appendChild(summaryWrapper);
        const historyTimeline = dashboardDiv.querySelector(
          ".di-user-history-timeline"
        );
        const historyWrap = historyTimeline?.parentElement;
        if (historyTimeline && historyWrap) {
          if (historyTimeline.scrollHeight > historyTimeline.clientHeight + 1) {
            historyWrap.classList.add("has-overflow");
            historyTimeline.addEventListener("scroll", () => {
              const atBottom = historyTimeline.scrollTop + historyTimeline.clientHeight >= historyTimeline.scrollHeight - 1;
              historyWrap.classList.toggle("scrolled-to-bottom", atBottom);
            });
          }
        }
        const btnPlayPause = dashboardDiv.querySelector(
          "#analytics-upload-btn-play-pause"
        );
        const uploadCard = dashboardDiv.querySelector(
          "#danbooru-insights-upload-card"
        );
        if (btnPlayPause && uploadCard) {
          let isPaused = false;
          btnPlayPause.addEventListener("click", () => {
            isPaused = !isPaused;
            if (isPaused) {
              uploadCard.classList.add("paused");
              btnPlayPause.title = "Play Animation";
              btnPlayPause.innerHTML = `
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                         <polygon points="5 3 19 12 5 21 5 3"></polygon>
                     </svg>
                  `;
            } else {
              uploadCard.classList.remove("paused");
              btnPlayPause.title = "Pause Animation";
              btnPlayPause.innerHTML = `
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                         <rect x="5" y="4" width="4" height="16"></rect>
                         <rect x="15" y="4" width="4" height="16"></rect>
                     </svg>
                  `;
            }
          });
        }
        const topStatsRow = document.createElement("div");
        topStatsRow.style.display = "grid";
        topStatsRow.style.gridTemplateColumns = "repeat(auto-fit, minmax(300px, 1fr))";
        topStatsRow.style.gap = "15px";
        topStatsRow.style.marginBottom = "35px";
        const pieContainer = document.createElement("div");
        pieContainer.style.background = "var(--di-bg, #fff)";
        pieContainer.style.border = "1px solid var(--di-border-light, #eee)";
        pieContainer.style.borderRadius = "8px";
        pieContainer.style.padding = "15px";
        pieContainer.style.display = "flex";
        pieContainer.style.flexDirection = "column";
        pieContainer.style.color = "var(--di-text-muted, #888)";
        const topPostContainer = document.createElement("div");
        topPostContainer.style.background = "var(--di-bg, #fff)";
        topPostContainer.style.border = "1px solid var(--di-border-light, #eee)";
        topPostContainer.style.borderRadius = "8px";
        topPostContainer.style.padding = "15px";
        topPostContainer.style.display = "flex";
        topPostContainer.style.flexDirection = "column";
        perfLogger.start("dbi:render:widget:pie");
        const pieResult = renderPieWidget(
          pieContainer,
          distributions,
          isNsfwEnabled,
          this.dataManager,
          this.context,
          firstUploadDate
        );
        perfLogger.end("dbi:render:widget:pie");
        perfLogger.start("dbi:render:widget:topPosts");
        const topPostsResult = renderTopPostsWidget(
          topPostContainer,
          topPosts,
          recentPopularPosts,
          randomPostsPromise,
          isNsfwEnabled,
          this.db,
          this.context
        );
        perfLogger.end("dbi:render:widget:topPosts");
        topStatsRow.appendChild(pieContainer);
        topStatsRow.appendChild(topPostContainer);
        dashboardDiv.appendChild(topStatsRow);
        content.appendChild(dashboardDiv);
        const milestonesDiv = document.createElement("div");
        milestonesDiv.style.marginTop = "20px";
        dashboardDiv.appendChild(milestonesDiv);
        const milestonesResult = await perfLogger.wrap(
          "dbi:render:widget:milestones",
          () => renderMilestonesWidget(
            milestonesDiv,
            this.db,
            this.context,
            isNsfwEnabled
          )
        );
        applyNsfwUpdate = async () => {
          pieResult.onNsfwChange(isNsfwEnabled);
          topPostsResult.onNsfwChange(isNsfwEnabled);
          await milestonesResult.onNsfwChange(isNsfwEnabled);
        };
        await perfLogger.wrap(
          "dbi:render:widget:history",
          () => renderHistoryChart(
            dashboardDiv,
            this.db,
            this.context,
            milestones1k,
            levelChanges
          )
        );
        const createdTagsContainer = document.createElement("div");
        createdTagsContainer.style.marginTop = "35px";
        dashboardDiv.appendChild(createdTagsContainer);
        perfLogger.start("dbi:render:widget:createdTags");
        renderCreatedTagsWidget(
          createdTagsContainer,
          this.dataManager,
          this.context.targetUser
        );
        perfLogger.end("dbi:render:widget:createdTags");
        const tagCloudContainer = document.createElement("div");
        tagCloudContainer.style.marginTop = "35px";
        dashboardDiv.appendChild(tagCloudContainer);
        perfLogger.start("dbi:render:widget:tagCloud");
        renderTagCloudWidget(tagCloudContainer, {
          initialData: tagCloudGeneral,
          fetchData: (catId) => this.dataManager.getTagCloudData(this.context.targetUser, catId),
          userName: this.context.targetUser.normalizedName,
          categories: [
            { id: 0, label: "General", color: "#0075f8" },
            { id: 1, label: "Artist", color: "#a00" },
            { id: 3, label: "Copy", color: "#a800aa" },
            { id: 4, label: "Char", color: "#00ab2c" }
          ]
        });
        perfLogger.end("dbi:render:widget:tagCloud");
        if (scatterData.length > 0) {
          perfLogger.start("dbi:render:widget:scatter");
          renderScatterPlot(
            dashboardDiv,
            scatterData,
            this.context,
            levelChanges,
            {
              userStats,
              needsBackfill,
              runBackfill: needsBackfill ? (onProgress) => dataManager.backfillPostMetadata(
                this.context.targetUser,
                onProgress
              ) : void 0,
              refreshScatterData: () => dataManager.getScatterData(this.context.targetUser),
              fetchPostDetails: (postId) => dataManager.fetchPostDetails(postId)
            }
          );
          perfLogger.end("dbi:render:widget:scatter", {
            points: scatterData.length
          });
        }
        dashboardDiv.insertAdjacentHTML("beforeend", dashboardFooterHtml());
        void this.updateHeaderStatus();
        scheduleRevalidate("status", statusStartRevalidate);
        scheduleRevalidate("rating", ratingStartRevalidate);
        scheduleRevalidate("topPosts", topPostsStartRevalidate);
        scheduleRevalidate("recentPopular", recentPopularStartRevalidate);
        scheduleRevalidate("milestones1k", milestones1kStartRevalidate);
        scheduleRevalidate("levelChanges", levelChangesStartRevalidate);
      } finally {
        perfLogger.end("dbi:render:total", perfMeta);
        this.isRendering = false;
      }
    }
  }
  const log$2 = createLogger("TagAnalyticsData");
  const CACHE_DAY_MS = 24 * 60 * 60 * 1e3;
  const MONTHLY_CACHE_DRIFT_THRESHOLD = 0.02;
  const MONTHLY_CACHE_FULL_RESCAN_MS = 90 * CACHE_DAY_MS;
  function computeMonthsDistance(yearMonth, now = new Date()) {
    const [y, m] = yearMonth.split("-").map(Number);
    return (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
  }
  function isMonthlyCountValid(yearMonth, fetchedAt, now) {
    const distance = computeMonthsDistance(yearMonth, new Date(now));
    if (distance <= 1) return false;
    const age = now - fetchedAt;
    if (age < 0) return false;
    if (distance <= 12) return age < 7 * CACHE_DAY_MS;
    if (distance <= 36) return age < 30 * CACHE_DAY_MS;
    return age < 180 * CACHE_DAY_MS;
  }
  const IMPLICATIONS_CACHE_TTL_MS = 180 * CACHE_DAY_MS;
  const IMPLICATIONS_BATCH_CHUNK_SIZE = 50;
  const topLevelSessionCache = new Map();
  function parseImplicationsResponse(chunk, imps) {
    const result = new Map();
    chunk.forEach((name) => result.set(name, true));
    if (Array.isArray(imps)) {
      for (const imp of imps) {
        const name = imp?.antecedent_name;
        if (name && result.has(name)) {
          result.set(name, false);
        }
      }
    }
    return result;
  }
  function isImplicationCacheValid(fetchedAt, now) {
    const age = now - fetchedAt;
    return age >= 0 && age < IMPLICATIONS_CACHE_TTL_MS;
  }
  const DISTRIBUTION_OTHERS_MIN_FREQ = 5e-3;
  const DISTRIBUTION_CUTOFF_FREQ = 0.95;
  const DISTRIBUTION_TOP_N = 10;
  function buildDistributionApprox(filteredCandidates, totalCount) {
    const getFreq = (c) => c.related_tag ? c.related_tag.frequency : c.frequency || 0;
    const sorted = [...filteredCandidates].sort(
      (a, b) => getFreq(b) - getFreq(a)
    );
    const topTags = sorted.slice(0, DISTRIBUTION_TOP_N).map((item) => {
      const freq = getFreq(item);
      return {
        name: item.tag.name.replace(/_/g, " "),
        key: item.tag.name,
        frequency: freq,
        count: Math.max(0, Math.floor(freq * Math.max(0, totalCount)))
      };
    });
    const finalTags = [];
    let currentSumFreq = 0;
    for (const t of topTags) {
      finalTags.push(t);
      currentSumFreq += t.frequency;
      if (currentSumFreq > DISTRIBUTION_CUTOFF_FREQ) break;
    }
    if (finalTags.length > 0) {
      const remainFreq = Math.max(0, 1 - currentSumFreq);
      if (remainFreq > DISTRIBUTION_OTHERS_MIN_FREQ) {
        const othersCount = Math.floor(Math.max(0, totalCount) * remainFreq);
        if (othersCount > 0) {
          finalTags.push({
            name: "Others",
            key: "others",
            frequency: remainFreq,
            count: othersCount,
            isOther: true
          });
        }
      }
    }
    return finalTags;
  }
  function distributionToCountMap(slices) {
    const result = {};
    for (const s of slices) {
      result[s.key] = s.count;
    }
    return result;
  }
  class TagAnalyticsDataService {
    db;
    rateLimiter;
    tagName;
    userNames;
_pendingLastFullScanAt = null;
_tagDataMemo = new Map();
    _tagDataTTL = 5 * 60 * 1e3;
    constructor(db, rateLimiter, tagName) {
      this.db = db;
      this.rateLimiter = rateLimiter;
      this.tagName = tagName;
      this.userNames = {};
    }
async loadFromCache() {
      if (!this.db || !this.db.tag_analytics) return null;
      try {
        const cached = await this.db.tag_analytics.get(this.tagName);
        if (cached) {
          const age = Date.now() - cached.updatedAt;
          if (age < CONFIG.CACHE_EXPIRY_MS) {
            return {
              ...cached.data,
              updatedAt: cached.updatedAt
            };
          }
        }
      } catch (e) {
        log$2.warn("Cache load failed", { error: e });
      }
      return null;
    }
async saveToCache(data) {
      if (!this.db || !this.db.tag_analytics) return;
      try {
        let lastFullScanAt;
        if (this._pendingLastFullScanAt !== null) {
          lastFullScanAt = this._pendingLastFullScanAt;
        } else {
          const existing = await this.db.tag_analytics.get(this.tagName);
          lastFullScanAt = existing?.lastFullScanAt;
        }
        await this.db.tag_analytics.put({
          tagName: this.tagName,
          updatedAt: Date.now(),
          data,
          lastFullScanAt
        });
        this._pendingLastFullScanAt = null;
      } catch (e) {
        log$2.warn("Cache save failed", { error: e });
      }
    }
async readMonthlyCountsCache(yearMonths) {
      const result = new Map();
      if (!this.db?.tag_monthly_counts || yearMonths.length === 0) return result;
      try {
        const keys = yearMonths.map((ym) => [this.tagName, ym]);
        const records = await this.db.tag_monthly_counts.bulkGet(keys);
        records.forEach((r, i) => {
          if (r) result.set(yearMonths[i], r);
        });
      } catch (e) {
        log$2.warn("Failed to read monthly counts cache", { error: e });
      }
      return result;
    }
async writeMonthlyCountsCache(entries) {
      if (!this.db?.tag_monthly_counts || entries.length === 0) return;
      try {
        const now = Date.now();
        const records = entries.map((e) => ({
          tag: this.tagName,
          yearMonth: e.yearMonth,
          count: e.count,
          fetchedAt: now
        }));
        await bulkPutSafe(
          this.db.tag_monthly_counts,
          records,
          () => evictOldestNonCurrentUser(this.db, 0)
        );
      } catch (e) {
        log$2.warn("Failed to write monthly counts cache", { error: e });
      }
    }
async fetchTopLevelTagsBatch(tagNames) {
      const result = new Map();
      if (tagNames.length === 0) return result;
      for (let i = 0; i < tagNames.length; i += IMPLICATIONS_BATCH_CHUNK_SIZE) {
        const chunk = tagNames.slice(i, i + IMPLICATIONS_BATCH_CHUNK_SIZE);
        const url = `/tag_implications.json?search[antecedent_name_comma]=${encodeURIComponent(chunk.join(","))}&limit=1000`;
        try {
          const imps = await this.rateLimiter.fetch(url).then((r) => r.json());
          const parsed = parseImplicationsResponse(chunk, imps);
          parsed.forEach((v, k) => result.set(k, v));
        } catch (e) {
          log$2.warn("Batch tag_implications fetch failed", {
            error: e,
            chunkSize: chunk.length
          });
        }
      }
      return result;
    }
async readImplicationCache(tagNames) {
      const result = new Map();
      if (tagNames.length === 0) return result;
      const missing = [];
      for (const name of tagNames) {
        const hit = topLevelSessionCache.get(name);
        if (hit !== void 0) {
          result.set(name, hit);
        } else {
          missing.push(name);
        }
      }
      if (missing.length === 0 || !this.db?.tag_implications_cache) {
        return result;
      }
      try {
        const now = Date.now();
        const records = await this.db.tag_implications_cache.bulkGet(missing);
        records.forEach((r, i) => {
          if (r && isImplicationCacheValid(r.fetchedAt, now)) {
            result.set(missing[i], r.isTopLevel);
            topLevelSessionCache.set(missing[i], r.isTopLevel);
          }
        });
      } catch (e) {
        log$2.warn("Failed to read tag_implications cache", { error: e });
      }
      return result;
    }
async writeImplicationCache(entries) {
      if (entries.size === 0) return;
      entries.forEach((isTopLevel, tagName) => {
        topLevelSessionCache.set(tagName, isTopLevel);
      });
      if (!this.db?.tag_implications_cache) return;
      try {
        const now = Date.now();
        const records = [];
        entries.forEach((isTopLevel, tagName) => {
          records.push({ tagName, isTopLevel, fetchedAt: now });
        });
        await bulkPutSafe(
          this.db.tag_implications_cache,
          records,
          () => evictOldestNonCurrentUser(this.db, 0)
        );
      } catch (e) {
        log$2.warn("Failed to write tag_implications cache", { error: e });
      }
    }
async getTopLevelFlags(tagNames) {
      const cached = await this.readImplicationCache(tagNames);
      const missing = tagNames.filter((n) => !cached.has(n));
      if (missing.length === 0) return cached;
      const fetched = await this.fetchTopLevelTagsBatch(missing);
      if (fetched.size > 0) {
        await this.writeImplicationCache(fetched);
      }
      for (const name of missing) {
        if (fetched.has(name)) {
          cached.set(name, fetched.get(name));
        } else {
          cached.set(name, true);
        }
      }
      return cached;
    }
async invalidateMonthlyCountsCache() {
      if (!this.db?.tag_monthly_counts) return;
      try {
        await this.db.tag_monthly_counts.where("tag").equals(this.tagName).delete();
      } catch (e) {
        log$2.warn("Failed to invalidate monthly counts cache", { error: e });
      }
    }
async persistFullScanMarker(ts) {
      if (!this.db?.tag_analytics) return;
      try {
        const existing = await this.db.tag_analytics.get(this.tagName);
        if (existing) {
          existing.lastFullScanAt = ts;
          await this.db.tag_analytics.put(existing);
        } else {
          this._pendingLastFullScanAt = ts;
        }
      } catch (e) {
        log$2.warn("Failed to persist full scan marker", { error: e });
      }
    }
getRetentionDays() {
      try {
        const val = localStorage.getItem("danbooru_tag_analytics_retention");
        if (val) return parseInt(val, 10);
      } catch {
      }
      return 7;
    }
getSyncThreshold() {
      try {
        const val = localStorage.getItem("danbooru_tag_analytics_sync_threshold");
        if (val) return parseInt(val, 10);
      } catch {
      }
      return 50;
    }
setSyncThreshold(count) {
      localStorage.setItem(
        "danbooru_tag_analytics_sync_threshold",
        count.toString()
      );
    }
setRetentionDays(days) {
      if (typeof days === "number" && days > 0) {
        localStorage.setItem("danbooru_tag_analytics_retention", String(days));
      }
    }
async resetTagCache() {
      if (!this.db) return;
      if (this.db.tag_analytics) {
        await this.db.tag_analytics.delete(this.tagName);
      }
      await this.invalidateMonthlyCountsCache();
      this._pendingLastFullScanAt = null;
      this.userNames = {};
    }
async cleanupOldCache() {
      if (!this.db || !this.db.tag_analytics) return;
      const retentionDays = this.getRetentionDays();
      const cutoff = Date.now() - retentionDays * DAY_MS;
      try {
        await this.db.tag_analytics.where("updatedAt").below(cutoff).delete();
      } catch (e) {
        log$2.warn("Cleanup failed", { error: e });
      }
    }
async fetchInitialStats(tagName, cachedData, absoluteOldest, foundEarliestDate) {
      const tagData = await this.fetchTagData(tagName);
      if (!tagData) return null;
      if (cachedData && cachedData.firstPost) {
        return {
          firstPost: cachedData.firstPost,
          hundredthPost: cachedData.hundredthPost,
          totalCount: tagData.post_count,
          startDate: new Date(cachedData.firstPost.created_at),
          timeToHundred: cachedData.timeToHundred,
          meta: tagData,
          initialPosts: null
};
      }
      let tagCreatedAt = tagData.created_at;
      if (foundEarliestDate) {
        tagCreatedAt = foundEarliestDate;
      } else if (absoluteOldest) {
        tagCreatedAt = "2005-01-01";
      }
      let posts = [];
      const MAX_OPTIMIZED_POSTS = CONFIG.MAX_OPTIMIZED_POSTS;
      const isSmallTag = tagData.post_count <= MAX_OPTIMIZED_POSTS;
      const targetFetchCount = Math.min(tagData.post_count, MAX_OPTIMIZED_POSTS);
      const limit = isSmallTag ? 200 : 100;
      let currentPage = "a0";
      let hasMore = true;
      try {
        while (hasMore && posts.length < targetFetchCount) {
          const fetchLimit = Math.min(limit, targetFetchCount - posts.length);
          const params = new URLSearchParams({
            tags: `${tagName} date:>=${tagCreatedAt}`,
            limit: String(fetchLimit),
            page: currentPage,
            only: "id,created_at,uploader_id,approver_id,file_url,preview_file_url,variants,rating,score,tag_string_copyright,tag_string_character"
          });
          const url = `/posts.json?${params.toString()}`;
          const batch = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (!Array.isArray(batch) || batch.length === 0) {
            break;
          }
          if (batch.length > 1) {
            if (batch[0].id > batch[batch.length - 1].id) {
              batch.reverse();
            }
          }
          posts = posts.concat(batch);
          if (batch.length < fetchLimit || posts.length >= targetFetchCount || !isSmallTag) {
            hasMore = false;
          } else {
            currentPage = `a${batch[batch.length - 1].id}`;
          }
        }
        if (isSmallTag && posts.length < targetFetchCount) {
          posts = [];
          currentPage = "a0";
          hasMore = true;
          while (hasMore && posts.length < targetFetchCount) {
            const fetchLimit = Math.min(limit, targetFetchCount - posts.length);
            const fbParams = new URLSearchParams({
              tags: `${tagName}`,
              limit: String(fetchLimit),
              page: currentPage,
              only: "id,created_at,uploader_id,approver_id,file_url,preview_file_url,variants,rating,score,tag_string_copyright,tag_string_character"
            });
            const fbBatch = await this.rateLimiter.fetch(`/posts.json?${fbParams.toString()}`).then((r) => r.json());
            if (!Array.isArray(fbBatch) || fbBatch.length === 0) {
              break;
            }
            if (fbBatch.length > 1 && fbBatch[0].id > fbBatch[fbBatch.length - 1].id) {
              fbBatch.reverse();
            }
            posts = posts.concat(fbBatch);
            if (fbBatch.length < fetchLimit || posts.length >= targetFetchCount) {
              hasMore = false;
            } else {
              currentPage = `a${fbBatch[fbBatch.length - 1].id}`;
            }
          }
        }
      } catch (e) {
        log$2.warn("Fetch failed for initial stats gather", { error: e });
      }
      if (!posts || posts.length === 0) {
        return {
          totalCount: tagData.post_count,
          meta: tagData,
          updatedAt: Date.now()
        };
      }
      const firstPost = posts[0];
      const hundredthPost = posts.length >= 100 ? posts[99] : null;
      const startDate = new Date(firstPost.created_at);
      let timeToHundred = null;
      if (hundredthPost) {
        const hundredthDate = new Date(hundredthPost.created_at);
        timeToHundred = hundredthDate.getTime() - startDate.getTime();
      }
      return {
        firstPost,
        hundredthPost,
        totalCount: tagData.post_count,
        startDate,
        timeToHundred,
        meta: tagData,
        initialPosts: posts
};
    }
async fetchCountWithRetry(url, retries = 1) {
      for (let i = 0; i <= retries; i++) {
        try {
          const resp = await this.rateLimiter.fetch(url);
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
          }
          const data = await resp.json();
          const count = data && data.counts && typeof data.counts === "object" ? data.counts.posts : data ? data.posts : void 0;
          if (count !== void 0 && count !== null) {
            return count;
          }
          throw new Error("Invalid count data");
        } catch (e) {
          if (i === retries) {
            log$2.warn(`Failed to fetch count after ${retries + 1} attempts`, {
              url,
              error: e
            });
            return 0;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      return 0;
    }
async fetchCommentaryCounts(tagName) {
      const queries = {
        total: `tags=${encodeURIComponent(tagName)}+has:commentary`,
        translated: `tags=${encodeURIComponent(tagName)}+has:commentary+commentary`,
        requested: `tags=${encodeURIComponent(tagName)}+has:commentary+commentary_request`
      };
      const results = {};
      const keys = Object.keys(queries);
      await Promise.all(
        keys.map(async (key) => {
          const query = queries[key];
          const url = `/counts/posts.json?${query}`;
          results[key] = await this.fetchCountWithRetry(url);
        })
      );
      keys.forEach((key) => {
        if (results[key] === void 0) {
          log$2.warn(`Missing commentary key: ${key}. Defaulting to 0.`);
          results[key] = 0;
        }
      });
      return results;
    }
async fetchStatusCounts(tagName) {
      const statuses = [
        "active",
        "appealed",
        "banned",
        "deleted",
        "flagged",
        "pending"
      ];
      const results = {};
      const tasks = statuses.map(async (status) => {
        const url = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+status:${status}`;
        results[status] = await this.fetchCountWithRetry(url);
      });
      await Promise.all(tasks);
      statuses.forEach((status) => {
        if (results[status] === void 0) {
          log$2.warn(`Missing status key: ${status}. Defaulting to 0.`);
          results[status] = 0;
        }
      });
      return results;
    }
async fetchRatingCounts(tagName, startDate = null) {
      const ratings = ["g", "s", "q", "e"];
      const results = {};
      const tasks = ratings.map(async (rating) => {
        let qs = `tags=${encodeURIComponent(tagName)}+rating:${rating}`;
        if (startDate) {
          qs += `+date:>=${startDate}`;
        }
        const url = `/counts/posts.json?${qs}`;
        results[rating] = await this.fetchCountWithRetry(url);
      });
      await Promise.all(tasks);
      ratings.forEach((rating) => {
        if (results[rating] === void 0) {
          log$2.warn(`Missing rating key: ${rating}. Defaulting to 0.`);
          results[rating] = 0;
        }
      });
      return results;
    }
    async fetchRelatedTagDistribution(tagName, categoryId, totalTagCount, opts = {}) {
      const catName = categoryId === 3 ? "Copyright" : "Character";
      const relatedUrl = `/related_tag.json?commit=Search&search[category]=${categoryId}&search[order]=Frequency&search[query]=${encodeURIComponent(tagName)}`;
      try {
        const resp = await this.rateLimiter.fetch(relatedUrl).then((r) => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
          return null;
        const tags = resp.related_tags;
        const candidates = tags.slice(0, 20);
        const flags = await this.getTopLevelFlags(
          candidates.map((c) => c.tag.name)
        );
        const filtered = candidates.filter(
          (item) => flags.get(item.tag.name) === true
        );
        const slices = buildDistributionApprox(filtered, totalTagCount);
        const approxResult = distributionToCountMap(slices);
        if (opts.onExactCounts && slices.length > 0) {
          void this.revalidateRelatedTagCounts(
            tagName,
            slices,
            opts.onExactCounts
          );
        }
        return approxResult;
      } catch (e) {
        log$2.warn(`Failed to fetch ${catName} distribution`, { error: e });
        return null;
      }
    }
async revalidateRelatedTagCounts(tagName, slices, onExactCounts) {
      try {
        const fetchable = slices.filter((s) => !s.isOther);
        const resolved = {};
        await Promise.all(
          fetchable.map(async (slice) => {
            try {
              const query = `${tagName} ${slice.key}`;
              const cUrl = `/counts/posts.json?tags=${encodeURIComponent(query)}`;
              const cResp = await this.rateLimiter.fetch(cUrl).then((r) => r.json());
              const exact = (cResp && cResp.counts ? cResp.counts.posts : cResp ? cResp.posts : 0) || 0;
              resolved[slice.key] = exact;
            } catch (e) {
              log$2.debug("SWR exact count fetch failed, keeping approx", {
                tag: slice.key,
                error: e
              });
              resolved[slice.key] = slice.count;
            }
          })
        );
        const others = slices.find((s) => s.isOther);
        if (others) resolved[others.key] = others.count;
        onExactCounts(resolved);
      } catch (e) {
        log$2.debug("SWR revalidation aborted", { error: e });
      }
    }
    async fetchHistoryBackwards(tagName, forwardStartDate, targetTotal, currentForwardTotal) {
      log$2.debug("Starting Reverse Scan", {
        tag: tagName,
        start: forwardStartDate,
        target: targetTotal,
        current: currentForwardTotal
      });
      const history2 = [];
      let totalSum = currentForwardTotal;
      const currentMonth = new Date(forwardStartDate);
      currentMonth.setMonth(currentMonth.getMonth() - 1);
      const hardLimit = new Date("2005-01-01");
      while (totalSum < targetTotal && currentMonth > hardLimit) {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth() + 1;
        const nextDate = new Date(currentMonth);
        nextDate.setMonth(nextDate.getMonth() + 1);
        const nYear = nextDate.getFullYear();
        const nMonth = nextDate.getMonth() + 1;
        const dateRange = `${year}-${String(month).padStart(2, "0")}-01...${nYear}-${String(nMonth).padStart(2, "0")}-01`;
        const url = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+date:${dateRange}`;
        try {
          const data = await this.rateLimiter.fetch(url).then((r) => r.json());
          const count = data.counts && typeof data.counts === "object" ? data.counts.posts || 0 : data.counts || 0;
          if (count > 0) {
            history2.unshift({
              date: `${year}-${String(month).padStart(2, "0")}-01`,
              count,
              cumulative: 0
});
            totalSum += count;
            log$2.debug(`Reverse Scan Hit: ${year}-${month}`, {
              count,
              total: totalSum,
              target: targetTotal
            });
          }
        } catch (e) {
          log$2.warn(`Backward fetch failed for ${year}-${month}`, { error: e });
        }
        currentMonth.setMonth(currentMonth.getMonth() - 1);
      }
      log$2.debug("Reverse Scan Completed", {
        total: totalSum,
        target: targetTotal,
        hitsCount: history2.length
      });
      let runningSum = 0;
      for (let i = 0; i < history2.length; i++) {
        runningSum += history2[i].count;
        history2[i].cumulative = runningSum;
      }
      return history2;
    }
    async fetchHistoryDelta(tagName, lastDate, startDate) {
      if (!lastDate) {
        return this.fetchMonthlyCounts(tagName, startDate, { isFullScan: true });
      }
      const now = new Date();
      const twoMonthsAgo = new Date(now);
      twoMonthsAgo.setMonth(now.getMonth() - 2);
      twoMonthsAgo.setDate(1);
      const effectiveStart = lastDate && lastDate > twoMonthsAgo ? twoMonthsAgo : lastDate || startDate;
      return this.fetchMonthlyCounts(tagName, effectiveStart);
    }
    mergeHistory(oldHistory, newHistory) {
      if (!oldHistory || oldHistory.length === 0) return newHistory ?? [];
      if (!newHistory || newHistory.length === 0) return oldHistory;
      const newStart = newHistory[0].date;
      const filteredOld = oldHistory.filter((h) => h.date < newStart);
      let merged = filteredOld.concat(newHistory);
      let runningSum = 0;
      merged = merged.map((h) => {
        runningSum += h.count;
        return { ...h, cumulative: runningSum };
      });
      return merged;
    }
    async fetchMilestonesDelta(tagName, currentTotal, cachedMilestones, fullHistory) {
      const allTargets = this.getMilestoneTargets(currentTotal);
      const existingTargets = new Set(cachedMilestones.map((m) => m.milestone));
      const missingTargets = allTargets.filter((t) => !existingTargets.has(t));
      if (missingTargets.length === 0) return [];
      return this.fetchMilestones(tagName, fullHistory, missingTargets);
    }
    mergeMilestones(oldMilestones, newMilestones) {
      if (!newMilestones || newMilestones.length === 0) return oldMilestones;
      return [...oldMilestones, ...newMilestones].sort(
        (a, b) => a.milestone - b.milestone
      );
    }
    async fetchLatestPost(tagName) {
      const url = `/posts.json?tags=${encodeURIComponent(tagName)}&limit=1&only=id,created_at,variants,uploader_id,rating,preview_file_url`;
      try {
        const posts = await this.rateLimiter.fetch(url).then((r) => r.json());
        return posts && posts.length > 0 ? posts[0] : null;
      } catch (e) {
        log$2.warn("Failed to fetch latest post", { error: e });
        return null;
      }
    }
    async fetchNewPostCount(tagName) {
      const url = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+age:..1d`;
      try {
        const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
        return (resp && resp.counts ? resp.counts.posts : resp ? resp.posts : 0) || 0;
      } catch (e) {
        log$2.warn("Failed to fetch new post count", { error: e });
        return 0;
      }
    }
    async fetchTrendingPost(tagName, isNSFW = false) {
      const ratingQuery = isNSFW ? "is:nsfw" : "is:sfw";
      const url = `/posts.json?tags=${encodeURIComponent(tagName)}+age:..3d+order:score+${ratingQuery}&limit=1&only=id,created_at,variants,uploader_id,rating,score,preview_file_url`;
      try {
        const posts = await this.rateLimiter.fetch(url).then((r) => r.json());
        return posts && posts.length > 0 ? posts[0] : null;
      } catch (e) {
        log$2.warn("Failed to fetch trending post", { error: e });
        return null;
      }
    }
calculateLocalStats(posts) {
      const ratingCounts = { g: 0, s: 0, q: 0, e: 0 };
      const uploaders = {};
      const approvers = {};
      posts.forEach((p) => {
        if (ratingCounts[p.rating] !== void 0) ratingCounts[p.rating]++;
        if (p.uploader_id) {
          uploaders[p.uploader_id] = (uploaders[p.uploader_id] || 0) + 1;
        }
        if (p.approver_id) {
          approvers[p.approver_id] = (approvers[p.approver_id] || 0) + 1;
        }
      });
      const sortMap = (map) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id, count], index) => ({ id, count, rank: index + 1 }));
      return {
        ratingCounts,
        uploaderRanking: sortMap(uploaders),
        approverRanking: sortMap(approvers)
      };
    }
    async fetchReportRanking(tagName, group, from, to) {
      const params = new URLSearchParams({
        "search[tags]": tagName,
        "search[group]": group,
        "search[mode]": "table",
        "search[group_limit]": "10",
commit: "Search"
      });
      if (from) params.append("search[from]", from);
      if (to) params.append("search[to]", to);
      const url = `/reports/posts.json?${params.toString()}`;
      try {
        const resp = await this.rateLimiter.fetch(url, {
          headers: { Accept: "application/json" }
        });
        const data = await resp.json();
        return data;
      } catch (e) {
        log$2.warn(`Ranking fetch failed (${group})`, { error: e });
        return [];
      }
    }

async fetchMonthlyCounts(tagName, startDate, opts = {}) {
      const startDateObj = startDate instanceof Date ? startDate : new Date(startDate);
      const startYear = startDateObj.getFullYear();
      const startMonth = startDateObj.getMonth();
      const now = new Date();
      const nowMs = now.getTime();
      const tasks = [];
      const current = new Date(Date.UTC(startYear, startMonth, 1));
      while (current <= now) {
        const y = current.getUTCFullYear();
        const m = current.getUTCMonth() + 1;
        const dateStr = `${y}-${String(m).padStart(2, "0")}-01`;
        const yearMonth = `${y}-${String(m).padStart(2, "0")}`;
        const nextMonth = new Date(current);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        const nextY = nextMonth.getUTCFullYear();
        const nextM = nextMonth.getUTCMonth() + 1;
        let rangeEnd = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
        if (nextMonth > now) {
          rangeEnd = now.toISOString();
        }
        const queryDate = `${y}-${String(m).padStart(2, "0")}-01...${rangeEnd}`;
        tasks.push({ dateStr, yearMonth, queryDate });
        current.setUTCMonth(current.getUTCMonth() + 1);
      }
      const cacheEnabled = !opts.skipCache && this.db?.tag_monthly_counts !== void 0;
      let forcedFullScan = false;
      if (cacheEnabled && opts.isFullScan) {
        const lastScan = await this.getLastFullScanAt();
        if (lastScan === 0 || nowMs - lastScan > MONTHLY_CACHE_FULL_RESCAN_MS) {
          forcedFullScan = true;
          log$2.debug("Monthly cache: forced full rescan", {
            tag: tagName,
            lastScan,
            ageDays: lastScan === 0 ? null : Math.round((nowMs - lastScan) / CACHE_DAY_MS)
          });
        }
      }
      let cached = new Map();
      if (cacheEnabled && !forcedFullScan) {
        cached = await this.readMonthlyCountsCache(tasks.map((t) => t.yearMonth));
        if (opts.isFullScan && opts.totalCount !== void 0 && opts.totalCount > 0 && tasks.length > 0 && cached.size / tasks.length > 0.95) {
          let cachedSum = 0;
          cached.forEach((r) => {
            cachedSum += r.count;
          });
          const drift = Math.abs(cachedSum - opts.totalCount) / opts.totalCount;
          if (drift > MONTHLY_CACHE_DRIFT_THRESHOLD) {
            log$2.warn("Monthly cache drift detected, invalidating", {
              tag: tagName,
              cachedSum,
              totalCount: opts.totalCount,
              drift
            });
            await this.invalidateMonthlyCountsCache();
            cached = new Map();
            forcedFullScan = true;
          }
        }
      }
      const cachedResults = [];
      const fetchTasks = [];
      for (const task of tasks) {
        const entry = forcedFullScan ? void 0 : cached.get(task.yearMonth);
        if (entry && isMonthlyCountValid(task.yearMonth, entry.fetchedAt, nowMs)) {
          cachedResults.push({
            date: task.dateStr,
            count: entry.count,
            cumulative: 0
          });
        } else {
          fetchTasks.push(task);
        }
      }
      const fetchedResults = await Promise.all(
        fetchTasks.map((task) => {
          const params = new URLSearchParams({
            tags: `${tagName} status:any date:${task.queryDate}`
          });
          const url = `/counts/posts.json?${params.toString()}`;
          return this.rateLimiter.fetch(url).then((r) => r.json()).then((data) => {
            const count = (data && data.counts ? data.counts.posts : data ? data.posts : 0) || 0;
            return {
              date: task.dateStr,
              yearMonth: task.yearMonth,
              count,
              ok: true
            };
          }).catch((e) => {
            log$2.warn(`Failed month ${task.dateStr}`, { error: e });
            return {
              date: task.dateStr,
              yearMonth: task.yearMonth,
              count: 0,
              ok: false
            };
          });
        })
      );
      if (cacheEnabled) {
        const toWrite = fetchedResults.filter((r) => r.ok).map((r) => ({ yearMonth: r.yearMonth, count: r.count }));
        if (toWrite.length > 0) {
          await this.writeMonthlyCountsCache(toWrite);
        }
      }
      if (cacheEnabled && forcedFullScan && fetchTasks.length === tasks.length && fetchedResults.every((r) => r.ok)) {
        await this.persistFullScanMarker(nowMs);
      }
      const combined = [
        ...cachedResults,
        ...fetchedResults.map((r) => ({
          date: r.date,
          count: r.count,
          cumulative: 0
        }))
      ];
      combined.sort((a, b) => a.date.localeCompare(b.date));
      let cumulative = 0;
      for (const item of combined) {
        cumulative += item.count;
        item.cumulative = cumulative;
      }
      const monthlyData = combined;
      monthlyData.historyCutoff = now.toISOString();
      return monthlyData;
    }
async getLastFullScanAt() {
      if (!this.db?.tag_analytics) return 0;
      try {
        const record = await this.db.tag_analytics.get(this.tagName);
        return record?.lastFullScanAt ?? 0;
      } catch (e) {
        log$2.warn("Failed to read lastFullScanAt", { error: e });
        return 0;
      }
    }
async fetchMilestones(tagName, monthlyData, targets) {
      const milestones = [];
      targets.sort((a, b) => a - b);
      if (!monthlyData || monthlyData.length === 0) return [];
      for (const target of targets) {
        let targetData = null;
        let prevCumulative = 0;
        for (const mData of monthlyData) {
          if (mData.cumulative >= target) {
            targetData = mData;
            break;
          }
          prevCumulative = mData.cumulative;
        }
        if (targetData) {
          const offset = target - prevCumulative;
          let y, m;
          {
            const dParts = targetData.date.split("-");
            y = parseInt(dParts[0], 10);
            m = parseInt(dParts[1], 10);
          }
          const prevMonthEnd = new Date(y, m - 1, 0);
          const prevDateStr = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, "0")}-${String(prevMonthEnd.getDate()).padStart(2, "0")}`;
          const limit = 200;
          const page = Math.ceil(offset / limit);
          const indexInPage = (offset - 1) % limit;
          const params = new URLSearchParams({
            tags: `${tagName} status:any date:>${prevDateStr} order:id`,
            limit: String(limit),
            page: String(page),
            only: "id,created_at,uploader_id,uploader_name,variants,rating,preview_file_url"
          });
          const url = `/posts.json?${params.toString()}`;
          try {
            const posts = await this.rateLimiter.fetch(url).then((r) => r.json());
            if (posts && posts[indexInPage]) {
              milestones.push({
                milestone: target,
                post: posts[indexInPage]
              });
            } else {
              log$2.warn(`Milestone ${target} post not found`, {
                index: indexInPage,
                page,
                postsLen: posts ? posts.length : 0
              });
            }
          } catch (e) {
            log$2.warn(`Failed milestone ${target}`, { error: e });
          }
        }
      }
      await this.backfillUploaderNames(milestones);
      return milestones;
    }
async backfillUploaderNames(items) {
      const userIds = new Set();
      items.forEach((item) => {
        const p = "post" in item ? item.post : item;
        if (p.uploader_id) userIds.add(p.uploader_id);
        if (p.approver_id) userIds.add(p.approver_id);
      });
      if (userIds.size > 0) {
        const userMap = await this.fetchUserMap(
          Array.from(userIds)
        );
        userMap.forEach((uObj, id) => {
          this.userNames[id] = uObj;
        });
        items.forEach((item) => {
          const p = "post" in item ? item.post : item;
          const uId = String(p.uploader_id);
          if (p.uploader_id && userMap.has(uId)) {
            const u = userMap.get(uId);
            p.uploader_name = u.name;
            p.uploader_level = u.level;
          }
          const aId = String(p.approver_id);
          if (p.approver_id && userMap.has(aId)) {
            const a = userMap.get(aId);
            p.approver_name = a.name;
            p.approver_level = a.level;
          }
        });
      }
      return items;
    }
async fetchUserMap(userIds) {
      const userMap = new Map();
      if (!userIds || userIds.length === 0) return userMap;
      const uniqueIds = Array.from(new Set(userIds));
      const batchSize = 20;
      const userBatches = [];
      for (let i = 0; i < uniqueIds.length; i += batchSize) {
        userBatches.push(uniqueIds.slice(i, i + batchSize));
      }
      const userPromises = userBatches.map((batch) => {
        const params = new URLSearchParams({
          "search[id]": batch.join(","),
          only: "id,name,level_string"
        });
        const url = `/users.json?${params.toString()}`;
        return this.rateLimiter.fetch(url).then((r) => r.json()).then((users) => {
          if (Array.isArray(users)) {
            users.forEach(
              (u) => userMap.set(String(u.id), { name: u.name, level: u.level_string })
            );
          }
        }).catch(
          (e) => log$2.warn("Failed to fetch user batch", { error: e })
        );
      });
      await Promise.all(userPromises);
      return userMap;
    }
async fetchUserMapByNames(userNames) {
      const userMap = new Map();
      if (!userNames || userNames.length === 0) return userMap;
      const uniqueNames = Array.from(new Set(userNames));
      const userPromises = uniqueNames.map((name) => {
        const params = new URLSearchParams({
          "search[name]": name,
only: "id,name,level_string"
        });
        const url = `/users.json?${params.toString()}`;
        return this.rateLimiter.fetch(url).then((r) => r.json()).then((users) => {
          if (Array.isArray(users) && users.length > 0) {
            const u = users[0];
            if (u) {
              userMap.set(name, {
                id: u.id,
                name: u.name,
                level: u.level_string
              });
              userMap.set(u.name, {
                id: u.id,
                name: u.name,
                level: u.level_string
              });
            }
          } else {
            log$2.warn(`User not found by name: "${name}"`);
          }
        }).catch(
          (e) => log$2.warn(`Failed to fetch user: "${name}"`, { error: e })
        );
      });
      await Promise.all(userPromises);
      return userMap;
    }
async resolveFirst100Names(stats) {
      const ids = new Set();
      if (stats.uploaderRanking)
        stats.uploaderRanking.forEach((u) => ids.add(String(u.id)));
      if (stats.approverRanking)
        stats.approverRanking.forEach((u) => ids.add(String(u.id)));
      const userMap = await this.fetchUserMap(Array.from(ids));
      if (stats.uploaderRanking) {
        stats.uploaderRanking.forEach((u) => {
          const uid = String(u.id);
          if (userMap.has(uid)) {
            const uObj = userMap.get(uid);
            u.name = uObj.name;
            u.level = uObj.level;
          }
        });
      }
      if (stats.approverRanking) {
        stats.approverRanking.forEach((u) => {
          const uid = String(u.id);
          if (userMap.has(uid)) {
            const uObj = userMap.get(uid);
            u.name = uObj.name;
            u.level = uObj.level;
          }
        });
      }
      return stats;
    }
calculateHistoryFromPosts(posts) {
      if (!posts || posts.length === 0) return [];
      const sorted = [...posts].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      const counts = {};
      sorted.forEach((p) => {
        const d = new Date(p.created_at);
        if (isNaN(d.getTime())) return;
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        counts[key] = (counts[key] || 0) + 1;
      });
      const startDate = new Date(sorted[0].created_at);
      const now = new Date();
      const history2 = [];
      let cumulative = 0;
      const current = new Date(
        Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1)
      );
      while (current <= now) {
        const key = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
        const count = counts[key] || 0;
        cumulative += count;
        const dateStr = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-${String(current.getUTCDate()).padStart(2, "0")}`;
        history2.push({
          date: dateStr,
count,
          cumulative
        });
        current.setUTCMonth(current.getUTCMonth() + 1);
      }
      return history2;
    }
getMilestoneTargets(total) {
      const milestones = new Set([1]);
      if (total >= 100) milestones.add(100);
      if (total >= 1e3) milestones.add(1e3);
      if (total >= 1e4) milestones.add(1e4);
      if (total >= 1e5) milestones.add(1e5);
      if (total >= 1e6) milestones.add(1e6);
      const step = this.getMilestoneStep(total);
      for (let i = step; i <= total; i += step) {
        milestones.add(i);
      }
      const res = Array.from(milestones).sort((a, b) => a - b);
      return res;
    }
getMilestoneStep(total) {
      if (total < 2500) return 100;
      if (total < 5e3) return 250;
      if (total < 1e4) return 500;
      if (total < 25e3) return 1e3;
      if (total < 5e4) return 2500;
      if (total < 1e5) return 5e3;
      if (total < 25e4) return 1e4;
      if (total < 5e5) return 25e3;
      if (total < 1e6) return 5e4;
      if (total < 25e5) return 1e5;
      if (total < 5e6) return 25e4;
      return 5e5;
    }
getNextMilestoneTarget(total) {
      if (total < 1) return 1;
      if (total < 100) return 100;
      if (total < 1e3) {
        return Math.floor(total / 100) * 100 + 100;
      }
      const step = this.getMilestoneStep(total);
      const nextStep = Math.floor(total / step) * step + step;
      const bases = [1e4, 1e5, 1e6, 1e7];
      let next = nextStep;
      for (const b of bases) {
        if (b > total && b < next) next = b;
      }
      return next;
    }
    async fetchRankingsAndResolve(tagName, dateStr1Y, dateStrTomorrow, measure) {
      const [uAll, aAll, uYear, aYear] = await Promise.all([
        measure(
          "Ranking (Uploader All)",
          this.fetchReportRanking(
            tagName,
            "uploader",
            "2005-01-01",
            dateStrTomorrow
          )
        ),
        measure(
          "Ranking (Approver All)",
          this.fetchReportRanking(
            tagName,
            "approver",
            "2005-01-01",
            dateStrTomorrow
          )
        ),
        measure(
          "Ranking (Uploader Year)",
          this.fetchReportRanking(
            tagName,
            "uploader",
            dateStr1Y,
            dateStrTomorrow
          )
        ),
        measure(
          "Ranking (Approver Year)",
          this.fetchReportRanking(
            tagName,
            "approver",
            dateStr1Y,
            dateStrTomorrow
          )
        )
      ]);
      const uRankingIds = new Set();
      const uRankingNames = new Set();
      const getKey = (r) => r.name || r.uploader || r.approver || r.user;
      const normalize = (n) => n ? n.replace(/ /g, "_") : "";
      [uAll, uYear, aAll, aYear].forEach((report) => {
        if (Array.isArray(report))
          report.forEach((r) => {
            if (r.id) uRankingIds.add(String(r.id));
            else {
              const n = normalize(getKey(r) ?? "");
              if (n && n !== "Unknown") uRankingNames.add(n);
            }
          });
      });
      if (uRankingIds.size > 0) {
        const userMap = await this.fetchUserMap(Array.from(uRankingIds));
        userMap.forEach((uObj, id) => {
          this.userNames[id] = uObj;
        });
      }
      if (uRankingNames.size > 0) {
        const nameMap = await this.fetchUserMapByNames(Array.from(uRankingNames));
        nameMap.forEach((uObj, name) => {
          this.userNames[name] = uObj;
          if (uObj.id) this.userNames[String(uObj.id)] = uObj;
        });
      }
      const processReport = (report) => {
        if (Array.isArray(report)) {
          return report.map((r) => {
            const rawKey = getKey(r) || "Unknown";
            const nName = normalize(rawKey);
            const u = (r.id ? this.userNames[String(r.id)] : null) || this.userNames[nName];
            const level = u ? u.level : null;
            const finalName = u ? u.name : rawKey;
            const count = r.posts || r.count || r.post_count || 0;
            return { id: r.id ?? u?.id ?? 0, name: finalName, level, count };
          });
        }
        return [];
      };
      const result = {
        uploaderAll: processReport(uAll),
        approverAll: processReport(aAll),
        uploaderYear: processReport(uYear),
        approverYear: processReport(aYear)
      };
      return result;
    }
    async fetchTagData(tagName) {
      const cached = this._tagDataMemo.get(tagName);
      if (cached && Date.now() - cached.ts < this._tagDataTTL) {
        return cached.value;
      }
      try {
        const url = `/tags.json?search[name_matches]=${encodeURIComponent(tagName)}`;
        const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
        let result = null;
        if (Array.isArray(resp) && resp.length > 0) {
          const exact = resp.find((t) => t.name === tagName);
          result = exact || resp[0];
        }
        this._tagDataMemo.set(tagName, { value: result, ts: Date.now() });
        return result;
      } catch (e) {
        log$2.error("Tag fetch error", { error: e });
        return null;
      }
    }
getTagNameFromUrl() {
      const path = window.location.pathname;
      const match = path.match(/\/wiki_pages\/([^/]+)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
      return null;
    }
  }
  const log$1 = createLogger("TagAnalyticsCharts");
  class TagAnalyticsChartRenderer {
    currentData;
    currentMilestones;
    resizeObserver;
    resizeTimeout;
    isMilestoneExpanded;
    constructor() {
      this.currentData = null;
      this.currentMilestones = null;
      this.resizeObserver = null;
      this.resizeTimeout = null;
      this.isMilestoneExpanded = false;
    }
cleanup() {
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = null;
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
    }
renderPieChart(type, tagData) {
      const container2 = document.getElementById("status-pie-chart");
      const legendContainer = document.getElementById("status-pie-legend");
      const loading = document.getElementById("status-pie-loading");
      const wrapper = document.getElementById("status-pie-chart-wrapper");
      if (!container2 || !tagData) return;
      let counts = null;
      if (type === "status") counts = tagData.statusCounts;
      else if (type === "rating") counts = tagData.ratingCounts;
      else if (type === "copyright") counts = tagData.copyrightCounts;
      else if (type === "character") counts = tagData.characterCounts;
      else if (type === "commentary") {
        const c = tagData.commentaryCounts;
        const translated = c?.translated || 0;
        const requested = c?.requested || 0;
        const total = c?.total || 0;
        const untagged = Math.max(0, total - (translated + requested));
        counts = {
          commentary: translated,
          commentary_request: requested,
          "has:commentary -commentary -commentary_request": untagged
        };
      }
      if (!counts) return;
      const ratingLabels = {
        g: "General",
        s: "Sensitive",
        q: "Questionable",
        e: "Explicit"
      };
      const data = Object.entries(counts).map(([key, count]) => {
        let name = key;
        if (type === "status")
          name = key.charAt(0).toUpperCase() + key.slice(1);
        else if (type === "rating") name = ratingLabels[key] || key;
        else if (type === "commentary") {
          if (key === "commentary") name = "Commentary";
          else if (key === "commentary_request") name = "Requested";
          else if (key === "has:commentary -commentary -commentary_request")
            name = "Untagged";
        } else name = key.replace(/_/g, " ");
        if (key === "others") name = "Others";
        const validCount = Number(count);
        return {
          name,
          count: isNaN(validCount) ? 0 : validCount,
          key
        };
      }).filter((d) => d.count > 0).sort((a, b) => {
        if (a.key === "others") return 1;
        if (b.key === "others") return -1;
        return b.count - a.count;
      });
      if (data.length === 0) {
        if (loading) {
          loading.style.display = "block";
          loading.textContent = `No ${type} data available.`;
        }
        if (wrapper) wrapper.style.opacity = "0";
        return;
      }
      if (loading) loading.style.display = "none";
      if (wrapper) wrapper.style.opacity = "1";
      const width = 120;
      const height = 120;
      const radius = Math.min(width, height) / 2 - 8;
      const statusColors = {
        active: "#28a745",
        deleted: "#dc3545",
        pending: "#ffc107",
        flagged: "#fd7e14",
        banned: "#6c757d",
        appealed: "#007bff"
      };
      const ratingColors = {
        g: "#28a745",
        s: "#fd7e14",
        q: "#6f42c1",
        e: "#dc3545"
      };
      const ordinalColor = d3__namespace.scaleOrdinal(d3__namespace.schemeCategory10);
      const getColor = (key) => {
        if (type === "status") return statusColors[key] || "#999";
        if (type === "rating") return ratingColors[key] || "#999";
        if (type === "commentary") {
          if (key === "commentary") return "#007bff";
          if (key === "commentary_request") return "#ffc107";
          if (key === "has:commentary -commentary -commentary_request")
            return "#6c757d";
        }
        if (key === "others") return "#888";
        return ordinalColor(key);
      };
      const pie = d3__namespace.pie().value((d) => d.count).sort(null);
      const arc = d3__namespace.arc().innerRadius(radius * 0.4).outerRadius(radius);
      const arcHover = d3__namespace.arc().innerRadius(radius * 0.4).outerRadius(radius * 1.1);
      let svg = d3__namespace.select(container2).select("svg");
      let g;
      if (svg.empty()) {
        svg = d3__namespace.select(container2).append("svg").attr("width", width).attr("height", height);
        g = svg.append("g").attr("transform", `translate(${width / 2},${height / 2})`);
      } else {
        g = svg.select("g");
      }
      const tooltip = d3__namespace.select("body").selectAll(".tag-pie-tooltip").data([0]).join("div").attr("class", "tag-pie-tooltip").style("position", "absolute").style("background", "rgba(30, 30, 30, 0.9)").style("color", "#fff").style("padding", "5px 10px").style("border-radius", "4px").style("font-size", "11px").style("pointer-events", "none").style("z-index", "2147483647").style("opacity", "0").style("box-shadow", "0 2px 5px var(--di-shadow, rgba(0,0,0,0.2))");
      const totalValue = d3__namespace.sum(data, (d) => d.count);
      const arcs = pie(data);
      const path = g.selectAll("path").data(arcs, (d) => d.data.key);
      path.exit().transition().duration(500).attrTween("d", (d) => {
        const start = d.startAngle;
        const end = d.endAngle;
        const i = d3__namespace.interpolate(start, end);
        return (t) => {
          return arc({ ...d, startAngle: i(t) }) || "";
        };
      }).remove();
      path.transition().duration(500).attrTween("d", function(d) {
        const prev = this._current || { startAngle: 0, endAngle: 0, padAngle: 0 };
        const i = d3__namespace.interpolate(prev, d);
        return (t) => {
          const val = i(t);
          this._current = val;
          return arc(val) || "";
        };
      }).attr("fill", (d) => getColor(d.data.key));
      path.enter().append("path").attr("fill", (d) => getColor(d.data.key)).attr("stroke", "#fff").style("stroke-width", "1px").style("opacity", 0.8).style("cursor", "pointer").transition().duration(500).attrTween("d", function(d) {
        const i = d3__namespace.interpolate({ startAngle: 0, endAngle: 0, padAngle: 0 }, d);
        return (t) => {
          const val = i(t);
          this._current = val;
          return arc(val) || "";
        };
      });
      g.selectAll("path").on("mouseover", function(event, d) {
        d3__namespace.select(this).transition().duration(200).attr("d", arcHover).style("opacity", 1);
        const percent = Math.round(d.data.count / totalValue * 100);
        tooltip.transition().duration(200).style("opacity", 1);
        tooltip.html(
          `<strong>${escapeHtml$1(d.data.name)}</strong>: ${d.data.count.toLocaleString()} (${percent}%)`
        ).style("left", event.pageX + 10 + "px").style("top", event.pageY - 20 + "px");
      }).on("mousemove", (event) => {
        tooltip.style("left", event.pageX + 10 + "px").style("top", event.pageY - 20 + "px");
      }).on("mouseout", function() {
        d3__namespace.select(this).transition().duration(200).attr("d", arc).style("opacity", 0.8);
        tooltip.transition().duration(200).style("opacity", 0);
      }).on("click", (_event, d) => {
        if (d.data.key === "others") return;
        let query = "";
        if (type === "status") {
          query = `${tagData.name} status:${d.data.key}`;
        } else if (type === "rating") {
          query = `${tagData.name} rating:${d.data.key}`;
        } else {
          query = `${tagData.name} ${d.data.key}`;
        }
        const url = `/posts?tags=${encodeURIComponent(query)}`;
        window.open(url, "_blank");
      });
      if (legendContainer) {
        legendContainer.innerHTML = "";
        data.forEach((d) => {
          const item = document.createElement("div");
          item.style.display = "flex";
          item.style.alignItems = "center";
          item.style.marginBottom = "2px";
          item.style.whiteSpace = "nowrap";
          const colorBox = document.createElement("div");
          colorBox.style.width = "10px";
          colorBox.style.height = "10px";
          colorBox.style.backgroundColor = getColor(d.key);
          colorBox.style.marginRight = "5px";
          colorBox.style.borderRadius = "2px";
          const label = document.createElement("a");
          let query = "";
          if (type === "status") {
            query = `${tagData.name} status:${d.key}`;
          } else if (type === "rating") {
            query = `${tagData.name} rating:${d.key}`;
          } else {
            if (d.key === "others") ;
            else {
              query = `${tagData.name} ${d.key}`;
            }
          }
          if (d.key !== "others") {
            label.href = `/posts?tags=${encodeURIComponent(query)}`;
            label.target = "_blank";
            label.style.cursor = "pointer";
            label.classList.add("di-hover-text-primary");
          } else {
            label.style.cursor = "default";
          }
          label.textContent = `${d.name} (${d.count.toLocaleString()})`;
          label.style.textDecoration = "none";
          label.style.color = "var(--di-text-secondary, #666)";
          label.style.transition = "color 0.2s";
          item.appendChild(colorBox);
          item.appendChild(label);
          legendContainer.appendChild(item);
        });
      }
    }
renderMilestones(milestonePosts, onNsfwUpdate, nextMilestone) {
      const grid = document.querySelector(
        "#tag-analytics-milestones .milestones-grid"
      );
      const toggleBtn = document.getElementById("tag-milestones-toggle");
      const loading = document.querySelector("#milestones-loading");
      if (loading) loading.style.display = "none";
      if (!grid) return;
      grid.innerHTML = "";
      if (milestonePosts.length === 0) {
        grid.innerHTML = '<div style="color:var(--di-text-muted, #888); grid-column:1/-1; text-align:center;">No milestones found.</div>';
        if (toggleBtn) toggleBtn.style.display = "none";
        return;
      }
      if (toggleBtn && milestonePosts.length > 6) {
        toggleBtn.style.display = "block";
        toggleBtn.textContent = this.isMilestoneExpanded ? "Show Less" : "Show More";
        grid.style.maxHeight = this.isMilestoneExpanded ? "2000px" : "120px";
        toggleBtn.onclick = () => {
          this.isMilestoneExpanded = !this.isMilestoneExpanded;
          grid.style.maxHeight = this.isMilestoneExpanded ? "2000px" : "120px";
          toggleBtn.textContent = this.isMilestoneExpanded ? "Show Less" : "Show More";
        };
      } else if (toggleBtn) {
        toggleBtn.style.display = "none";
        grid.style.maxHeight = "none";
      }
      milestonePosts.forEach((item) => {
        const m = item.milestone;
        const p = item.post;
        let label = `#${m}`;
        if (m === 1) label = "First";
        else if (m >= 1e6) {
          const val = m / 1e6;
          label = `${Number.isInteger(val) ? val : val.toFixed(1).replace(/\.0$/, "")} M`;
        } else if (m >= 1e3) {
          const val = m / 1e3;
          label = `${val} k`;
        }
        const dateStr = new Date(p.created_at).toISOString().slice(0, 10);
        const thumbUrl = getBestThumbnailUrl(p);
        const uploaderName = p.uploader_name || `User ${p.uploader_id}`;
        const card = document.createElement("div");
        card.className = "di-milestone-card di-nsfw-monitor";
        card.setAttribute("data-rating", p.rating);
        card.style.background = "var(--di-bg, #fff)";
        card.style.border = "1px solid var(--di-border, #e1e4e8)";
        card.style.borderRadius = "6px";
        card.style.padding = "10px 80px 10px 10px";
        card.style.position = "relative";
        card.style.minHeight = "80px";
        card.style.boxShadow = "0 2px 4px rgba(0,0,0,0.05)";
        card.classList.add("di-hover-translate-up");
        card.innerHTML = `
            <div style="font-size: 0.8em; color: var(--di-text-muted, #888); letter-spacing: 0.3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">#${p.id}</div>
            <a href="/posts/${p.id}" target="_blank" class="di-milestone-link" style="font-weight: bold; font-size: 1.1em; color: var(--di-link, #007bff); text-decoration: none; display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${label}</a>
            <div style="font-size: 0.8em; color: var(--di-text-secondary, #666); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${dateStr}</div>
            <div style="font-size: 0.75em; color: var(--di-text-muted, #888); margin-top: 4px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <a href="/users/${p.uploader_id}" target="_blank" class="${getLevelClass(p.uploader_level ?? null)}" style="text-decoration: none;">${escapeHtml$1(uploaderName)}</a>
            </div>
            <a href="/posts/${p.id}" target="_blank" style="position: absolute; top: 10px; right: 10px; width: 60px; height: 60px; border-radius: 4px; overflow: hidden; background: var(--di-bg-tertiary, #f0f0f0); display: block;">
                <img src="${thumbUrl}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
        `;
        const link = card.querySelector(".di-milestone-link");
        if (link) link.classList.add("di-hover-underline");
        grid.appendChild(card);
      });
      if (nextMilestone && nextMilestone.nextTarget > nextMilestone.totalPosts) {
        const total = nextMilestone.totalPosts;
        const next = nextMilestone.nextTarget;
        const remaining = next - total;
        const lastReached = milestonePosts.length > 0 ? milestonePosts[milestonePosts.length - 1].milestone : 0;
        const span = next - lastReached;
        const progressPct = span > 0 ? Math.max(0, Math.min(100, (total - lastReached) / span * 100)) : 0;
        let nextLabel = `#${next.toLocaleString()}`;
        if (next === 1) nextLabel = "First";
        else if (next >= 1e6) {
          const val = next / 1e6;
          nextLabel = `${Number.isInteger(val) ? val : val.toFixed(1).replace(/\.0$/, "")} M`;
        } else if (next >= 1e3) {
          const val = next / 1e3;
          nextLabel = `${val} k`;
        }
        const nextCard = document.createElement("div");
        nextCard.className = "di-next-milestone-card";
        nextCard.style.background = "#f6f8fa";
        nextCard.style.border = "1px dashed #d0d7de";
        nextCard.style.borderRadius = "6px";
        nextCard.style.padding = "10px";
        nextCard.style.minHeight = "80px";
        nextCard.style.display = "flex";
        nextCard.style.flexDirection = "column";
        nextCard.style.justifyContent = "space-between";
        nextCard.style.color = "#57606a";
        nextCard.innerHTML = `
        <div>
          <div style="font-size: 0.7em; color: var(--di-text-muted, #888); letter-spacing: 0.3px; text-transform: uppercase;">Next</div>
          <div style="font-weight: bold; font-size: 1.1em; color: #57606a; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nextLabel}</div>
          <div style="font-size: 0.8em; color: var(--di-chart-axis-secondary, #666); margin-top: 4px;">${remaining.toLocaleString()} remaining</div>
        </div>
        <div style="margin-top: 6px;">
          <div style="height: 6px; background: var(--di-border, #e1e4e8); border-radius: 3px; overflow: hidden;">
            <div style="width: ${progressPct.toFixed(1)}%; height: 100%; background: var(--di-link, #007bff);"></div>
          </div>
          <div style="font-size: 0.7em; color: var(--di-text-muted, #888); margin-top: 3px; text-align: right;">${progressPct.toFixed(0)}%</div>
        </div>
      `;
        grid.appendChild(nextCard);
      }
      onNsfwUpdate();
    }
renderHistoryCharts(data, tagName, milestones) {
      if (!window.d3) {
        log$1.error("D3.js not loaded");
        return;
      }
      this.currentMilestones = milestones;
      const chartData = data.map((d) => ({ ...d }));
      this.currentData = chartData;
      this.renderBarChart(
        chartData,
        "#history-chart-monthly",
        "Monthly Posts",
        tagName,
        milestones
      );
      this.renderAreaChart(
        chartData,
        "#history-chart-cumulative",
        "Cumulative Posts"
      );
      if (!this.resizeObserver) {
        const modalContent = document.querySelector(
          "#tag-analytics-content"
        )?.parentElement;
        if (modalContent) {
          this.resizeObserver = new ResizeObserver(() => {
            if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
              if (this.currentData && document.getElementById("history-chart-monthly")) {
                this.renderBarChart(
                  this.currentData,
                  "#history-chart-monthly",
                  "Monthly Posts",
                  tagName,
                  this.currentMilestones
                );
                this.renderAreaChart(
                  this.currentData,
                  "#history-chart-cumulative",
                  "Cumulative Posts"
                );
              }
            }, 100);
          });
          this.resizeObserver.observe(modalContent);
        }
      }
    }
renderBarChart(data, selector, title, tagName, milestones) {
      const container2 = document.querySelector(selector);
      if (!container2) return;
      container2.innerHTML = "";
      container2.style.display = "flex";
      container2.style.flexDirection = "column";
      container2.style.height = "100%";
      const titleEl = document.createElement("div");
      titleEl.textContent = title;
      titleEl.style.fontSize = "14px";
      titleEl.style.fontWeight = "bold";
      titleEl.style.color = "var(--di-text-heading, #444)";
      titleEl.style.marginBottom = "5px";
      titleEl.style.textAlign = "left";
      titleEl.style.borderLeft = "4px solid var(--di-link, #007bff)";
      titleEl.style.paddingLeft = "10px";
      container2.appendChild(titleEl);
      const mainWrapper = document.createElement("div");
      mainWrapper.className = "chart-flex-wrapper";
      mainWrapper.style.display = "flex";
      mainWrapper.style.width = "100%";
      mainWrapper.style.position = "relative";
      container2.appendChild(mainWrapper);
      const yAxisContainer = document.createElement("div");
      yAxisContainer.className = "y-axis-container";
      yAxisContainer.style.width = "45px";
      yAxisContainer.style.flexShrink = "0";
      yAxisContainer.style.background = "var(--di-chart-bg, #fff)";
      yAxisContainer.style.zIndex = "5";
      mainWrapper.appendChild(yAxisContainer);
      const scrollWrapper = document.createElement("div");
      scrollWrapper.className = "scroll-wrapper";
      scrollWrapper.style.flex = "1";
      scrollWrapper.style.overflowX = "auto";
      scrollWrapper.style.overflowY = "hidden";
      mainWrapper.appendChild(scrollWrapper);
      const barWidth = 20;
      const margin = { top: 20, right: 30, bottom: 40, left: 10 };
      const yAxisMargin = { top: 20, left: 40 };
      const containerWidth = mainWrapper.clientWidth - 45;
      const calculatedWidth = data.length * barWidth;
      const width = Math.max(
        containerWidth,
        calculatedWidth + margin.left + margin.right
      );
      const height = 300;
      const yAxisSvg = d3__namespace.select(yAxisContainer).append("svg").attr("width", 45).attr("height", height).append("g").attr("transform", `translate(${yAxisMargin.left},${yAxisMargin.top})`);
      const svg = d3__namespace.select(scrollWrapper).append("svg").attr("width", width).attr("height", height).append("g").attr("transform", `translate(${margin.left},${margin.top})`);
      const x = d3__namespace.scaleBand().domain(data.map((d) => d.date)).range([0, width - margin.left - margin.right]).padding(0.2);
      const y = d3__namespace.scaleLinear().domain([0, d3__namespace.max(data, (d) => d.count) ?? 0]).nice().range([height - margin.top - margin.bottom, 0]);
      yAxisSvg.call(d3__namespace.axisLeft(y).ticks(8));
      svg.append("g").attr("class", "grid").attr("stroke-opacity", 0.05).call(
        d3__namespace.axisLeft(y).ticks(8).tickSize(-(width - margin.left - margin.right)).tickFormat(() => "")
      ).call((g) => g.select(".domain").remove());
      const overlayGroups = svg.append("g").attr("class", "monthly-overlays");
      data.forEach((d) => {
        const dateStr = d.date;
        const dateObj = new Date(dateStr);
        const nextDate = new Date(dateObj);
        nextDate.setMonth(nextDate.getMonth() + 1);
        const nextDateStr = nextDate.toLocaleDateString("en-CA");
        const dateRange = `${dateStr}...${nextDateStr}`;
        const searchUrl = `/posts?tags=${encodeURIComponent(tagName)}+date:${dateRange}`;
        const colWidth = x.step();
        const colX = (x(dateStr) ?? 0) - (x.step() - x.bandwidth()) / 2;
        overlayGroups.append("rect").attr("x", colX).attr("y", 0).attr("width", colWidth).attr("height", height - margin.top - margin.bottom).attr("fill", "transparent").style("cursor", "pointer").style("pointer-events", "all").on("mouseover", function() {
          d3__namespace.select(this).attr("fill", "rgba(0, 123, 255, 0.05)");
          const bar = svg.select(`.monthly-bar-${dateStr}`);
          if (bar.node()) bar.attr("fill", "#2e7d32");
        }).on("mouseout", function() {
          d3__namespace.select(this).attr("fill", "transparent");
          const bar = svg.select(`.monthly-bar-${dateStr}`);
          if (bar.node()) bar.attr("fill", "#69b3a2");
        }).on("click", () => {
          window.open(searchUrl, "_blank");
        }).append("title").text(`${dateStr}
Count: ${d.count.toLocaleString()}`);
      });
      svg.selectAll("rect.monthly-bar").data(data).enter().append("rect").attr(
        "class",
        (d) => `monthly-bar monthly-bar-${d.date instanceof Date ? d.date.toLocaleDateString("en-CA") : d.date}`
      ).attr(
        "x",
        (d) => x(
          d.date instanceof Date ? d.date.toLocaleDateString("en-CA") : d.date
        ) ?? 0
      ).attr("y", (d) => y(d.count)).attr("width", x.bandwidth()).attr(
        "height",
        (d) => height - margin.top - margin.bottom - y(d.count)
      ).attr("fill", "#69b3a2").style("pointer-events", "none").append("title").text(
        (d) => `${d.date instanceof Date ? d.date.toLocaleDateString("en-CA") : d.date}: ${d.count} posts`
      );
      if (milestones && milestones.length > 0) {
        const milestonesByMonth = {};
        milestones.forEach((m) => {
          if (!m.post) return;
          if (m.milestone !== 1 && m.milestone % 1e3 !== 0) return;
          const pDate = new Date(m.post.created_at);
          const mKey = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, "0")}-01`;
          if (!milestonesByMonth[mKey]) milestonesByMonth[mKey] = [];
          milestonesByMonth[mKey].push(m);
        });
        const starGroups = svg.append("g").attr("class", "di-milestone-stars");
        data.forEach((d) => {
          const mKey = d.date;
          const monthMilestones = milestonesByMonth[mKey];
          if (monthMilestones) {
            const bx = (x(d.date) ?? 0) + x.bandwidth() / 2;
            monthMilestones.forEach((m, si) => {
              const starY = 12 + si * 14;
              let fill = "#ffd700";
              let stroke = "#b8860b";
              let animClass = "";
              let fontSize = "12px";
              if (m.milestone === 1) {
                fill = "#00e676";
                stroke = "#00a050";
              } else if (m.milestone % 1e4 === 0) {
                fill = "#ffb300";
                animClass = "star-shiny";
                fontSize = "15px";
              }
              const star = starGroups.append("a").attr("href", `${window.location.origin}/posts/${m.post.id}`).attr("target", "_blank").style("text-decoration", "none").append("text").attr("class", animClass).attr("x", bx).attr("y", starY).attr("text-anchor", "middle").attr("dominant-baseline", "central").attr("font-size", fontSize).attr("fill", fill).attr("stroke", stroke).attr("stroke-width", "0.5").style("cursor", "pointer").style("filter", "drop-shadow(0px 1px 1px rgba(0,0,0,0.3))").style("pointer-events", "all").text("★");
              star.append("title").text(
                `Milestone #${m.milestone} (${new Date(m.post.created_at).toLocaleDateString()})`
              );
            });
          }
        });
      }
      const xAxis = d3__namespace.axisBottom(x).tickValues(x.domain().filter((d) => new Date(d).getMonth() === 0)).tickFormat((d) => d3__namespace.timeFormat("%Y")(new Date(d)));
      svg.append("g").attr("transform", `translate(0,${height - margin.top - margin.bottom})`).call(xAxis);
      setTimeout(() => {
        if (scrollWrapper) scrollWrapper.scrollLeft = scrollWrapper.scrollWidth;
      }, 50);
    }
renderAreaChart(data, selector, title) {
      const container2 = document.querySelector(selector);
      if (!container2) return;
      container2.innerHTML = "";
      container2.style.position = "relative";
      const titleEl = document.createElement("div");
      titleEl.textContent = title;
      titleEl.style.fontSize = "14px";
      titleEl.style.fontWeight = "bold";
      titleEl.style.color = "var(--di-text-heading, #444)";
      titleEl.style.marginBottom = "5px";
      titleEl.style.textAlign = "left";
      titleEl.style.borderLeft = "4px solid var(--di-link, #007bff)";
      titleEl.style.paddingLeft = "10px";
      container2.appendChild(titleEl);
      const width = container2.getBoundingClientRect().width;
      const margin = { top: 30, right: 30, bottom: 40, left: 50 };
      if (width <= margin.left + margin.right) {
        log$1.warn("Container too narrow for chart, skipping render");
        return;
      }
      const height = 300;
      const svg = d3__namespace.select(selector).append("svg").attr("width", width).attr("height", height).append("g").attr("transform", `translate(${margin.left},${margin.top})`);
      const x = d3__namespace.scaleTime().domain(d3__namespace.extent(data, (d) => new Date(d.date))).range([0, width - margin.left - margin.right]);
      const y = d3__namespace.scaleLinear().domain([0, d3__namespace.max(data, (d) => d.cumulative) ?? 0]).nice().range([height - margin.top - margin.bottom, 0]);
      svg.append("path").datum(data).attr("fill", "#cce5df").attr("stroke", "#69b3a2").attr("stroke-width", 1.5).attr(
        "d",
        d3__namespace.area().x((d) => x(new Date(d.date))).y0(y(0)).y1((d) => y(d.cumulative))
      );
      const tickCount = width < 400 ? 3 : width < 600 ? 5 : void 0;
      svg.append("g").attr("transform", `translate(0,${height - margin.top - margin.bottom})`).call(
        d3__namespace.axisBottom(x).ticks(tickCount).tickFormat((d) => {
          return d3__namespace.timeFormat("%Y")(d);
        })
      );
      svg.append("g").call(d3__namespace.axisLeft(y));
      const focus = svg.append("g").attr("class", "focus").style("display", "none");
      focus.append("circle").attr("r", 5).attr("fill", "#69b3a2").attr("stroke", "#fff").attr("stroke-width", 2);
      d3__namespace.select("body").selectAll(".tag-analytics-tooltip").remove();
      const tooltip = d3__namespace.select("body").append("div").attr("class", "tag-analytics-tooltip").style("position", "absolute").style("z-index", "11000").style("background", "rgba(0, 0, 0, 0.8)").style("color", "#fff").style("padding", "8px").style("border-radius", "4px").style("font-size", "12px").style("pointer-events", "none").style("opacity", 0).style("transition", "opacity 0.2s");
      svg.append("rect").attr("class", "overlay").attr("width", width - margin.left - margin.right).attr("height", height - margin.top - margin.bottom).style("fill", "none").style("pointer-events", "all").on("mouseover", () => {
        focus.style("display", null);
        tooltip.style("opacity", 1);
      }).on("mouseout", () => {
        focus.style("display", "none");
        tooltip.style("opacity", 0);
      }).on("mousemove", (event) => {
        try {
          const bisectDate = d3__namespace.bisector((d2) => new Date(d2.date)).left;
          const [mx] = d3__namespace.pointer(event);
          const x0 = x.invert(mx);
          const i = bisectDate(data, x0, 1);
          const d0 = data[i - 1];
          const d1 = data[i];
          let d = d0;
          if (d1 && d0) {
            const date0 = new Date(d0.date);
            const date1 = new Date(d1.date);
            d = x0 - date0.getTime() > date1.getTime() - x0 ? d1 : d0;
          } else if (d1) {
            d = d1;
          }
          if (!d) return;
          const dateObj = new Date(d.date);
          const dateStr = dateObj.toLocaleDateString("en-CA");
          focus.attr(
            "transform",
            `translate(${x(dateObj)},${y(d.cumulative)})`
          );
          let left = event.pageX + 15;
          const top = event.pageY - 28;
          if (left + 150 > document.documentElement.clientWidth) {
            left = event.pageX - 160;
          }
          tooltip.html(
            `<strong>${dateStr}</strong><br>Cumulative: ${d.cumulative.toLocaleString()}`
          ).style("left", left + "px").style("top", top + "px");
        } catch {
        }
      });
    }
    renderRankingColumn(title, data, role, tagName, userNames, limitId = null) {
      if (!data || data.length === 0) {
        return `
          <div class="di-card-sm">
              <h4 style="margin: 0 0 10px 0; font-size: 0.9em; color: var(--di-text-secondary, #666); text-align: center; border-bottom: 1px solid var(--di-border-input, #ddd); padding-bottom: 5px;">${title}</h4>
              <div style="text-align: center; color: var(--di-text-faint, #999); font-size: 0.8em; padding: 20px 0;">No Data</div>
          </div>`;
      }
      const maxCount = Math.max(...data.map((u) => u.count || 0));
      const list = data.slice(0, 10).map((u, i) => {
        let nameHtml = "Unknown";
        const name = u.name || `user_${u.id} `;
        const normalizedName = name.replace(/ /g, "_");
        const userCached = userNames[String(u.id)] || userNames[name];
        const level = u.level || (userCached && typeof userCached === "object" ? userCached.level : null);
        const userClass = getLevelClass(level);
        let query = "";
        if (role && tagName) {
          const queryRole = role === "uploader" ? "user" : role;
          query = `${queryRole}:${normalizedName} ${tagName} `;
          if (limitId) {
            query += `id:..${limitId} `;
          }
        }
        const safeName = escapeHtml$1(name);
        if (query) {
          nameHtml = `<a href="/posts?tags=${encodeURIComponent(query)}" target="_blank" class="di-ranking-username ${userClass}" style="text-decoration: none;">${safeName}</a>`;
        } else if (u.id) {
          nameHtml = `<a href="/users/${u.id}" target="_blank" class="di-ranking-username ${userClass}" style="text-decoration: none;">${safeName}</a>`;
        } else {
          nameHtml = `<span class="di-ranking-username ${userClass}" style="cursor: default;">${safeName}</span>`;
        }
        const count = u.count || 0;
        const percentage = maxCount > 0 ? count / maxCount * 100 : 0;
        return `
          <div style="display: flex; justify-content: space-between; font-size: 0.85em; padding: 3px 5px; border-bottom: 1px solid #f5f5f5; background: linear-gradient(90deg, rgba(0,0,0,0.06) ${percentage}%, transparent ${percentage}%);">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;" title="${safeName}">${i + 1}. ${nameHtml}</span>
              <span style="color: var(--di-chart-axis-secondary, #666); font-weight: bold;">${count}</span>
          </div>`;
      }).join("");
      return `
      <div class="di-card-sm">
          <h4 style="margin: 0 0 10px 0; font-size: 0.9em; color: var(--di-text-secondary, #666); text-align: center; border-bottom: 1px solid var(--di-border-input, #ddd); padding-bottom: 5px;">${title}</h4>
          <div>${list}</div>
      </div>`;
    }
    updateRankingTabs(role, tagData, userNames) {
      const container2 = document.getElementById("ranking-container");
      const rankRole = role;
      if (!container2 || !tagData.rankings || !tagData.rankings[rankRole]) return;
      const rData = tagData.rankings[rankRole];
      log$1.debug("updateRankingTabs", { hundredthPost: tagData.hundredthPost });
      const limitId = tagData.hundredthPost ? tagData.hundredthPost.id : null;
      container2.innerHTML = `
          ${this.renderRankingColumn("All-time", rData.allTime, role, tagData.name, userNames)}
          ${this.renderRankingColumn("Last 1 Year", rData.year, role, tagData.name, userNames)}
          ${this.renderRankingColumn("First 100 Post", rData.first100, role, tagData.name, userNames, limitId)}
`;
    }
  }
  const log = createLogger("TagAnalytics");
  class TagAnalyticsApp {
    db;
    settings;
    tagName;
    rateLimiter;
    dataService;
    isFetching;
    chartRenderer;
constructor(db, settings, tagName, rateLimiter) {
      this.db = db;
      this.settings = settings;
      this.tagName = tagName;
      const rl = CONFIG.RATE_LIMITER;
      this.rateLimiter = rateLimiter ?? new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);
      this.dataService = new TagAnalyticsDataService(
        db,
        this.rateLimiter,
        tagName
      );
      this.chartRenderer = new TagAnalyticsChartRenderer();
      this.isFetching = false;
    }
async run() {
      if (!this.tagName) return;
      try {
        const tagData = await this.dataService.fetchTagData(this.tagName);
        const validCategories = [1, 3, 4];
        if (!tagData || !validCategories.includes(tagData.category)) {
          return;
        }
      } catch {
        return;
      }
      this.injectAnalyticsButton(null);
      try {
        const rawCache = this.db && this.db.tag_analytics ? await this.db.tag_analytics.get(this.tagName) : null;
        const statusLabel = document.getElementById("tag-analytics-status");
        if (!statusLabel) return;
        if (rawCache) {
          const age = Date.now() - rawCache.updatedAt;
          const isStale = age >= CONFIG.CACHE_EXPIRY_MS;
          const date = new Date(rawCache.updatedAt).toLocaleDateString();
          if (isStale) {
            statusLabel.textContent = `Updated: ${date} · Sync needed`;
            statusLabel.style.color = "#d73a49";
          } else {
            statusLabel.textContent = `Updated: ${date}`;
            statusLabel.style.color = "#28a745";
          }
        } else {
          statusLabel.textContent = "Sync needed";
          statusLabel.style.color = "#d73a49";
        }
        statusLabel.style.display = "inline";
      } catch {
      }
    }
_showUpdatedStatus(updatedAt) {
      const statusLabel = document.getElementById("tag-analytics-status");
      if (!statusLabel) return;
      const date = new Date(updatedAt).toLocaleDateString();
      statusLabel.textContent = `Updated: ${date}`;
      statusLabel.style.color = "#28a745";
      statusLabel.style.display = "inline";
    }
async _fetchAndRender() {
      const tagName = this.tagName;
      if (!tagName || this.isFetching) return;
      this.isFetching = true;
      try {
        this.injectAnalyticsButton(null, 0, "Waiting...");
        void this.dataService.cleanupOldCache();
        const cacheResult = await this._checkCache();
        if (!cacheResult) return;
        const { runDelta, baseData } = cacheResult;
        const t0 = performance.now();
        this.rateLimiter.requestCounter = 0;
        const initialStats = await this.dataService.fetchInitialStats(
          tagName,
          baseData
        );
        if (!initialStats) {
          log.warn(`Could not fetch initial stats for tag: "${tagName}"`);
          return;
        }
        const { totalCount, startDate, initialPosts } = initialStats;
        const meta = initialStats.meta;
        meta.updatedAt = Date.now();
        if (![1, 3, 4].includes(meta.category)) {
          const btn = document.getElementById("tag-analytics-btn");
          if (btn) btn.remove();
          const status = document.getElementById("tag-analytics-status");
          if (status) status.remove();
          return;
        }
        if (totalCount === 0) {
          this.injectAnalyticsButton(null);
          this._renderEmptyState(tagName, meta);
          return;
        }
        this.injectAnalyticsButton(meta);
        const isSmallTag = initialPosts && totalCount <= CONFIG.MAX_OPTIMIZED_POSTS && initialPosts.length >= totalCount;
        if (isSmallTag) {
          await this._fetchSmallTag(meta, initialStats, initialPosts, t0);
        } else {
          await this._fetchLargeTag(
            meta,
            initialStats,
            runDelta,
            baseData,
            startDate,
            initialPosts
          );
        }
      } finally {
        this.isFetching = false;
      }
    }
async _checkCache() {
      const tagName = this.tagName;
      const cachedData = await this.dataService.loadFromCache();
      if (!cachedData) {
        return { runDelta: false, baseData: null };
      }
      const age = Date.now() - cachedData.updatedAt;
      const isTimeExpired = age >= CONFIG.CACHE_EXPIRY_MS;
      let postCountDiff = 0;
      try {
        const currentTagData = await this.dataService.fetchTagData(tagName);
        if (currentTagData) {
          postCountDiff = Math.max(
            0,
            currentTagData.post_count - (cachedData.post_count || 0)
          );
        }
      } catch (e) {
        log.warn("Failed to check post count diff", { error: e });
      }
      const threshold = this.dataService.getSyncThreshold();
      const isCountThresholdMet = postCountDiff >= threshold;
      if (isTimeExpired || isCountThresholdMet) {
        log.debug(
          `Partial Sync Triggered. TimeExpired=${isTimeExpired} (${(age / 36e5).toFixed(1)}h), CountThreshold=${isCountThresholdMet} (${postCountDiff} >= ${threshold})`
        );
        return { runDelta: true, baseData: cachedData };
      }
      cachedData._isCached = true;
      try {
        const newPostCount24h = await this.dataService.fetchNewPostCount(tagName);
        const [latestPost, trendingPost, trendingPostNSFW] = await Promise.all([
          this.dataService.fetchLatestPost(tagName),
          this.dataService.fetchTrendingPost(tagName, false),
          this.dataService.fetchTrendingPost(tagName, true)
        ]);
        cachedData.latestPost = latestPost ?? void 0;
        cachedData.trendingPost = trendingPost ?? void 0;
        cachedData.trendingPostNSFW = trendingPostNSFW ?? void 0;
        cachedData.newPostCount = newPostCount24h;
        await this.dataService.saveToCache(cachedData);
      } catch (e) {
        log.warn("Failed to update volatile data for cache:", { error: e });
      }
      this.injectAnalyticsButton(cachedData);
      this._showUpdatedStatus(cachedData.updatedAt);
      this.toggleModal(true);
      this.renderDashboard(cachedData);
      return null;
    }
_renderEmptyState(tagName, meta) {
      if (!document.getElementById("tag-analytics-modal")) {
        this.createModal();
      }
      const content = document.getElementById("tag-analytics-content");
      if (!content) return;
      const categoryMap = {
        1: "Artist",
        3: "Copyright",
        4: "Character"
      };
      const colorMap = {
        1: "#c00004",
        3: "#a800aa",
        4: "#00ab2c"
      };
      const categoryLabel = categoryMap[meta.category] || "Tag";
      const titleColor = colorMap[meta.category] || "var(--di-text, #333)";
      content.innerHTML = `
      <div style="margin-bottom:25px;">
        <h2 style="margin-top:0; color:${titleColor}; margin-bottom:4px;">${escapeHtml$1(tagName)}</h2>
        <p style="color:var(--di-text-secondary, #666); margin:0;">${categoryLabel} analytics</p>
      </div>
      <div style="text-align:center; padding:60px 20px; color:var(--di-text-secondary, #666);">
        <div style="font-size:48px; margin-bottom:20px;">📭</div>
        <h3 style="margin-top:0;">No posts to analyze</h3>
        <p>This tag currently has no posts, so there is nothing to report.</p>
      </div>
      ${dashboardFooterHtml()}
    `;
      this.toggleModal(true);
    }
async _fetchSmallTag(meta, initialStats, initialPosts, t0) {
      const tagName = this.tagName;
      const { firstPost, hundredthPost, timeToHundred, totalCount } = initialStats;
      this.injectAnalyticsButton(null, 0, "Calculating history... (0%)");
      const historyData = this.dataService.calculateHistoryFromPosts(initialPosts);
      const targets = this.dataService.getMilestoneTargets(totalCount);
      const milestones = [];
      targets.forEach((target) => {
        const index = target - 1;
        if (initialPosts[index]) {
          milestones.push({
            milestone: target,
            post: initialPosts[index]
          });
        }
      });
      this.injectAnalyticsButton(null, 15, "Calculating rankings... (15%)");
      const localStatsAllTime = this.dataService.calculateLocalStats(initialPosts);
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const yearPosts = initialPosts.filter(
        (p) => p.created_at && new Date(p.created_at) >= oneYearAgo
      );
      const localStatsYear = this.dataService.calculateLocalStats(yearPosts);
      const localStatsFirst100 = this.dataService.calculateLocalStats(
        initialPosts.slice(0, 100)
      );
      this.injectAnalyticsButton(null, 25, "Fetching stats... (25%)");
      let smallTagFetched = 0;
      const smallTagTotalFetches = 6;
      const trackSmall = (label, promise) => promise.then((res) => {
        smallTagFetched++;
        const pct = 25 + Math.round(smallTagFetched / smallTagTotalFetches * 55);
        this.injectAnalyticsButton(null, pct, `${label}... (${pct}%)`);
        return res;
      });
      const [
        statusCounts,
        latestPost,
        trendingPost,
        trendingPostNSFW,
        newPostCount,
        commentaryCounts
      ] = await Promise.all([
        trackSmall(
          "Fetching status",
          this.dataService.fetchStatusCounts(tagName)
        ),
        trackSmall(
          "Fetching latest post",
          this.dataService.fetchLatestPost(tagName)
        ),
        trackSmall(
          "Finding trending post",
          this.dataService.fetchTrendingPost(tagName, false)
        ),
        trackSmall(
          "Finding trending NSFW",
          this.dataService.fetchTrendingPost(tagName, true)
        ),
        trackSmall(
          "Counting new posts",
          this.dataService.fetchNewPostCount(tagName)
        ),
        trackSmall(
          "Analyzing commentary",
          this.dataService.fetchCommentaryCounts(tagName)
        ),
        this.dataService.backfillUploaderNames(initialPosts)
      ]);
      meta.historyData = historyData;
      meta.firstPost = firstPost ?? void 0;
      meta.hundredthPost = hundredthPost ?? void 0;
      meta.timeToHundred = timeToHundred ?? void 0;
      meta.statusCounts = statusCounts;
      meta.commentaryCounts = commentaryCounts;
      meta.ratingCounts = localStatsAllTime.ratingCounts;
      meta.precalculatedMilestones = milestones;
      meta.latestPost = latestPost ?? void 0;
      meta.newPostCount = newPostCount;
      meta.trendingPost = trendingPost ?? void 0;
      meta.trendingPostNSFW = trendingPostNSFW ?? void 0;
      const mapNames = (ranking) => ranking.map((r) => {
        const u = this.dataService.userNames[r.id];
        return {
          ...r,
          name: (u ? u.name : null) || `user_${r.id}`,
          level: u ? u.level : null
        };
      });
      meta.rankings = {
        uploader: {
          allTime: mapNames(localStatsAllTime.uploaderRanking),
          year: mapNames(localStatsYear.uploaderRanking),
          first100: mapNames(localStatsFirst100.uploaderRanking)
        },
        approver: {
          allTime: mapNames(localStatsAllTime.approverRanking),
          year: mapNames(localStatsYear.approverRanking),
          first100: mapNames(localStatsFirst100.approverRanking)
        }
      };
      this.injectAnalyticsButton(null, 85, "Analyzing tag distribution... (85%)");
      await this._calculateLocalTagDistribution(initialPosts, meta);
      this.injectAnalyticsButton(meta, 100, "");
      this._showUpdatedStatus(meta.updatedAt);
      await this.dataService.saveToCache(meta);
      log.debug(
        `[Small Tag Optimization] Finished analysis for tag: ${tagName} (Category: ${meta.category}, Count: ${totalCount}) in ${(performance.now() - t0).toFixed(2)}ms`
      );
      this.toggleModal(true);
      this.renderDashboard(meta);
    }
async _calculateLocalTagDistribution(posts, meta) {
      if (meta.category !== 1 && meta.category !== 3) return;
      const copyrightMap = {};
      const characterMap = {};
      posts.forEach((p) => {
        if (p.tag_string_copyright) {
          p.tag_string_copyright.split(" ").forEach((tag) => {
            if (tag) copyrightMap[tag] = (copyrightMap[tag] || 0) + 1;
          });
        }
        if (p.tag_string_character) {
          p.tag_string_character.split(" ").forEach((tag) => {
            if (tag) characterMap[tag] = (characterMap[tag] || 0) + 1;
          });
        }
      });
      if (meta.category === 1) {
        const copyrightCandidates = Object.entries(copyrightMap).sort((a, b) => b[1] - a[1]).slice(0, 20);
        const flags = await this.dataService.getTopLevelFlags(
          copyrightCandidates.map(([tag]) => tag)
        );
        const filteredCopyright = copyrightCandidates.filter(
          ([tag]) => flags.get(tag) === true
        );
        const copyrightMap2 = {};
        filteredCopyright.slice(0, 10).forEach(([name, count]) => {
          copyrightMap2[name] = count;
        });
        meta.copyrightCounts = copyrightMap2;
      }
      const characterMap2 = {};
      Object.entries(characterMap).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([name, count]) => {
        characterMap2[name] = count;
      });
      meta.characterCounts = characterMap2;
    }
_rerenderPieIfActive(meta, type) {
      const activeTab = document.querySelector(".di-pie-tab.active");
      if (activeTab?.getAttribute("data-type") === type) {
        this.chartRenderer.renderPieChart(type, meta);
      }
    }
async _fetchLargeTag(meta, initialStats, runDelta, baseData, startDate, initialPosts) {
      const tagName = this.tagName;
      const { totalCount } = initialStats;
      let { firstPost, hundredthPost } = initialStats;
      const now = new Date();
      const oneYearAgoDate = new Date(now);
      oneYearAgoDate.setFullYear(oneYearAgoDate.getFullYear() - 1);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr1Y = oneYearAgoDate.toISOString().split("T")[0];
      const dateStrTomorrow = tomorrow.toISOString().split("T")[0];
      const measure = (label, promise) => {
        const start = performance.now();
        return promise.then((res) => {
          log.debug(
            `[Task] Finished: ${label} (${(performance.now() - start).toFixed(2)}ms)`
          );
          return res;
        });
      };
      let completedCount = 0;
      const totalEstimatedTasks = 12;
      this.injectAnalyticsButton(null, 0, "Initializing...");
      const trackProgress = (task) => {
        return task.promise.then((res) => {
          completedCount++;
          const pct = Math.round(completedCount / totalEstimatedTasks * 100);
          this.injectAnalyticsButton(null, pct, `${task.label} ${pct}%`);
          return res;
        });
      };
      const tTotal = performance.now();
      log.debug(
        `Starting analysis for tag: ${tagName} (Category: ${meta.category}, Count: ${totalCount})`
      );
      const tGroup1Start = performance.now();
      const quickStatsPromise = this._runQuickStatsPhase(
        tagName,
        meta,
        totalCount,
        measure,
        trackProgress
      );
      log.debug("[Phase 2] Starting Rankings & History in parallel...");
      const canSwrRankings = Boolean(
        runDelta && baseData?.rankings?.uploader?.allTime && baseData?.rankings?.approver?.allTime
      );
      let rankingPromise;
      let rankingRevalidatePromise = null;
      if (canSwrRankings && baseData?.rankings) {
        const cached = baseData.rankings;
        rankingPromise = Promise.resolve({
          uploaderAll: cached.uploader.allTime,
          approverAll: cached.approver.allTime,
          uploaderYear: cached.uploader.year,
          approverYear: cached.approver.year
        });
        rankingRevalidatePromise = this.dataService.fetchRankingsAndResolve(
          tagName,
          dateStr1Y,
          dateStrTomorrow,
          measure
        );
      } else {
        rankingPromise = this.dataService.fetchRankingsAndResolve(
          tagName,
          dateStr1Y,
          dateStrTomorrow,
          measure
        );
      }
      const first100Override = { value: null };
      const heavyPromises = this._buildHeavyStatPromises(
        meta,
        initialStats,
        runDelta,
        baseData,
        startDate,
        initialPosts,
        first100Override,
        measure
      );
      const heavyTasks = [
        {
          id: "rankings_full",
          label: "Fetching & resolving rankings...",
          promise: rankingPromise
        },
        {
          id: "history",
          label: "Analyzing monthly trends...",
          promise: heavyPromises.historyPromise
        },
        {
          id: "milestones",
          label: "Checking milestones...",
          promise: heavyPromises.milestonesPromise
        },
        {
          id: "resolve_names",
          label: "Resolving usernames...",


promise: heavyPromises.first100StatsPromise
        }
      ];
      const heavyResultsPromise = Promise.all(
        heavyTasks.map(trackProgress)
      );
      const quickStats = await quickStatsPromise;
      log.debug(
        `[Phase 1] Finished Quick Stats in ${(performance.now() - tGroup1Start).toFixed(2)}ms`
      );
      meta.statusCounts = quickStats.statusCounts;
      meta.latestPost = quickStats.latestPost ?? void 0;
      meta.newPostCount = quickStats.newPostCount;
      meta.trendingPost = quickStats.trendingPost ?? void 0;
      meta.trendingPostNSFW = quickStats.trendingPostNSFW ?? void 0;
      meta.copyrightCounts = quickStats.copyrightCounts ?? void 0;
      meta.characterCounts = quickStats.characterCounts ?? void 0;
      meta.commentaryCounts = quickStats.commentaryCounts;
      log.debug("[Phase 2] Awaiting Heavy Stats...");
      const heavyResults = await heavyResultsPromise;
      const [resolvedRankings, historyData, milestones, first100Stats] = heavyResults;
      firstPost = initialStats.firstPost;
      hundredthPost = initialStats.hundredthPost;
      if (first100Override.value) {
        log.debug("Applying updated First 100 Rankings from backward scan.");
      }
      const { uploaderAll, approverAll, uploaderYear, approverYear } = resolvedRankings;
      meta.historyData = historyData;
      meta.precalculatedMilestones = milestones;
      meta.firstPost = firstPost ?? void 0;
      meta.hundredthPost = hundredthPost ?? void 0;
      meta.rankings = {
        uploader: {
          allTime: uploaderAll,
          year: uploaderYear,
          first100: first100Stats?.uploaderRanking ?? []
        },
        approver: {
          allTime: approverAll,
          year: approverYear,
          first100: first100Stats?.approverRanking ?? []
        }
      };
      const minDate = historyData && historyData.length > 0 ? new Date(historyData[0].date) : new Date("2005-01-01");
      const minDateStr = minDate.toISOString().split("T")[0];
      log.debug(
        `[Phase 3] Starting Deferred Counts (Rating) with startDate: ${minDateStr}`
      );
      const ratingCounts = await measure(
        "Rating Counts",
        this.dataService.fetchRatingCounts(tagName, minDateStr)
      );
      meta.ratingCounts = ratingCounts;
      this._showUpdatedStatus(meta.updatedAt);
      this.toggleModal(true);
      this.renderDashboard(meta);
      if (rankingRevalidatePromise) {
        try {
          const fresh = await rankingRevalidatePromise;
          const currentSignature = JSON.stringify({
            uA: meta.rankings?.uploader.allTime,
            aA: meta.rankings?.approver.allTime,
            uY: meta.rankings?.uploader.year,
            aY: meta.rankings?.approver.year
          });
          const freshSignature = JSON.stringify({
            uA: fresh.uploaderAll,
            aA: fresh.approverAll,
            uY: fresh.uploaderYear,
            aY: fresh.approverYear
          });
          if (currentSignature !== freshSignature && meta.rankings) {
            log.debug("Ranking SWR: applying fresh report");
            meta.rankings = {
              uploader: {
                allTime: fresh.uploaderAll,
                year: fresh.uploaderYear,
                first100: meta.rankings.uploader.first100
              },
              approver: {
                allTime: fresh.approverAll,
                year: fresh.approverYear,
                first100: meta.rankings.approver.first100
              }
            };
            this._updateRankingsWidget(meta);
          } else {
            log.debug("Ranking SWR: cached report still fresh, no update");
          }
        } catch (e) {
          log.warn("Ranking SWR revalidation failed, keeping cached", {
            error: e
          });
        }
      }
      log.debug(
        `Total analysis time: ${(performance.now() - tTotal).toFixed(2)}ms`
      );
      this.injectAnalyticsButton(meta, 100, "");
      await this.dataService.saveToCache(meta);
    }
async _runQuickStatsPhase(tagName, meta, totalCount, measure, trackProgress) {
      log.debug(
        "[Group 1] Queueing Quick Stats (Status, Rating, Latest, Trending, Related)..."
      );
      const statusPromise = measure(
        "Status Counts",
        this.dataService.fetchStatusCounts(tagName)
      );
      const latestPromise = measure(
        "Latest Post",
        this.dataService.fetchLatestPost(tagName)
      );
      const newPostPromise = measure(
        "New Post Count",
        this.dataService.fetchNewPostCount(tagName)
      );
      const trendingPromise = measure(
        "Trending Post (SFW)",
        this.dataService.fetchTrendingPost(tagName, false)
      );
      const trendingNsfwPromise = measure(
        "Trending Post (NSFW)",
        this.dataService.fetchTrendingPost(tagName, true)
      );
      let copyrightPromise = Promise.resolve(null);
      let characterPromise = Promise.resolve(null);
      const onExactCopyright = (exact) => {
        meta.copyrightCounts = exact;
        this._rerenderPieIfActive(meta, "copyright");
      };
      const onExactCharacter = (exact) => {
        meta.characterCounts = exact;
        this._rerenderPieIfActive(meta, "character");
      };
      if (meta.category === 1) {
        copyrightPromise = measure(
          "Related Copyrights",
          this.dataService.fetchRelatedTagDistribution(tagName, 3, totalCount, {
            onExactCounts: onExactCopyright
          })
        );
        characterPromise = measure(
          "Related Characters",
          this.dataService.fetchRelatedTagDistribution(tagName, 4, totalCount, {
            onExactCounts: onExactCharacter
          })
        );
      } else if (meta.category === 3) {
        characterPromise = measure(
          "Related Characters",
          this.dataService.fetchRelatedTagDistribution(tagName, 4, totalCount, {
            onExactCounts: onExactCharacter
          })
        );
      }
      const quickTasks = [
        { id: "status", label: "Analyzing post status...", promise: statusPromise },
        { id: "latest", label: "Fetching latest info...", promise: latestPromise },
        {
          id: "new_count",
          label: "Counting new posts...",
          promise: newPostPromise
        },
        {
          id: "trending",
          label: "Finding trending posts...",
          promise: trendingPromise
        },
        {
          id: "trending_nsfw",
          label: "Finding trending NSFW...",
          promise: trendingNsfwPromise
        },
        {
          id: "related_copy",
          label: "Analyzing related copyrights...",
          promise: copyrightPromise
        },
        {
          id: "related_char",
          label: "Analyzing related characters...",
          promise: characterPromise
        },
        {
          id: "commentary",
          label: "Analyzing commentary status...",
          promise: measure(
            "Commentary Status",
            this.dataService.fetchCommentaryCounts(tagName)
          )
        }
      ];
      log.debug("[Phase 1] Executing Quick Stats...");
      const quickResults = await Promise.all(
        quickTasks.map(trackProgress)
      );
      const [
        statusCounts,
        latestPost,
        newPostCount,
        trendingPost,
        trendingPostNSFW,
        copyrightCounts,
        characterCounts,
        commentaryCounts
      ] = quickResults;
      return {
        statusCounts,
        latestPost,
        newPostCount,
        trendingPost,
        trendingPostNSFW,
        copyrightCounts,
        characterCounts,
        commentaryCounts
      };
    }
_buildHeavyStatPromises(meta, initialStats, runDelta, baseData, startDate, initialPosts, first100Override, measure) {
      const tagName = this.tagName;
      const { totalCount } = initialStats;
      const milestoneTargets = this.dataService.getMilestoneTargets(totalCount);
      let historyPromise;
      let milestonesPromise;
      let first100StatsPromise;
      if (runDelta && baseData) {
        const lastHistory = baseData.historyData[baseData.historyData.length - 1];
        const lastDate = lastHistory ? new Date(lastHistory.date) : startDate ?? new Date();
        const deltaStart = new Date(lastDate);
        deltaStart.setDate(deltaStart.getDate() - 7);
        historyPromise = this.dataService.fetchHistoryDelta(tagName, deltaStart, startDate ?? new Date()).then(
          (delta) => this.dataService.mergeHistory(baseData.historyData, delta)
        );
        milestonesPromise = historyPromise.then((fullHistory) => {
          return this.dataService.fetchMilestonesDelta(
            tagName,
            totalCount,
            baseData.precalculatedMilestones,
            fullHistory
          ).then(
            (delta) => this.dataService.mergeMilestones(
              baseData.precalculatedMilestones,
              delta
            )
          );
        });
      } else {
        historyPromise = measure(
          "Full History (Monthly)",
          this.dataService.fetchMonthlyCounts(tagName, startDate ?? new Date(), {
            isFullScan: true,
            totalCount
          })
        );
      }
      historyPromise = historyPromise.then(
        async (monthlyData) => {
          const forwardTotal = monthlyData && monthlyData.length > 0 ? monthlyData[monthlyData.length - 1].cumulative : 0;
          let referenceTotal = meta.post_count;
          if (monthlyData.historyCutoff) {
            try {
              const cutoffUrl = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+status:any+date:<${encodeURIComponent(monthlyData.historyCutoff)}`;
              const r = await this.rateLimiter.fetch(cutoffUrl).then((res) => res.json());
              referenceTotal = (r && r.counts ? r.counts.posts : r ? r.posts : 0) || 0;
            } catch (e) {
              log.warn(
                "Failed to fetch cutoff total, falling back to meta.post_count",
                { error: e }
              );
            }
          }
          log.debug(
            `Reverse Scan Check: ForwardTotal=${forwardTotal}, ReferenceTotal=${referenceTotal}, NeedScan=${forwardTotal < referenceTotal}`
          );
          if (forwardTotal < referenceTotal && !runDelta) {
            this.injectAnalyticsButton(
              null,
              void 0,
              "Scanning history backwards..."
            );
            const backwardResult = await measure(
              "Backward History Scan",
              this.dataService.fetchHistoryBackwards(
                tagName,
                (startDate ?? new Date()).toISOString().slice(0, 10),
                referenceTotal,
                forwardTotal
              )
            );
            if (backwardResult.length > 0) {
              const backwardShift = backwardResult[backwardResult.length - 1].cumulative;
              const adjustedForward = monthlyData.map((h) => ({
                ...h,
                cumulative: h.cumulative + backwardShift
              }));
              const fullHistory = [...backwardResult, ...adjustedForward];
              const earliestDateFound = backwardResult[0].date;
              const realInitialStats = await this.dataService.fetchInitialStats(
                tagName,
                null,
                true,
                earliestDateFound
              );
              const hasFreshPosts = !!(realInitialStats && realInitialStats.initialPosts && realInitialStats.initialPosts.length > 0);
              if (hasFreshPosts && realInitialStats) {
                initialStats.firstPost = realInitialStats.firstPost;
                initialStats.hundredthPost = realInitialStats.hundredthPost;
                initialStats.timeToHundred = realInitialStats.timeToHundred;
                log.debug("Recalculating First 100 Rankings for older posts...");
                const newStats = this.dataService.calculateLocalStats(
                  realInitialStats.initialPosts
                );
                first100Override.value = await this.dataService.resolveFirst100Names(newStats).catch((e) => {
                  log.warn("Failed to resolve names for older posts", {
                    error: e
                  });
                  return newStats;
                });
              } else {
                log.warn(
                  "Backward scan surfaced older posts, but the follow-up fetchInitialStats call returned no posts — first-100 rankings will reflect the initial fetch, not the older posts. Likely a transient server error; re-run analysis to recover.",
                  {
                    tagName,
                    earliestDateFound,
                    backwardMonthsFound: backwardResult.length,
                    retryResult: realInitialStats ? "empty" : "null"
                  }
                );
              }
              return fullHistory;
            }
          }
          return monthlyData;
        }
      );
      if (!milestonesPromise) {
        milestonesPromise = historyPromise.then((monthlyData) => {
          return this.dataService.fetchMilestones(
            tagName,
            monthlyData || [],
            milestoneTargets
          );
        });
      }
      if (runDelta && baseData?.rankings?.uploader?.first100) {
        initialStats.first100Stats = {
          uploaderRanking: baseData.rankings.uploader.first100,
          approverRanking: baseData.rankings.approver.first100,
          ratingCounts: {}
        };
        first100StatsPromise = Promise.resolve(initialStats.first100Stats);
      } else {
        first100StatsPromise = historyPromise.then(async () => {
          if (first100Override.value) return first100Override.value;
          const initial = this.dataService.calculateLocalStats(
            initialPosts || []
          );
          try {
            return await this.dataService.resolveFirst100Names(initial);
          } catch (e) {
            log.warn("Failed to resolve names for initial first-100", {
              error: e
            });
            return initial;
          }
        });
      }
      return {
        historyPromise,
        milestonesPromise,
        first100StatsPromise
      };
    }
injectHeaderControls(container2) {
      if (document.getElementById("tag-analytics-controls-container")) return;
      const wrapper = document.createElement("span");
      wrapper.id = "tag-analytics-controls-container";
      container2.appendChild(wrapper);
      const settingsBtn = document.createElement("span");
      settingsBtn.id = "tag-analytics-settings-btn";
      settingsBtn.innerHTML = "⚙️";
      settingsBtn.style.cursor = "pointer";
      settingsBtn.style.marginLeft = "6px";
      settingsBtn.style.fontSize = "12px";
      settingsBtn.style.verticalAlign = "middle";
      settingsBtn.title = "Configure Data Retention";
      settingsBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.showSettingsPopover(settingsBtn);
      };
      wrapper.appendChild(settingsBtn);
      const resetBtn = document.createElement("span");
      resetBtn.id = "tag-analytics-reset-btn";
      resetBtn.innerHTML = "🗑️";
      resetBtn.style.cursor = "pointer";
      resetBtn.style.marginLeft = "8px";
      resetBtn.style.fontSize = "12px";
      resetBtn.style.verticalAlign = "middle";
      resetBtn.title = "Reset Data & Re-fetch";
      resetBtn.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!confirm(
          `Reset analytics data for "${this.tagName}"?
This clears the local cache (analytics record + monthly count history). Click the analytics button again to trigger a fresh sync.`
        )) {
          return;
        }
        try {
          await this.dataService.resetTagCache();
          log.debug(`Deleted cache for ${this.tagName}`);
          this.injectAnalyticsButton(null, void 0, "Sync needed");
          const statusLabel = document.getElementById("tag-analytics-status");
          if (statusLabel) statusLabel.style.color = "#d73a49";
          showToast({
            type: "success",
            message: `"${this.tagName}" analytics cleared. Click the analytics button to re-sync.`
          });
          this.toggleModal(false);
        } catch (err) {
          log.error("Failed to delete cache:", { error: err });
          showToast({
            type: "error",
            message: "Failed to reset data. Check console for details."
          });
        }
      };
      wrapper.appendChild(resetBtn);
    }
showSettingsPopover(target) {
      const existing = document.getElementById("tag-analytics-settings-popover");
      if (existing) existing.remove();
      const currentDays = this.dataService.getRetentionDays();
      const currentThreshold = this.dataService.getSyncThreshold();
      const popover = document.createElement("div");
      popover.id = "tag-analytics-settings-popover";
      const effective = resolveEffectiveDashboardTheme(
        this.settings.getDarkMode()
      );
      if (effective === "dark") popover.setAttribute("data-di-theme", "dark");
      popover.style.position = "absolute";
      popover.style.zIndex = "11001";
      popover.style.background = "var(--di-bg, #fff)";
      popover.style.border = "1px solid var(--di-border, #e1e4e8)";
      popover.style.borderRadius = "6px";
      popover.style.padding = "12px";
      popover.style.boxShadow = "0 2px 10px var(--di-shadow-light, rgba(0,0,0,0.1))";
      popover.style.fontSize = "11px";
      popover.style.color = "var(--di-text, #333)";
      popover.style.width = "260px";
      const rect = target.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      popover.style.top = `${rect.top + scrollTop}px`;
      popover.style.left = `${rect.right + scrollLeft + 10}px`;
      popover.innerHTML = `
  <div class="di-section">
    <strong>Data Retention Period</strong><br>
    Records older than this (days) will be deleted.
  </div>
  <div class="di-row di-gapped">
     <input type="number" id="retention-days-input" value="${currentDays}" min="1" step="1">
     <span>days</span>
  </div>

  <div class="di-section di-divider">
    <strong>Sync Threshold</strong><br>
    Run partial sync if new posts exceed this count.
  </div>
  <div class="di-row">
     <input type="number" id="sync-threshold-input" value="${currentThreshold}" min="1" step="1">
     <button id="retention-save-btn" class="di-save-btn">✅ Save</button>
  </div>

  <div class="di-section di-divider">
    <strong>Dashboard Theme</strong>
    <select id="dark-mode-select" style="width:100%; margin-top:4px; padding:3px; border:1px solid var(--di-border-input, #ddd); border-radius:3px; background:var(--di-bg, #fff); color:var(--di-text, #333); font-size:11px;">
      <option value="auto">Auto (follow Danbooru)</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </div>
`;
      document.body.appendChild(popover);
      const darkModeSelect = popover.querySelector(
        "#dark-mode-select"
      );
      if (darkModeSelect) {
        darkModeSelect.value = this.settings.getDarkMode();
        darkModeSelect.addEventListener("change", () => {
          const pref = darkModeSelect.value;
          this.settings.setDarkMode(pref);
          applyDashboardTheme(this.settings);
        });
      }
      const closeHandler = (e) => {
        if (!popover.contains(e.target) && e.target !== target) {
          popover.remove();
          document.removeEventListener("click", closeHandler);
        }
      };
      setTimeout(() => document.addEventListener("click", closeHandler), 0);
      const saveBtn = popover.querySelector("#retention-save-btn");
      saveBtn.onclick = () => {
        const daysInput = popover.querySelector("#retention-days-input");
        const thresholdInput = popover.querySelector("#sync-threshold-input");
        const days = parseInt(daysInput.value, 10);
        const threshold = parseInt(
          thresholdInput.value,
          10
        );
        if (!isNaN(days) && days > 0 && !isNaN(threshold) && threshold > 0) {
          this.dataService.setRetentionDays(days);
          this.dataService.setSyncThreshold(threshold);
          popover.remove();
          document.removeEventListener("click", closeHandler);
          showToast({
            type: "success",
            message: `Settings Saved: Retention ${days} days, Sync Threshold ${threshold} posts. Cleaning up old data now...`
          });
          void this.dataService.cleanupOldCache();
        } else {
          showToast({
            type: "warn",
            message: "Please enter valid positive numbers."
          });
        }
      };
    }
injectAnalyticsButton(tagData, progress, statusText) {
      let title = document.querySelector(
        "#c-wiki-pages #a-show h1, #c-artists #a-show h1, #tag-show #posts h1, #tag-list h1"
      );
      if (!title) {
        const postCount = document.querySelector(
          '.post-count, span[class*="post-count"]'
        );
        if (postCount && postCount.parentElement) {
          title = postCount.parentElement;
        }
      }
      if (!title) {
        log.warn("Could not find a suitable title element for button injection.");
        return;
      }
      let btn = document.getElementById("tag-analytics-btn");
      const isNew = !btn;
      if (isNew) {
        btn = document.createElement("button");
        btn.id = "tag-analytics-btn";
        btn.setAttribute("aria-label", "View tag analytics dashboard");
        btn.style.marginLeft = "10px";
        btn.style.border = "none";
        btn.style.background = "transparent";
        btn.style.fontSize = "1.5rem";
        btn.style.verticalAlign = "middle";
        btn.innerHTML = `
        <div class="di-tag-analytics-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--di-link, #007bff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
        </div>
      `;
        title.appendChild(btn);
      }
      let statusLabel = document.getElementById("tag-analytics-status");
      if (!statusLabel) {
        statusLabel = document.createElement("span");
        statusLabel.id = "tag-analytics-status";
        statusLabel.style.marginLeft = "10px";
        statusLabel.style.fontSize = "14px";
        statusLabel.style.color = "var(--di-text-muted, #888)";
        statusLabel.style.verticalAlign = "middle";
        statusLabel.style.fontFamily = "sans-serif";
        if (btn && btn.nextSibling) {
          btn.parentNode?.insertBefore(statusLabel, btn.nextSibling);
        } else if (btn) {
          btn.parentNode?.appendChild(statusLabel);
        }
      }
      if (statusText) {
        statusLabel.textContent = statusText;
        statusLabel.style.display = "inline";
      } else {
        statusLabel.textContent = "";
        statusLabel.style.display = "none";
      }
      if (!btn) return;
      const isReady = tagData && !!(tagData.historyData && tagData.precalculatedMilestones && tagData.statusCounts && tagData.ratingCounts);
      const iconContainer = btn.querySelector(".icon-container");
      if (isReady) {
        btn.style.cursor = "pointer";
        btn.title = "View Tag Analytics";
        if (iconContainer) {
          iconContainer.style.opacity = "1";
          iconContainer.style.filter = "none";
        }
        btn.onclick = () => {
          this.toggleModal(true);
          this.renderDashboard(tagData);
        };
      } else if (this.isFetching) {
        btn.style.cursor = "wait";
        btn.title = `Analytics Data is loading... ${(progress ?? 0) > 0 ? progress + "%" : "Please wait."}`;
        if (iconContainer) {
          iconContainer.style.opacity = "0.5";
          iconContainer.style.filter = "grayscale(1)";
        }
        btn.onclick = () => {
          showToast({
            type: "warn",
            message: `Report data is still being calculated (${progress ?? 0}%). It will be ready in a few seconds.`
          });
        };
      } else {
        btn.style.cursor = "pointer";
        btn.title = "Load Tag Analytics (Click to start)";
        if (iconContainer) {
          iconContainer.style.opacity = "1";
          iconContainer.style.filter = "none";
        }
        btn.onclick = async () => {
          await this._fetchAndRender();
        };
      }
    }
createModal() {
      if (document.getElementById("tag-analytics-modal")) return;
      const modal = document.createElement("div");
      modal.id = "tag-analytics-modal";
      const effective = resolveEffectiveDashboardTheme(
        this.settings.getDarkMode()
      );
      if (effective === "dark") modal.setAttribute("data-di-theme", "dark");
      modal.style.display = "none";
      modal.style.position = "fixed";
      modal.style.top = "0";
      modal.style.left = "0";
      modal.style.width = "100%";
      modal.style.height = "100%";
      modal.style.backgroundColor = "rgba(0,0,0,0.5)";
      modal.style.zIndex = "10000";
      modal.style.justifyContent = "center";
      modal.style.alignItems = "center";
      modal.innerHTML = `
          <div>
              <button id="tag-analytics-close">&times;</button>
              <div id="tag-analytics-content">
                  <h2>Loading...</h2>
              </div>
          </div>
      `;
      document.body.appendChild(modal);
      const closeBtn = document.getElementById("tag-analytics-close");
      if (closeBtn) closeBtn.onclick = () => this.toggleModal(false);
      modal.onclick = (e) => {
        if (e.target === modal) this.toggleModal(false);
      };
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.style.display !== "none") {
          this.toggleModal(false);
        }
      });
      window.addEventListener("popstate", () => {
        if (modal.style.display !== "none" && history.state?.diModalOpen !== "tag-analytics-modal") {
          this.toggleModal(false);
        }
      });
    }
toggleModal(show) {
      if (!document.getElementById("tag-analytics-modal")) {
        this.createModal();
      }
      const modal = document.getElementById("tag-analytics-modal");
      if (!modal) return;
      if (show) {
        if (history.state?.diModalOpen !== "tag-analytics-modal") {
          history.pushState(
            { diModalOpen: "tag-analytics-modal" },
            "",
            location.href
          );
        }
        modal.style.display = "flex";
        lockBodyScroll();
        const closeBtn = document.getElementById("tag-analytics-close");
        if (closeBtn) closeBtn.focus();
      } else {
        if (history.state?.diModalOpen === "tag-analytics-modal") {
          history.back();
          return;
        }
        modal.style.display = "none";
        unlockBodyScroll();
        this.chartRenderer.cleanup();
        d3__namespace.select("body").selectAll(".tag-analytics-tooltip").remove();
      }
    }
updateNsfwVisibility() {
      const isNsfwEnabled = localStorage.getItem("tag_analytics_nsfw_enabled") === "true";
      const items = document.querySelectorAll(".di-nsfw-monitor");
      items.forEach((item) => {
        const rating = item.getAttribute("data-rating");
        if (isNsfwEnabled) {
          const img = item.querySelector("img");
          if (img) {
            img.style.filter = "none";
            img.style.opacity = "1";
          }
        } else {
          if (rating === "q" || rating === "e") {
            const img = item.querySelector("img");
            if (img) {
              img.style.filter = "blur(10px) grayscale(100%)";
              img.style.opacity = "0.3";
            }
          } else {
            const img = item.querySelector("img");
            if (img) {
              img.style.filter = "none";
              img.style.opacity = "1";
            }
          }
        }
      });
      const cb = document.getElementById("tag-analytics-nsfw-toggle");
      if (cb) cb.checked = isNsfwEnabled;
      const trendingSFW = document.getElementById("trending-post-sfw");
      const trendingNSFW = document.getElementById("trending-post-nsfw");
      if (isNsfwEnabled) {
        if (trendingSFW) trendingSFW.style.display = "none";
        if (trendingNSFW) trendingNSFW.style.display = "flex";
      } else {
        if (trendingSFW) trendingSFW.style.display = "flex";
        if (trendingNSFW) trendingNSFW.style.display = "none";
      }
    }
buildDashboardHeader(tagData, titleColor, categoryLabel) {
      return `
      <div class="di-tag-header">
          <div>
              <h2 style="color: ${titleColor};">${escapeHtml$1(tagData.name.replace(/_/g, " "))}</h2>
              <div class="di-tag-header-meta">
                  <span class="di-category-badge">${categoryLabel}</span>
                  <span class="di-tag-header-date">Created: ${tagData.created_at ? new Date(tagData.created_at).toLocaleDateString("en-CA") : "N/A"}</span>
                  <span class="di-tag-header-date di-tag-header-date-updated" id="tag-updated-at">
                      Updated: ${tagData.updatedAt ? new Date(tagData.updatedAt).toLocaleDateString("en-CA") : "N/A"}
                      <span id="tag-settings-anchor"></span>
                  </span>
              </div>
          </div>
          <div>
              <label class="di-tag-header-nsfw">
                  <input type="checkbox" id="tag-analytics-nsfw-toggle">
                  Enable NSFW
              </label>
          </div>
      </div>
    `;
    }
buildMainGrid(tagData) {
      const totalUploads = tagData.historyData && tagData.historyData.length > 0 ? tagData.historyData.reduce((a, b) => a + b.count, 0).toLocaleString() : "0";
      const latestPostHtml = tagData.latestPost ? `
      <div class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.latestPost.rating}">
         <div class="di-nsfw-monitor-thumb di-nsfw-monitor-thumb-latest">
            <a href="/posts/${tagData.latestPost.id}" target="_blank">
                <img src="${getBestThumbnailUrl(tagData.latestPost)}" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
         </div>
         <div class="di-nsfw-monitor-label">Latest</div>
         <div class="di-nsfw-monitor-sublabel">${tagData.latestPost.created_at.split("T")[0]}</div>
      </div>
    ` : "";
      const trendingSfwHtml = tagData.trendingPost ? `
      <div id="trending-post-sfw" class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.trendingPost.rating}">
         <div class="di-nsfw-monitor-thumb di-nsfw-monitor-thumb-trending">
            <a href="/posts/${tagData.trendingPost.id}" target="_blank">
                  <img src="${getBestThumbnailUrl(tagData.trendingPost)}" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
         </div>
         <div class="di-nsfw-monitor-label-trending">Trending(3d)</div>
         <div class="di-nsfw-monitor-sublabel">Score: ${tagData.trendingPost.score}</div>
      </div>
    ` : "";
      const trendingNsfwHtml = tagData.trendingPostNSFW ? `
      <div id="trending-post-nsfw" class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.trendingPostNSFW.rating}">
         <div class="di-nsfw-monitor-thumb di-nsfw-monitor-thumb-trending-nsfw">
            <a href="/posts/${tagData.trendingPostNSFW.id}" target="_blank">
                  <img src="${getBestThumbnailUrl(tagData.trendingPostNSFW)}" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
         </div>
         <div class="di-nsfw-monitor-label-trending-nsfw">Trending(NSFW)</div>
         <div class="di-nsfw-monitor-sublabel">Score: ${tagData.trendingPostNSFW.score}</div>
      </div>
    ` : "";
      const extraPieTabsHtml = `
      ${tagData.copyrightCounts ? '<button class="di-pie-tab" data-type="copyright">Copyright</button>' : ""}
      ${tagData.characterCounts ? '<button class="di-pie-tab" data-type="character">Character</button>' : ""}
      ${tagData.commentaryCounts ? '<button class="di-pie-tab" data-type="commentary">Commentary</button>' : ""}
    `;
      return `
      <!-- Main Grid: Summary & Distribution -->
      <div class="di-summary-grid">
           <!-- Summary Card -->
           <div class="di-card di-flex-col-between di-summary-card">
              <div class="di-summary-card-top">
                  <div>
                      <div class="di-summary-stat-label">Total Uploads</div>
                      <div class="di-summary-stat-value">${totalUploads}</div>
                      <div class="di-summary-stat-trend">
                          +${tagData.newPostCount || 0} <span class="di-summary-stat-trend-meta">(24h)</span>
                      </div>
                  </div>
                  <!-- Right Side: Latest & Trending -->
                  <div class="di-summary-card-thumbs">
                      ${latestPostHtml}
                      ${trendingSfwHtml}
                      ${trendingNsfwHtml}
                  </div>
              </div>
           </div>

           <!-- Distribution Card -->
           <div class="di-distribution-card">
              <div class="di-distribution-header">
                 <div class="di-distribution-title">Distribution</div>
                 <div class="pie-tabs">
                    <button class="di-pie-tab active" data-type="status">Status</button>
                    <button class="di-pie-tab" data-type="rating">Rating</button>
                    ${extraPieTabsHtml}
                 </div>
              </div>
              <div id="status-pie-chart-wrapper">
                 <div id="status-pie-chart"></div>
                 <div id="status-pie-legend"></div>
              </div>
              <div id="status-pie-loading">Loading data...</div>
           </div>
      </div>
    `;
    }
buildRankingsSection(tagData) {
      const inner = tagData.rankings ? this.buildRankingsContent(tagData) : '<div id="di-rankings-placeholder" class="di-rankings-loading">Analyzing user rankings…</div>';
      return `<div id="di-rankings-slot">${inner}</div>`;
    }
buildRankingsContent(tagData) {
      if (!tagData.rankings) return "";
      log.debug("renderDashboard - Initial Render - hundredthPost:", {
        hundredthPost: tagData.hundredthPost
      });
      const hundredthPostId = tagData.hundredthPost ? tagData.hundredthPost.id : null;
      return `
      <div class="di-rankings-section">
           <div class="di-rankings-header">
              <h3 class="di-rankings-title">User Rankings</h3>
              <div class="di-rank-tabs">
                  <button class="rank-tab active" data-role="uploader">Uploaders</button>
                  <button class="rank-tab" data-role="approver">Approvers</button>
              </div>
           </div>
           <div id="ranking-container">
              ${this.chartRenderer.renderRankingColumn("All-time", tagData.rankings.uploader.allTime, "uploader", tagData.name, this.dataService.userNames)}
              ${this.chartRenderer.renderRankingColumn("Last 1 Year", tagData.rankings.uploader.year, "uploader", tagData.name, this.dataService.userNames)}
              ${this.chartRenderer.renderRankingColumn("First 100 Post", tagData.rankings.uploader.first100, "uploader", tagData.name, this.dataService.userNames, hundredthPostId)}
           </div>
      </div>
    `;
    }
buildBottomSections() {
      return `
      <!-- Milestones Container -->
      <div id="tag-analytics-milestones">
          <div class="di-milestones-header">
              <h2>Milestones</h2>
              <button id="tag-milestones-toggle">Show More</button>
          </div>
          <div id="milestones-loading">Checking milestones...</div>
          <div id="tag-milestones-grid-container" class="milestones-grid"></div>
      </div>

      <!-- Charts Container -->
      <div id="tag-analytics-charts">
          <h2>Post History</h2>
          <div id="chart-loading">Loading History Data...</div>
          <div id="history-chart-monthly"></div>
          <div id="history-chart-cumulative"></div>
      </div>
    `;
    }
renderDashboard(tagData) {
      if (!document.getElementById("tag-analytics-modal")) {
        this.createModal();
      }
      const content = document.getElementById("tag-analytics-content");
      if (!content) return;
      const categoryMap = {
        1: "Artist",
        3: "Copyright",
        4: "Character"
      };
      const categoryLabel = categoryMap[tagData.category] || "Unknown";
      const colorMap = {
        1: "#c00004",
3: "#a800aa",
4: "#00ab2c"
};
      const titleColor = colorMap[tagData.category] || "var(--di-text, #333)";
      content.innerHTML = `
      ${this.buildDashboardHeader(tagData, titleColor, categoryLabel)}
      ${this.buildMainGrid(tagData)}
      ${this.buildRankingsSection(tagData)}
      ${this.buildBottomSections()}
      ${dashboardFooterHtml()}
    `;
      const anchor = document.getElementById("tag-settings-anchor");
      if (anchor) this.injectHeaderControls(anchor);
      const nsfwCheck = document.getElementById("tag-analytics-nsfw-toggle");
      if (nsfwCheck) {
        nsfwCheck.checked = localStorage.getItem("tag_analytics_nsfw_enabled") === "true";
        nsfwCheck.onchange = (e) => {
          localStorage.setItem(
            "tag_analytics_nsfw_enabled",
            e.target.checked.toString()
          );
          this.updateNsfwVisibility();
        };
        this.updateNsfwVisibility();
      }
      if (tagData.statusCounts) {
        this.chartRenderer.renderPieChart("status", tagData);
        this._wirePieTabHandlers(tagData);
      }
      this._renderHistoryAndMilestones(tagData);
      if (tagData.rankings) {
        this._wireRankTabHandlers(tagData);
      }
    }
_renderHistoryAndMilestones(tagData) {
      const data = tagData.historyData || [];
      const loading = document.getElementById("chart-loading");
      if (data.length > 0) {
        if (loading) loading.style.display = "none";
        this.chartRenderer.renderHistoryCharts(
          data,
          this.tagName,
          tagData.precalculatedMilestones
        );
        const milestonesContainer = document.getElementById(
          "tag-analytics-milestones"
        );
        if (milestonesContainer) {
          milestonesContainer.style.display = "block";
          const targets = this.dataService.getMilestoneTargets(
            tagData.post_count
          );
          const nextTarget = this.dataService.getNextMilestoneTarget(
            tagData.post_count
          );
          const nextInfo = { totalPosts: tagData.post_count, nextTarget };
          if (tagData.precalculatedMilestones) {
            this.chartRenderer.renderMilestones(
              tagData.precalculatedMilestones,
              () => this.updateNsfwVisibility(),
              nextInfo
            );
          } else {
            this.dataService.fetchMilestones(tagData.name, [], targets).then((milestonePosts) => {
              this.chartRenderer.renderMilestones(
                milestonePosts,
                () => this.updateNsfwVisibility(),
                nextInfo
              );
            }).catch((err) => {
              log.error("Failed to fetch milestones:", { error: err });
            });
          }
        }
      }
    }
_wirePieTabHandlers(tagData) {
      const tabs = document.querySelectorAll(".di-pie-tab");
      tabs.forEach((tab) => {
        tab.onclick = () => {
          const newType = tab.getAttribute("data-type");
          tabs.forEach((t) => {
            t.classList.remove("active");
            t.style.background = "";
            t.style.color = "";
          });
          tab.classList.add("active");
          this.chartRenderer.renderPieChart(newType ?? "status", tagData);
        };
      });
    }
_wireRankTabHandlers(tagData) {
      const rankTabs = document.querySelectorAll(".rank-tab");
      rankTabs.forEach((tab) => {
        tab.onclick = () => {
          const role = tab.getAttribute("data-role");
          rankTabs.forEach((t) => {
            t.classList.remove("active");
            t.style.fontWeight = "normal";
            t.style.color = "var(--di-text-muted, #888)";
          });
          tab.classList.add("active");
          tab.style.fontWeight = "bold";
          tab.style.color = "var(--di-link, #007bff)";
          this.chartRenderer.updateRankingTabs(
            role ?? "uploader",
            tagData,
            this.dataService.userNames
          );
        };
      });
    }
_updateRankingsWidget(tagData) {
      const slot = document.getElementById("di-rankings-slot");
      if (!slot || !tagData.rankings) return;
      const activeTab = slot.querySelector(".rank-tab.active");
      const activeRole = activeTab?.getAttribute("data-role") ?? "uploader";
      slot.innerHTML = this.buildRankingsContent(tagData);
      this._wireRankTabHandlers(tagData);
      if (activeRole === "approver") {
        const tabEl = slot.querySelector('.rank-tab[data-role="approver"]');
        if (tabEl instanceof HTMLElement) tabEl.click();
      }
    }
  }
  const DB_NAME = "DanbooruGrassDB";
  const DIAG_GATE_KEY = "di.diag.enabled";
  function shouldRunDiagnostic() {
    if (window.location.hash.includes("di_diag")) return true;
    try {
      return localStorage.getItem(DIAG_GATE_KEY) === "1";
    } catch {
      return false;
    }
  }
  function extractUserId() {
    const ds = document.body.dataset.currentUserId;
    if (ds) return ds;
    const meta = document.querySelector('meta[name="current-user-id"]');
    if (meta) return meta.getAttribute("content");
    const editLink = document.querySelector(
      'a[href*="/users/"][href*="/edit"]'
    );
    if (editLink) {
      const m = editLink.href.match(/\/users\/(\d+)/);
      if (m) return m[1];
    }
    const msgLink = document.querySelector(
      'a[href*="/dmails"]'
    );
    if (msgLink) {
      const parent = msgLink.closest("[data-user-id]");
      if (parent?.dataset.userId) return parent.dataset.userId;
    }
    return null;
  }
  function extractProfileUserId() {
    const path = window.location.pathname;
    const m = path.match(/^\/users\/(\d+)/);
    return m ? m[1] : null;
  }
  function extractTagName() {
    const path = window.location.pathname;
    if (path.startsWith("/wiki_pages/")) {
      const segs = path.split("/").filter(Boolean);
      if (segs.length === 2 && !["search", "show_or_new", "new"].includes(segs[1])) {
        return decodeURIComponent(segs[1]);
      }
    }
    if (path.startsWith("/artists/")) {
      return document.body.dataset.artistName ?? null;
    }
    return null;
  }
  function detectPageType() {
    const path = window.location.pathname;
    if (path.startsWith("/users/") || path === "/profile") return "profile";
    if (path.startsWith("/wiki_pages/") || path.startsWith("/artists/"))
      return "tag";
    return "unknown";
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbGet(db, store, key) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch {
        resolve(void 0);
      }
    });
  }
  function idbGetAll(db, store, query, count) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).getAll(query, count);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch {
        resolve([]);
      }
    });
  }
  function idbCursorCollect(db, store, indexName, range, limit, direction = "prev") {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(store, "readonly");
        const idx = tx.objectStore(store).index(indexName);
        const req = idx.openCursor(range, direction);
        const results = [];
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || results.length >= limit) {
            resolve(results);
            return;
          }
          results.push(cursor.value);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      } catch {
        resolve([]);
      }
    });
  }
  function idbDistinctUserIds(db, store) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(store, "readonly");
        const idx = tx.objectStore(store).index("userId");
        const req = idx.openKeyCursor(null, "nextunique");
        const ids = [];
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve(ids);
            return;
          }
          ids.push(String(cursor.key));
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      } catch {
        resolve([]);
      }
    });
  }
  async function fetchRemoteCount(tags) {
    try {
      const url = `/counts/posts.json?tags=${encodeURIComponent(tags)}`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.counts?.posts ?? null;
    } catch {
      return null;
    }
  }
  function createPanel() {
    const container2 = document.createElement("div");
    container2.className = "di-diag-panel";
    container2.style.cssText = "position:fixed;bottom:0;left:0;right:0;max-height:60vh;overflow-y:auto;z-index:2147483647;background:#1a1a2e;color:#e0e0e0;font-family:monospace;font-size:12px;line-height:1.5;border-top:2px solid #4a9eff;display:none;";
    const header = document.createElement("div");
    header.style.cssText = "position:sticky;top:0;background:#1a1a2e;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;";
    header.innerHTML = '<span style="font-weight:bold;color:#4a9eff;">DI Diagnostic</span>';
    const btnGroup = document.createElement("div");
    btnGroup.style.cssText = "display:flex;gap:8px;";
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.style.cssText = btnStyle("#2d8a4e");
    copyBtn.onclick = () => {
      const text = panel.getText();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      } else {
        fallbackCopy(text);
      }
      copyBtn.textContent = "Copied!";
      setTimeout(() => copyBtn.textContent = "Copy", 1500);
    };
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.style.cssText = btnStyle("#c93c37");
    closeBtn.onclick = () => panel.hide();
    btnGroup.append(copyBtn, closeBtn);
    header.appendChild(btnGroup);
    container2.appendChild(header);
    const content = document.createElement("div");
    content.style.cssText = "padding:6px 10px;";
    container2.appendChild(content);
    const reopenBtn = document.createElement("button");
    reopenBtn.textContent = "DI";
    reopenBtn.title = "Reopen Diagnostic Panel";
    reopenBtn.style.cssText = "position:fixed;bottom:10px;right:10px;z-index:2147483647;width:36px;height:36px;border-radius:50%;border:2px solid #4a9eff;background:#1a1a2e;color:#4a9eff;font-family:monospace;font-size:11px;font-weight:bold;cursor:pointer;display:none;box-shadow:0 2px 8px rgba(0,0,0,0.4);";
    reopenBtn.onclick = () => panel.show();
    document.body.appendChild(container2);
    document.body.appendChild(reopenBtn);
    const panel = {
      container: container2,
      content,
      addSection(title, expanded) {
        const wrapper = document.createElement("div");
        wrapper.style.cssText = "margin-bottom:8px;";
        const hdr = document.createElement("div");
        hdr.style.cssText = "cursor:pointer;padding:4px 6px;background:#22223a;border-radius:3px;font-weight:bold;user-select:none;";
        const arrow = expanded ? "▼" : "▶";
        hdr.textContent = `${arrow} ${title}`;
        const body = document.createElement("div");
        body.style.cssText = `padding:4px 6px;${expanded ? "" : "display:none;"}`;
        hdr.onclick = () => {
          const visible = body.style.display !== "none";
          body.style.display = visible ? "none" : "";
          hdr.textContent = `${visible ? "▶" : "▼"} ${title}`;
        };
        wrapper.append(hdr, body);
        content.appendChild(wrapper);
        return body;
      },
      addLine(section, label, value) {
        const line = document.createElement("div");
        line.innerHTML = `<span style="color:#888;">${esc(label)}:</span> ${esc(value)}`;
        section.appendChild(line);
      },
      addTable(section, headers, rows) {
        const tbl = document.createElement("table");
        tbl.style.cssText = "width:100%;border-collapse:collapse;margin:4px 0;font-size:11px;";
        const thead = document.createElement("tr");
        for (const h of headers) {
          const th = document.createElement("th");
          th.textContent = h;
          th.style.cssText = "text-align:left;padding:2px 6px;border-bottom:1px solid #444;color:#4a9eff;";
          thead.appendChild(th);
        }
        tbl.appendChild(thead);
        for (const row of rows) {
          const tr = document.createElement("tr");
          for (const cell of row) {
            const td = document.createElement("td");
            td.textContent = cell;
            td.style.cssText = "padding:2px 6px;border-bottom:1px solid #2a2a44;";
            tr.appendChild(td);
          }
          tbl.appendChild(tr);
        }
        section.appendChild(tbl);
      },
      show() {
        container2.style.display = "";
        reopenBtn.style.display = "none";
      },
      hide() {
        container2.style.display = "none";
        reopenBtn.style.display = "";
      },
      getText() {
        const lines = ["=== Danbooru Insights Diagnostic ===", ""];
        for (const wrapper of content.children) {
          const hdr = wrapper.children[0];
          const body = wrapper.children[1];
          if (!hdr || !body) continue;
          lines.push(`--- ${hdr.textContent?.replace(/^[▶▼]\s*/, "") ?? ""} ---`);
          for (const child of body.children) {
            if (child.tagName === "TABLE") {
              const tableRows = child.querySelectorAll("tr");
              for (const tr of tableRows) {
                const cells = tr.querySelectorAll("th, td");
                lines.push(
                  Array.from(cells).map((c) => (c.textContent ?? "").padEnd(20)).join("")
                );
              }
            } else {
              lines.push(child.textContent ?? "");
            }
          }
          lines.push("");
        }
        return lines.join("\n");
      }
    };
    return panel;
  }
  function btnStyle(bg) {
    return `background:${bg};color:#fff;border:none;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:11px;font-family:monospace;`;
  }
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  function fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }
  function fmtAge(isoStr) {
    if (!isoStr) return "N/A";
    const ms = Date.now() - new Date(isoStr).getTime();
    const hours = Math.floor(ms / 36e5);
    if (hours < 1) return `${Math.floor(ms / 6e4)}m ago`;
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
  function buildSystemSection(panel, db) {
    const sec = panel.addSection("System", true);
    panel.addLine(sec, "Script version", APP_VERSION);
    panel.addLine(sec, "Page URL", window.location.href);
    panel.addLine(sec, "User-Agent", navigator.userAgent);
    panel.addLine(sec, "Timestamp", ( new Date()).toISOString());
    panel.addLine(sec, "Page type", detectPageType());
    if (db) {
      panel.addLine(sec, "DB version", String(db.version));
      panel.addLine(sec, "DB stores", Array.from(db.objectStoreNames).join(", "));
    } else {
      panel.addLine(sec, "DB", "Failed to open");
    }
    const diKeys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("di") || k.startsWith("danbooru"))) {
          diKeys.push(k);
        }
      }
    } catch {
    }
    panel.addLine(sec, "DI localStorage keys", String(diKeys.length));
    if (diKeys.length > 0 && diKeys.length <= 30) {
      for (const k of diKeys.sort()) {
        const v = localStorage.getItem(k) ?? "";
        panel.addLine(sec, `  ${k}`, v.length > 60 ? v.slice(0, 60) + "..." : v);
      }
    }
  }
  async function buildGrassSection(panel, db, userId, userName) {
    const sec = panel.addSection("GrassApp", detectPageType() === "profile");
    try {
      const ids = await idbDistinctUserIds(db, "uploads");
      panel.addLine(sec, "Cached userIds", ids.join(", ") || "none");
    } catch {
      panel.addLine(sec, "Cached userIds", "error");
    }
    const today = fmtDate( new Date());
    const year = ( new Date()).getFullYear();
    for (const metric of ["uploads", "approvals", "notes"]) {
      const mSec = document.createElement("div");
      mSec.style.cssText = "margin:6px 0 2px;font-weight:bold;color:#4a9eff;";
      mSec.textContent = `[${metric}]`;
      sec.appendChild(mSec);
      const todayKey = `${userId}_${today}`;
      const todayRow = await idbGet(db, metric, todayKey);
      panel.addLine(
        sec,
        `  Today (${today})`,
        String(todayRow?.count ?? "not cached")
      );
      const last7 = [];
      for (let d = 0; d < 7; d++) {
        const dt = new Date();
        dt.setDate(dt.getDate() - d);
        const dateStr = fmtDate(dt);
        const key = `${userId}_${dateStr}`;
        const row = await idbGet(db, metric, key);
        last7.push([dateStr, String(row?.count ?? "-")]);
      }
      panel.addTable(sec, ["Date", "Count"], last7);
      let localSum = 0;
      const yearRows = await idbGetAll(db, metric);
      for (const r of yearRows) {
        if (String(r.userId) === userId && r.id && r.id.includes(`_${year}-`)) {
          localSum += r.count ?? 0;
        }
      }
      panel.addLine(sec, `  Local ${year} total`, String(localSum));
      if (metric === "uploads" && userName) {
        const remoteToday = await fetchRemoteCount(
          `user:${userName} date:${today}`
        );
        const remoteYear = await fetchRemoteCount(
          `user:${userName} date:${year}-01-01..${year}-12-31`
        );
        panel.addLine(
          sec,
          "  Remote today",
          String(remoteToday ?? "fetch failed")
        );
        panel.addLine(
          sec,
          `  Remote ${year} total`,
          String(remoteYear ?? "fetch failed")
        );
        if (remoteToday !== null && todayRow?.count !== void 0) {
          const match = remoteToday === todayRow.count;
          panel.addLine(
            sec,
            "  Today match",
            match ? "OK" : `MISMATCH (local=${todayRow.count}, remote=${remoteToday})`
          );
        }
        if (remoteYear !== null) {
          const match = remoteYear === localSum;
          panel.addLine(
            sec,
            `  ${year} match`,
            match ? "OK" : `MISMATCH (local=${localSum}, remote=${remoteYear})`
          );
        }
      }
      const cyKey = `${userId}_${metric}_${year}`;
      const cy = await idbGet(db, "completed_years", cyKey);
      panel.addLine(sec, `  completed_years[${year}]`, cy ? "yes" : "no");
    }
    try {
      const gs = await idbGet(db, "grass_settings", userId);
      panel.addLine(sec, "grass_settings", gs ? JSON.stringify(gs) : "not set");
    } catch {
      panel.addLine(sec, "grass_settings", "error reading");
    }
    try {
      const lsKey = `danbooru_grass_last_sync_${userId}`;
      const ls = localStorage.getItem(lsKey);
      panel.addLine(sec, "Last sync", ls ? `${ls} (${fmtAge(ls)})` : "never");
    } catch {
      panel.addLine(sec, "Last sync", "error reading");
    }
    try {
      const samples = await idbGetAll(db, "uploads", void 0, 5);
      if (samples.length > 0) {
        const rows = samples.map((r) => {
          const rec = r;
          return [
            String(rec.id ?? ""),
            String(rec.userId ?? ""),
            String(rec.date ?? ""),
            String(rec.count ?? "")
          ];
        });
        panel.addTable(sec, ["ID", "userId", "date", "count"], rows);
      }
    } catch {
      panel.addLine(sec, "Sample rows", "error");
    }
  }
  async function buildUserAnalyticsSection(panel, db, userId) {
    const sec = panel.addSection(
      "UserAnalyticsApp",
      detectPageType() === "profile"
    );
    try {
      if (db.objectStoreNames.contains("posts")) {
        const tx = db.transaction("posts", "readonly");
        const idx = tx.objectStore("posts").index("uploader_id");
        const countReq = idx.count(IDBKeyRange.only(Number(userId)));
        const count = await new Promise((resolve, reject) => {
          countReq.onsuccess = () => resolve(countReq.result);
          countReq.onerror = () => reject(countReq.error);
        });
        panel.addLine(sec, "Posts in DB", String(count));
        panel.addLine(
          sec,
          "Sync path",
          count <= 1200 ? "Quick Sync (<=1200)" : "Full Sync"
        );
        const recent = await idbCursorCollect(
          db,
          "posts",
          "uploader_id",
          IDBKeyRange.only(Number(userId)),
          5
        );
        if (recent.length > 0) {
          const rows = recent.map((p) => [
            String(p.id ?? ""),
            String(p.created_at ?? "").slice(0, 10),
            String(p.score ?? ""),
            String(p.rating ?? "")
          ]);
          panel.addTable(sec, ["Post ID", "Date", "Score", "Rating"], rows);
        }
      }
    } catch {
      panel.addLine(sec, "Posts", "error reading");
    }
    try {
      if (db.objectStoreNames.contains("piestats")) {
        const all = await idbGetAll(db, "piestats");
        const userPie = all.filter(
          (r) => String(r.userId) === userId || String(r.userId) === userId
        );
        panel.addLine(sec, "piestats entries", String(userPie.length));
        if (userPie.length > 0) {
          const rows = userPie.slice(0, 10).map((r) => {
            const updatedAt = r.updated_at ? fmtAge(String(r.updated_at)) : "N/A";
            return [String(r.key ?? ""), updatedAt];
          });
          panel.addTable(sec, ["Key", "Age"], rows);
        }
      }
    } catch {
      panel.addLine(sec, "piestats", "error reading");
    }
    try {
      if (db.objectStoreNames.contains("hourly_stats")) {
        const hs = await idbGet(db, "hourly_stats", userId);
        panel.addLine(sec, "hourly_stats", hs ? "exists" : "not cached");
      }
    } catch {
      panel.addLine(sec, "hourly_stats", "error");
    }
    try {
      if (db.objectStoreNames.contains("user_stats")) {
        const us = await idbGet(db, "user_stats", userId);
        panel.addLine(sec, "user_stats", us ? "exists" : "not cached");
      }
    } catch {
      panel.addLine(sec, "user_stats", "error");
    }
  }
  async function buildTagAnalyticsSection(panel, db, tagName) {
    const sec = panel.addSection("TagAnalyticsApp", detectPageType() === "tag");
    panel.addLine(sec, "Tag name", tagName);
    try {
      if (db.objectStoreNames.contains("tag_analytics")) {
        const entry = await idbGet(db, "tag_analytics", tagName);
        if (entry) {
          panel.addLine(sec, "Cache exists", "yes");
          const updatedAt = entry.updatedAt ? String(entry.updatedAt) : "unknown";
          panel.addLine(sec, "Updated at", `${updatedAt} (${fmtAge(updatedAt)})`);
          if (entry.updatedAt) {
            const age = Date.now() - new Date(String(entry.updatedAt)).getTime();
            const expired = age > 24 * 3600 * 1e3;
            panel.addLine(sec, "Cache expired (24h)", expired ? "YES" : "no");
          }
          const meta = entry.meta;
          const cachedCount = meta?.post_count ?? entry.postCount ?? "unknown";
          panel.addLine(sec, "Cached post count", String(cachedCount));
          const remoteCount = await fetchRemoteCount(tagName);
          panel.addLine(
            sec,
            "Remote post count",
            String(remoteCount ?? "fetch failed")
          );
          if (remoteCount !== null && cachedCount !== "unknown") {
            const match = remoteCount === Number(cachedCount);
            panel.addLine(
              sec,
              "Count match",
              match ? "OK" : `DIFF (cached=${cachedCount}, remote=${remoteCount})`
            );
          }
          if (remoteCount !== null) {
            panel.addLine(
              sec,
              "Small tag optimization",
              remoteCount <= 1200 ? `YES (${remoteCount} <= 1200)` : "no (full sync)"
            );
          }
        } else {
          panel.addLine(sec, "Cache exists", "no (not yet loaded)");
        }
        const allTags = await idbGetAll(db, "tag_analytics");
        allTags.sort((a, b) => {
          const tA = new Date(String(a.updatedAt ?? 0)).getTime();
          const tB = new Date(String(b.updatedAt ?? 0)).getTime();
          return tB - tA;
        });
        const recentTags = allTags.slice(0, 10);
        if (recentTags.length > 0) {
          const rows = recentTags.map((t) => [
            String(t.tagName ?? t.id ?? ""),
            fmtAge(String(t.updatedAt ?? ""))
          ]);
          panel.addTable(sec, ["Tag", "Age"], rows);
        }
      }
    } catch {
      panel.addLine(sec, "tag_analytics", "error reading");
    }
  }
  async function showDiagnostic() {
    let panel;
    try {
      panel = createPanel();
    } catch (e) {
      alert(`DI Diagnostic: panel creation failed: ${e}`);
      return;
    }
    panel.hide();
    let db = null;
    try {
      db = await openDb();
    } catch {
    }
    try {
      buildSystemSection(panel, db);
    } catch {
      const sec = panel.addSection("System", true);
      panel.addLine(sec, "Error", "Failed to collect system info");
    }
    if (!db) return;
    const pageType = detectPageType();
    const profileUserId = extractProfileUserId();
    const currentUserId = extractUserId();
    const tagName = extractTagName();
    const userId = profileUserId ?? currentUserId;
    let userName = null;
    try {
      const h1 = document.querySelector('h1 a[href*="/users/"]');
      if (h1) userName = h1.textContent?.trim()?.replace(/ /g, "_") ?? null;
    } catch {
    }
    if (pageType === "profile" && userId) {
      try {
        await buildGrassSection(panel, db, userId, userName);
      } catch {
        const sec = panel.addSection("GrassApp", true);
        panel.addLine(sec, "Error", "Failed to collect GrassApp diagnostics");
      }
      try {
        await buildUserAnalyticsSection(panel, db, userId);
      } catch {
        const sec = panel.addSection("UserAnalyticsApp", true);
        panel.addLine(
          sec,
          "Error",
          "Failed to collect UserAnalytics diagnostics"
        );
      }
      if (tagName) {
        try {
          await buildTagAnalyticsSection(panel, db, tagName);
        } catch {
          const sec = panel.addSection("TagAnalyticsApp", false);
          panel.addLine(
            sec,
            "Error",
            "Failed to collect TagAnalytics diagnostics"
          );
        }
      }
    } else if (pageType === "tag" && tagName) {
      try {
        await buildTagAnalyticsSection(panel, db, tagName);
      } catch {
        const sec = panel.addSection("TagAnalyticsApp", true);
        panel.addLine(sec, "Error", "Failed to collect TagAnalytics diagnostics");
      }
      if (userId) {
        try {
          await buildGrassSection(panel, db, userId, userName);
        } catch {
          const sec = panel.addSection("GrassApp", false);
          panel.addLine(sec, "Error", "Failed");
        }
        try {
          await buildUserAnalyticsSection(panel, db, userId);
        } catch {
          const sec = panel.addSection("UserAnalyticsApp", false);
          panel.addLine(sec, "Error", "Failed");
        }
      }
    } else {
      if (userId) {
        try {
          await buildGrassSection(panel, db, userId, userName);
        } catch {
        }
        try {
          await buildUserAnalyticsSection(panel, db, userId);
        } catch {
        }
      }
      if (tagName) {
        try {
          await buildTagAnalyticsSection(panel, db, tagName);
        } catch {
        }
      }
    }
    db.close();
  }
  const WIKI_RESERVED = new Set(["search", "show_or_new", "new"]);
  function detectCurrentTag() {
    const path = window.location.pathname;
    if (path.startsWith("/wiki_pages/")) {
      const segments = path.split("/").filter((s) => s !== "");
      if (segments.length !== 2) return null;
      const rawName = segments[1];
      if (WIKI_RESERVED.has(rawName)) return null;
      return decodeURIComponent(rawName);
    }
    if (path.startsWith("/artists/")) {
      const segments = path.split("/").filter((s) => s !== "");
      if (segments.length !== 2 || !/^\d+$/.test(segments[1])) return null;
      if (document.body.dataset.artistName) {
        return document.body.dataset.artistName;
      }
      const postLink = document.querySelector('a[href^="/posts?tags="]');
      if (postLink) {
        const urlParams = new URLSearchParams(
          postLink.search
        );
        return urlParams.get("tags");
      }
    }
    return null;
  }
  const DASHBOARD_CONTAINERS = [
    "danbooru-grass-modal-overlay",
    "tag-analytics-modal",
    "scatter-popover-ui",
    "danbooru-grass-sync-settings",
    "tag-analytics-settings-popover",
    "di-post-hover-card"
  ];
  function resolveEffectiveDashboardTheme(pref) {
    if (pref === "light" || pref === "dark") return pref;
    return document.body.getAttribute("data-current-user-theme") === "dark" ? "dark" : "light";
  }
  function applyDashboardTheme(settings) {
    const effective = resolveEffectiveDashboardTheme(settings.getDarkMode());
    for (const id of DASHBOARD_CONTAINERS) {
      const el = document.getElementById(id);
      if (el) {
        if (effective === "dark") {
          el.setAttribute("data-di-theme", "dark");
        } else {
          el.removeAttribute("data-di-theme");
        }
      }
    }
  }
  function observeDanbooruTheme(settings) {
    const observer = new MutationObserver(() => {
      if (settings.getDarkMode() !== "auto") return;
      applyDashboardTheme(settings);
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-current-user-theme"]
    });
  }
  function observeCrossTabSettings(settings) {
    const settingsKey = `${CONFIG.STORAGE_PREFIX}settings`;
    window.addEventListener("storage", (e) => {
      if (e.key !== settingsKey) return;
      settings.settings = settings.load();
      applyDashboardTheme(settings);
    });
  }
  async function main() {
    if (shouldRunDiagnostic()) {
      let fired = false;
      const openDiag = () => {
        if (fired) return;
        fired = true;
        void showDiagnostic();
      };
      window.addEventListener("di:sync-complete", openDiag, { once: true });
      setTimeout(openDiag, 6e3);
    }
    if (document.body.classList.length === 0) return;
    injectGlobalStyles();
    const db = new Database();
    const settings = new SettingsManager();
    observeDanbooruTheme(settings);
    observeCrossTabSettings(settings);
    const rl = CONFIG.RATE_LIMITER;
    const rateLimiter = new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);
    const coordinator = new TabCoordinator();
    coordinator.onTabCountChange = (count) => {
      const rps = Math.max(1, Math.floor(rl.rps / count));
      const conc = Math.max(1, Math.floor(rl.concurrency / count));
      rateLimiter.updateLimits(rps, conc);
    };
    coordinator.onBackoffReceived = (until) => {
      rateLimiter.setBackoff(until);
    };
    rateLimiter.onBackoff = (until) => {
      coordinator.broadcastBackoff(until);
    };
    coordinator.start();
    const targetTagName = detectCurrentTag();
    if (targetTagName) {
      const tagAnalytics = new TagAnalyticsApp(
        db,
        settings,
        targetTagName,
        rateLimiter
      );
      void tagAnalytics.run();
    } else {
      const context = new ProfileContext();
      if (!context.isValidProfile()) {
        return;
      }
      const grass = new GrassApp(db, settings, context, rateLimiter);
      const userAnalytics = new UserAnalyticsApp(
        db,
        settings,
        context,
        rateLimiter
      );
      void grass.run();
      void userAnalytics.run();
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void main());
  } else {
    void main();
  }

})(Dexie, d3);
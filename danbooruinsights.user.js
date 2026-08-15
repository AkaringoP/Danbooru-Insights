// ==UserScript==
// @name         Danbooru Insights
// @namespace    http://tampermonkey.net/
// @version      9.9.2
// @author       AkaringoP with Claude Code
// @description  Injects a GitHub-style contribution graph and advanced analytics dashboard into Danbooru profile and wiki pages.
// @icon         https://danbooru.donmai.us/favicon.ico
// @homepageURL  https://github.com/AkaringoP/Danbooru-Insights
// @downloadURL  https://github.com/AkaringoP/Danbooru-Insights/raw/build/danbooruinsights.user.js
// @updateURL    https://github.com/AkaringoP/Danbooru-Insights/raw/build/danbooruinsights.user.js
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
MAX_OPTIMIZED_POSTS: 1200,
MAX_PREVIEW_ONLY_UPLOADS: 30,
REPORT_COOLDOWN_MS: 3e3,
ANALYTICS_CLEANUP_THRESHOLD_MS: 14 * DAY_MS,
CACHE_EXPIRY_MS: DAY_MS,
FULL_REFRESH_HINT_DAYS: 30,
BACKOFF_DURATION_MS: 5e3,




RATE_LIMITER: { concurrency: 8, jitter: [0, 50], rps: 9 },
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

      /* Ranking row fill (% bar behind each user row) — white wash on
         dark, black wash on light. Light fallback lives at the use site. */
      --di-ranking-row-fill: rgba(255, 255, 255, 0.09);

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
    /* "Refreshing counts" pill on the pie header — signals the current tab's
       per-tag counts are being revalidated in the background so a briefly
       stale cached value isn't mistaken for final. Toggled via .is-active.

       Overlaid (absolute, right-centred in the tab header) rather than laid
       out: as a flex sibling its appearance narrowed the tab column, so every
       toggle re-wrapped the tab rows and the whole header jumped. Out of the
       flow, the tabs keep one arrangement whether it is showing or not. The
       trade-off is that on narrow widths it can sit over a tab's right edge —
       it is opaque enough to stay readable, transient, and pointer-events:none
       so the tab underneath still takes the click. */
    .di-pie-updating-badge {
        display: none;
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        align-items: center;
        gap: 5px;
        font-size: 10px;
        color: var(--di-text-muted, #888);
        background: var(--di-bg-tertiary, #f0f0f0);
        border-radius: 10px;
        padding: 2px 8px;
        white-space: nowrap;
        pointer-events: none;
    }
    .di-pie-updating-badge.is-active { display: inline-flex; }
    .di-pie-updating-badge .di-pie-updating-spin {
        display: inline-block;
        animation: di-spin 0.9s linear infinite;
    }

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

    /* -- Widget Locked Placeholder (v9.6.0) -- */
    .di-widget-locked-card {
        background: var(--di-bg, #fff);
        border: 1px solid var(--di-border-light, #eeeeee);
        border-radius: 8px;
        padding: 28px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        text-align: center;
        color: var(--di-text, #333333);
    }
    .di-widget-locked-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 1em;
        font-weight: 600;
        color: var(--di-text-heading, var(--di-text, #333333));
    }
    .di-widget-locked-icon {
        font-size: 1.1em;
    }
    .di-widget-locked-state {
        margin-top: 4px;
        font-size: 0.95em;
        color: var(--di-text-secondary, #666666);
    }
    .di-widget-locked-progress {
        width: 100%;
        max-width: 320px;
        height: 8px;
        background: var(--di-bg-tertiary, #f0f0f0);
        border-radius: 999px;
        overflow: hidden;
    }
    .di-widget-locked-progress-fill {
        height: 100%;
        background: var(--di-accent, #4a90e2);
        border-radius: 999px;
        transition: width 0.3s ease;
    }
    .di-widget-locked-counter {
        font-size: 0.85em;
        font-variant-numeric: tabular-nums;
        color: var(--di-text-secondary, #666666);
    }
    .di-widget-locked-message {
        font-size: 0.8em;
        color: var(--di-text-muted, #888888);
        max-width: 380px;
        line-height: 1.4;
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
    /* Sortable column header: the whole label + single ▲/▼ arrow is one
       clickable target, with a little padding to enlarge the hit area. */
    .di-cts-th {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        padding: 2px 4px;
        margin: -2px -4px;
        border-radius: 4px;
        user-select: none;
        transition: background 0.12s, color 0.12s;
    }
    .di-cts-th:hover {
        background: var(--di-table-row-hover, #f6f8fa);
    }
    .di-cts-th--active {
        color: var(--di-text, #333);
    }
    /* One arrow per column. Hidden until the header is hovered (keeps the row
       clean); the active sort's arrow overrides this and stays lit + accent. */
    .di-cts-arrow {
        opacity: 0;
        font-size: 9px;
        color: var(--di-text-muted, #888);
        transition: opacity 0.12s, color 0.12s;
    }
    .di-cts-th:hover .di-cts-arrow {
        opacity: 0.6;
    }
    .di-cts-arrow--active {
        opacity: 1;
        color: var(--di-link, #007bff);
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
    /* Popover Save/Cancel action row (shared: UserAnalyticsApp sync popover
       + TagAnalyticsApp settings popover). Save commits all edits at once;
       Cancel (or outside click) discards them. */
    .di-popover-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 12px;
        padding-top: 8px;
        border-top: 1px solid var(--di-border-light, #eeeeee);
    }
    .di-popover-btn {
        border-radius: 4px;
        cursor: pointer;
        padding: 4px 12px;
        font-size: 11px;
        font-weight: 600;
    }
    .di-popover-btn-save {
        background: #28a745;
        border: 1px solid #28a745;
        color: #ffffff;
    }
    .di-popover-btn-save:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    .di-popover-btn-cancel {
        background: none;
        border: 1px solid #dc3545;
        color: #dc3545;
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
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
    }
    .pie-tabs-row {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        justify-content: flex-end;
    }
    .pie-tabs-row:empty { display: none; }
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
      /* Only size the thumbnail wrapper (second div), not the text div
         when the thumbnail is hidden for NSFW posts. */
      #analytics-milestone-container > a > div:last-child:not(:first-child) {
        width: 45px !important;
        height: 45px !important;
      }
      /* Mobile cards are shorter (~75-80px); 110px would cut the next row
         mid-card. Show one full row when collapsed. */
      #analytics-milestone-container.di-milestone-collapsed {
        max-height: 90px !important;
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
    .di-toast-action {
      flex-shrink: 0;
      background: rgba(255, 255, 255, 0.18);
      border: 1px solid rgba(255, 255, 255, 0.4);
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 3px;
      cursor: pointer;
      line-height: 1;
    }
    .di-toast-action:hover {
      background: rgba(255, 255, 255, 0.32);
    }
    @media (max-width: 480px) {
      .di-toast-container {
        left: 8px;
        right: 8px;
        bottom: 8px;
        max-width: none;
      }
    }

    /* Threshold auto-tune button (settings popover header). */
    .di-autotune-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      background: transparent;
      border: 1px solid var(--di-border-input, #ddd);
      border-radius: 4px;
      color: var(--di-btn-text, #555);
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .di-autotune-btn:hover {
      background: var(--di-bg-tertiary, #f0f0f0);
      color: var(--di-link, #007bff);
      border-color: var(--di-link, #007bff);
    }
    .di-autotune-btn[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .di-autotune-btn svg {
      width: 14px;
      height: 14px;
      display: block;
    }

    /* Threshold preview modal. */
    .di-tt-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10010;
      animation: di-tt-fade-in 0.12s ease-out;
    }
    @keyframes di-tt-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .di-tt-modal {
      background: var(--di-bg, #fff);
      color: var(--di-text, #333);
      border: 1px solid var(--di-border-input, #ddd);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      padding: 18px 20px 14px;
      min-width: 320px;
      max-width: 90vw;
    }
    .di-tt-modal-header {
      font-size: 14px;
      font-weight: 600;
      color: var(--di-text-heading, #444);
      margin-bottom: 10px;
    }
    .di-tt-modal-body {
      font-size: 12px;
      margin-bottom: 16px;
    }
    .di-tt-modal-intro {
      color: var(--di-text-muted, #888);
      margin-bottom: 10px;
    }
    .di-tt-modal-foot {
      color: var(--di-text-muted, #888);
      font-size: 11px;
      line-height: 1.45;
      margin-top: 10px;
    }
    .di-tt-modal-table {
      display: grid;
      grid-template-columns: 18px 1fr auto auto auto;
      gap: 4px 12px;
      align-items: center;
      padding: 8px 10px;
      background: var(--di-bg-tertiary, #f6f6f8);
      border: 1px solid var(--di-border-light, #eee);
      border-radius: 6px;
    }
    .di-tt-modal-trow {
      display: contents;
      color: var(--di-text, #333);
    }
    .di-tt-modal-trow-head .di-tt-modal-tcol-val {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--di-text-muted, #888);
      padding-bottom: 2px;
      border-bottom: 1px solid var(--di-border-light, #eee);
    }
    .di-tt-modal-tcol-swatch {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .di-tt-modal-swatch {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 3px;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08) inset;
    }
    .di-tt-modal-tcol-label {
      font-weight: 500;
    }
    .di-tt-modal-tcol-tune {
      font-weight: 400;
      font-size: 11px;
      color: var(--di-text-muted, #888);
      font-variant-numeric: tabular-nums;
    }
    .di-tt-modal-tcol-val {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-variant-numeric: tabular-nums;
      text-align: right;
      min-width: 32px;
    }
    .di-tt-modal-tcol-before {
      color: var(--di-text-muted, #888);
    }
    .di-tt-modal-tcol-after {
      font-weight: 700;
      color: var(--di-text-heading, #222);
    }
    .di-tt-modal-tcol-arrow {
      font-size: 12px;
      width: 14px;
      text-align: center;
      color: var(--di-text-muted, #888);
    }
    .di-tt-modal-arrow-up   { color: #2d8a4e; }
    .di-tt-modal-arrow-down { color: #c93c37; }
    .di-tt-modal-trow-unchanged .di-tt-modal-tcol-after {
      color: var(--di-text-muted, #888);
      font-weight: 500;
    }
    .di-tt-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .di-tt-modal-btn {
      padding: 6px 16px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 5px;
      border: 1px solid var(--di-border-input, #ddd);
      cursor: pointer;
      line-height: 1;
    }
    /* Restate background/color/border on every state so Danbooru's
       global button:hover (and similar) can't repaint our buttons mid
       interaction. !important guards against host stylesheets that
       outrank our class selector. */
    .di-tt-modal-btn-secondary,
    .di-tt-modal-btn-secondary:hover,
    .di-tt-modal-btn-secondary:focus,
    .di-tt-modal-btn-secondary:active {
      background: transparent !important;
      color: var(--di-btn-text, #555) !important;
      border-color: var(--di-border-input, #ddd) !important;
    }
    .di-tt-modal-btn-secondary:hover {
      background: var(--di-bg-tertiary, #f0f0f0) !important;
    }
    .di-tt-modal-btn-primary,
    .di-tt-modal-btn-primary:hover,
    .di-tt-modal-btn-primary:focus,
    .di-tt-modal-btn-primary:active {
      background: var(--di-link, #007bff) !important;
      border-color: var(--di-link, #007bff) !important;
      color: #ffffff !important;
    }
    .di-tt-modal-btn-primary:hover {
      filter: brightness(1.1);
    }
    .di-tt-modal-btn-primary:focus-visible {
      outline: 2px solid var(--di-link, #007bff);
      outline-offset: 2px;
    }

    /* Sub-tag breakdown tooltip (Copy / Fav_Copy / Char legend hover/tap, v9.6.0+) */
    .di-subtag-tooltip {
      position: absolute;
      min-width: 180px;
      /* Cap to 280px on roomy viewports, but shrink to viewport width
       * minus 16px on narrow screens so mobile centred placement keeps
       * an 8px gutter on each side (matches showSubtagTooltip's mobile
       * branch which centres the measured width). */
      max-width: min(280px, calc(100vw - 16px));
      /* Cap height so a long sub list (gundam: 10+ subs) doesn't flow
       * past the viewport and hide its trailing Others row. Scroll the
       * list region (di-subtag-tooltip-list) — the heading stays
       * pinned. 80vh keeps a small margin against the very top/bottom. */
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      padding: 8px 10px;
      background: var(--di-bg-glass, rgba(40, 40, 50, 0.97));
      color: var(--di-text, #e0e0e0);
      border: 1px solid var(--di-border, #3a3a55);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      font-size: 12px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.12s ease-out;
    }
    .di-subtag-tooltip-heading {
      font-weight: 600;
      color: var(--di-text-heading, #d0d0d0);
      margin-bottom: 5px;
      padding-bottom: 5px;
      border-bottom: 1px solid var(--di-border-light, #2e2e48);
      /* Pinned above the scrollable list — never participate in the
       * flex remainder. */
      flex: 0 0 auto;
    }
    .di-subtag-tooltip-list {
      display: flex;
      flex-direction: column;
      /* min-height: 0 is required for overflow-y to actually clip:
       * by default a flex items min-height is auto, which sizes to
       * the intrinsic content, defeating the parents max-height cap.
       * flex: 1 1 auto claims the remaining vertical space inside
       * the tooltip so the scrollbar appears in the list region. */
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      /* Slim scrollbar matching the dashboard legend's style. */
      scrollbar-width: thin;
    }
    .di-subtag-tooltip-list::-webkit-scrollbar { width: 6px; }
    .di-subtag-tooltip-list::-webkit-scrollbar-track { background: transparent; }
    .di-subtag-tooltip-list::-webkit-scrollbar-thumb {
      background: var(--di-border, #3a3a55);
      border-radius: 3px;
    }
    .di-subtag-tooltip-item {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 3px 6px;
      border-radius: 4px;
      color: var(--di-text, #e0e0e0);
      text-decoration: none;
    }
    a.di-subtag-tooltip-item:hover {
      background: var(--di-bg-tertiary, #2a2a44);
      color: var(--di-link, #007bff);
    }
    .di-subtag-tooltip-item--other {
      color: var(--di-text-muted, #888888);
      cursor: default;
    }
    .di-subtag-tooltip-item-name {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .di-subtag-tooltip-item-share {
      flex: 0 0 auto;
      min-width: 46px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 500;
      color: var(--di-text-secondary, #aaaaaa);
    }
    .di-subtag-tooltip-item-count {
      flex: 0 0 auto;
      min-width: 52px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--di-text-muted, #888888);
      font-size: 0.9em;
    }

    /* ----- Grass month-label popover ----- */
    /* Base chrome (bg/border/shadow/padding/width) comes from
       applyPopoverChrome; palette vars from applyPopoverPalette. The 200ms
       here must match FADE_MS in grass-month-popover.ts. */
    .di-grass-month-popover {
      transition: opacity 200ms ease;
      line-height: 1.45;
    }
    .di-grass-month-popover--fading {
      opacity: 0;
    }
    .di-gmp-caret {
      position: absolute;
      top: -6px;
      width: 12px;
      height: 12px;
      background: var(--di-bg, #fff);
      border-left: 1px solid var(--di-border, #e1e4e8);
      border-top: 1px solid var(--di-border, #e1e4e8);
      transform: translateX(-50%) rotate(45deg);
    }
    /* Header row: month·metric on the left, year-trend chart on the right,
       stacked directly above the headline's daily sparkline. */
    .di-gmp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--di-text-muted, #888);
      margin-bottom: 8px;
    }
    /* The year's shape recedes so the hovered month's marker reads as "you
       are here" rather than competing with eleven neighbours. */
    .di-gmp-trend .di-gmp-trend-line {
      fill: none;
      stroke: var(--grass-level-2, #40c463);
      stroke-width: 1.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .di-gmp-trend .di-gmp-trend-dot {
      fill: var(--grass-level-2, #40c463);
    }
    /* Solid marker, sized past the line's vertices so it still reads on top
       of them. */
    .di-gmp-trend .di-gmp-trend-now {
      fill: var(--grass-level-4, #216e39);
    }
    /* Same two colours as .di-gmp-mom--up / --down: the marker and the
       percentage beside it must never disagree. */
    .di-gmp-trend .di-gmp-trend-now.di-gmp-trend-up {
      fill: #2ea043;
    }
    .di-gmp-trend .di-gmp-trend-now.di-gmp-trend-down {
      fill: #cf222e;
    }
    /* Headline row: total + MoM on the left, sparkline on the right. */
    .di-gmp-headline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .di-gmp-headline-main {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }
    .di-gmp-spark {
      flex: 0 0 auto;
      display: block;
      overflow: visible;
    }
    /* Same palette bridge as .di-gmp-bar-fill; the busiest day sits one level
       darker so it matches the day named in the "Busiest" row. */
    .di-gmp-spark rect {
      fill: var(--grass-level-2, #40c463);
    }
    .di-gmp-spark rect.di-gmp-spark-peak {
      fill: var(--grass-level-4, #216e39);
    }
    .di-gmp-total {
      font-size: 20px;
      font-weight: 700;
      color: var(--di-text, #333);
    }
    .di-gmp-mom {
      font-size: 11px;
      font-weight: 600;
    }
    .di-gmp-mom--up {
      color: #2ea043;
    }
    .di-gmp-mom--down {
      color: #cf222e;
    }
    .di-gmp-mom--flat,
    .di-gmp-mom--new {
      color: var(--di-text-muted, #888);
    }
    .di-gmp-rows {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .di-gmp-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 11px;
    }
    .di-gmp-k {
      color: var(--di-text-muted, #888);
    }
    .di-gmp-v {
      color: var(--di-text, #333);
      font-weight: 500;
    }
    .di-gmp-bar {
      height: 4px;
      border-radius: 2px;
      background: var(--di-border-light, #eee);
      overflow: hidden;
      margin: 2px 0 4px;
    }
    .di-gmp-bar-fill {
      height: 100%;
      /* Bridge to the active grass palette (level 2 ≈ #40c463 in the default
         theme) so the bar matches Sakura/Ember/etc. instead of a fixed green.
         --grass-level-* live on :root, set by SettingsManager.setTheme. */
      background: var(--grass-level-2, #40c463);
    }
    .di-gmp-empty {
      font-size: 11px;
      color: var(--di-text-muted, #888);
      padding: 4px 0;
    }

    /* ----- Dashboard preview popover ----- */
    /* Transient (hover) dismiss fades out; FADE_MS in the popover module must
       match this duration so display:none lands exactly as opacity hits 0. */
    .di-preview-popover {
      transition: opacity 350ms ease;
    }
    .di-preview-popover--fading {
      opacity: 0;
    }
    .di-preview-caret {
      position: absolute;
      top: -6px;
      width: 12px;
      height: 12px;
      background: var(--di-bg, #fff);
      border-left: 1px solid var(--di-border, #e1e4e8);
      border-top: 1px solid var(--di-border, #e1e4e8);
      transform: translateX(-50%) rotate(45deg);
    }
    .di-preview-body {
      padding: 12px;
    }
    .di-preview-section-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--di-text-muted, #888);
      margin: 0 0 6px;
    }
    /* Section A header: label + "?" legend hug the left, NSFW toggle pushed to
       the right (margin-left:auto on the toggle) — NOT space-between, which
       would strand the "?" in the dead centre. */
    .di-preview-section-head {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 8px;
    }
    .di-preview-section-head .di-preview-section-label {
      margin-bottom: 6px;
    }
    .di-preview-nsfw-toggle {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--di-text-muted, #888);
      cursor: pointer;
      user-select: none;
      margin-bottom: 6px;
      margin-left: auto; /* push to the far right of the section head */
    }
    .di-preview-nsfw-toggle input {
      margin: 0;
      cursor: pointer;
    }
    .di-preview-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 4px;
    }
    .di-preview-cell {
      position: relative;
      display: block;
      text-decoration: none;
    }
    .di-preview-thumb,
    .di-preview-thumb--empty {
      display: block;
      width: 100%;
      aspect-ratio: 1 / 1;
      object-fit: cover;
      background: var(--di-bg-tertiary, #f0f0f0);
      border: 2px solid transparent;
      border-radius: 4px;
      box-sizing: border-box;
    }
    /* NSFW filter: blur q/e thumbnails (mirrors TagAnalyticsApp). The label
       below stays readable — only the thumbnail is obscured. */
    .di-preview-thumb--nsfw {
      filter: blur(10px) grayscale(100%);
      opacity: 0.3;
    }
    .di-preview-label {
      font-size: 9px;
      line-height: 1.3;
      text-align: center;
      color: var(--di-text-muted, #888);
      padding: 1px 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .di-preview-label--flag {
      color: #e5484d;
      font-weight: 700;
    }
    /* Mintagged: the uploader added few tags. Amber — a milder warning than
       the red --flag (heavily downvoted); readable on light + dark bodies. */
    .di-preview-label--mintag {
      color: #e8950c;
      font-weight: 700;
    }
    /* "?" colour legend in the section-A header: a hover/tap-revealed key for
       the thumbnail border colours + label colours. */
    .di-preview-legend-wrap {
      position: relative;
      display: inline-flex;
      margin-bottom: 6px; /* match the label/NSFW baseline in the section head */
    }
    .di-preview-legend-icon {
      cursor: help;
      width: 14px;
      height: 14px;
      border: 1px solid var(--di-border, #ccc);
      border-radius: 50%;
      color: var(--di-text-muted, #888);
      font-size: 9px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      user-select: none;
    }
    .di-preview-legend-pop {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      z-index: 1;
      margin-top: 4px;
      padding: 6px 8px;
      min-width: 180px;
      background: var(--di-bg, #fff);
      border: 1px solid var(--di-border, #ddd);
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
      font-size: 10px;
      color: var(--di-text, #333);
      white-space: nowrap;
    }
    .di-preview-legend-wrap:hover .di-preview-legend-pop,
    .di-preview-legend-wrap:focus-within .di-preview-legend-pop,
    .di-preview-legend-wrap--open .di-preview-legend-pop {
      display: block;
    }
    .di-preview-legend-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 1px 0;
    }
    .di-preview-legend-swatch {
      display: inline-block;
      width: 12px;
      height: 12px;
      box-sizing: border-box;
      border-radius: 2px;
      flex: none;
      text-align: center;
      line-height: 12px;
      font-size: 12px;
    }
    .di-preview-skeleton {
      aspect-ratio: 1 / 1;
      background: var(--di-bg-tertiary, #f0f0f0);
      border-radius: 4px;
      animation: di-preview-pulse 1.2s ease-in-out infinite;
    }
    @keyframes di-preview-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    /* Unified-loading spinner (touch + pinned): spans the grid, one spinner
       for both sections instead of per-section skeletons. */
    .di-preview-loading {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 120px;
    }
    .di-preview-loading::after {
      content: '';
      width: 24px;
      height: 24px;
      border: 3px solid var(--di-border, #e1e4e8);
      border-top-color: var(--di-text-secondary, #888);
      border-radius: 50%;
      animation: di-preview-spin 0.7s linear infinite;
    }
    @keyframes di-preview-spin {
      to { transform: rotate(360deg); }
    }
    .di-preview-msg {
      grid-column: 1 / -1;
      text-align: center;
      color: var(--di-text-muted, #888);
      padding: 16px 8px;
      font-size: 11px;
    }
    /* ----- Section B: activity distribution ----- */
    .di-activity-section {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--di-border, #e1e4e8);
    }
    .di-activity-strip {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-height: 14px;
      padding: 1px;
      border-radius: 3px;
      background: var(--di-bg-tertiary, #f0f0f0);
    }
    .di-activity-row {
      display: flex;
      gap: 1px;
      height: 13px;
    }
    .di-activity-seg {
      flex: 1 1 0;
      min-width: 0;
      border-radius: 1px;
      transition: opacity 0.1s ease;
    }
    /* Malicious-looking item: near-black fill + red inset border so it stays
       visible on dark themes too. Also applied to the legend swatch. */
    .di-activity-seg--flag {
      box-shadow: inset 0 0 0 1.5px #e5484d;
    }
    /* Peer-highlight: cells of a non-hovered type fade so the hovered
       activity type's cells stand out together. */
    .di-activity-seg--mute {
      opacity: 0.2;
    }
    .di-activity-loading {
      animation: di-preview-pulse 1.2s ease-in-out infinite;
    }
    .di-activity-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 10px;
      margin-top: 8px;
      font-size: 10px;
      color: var(--di-text-secondary, #aaa);
    }
    .di-activity-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    /* Peer-highlight: the legend label of the hovered type (strip cell or the
       label itself) goes bold to echo the dimmed strip. The label reserves its
       *bold* width up front (a hidden bold ghost stacked in the same grid cell)
       so toggling the weight on hover never reflows the row. */
    .di-activity-legend-item__text {
      display: inline-grid;
    }
    .di-activity-legend-item__text > span,
    .di-activity-legend-item__text::after {
      grid-area: 1 / 1;
    }
    .di-activity-legend-item__text::after {
      content: attr(data-text);
      font-weight: 700;
      height: 0;
      overflow: hidden;
      visibility: hidden;
      pointer-events: none;
    }
    .di-activity-legend-item--active .di-activity-legend-item__text {
      font-weight: 700;
    }
    .di-activity-legend-item--link {
      cursor: pointer;
    }
    .di-activity-legend-item--link:hover {
      text-decoration: underline;
    }
    .di-activity-swatch {
      width: 9px;
      height: 9px;
      border-radius: 2px;
      flex: 0 0 auto;
    }
    .di-activity-empty {
      color: var(--di-text-muted, #888);
      font-size: 11px;
      padding: 4px 0;
    }
  `;
  function injectGlobalStyles() {
    if (document.getElementById("danbooru-insights-global-css")) return;
    const style = document.createElement("style");
    style.id = "danbooru-insights-global-css";
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
  }
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
        return;
      },
      debug(message, meta) {
        return;
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
  function isThreshold4(v) {
    return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number");
  }
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
          },
          perProfileThresholds: {
            ...saved.perProfileThresholds ?? {}
          },
          perProfileTuneTimes: {
            ...saved.perProfileTuneTimes ?? {}
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
      const stored = this.settings.thresholds[metric];
      if (isThreshold4(stored)) return stored;
      const fallback = this.defaults.thresholds[metric];
      if (isThreshold4(fallback)) return fallback;
      return [1, 5, 10, 20];
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
getThresholdsForView(userId, metric) {
      const stored = this.settings.perProfileThresholds?.[userId]?.[metric];
      if (isThreshold4(stored)) return stored;
      return this.getThresholds(metric);
    }
hasProfileThresholds(userId, metric) {
      const entry = this.settings.perProfileThresholds?.[userId];
      if (!entry) return false;
      if (!metric) return Object.keys(entry).length > 0;
      return entry[metric] !== void 0;
    }
setProfileThresholds(userId, metric, values) {
      const all = { ...this.settings.perProfileThresholds ?? {} };
      all[userId] = {
        ...all[userId] ?? {},
        [metric]: values
      };
      this.save({ perProfileThresholds: all });
    }
static DEFAULT_SCHEDULE = {
      enabled: false,
      interval: "semiannual"
    };
getAutoTuneSchedule() {
      const stored = this.settings.autoTuneSchedule;
      if (stored && typeof stored.enabled === "boolean" && stored.interval) {
        return stored;
      }
      return SettingsManager.DEFAULT_SCHEDULE;
    }
setAutoTuneSchedule(schedule) {
      this.save({ autoTuneSchedule: schedule });
    }
getProfileTuneTime(userId, metric) {
      const ts = this.settings.perProfileTuneTimes?.[userId]?.[metric];
      return typeof ts === "number" ? ts : 0;
    }
setProfileTuneTime(userId, metric, timestamp) {
      const all = { ...this.settings.perProfileTuneTimes ?? {} };
      all[userId] = {
        ...all[userId] ?? {},
        [metric]: timestamp
      };
      this.save({ perProfileTuneTimes: all });
    }
clearProfileThreshold(userId, metric) {
      const all = { ...this.settings.perProfileThresholds ?? {} };
      const entry = all[userId];
      if (!entry || entry[metric] === void 0) return;
      const updated = { ...entry };
      delete updated[metric];
      if (Object.keys(updated).length === 0) {
        delete all[userId];
      } else {
        all[userId] = updated;
      }
      this.save({ perProfileThresholds: all });
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
  const NSFW_STORAGE_KEY = "di.nsfw_enabled";
  function getNsfwEnabled() {
    return localStorage.getItem(NSFW_STORAGE_KEY) === "true";
  }
  function setNsfwEnabled(value) {
    localStorage.setItem(NSFW_STORAGE_KEY, String(value));
  }
  function migrateNsfwKey() {
    if (localStorage.getItem(NSFW_STORAGE_KEY) !== null) {
      localStorage.removeItem("danbooru_grass_nsfw_enabled");
      localStorage.removeItem("tag_analytics_nsfw_enabled");
      return;
    }
    const legacy = localStorage.getItem("danbooru_grass_nsfw_enabled") ?? localStorage.getItem("tag_analytics_nsfw_enabled");
    if (legacy !== null) {
      localStorage.setItem(NSFW_STORAGE_KEY, legacy);
    }
    localStorage.removeItem("danbooru_grass_nsfw_enabled");
    localStorage.removeItem("tag_analytics_nsfw_enabled");
  }
  const COUNT_CACHE_TTL_MIN_KEY = "di.count_cache_ttl_min";
  const DEFAULT_COUNT_CACHE_TTL_MIN = 10;
  function getCountCacheTtlMin() {
    const raw = localStorage.getItem(COUNT_CACHE_TTL_MIN_KEY);
    if (raw === null) return DEFAULT_COUNT_CACHE_TTL_MIN;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return DEFAULT_COUNT_CACHE_TTL_MIN;
    }
    return parsed;
  }
  function getCountCacheTtlMs() {
    return getCountCacheTtlMin() * 6e4;
  }
  function setCountCacheTtlMin(minutes) {
    const clamped = Math.max(1, Math.floor(minutes));
    localStorage.setItem(COUNT_CACHE_TTL_MIN_KEY, String(clamped));
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
  function getPalette(el2) {
    const target = el2 ?? document.documentElement;
    const style = getComputedStyle(target);
    const palette = {};
    for (const [key, cssVar] of Object.entries(VAR_MAP)) {
      const v = style.getPropertyValue(cssVar).trim();
      palette[key] = v || LIGHT_FALLBACK[key];
    }
    return palette;
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
      const el2 = document.getElementById(id);
      if (el2) {
        if (effective === "dark") {
          el2.setAttribute("data-di-theme", "dark");
        } else {
          el2.removeAttribute("data-di-theme");
        }
      }
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
          (el2) => el2.textContent?.trim() === "Join Date"
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
        const levelHeader = cells.find((el2) => el2.textContent?.trim() === "Level");
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
  async function fetchRemoteCount$1(rateLimiter, tags) {
    const url = `/counts/posts.json?tags=${encodeURIComponent(tags)}`;
    const resp = await rateLimiter.fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    return json["counts"] && typeof json["counts"]["posts"] === "number" ? json["counts"]["posts"] : 0;
  }
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
async getStats(key, userId, maxAgeMs) {
      try {
        const record = await this.db.piestats.get({ key, userId });
        if (!record) return null;
        if (maxAgeMs !== void 0 && record.updated_at) {
          const age = Date.now() - new Date(record.updated_at).getTime();
          if (age < 0 || age > maxAgeMs) return null;
        }
        return record.data;
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
async sumDailyCounts(metric, userId, startDate, endDate) {
      const table = this.db[metric];
      if (!table) return 0;
      try {
        const rows = await table.where("id").between(
          `${userId}_${startDate}`,
          `${userId}_${endDate}￿`,
          true,
          true
        ).toArray();
        return rows.reduce((sum, row) => sum + (row.count || 0), 0);
      } catch (e) {
        log$d.warn("Failed to sum daily counts", { error: e, metric });
        return 0;
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
        const cfg = this.resolveMetricFetchConfig(metric, userInfo, year);
        if (cfg === null) return {};
        const userIdVal = userInfo.id || userInfo.name;
        const isYearCompleteCache = await this.checkYearCompletion(
          userIdVal,
          metric,
          year
        );
        const forceFullFetch = await this.runUploadsIntegrityCheck({
          metric,
          year,
          normalizedName: cfg.normalizedName,
          table: cfg.table,
          userIdVal,
          startDate: cfg.startDate,
          isYearCompleteCache
        });
        const state2 = await this.loadCachedYearState({
          table: cfg.table,
          userIdVal,
          startDate: cfg.startDate,
          year,
          metric,
          forceFullFetch,
          isYearCompleteCache
        });
        if (!isYearCompleteCache) {
          await this.fetchAndPersistYear({
            cfg,
            metric,
            year,
            userInfo,
            userIdVal,
            state: state2,
            forceFullFetch,
            onProgress
          });
        }
        return this.loadYearResultFromCache({
          table: cfg.table,
          userIdVal,
          startDate: cfg.startDate,
          year,
          metric,
          isYearCompleteCache,
          hourlyCounts: state2.hourlyCounts
        });
      } catch (e) {
        log$d.error("Metric data fetch failed", { error: e });
        throw e;
      }
    }
resolveMetricFetchConfig(metric, userInfo, year) {
      const startDate = `${year}-01-01`;
      const endDate = `${year + 1}-01-01`;
      const normalizedName = (userInfo.name || "").replace(/ /g, "_");
      const params = {
        limit: metric === "uploads" ? 200 : 1e3
      };
      let endpoint = "";
      let storeName = "";
      const dateKey = "created_at";
      let idKey = "";
      switch (metric) {
        case "uploads":
          endpoint = "/posts.json";
          storeName = "uploads";
          idKey = "uploader_id";
          params["only"] = "uploader_id,created_at";
          break;
        case "approvals":
          endpoint = "/post_approvals.json";
          storeName = "approvals";
          idKey = "user_id";
          params["search[user_id]"] = userInfo.id;
          params["only"] = "id,post_id,created_at";
          break;
        case "notes":
          if (!userInfo.id) throw new Error("User ID required for Notes");
          endpoint = "/note_versions.json";
          storeName = "notes";
          idKey = "updater_id";
          params["search[updater_id]"] = userInfo.id;
          params["only"] = "updater_id,created_at";
          break;
        default:
          return null;
      }
      return {
        endpoint,
        storeName,
        dateKey,
        idKey,
        params,
        normalizedName,
        startDate,
        endDate,
        table: this.db[storeName]
      };
    }
async runUploadsIntegrityCheck(args) {
      const {
        metric,
        year,
        normalizedName,
        table,
        userIdVal,
        startDate,
        isYearCompleteCache
      } = args;
      if (isYearCompleteCache || metric !== "uploads" || year >= ( new Date()).getFullYear()) {
        return false;
      }
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
        if (remoteCount === localCount) return false;
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
        return true;
      } catch (e) {
        log$d.warn("Integrity check failed (Network/API), proceeding with cache", {
          error: e
        });
        return false;
      }
    }
async loadCachedYearState(args) {
      const {
        table,
        userIdVal,
        startDate,
        year,
        metric,
        forceFullFetch,
        isYearCompleteCache
      } = args;
      const hourlyCounts = new Array(24).fill(0);
      let lastEntry = null;
      let fetchFromDate = null;
      if (!forceFullFetch && !isYearCompleteCache) {
        lastEntry = await table.where("id").between(
          `${userIdVal}_${startDate}`,
          `${userIdVal}_${year}-12-31￿`,
          true,
          true
        ).last();
        const existingHourlyStats = await this.db.hourly_stats.where("id").between(
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
        if (year < ( new Date()).getFullYear()) {
          fetchFromDate = `${year + 1}-01-01`;
        } else {
          const lastDate = new Date(lastEntry["date"]);
          lastDate.setDate(lastDate.getDate() - 3);
          fetchFromDate = lastDate.toISOString().slice(0, 10);
        }
      }
      return { fetchFromDate, lastEntry, hourlyCounts };
    }
async fetchAndPersistYear(args) {
      const {
        cfg,
        metric,
        year,
        userInfo,
        userIdVal,
        state: state2,
        forceFullFetch,
        onProgress
      } = args;
      const {
        endpoint,
        params,
        dateKey,
        idKey,
        normalizedName,
        startDate,
        endDate,
        table
      } = cfg;
      const { fetchFromDate, lastEntry, hourlyCounts } = state2;
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
      } else if (metric === "notes" || metric === "approvals") {
        params["search[created_at]"] = fetchRange;
      }
      const isDeltaFetch = !!lastEntry && !forceFullFetch;
      const items = await this.fetchAllPages(
        endpoint,
        params,
        null,
        dateKey,
        "desc",
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
        bulkData.push({ id, userId: userIdVal, date, count: entry.count });
        if (metric === "approvals") {
          detailData.push({ id, userId: userIdVal, post_list: entry.postList });
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
async loadYearResultFromCache(args) {
      const {
        table,
        userIdVal,
        startDate,
        year,
        metric,
        isYearCompleteCache,
        hourlyCounts
      } = args;
      const dataEndDate = `${year}-12-31`;
      const fullYearData = await table.where("id").between(
        `${userIdVal}_${startDate}`,
        `${userIdVal}_${dataEndDate}￿`,
        true,
        true
      ).toArray();
      const resultMap = {};
      fullYearData.forEach((i) => resultMap[i.date] = i.count);
      let hourly = hourlyCounts;
      if (isYearCompleteCache) {
        const cachedHourly = await this.db.hourly_stats.where("id").between(
          `${userIdVal}_${metric}_${year}_00`,
          `${userIdVal}_${metric}_${year}_24`,
          true,
          false
        ).toArray();
        hourly = new Array(24).fill(0);
        cachedHourly.forEach((stat) => {
          if (stat.hour >= 0 && stat.hour < 24) {
            hourly[stat.hour] = stat.count;
          }
        });
      }
      return { daily: resultMap, hourly };
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
        const url = `${this.baseUrl}/user_feedbacks.json?search[body_matches]=to+Approver&search[category]=neutral&search[hide_bans]=No&search[user_name]=${encodedName}&limit=20`;
        const resp = await this.rateLimiter.fetch(url);
        if (!resp.ok) return null;
        const json = await resp.json();
        if (!Array.isArray(json) || json.length === 0) {
          return null;
        }
        const oldest = json.filter((item) => typeof item["created_at"] === "string").map((item) => String(item["created_at"])).sort()[0];
        return oldest ? oldest.slice(0, 10) : null;
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
      return fetchRemoteCount$1(this.rateLimiter, tags);
    }
  }
  function calcPopoverPosition(target) {
    const rect = target.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    return {
      top: rect.top + scrollTop,
      left: rect.right + scrollLeft + 10
    };
  }
  function calcPopoverPositionBelowCentered(target, popoverWidth) {
    const rect = target.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    const centeredLeft = (window.innerWidth - popoverWidth) / 2;
    return {
      top: rect.bottom + scrollTop + 8,
      left: scrollLeft + Math.max(8, centeredLeft)
    };
  }
  function calcPopoverPositionBelow(target, popoverWidth) {
    const rect = target.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - popoverWidth - margin);
    const viewportLeft = Math.min(Math.max(margin, rect.left), maxLeft);
    const top = rect.bottom + scrollTop + margin;
    const left = viewportLeft + scrollLeft;
    const caretHalf = 7;
    const anchorCenter = rect.left + rect.width / 2;
    const caretLeft = Math.min(
      Math.max(caretHalf, anchorCenter - viewportLeft),
      popoverWidth - caretHalf
    );
    return { top, left, caretLeft };
  }
  function createClickOutsideHandler(container2, onClose, options = {}) {
    const ignore = options.ignore;
    const ignoreList = !ignore ? [] : Array.isArray(ignore) ? ignore : [ignore];
    return (e) => {
      const target = e.target;
      if (!target) return;
      if (container2.contains(target)) return;
      for (const el2 of ignoreList) {
        if (el2.contains(target)) return;
      }
      onClose();
    };
  }
  function applyPopoverChrome(popover, options = {}) {
    popover.style.position = "absolute";
    popover.style.zIndex = options.zIndex ?? "10001";
    popover.style.background = "var(--di-bg, #fff)";
    popover.style.border = "1px solid var(--di-border, #e1e4e8)";
    popover.style.borderRadius = "6px";
    popover.style.padding = "12px";
    popover.style.boxShadow = "0 2px 10px var(--di-shadow-light, rgba(0,0,0,0.1))";
    popover.style.fontSize = "11px";
    popover.style.color = "var(--di-text, #333)";
    popover.style.width = options.width ?? "220px";
  }
  const DASHBOARD_THEME_SELECT_HTML = `
  <div style="margin-top:10px; padding-top:8px; border-top:1px solid var(--di-border-light, #eee);">
    <strong>Dashboard Theme</strong>
    <select id="dark-mode-select" style="width:100%; margin-top:4px; padding:3px; border:1px solid var(--di-border-input, #ddd); border-radius:3px; background:var(--di-bg, #fff); color:var(--di-text, #333); font-size:11px;">
      <option value="auto">Auto (follow Danbooru)</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </div>
`;
  function createBodyTooltip(className) {
    const existing = document.body.querySelector(`.${className}`);
    if (existing) return existing;
    const tooltip = document.createElement("div");
    tooltip.className = className;
    tooltip.style.position = "absolute";
    tooltip.style.opacity = "0";
    tooltip.style.pointerEvents = "none";
    tooltip.style.zIndex = "2147483647";
    document.body.appendChild(tooltip);
    return tooltip;
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
  function removeToast(el2) {
    el2.classList.remove("di-toast-visible");
    el2.classList.add("di-toast-exit");
    const onEnd = () => {
      el2.removeEventListener("transitionend", onEnd);
      el2.remove();
      const idx = activeToasts.indexOf(el2);
      if (idx !== -1) activeToasts.splice(idx, 1);
    };
    el2.addEventListener("transitionend", onEnd);
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
    const el2 = document.createElement("div");
    el2.className = `di-toast di-toast-${type}`;
    const msgSpan = document.createElement("span");
    msgSpan.className = "di-toast-message";
    msgSpan.textContent = message;
    el2.appendChild(msgSpan);
    let actionTriggered = false;
    let onCloseFired = false;
    const fireOnCloseOnce = () => {
      if (actionTriggered || onCloseFired) return;
      onCloseFired = true;
      if (options.onClose) options.onClose();
    };
    if (options.actions && options.actions.length > 0) {
      for (const action of options.actions) {
        const btn = document.createElement("button");
        btn.className = "di-toast-action";
        btn.textContent = action.label;
        btn.addEventListener("click", () => {
          actionTriggered = true;
          action.onClick();
          removeToast(el2);
        });
        el2.appendChild(btn);
      }
    }
    const closeBtn = document.createElement("button");
    closeBtn.className = "di-toast-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      fireOnCloseOnce();
      removeToast(el2);
    });
    el2.appendChild(closeBtn);
    parent.appendChild(el2);
    activeToasts.push(el2);
    requestAnimationFrame(() => {
      el2.classList.add("di-toast-visible");
    });
    if (duration > 0) {
      setTimeout(() => {
        if (document.body.contains(el2)) {
          fireOnCloseOnce();
          removeToast(el2);
        }
      }, duration);
    }
  }
  const METRIC_LABEL$1 = {
    uploads: "Uploads",
    approvals: "Approvals",
    notes: "Notes"
  };
  const LEVEL_COLORS = ["#9be9a8", "#40c463", "#30a14e", "#216e39"];
  const LEVEL_TUNING_LABEL = ["≥1", "P40", "P70", "P90"];
  function showThresholdPreviewModal(args) {
    const { metric, current, proposed, themeKey, onApply } = args;
    const backdrop = document.createElement("div");
    backdrop.className = "di-tt-modal-backdrop";
    const card = document.createElement("div");
    card.className = "di-tt-modal";
    const header = document.createElement("div");
    header.className = "di-tt-modal-header";
    header.textContent = `Auto-tune ${METRIC_LABEL$1[metric]}`;
    card.appendChild(header);
    const body = document.createElement("div");
    body.className = "di-tt-modal-body";
    const intro = document.createElement("div");
    intro.className = "di-tt-modal-intro";
    intro.textContent = "Based on this user's last 180 days of activity:";
    body.appendChild(intro);
    const table = document.createElement("div");
    table.className = "di-tt-modal-table";
    const headerRow = document.createElement("div");
    headerRow.className = "di-tt-modal-trow di-tt-modal-trow-head";
    headerRow.innerHTML = '<div class="di-tt-modal-tcol-swatch"></div><div class="di-tt-modal-tcol-label"></div><div class="di-tt-modal-tcol-val">Now</div><div class="di-tt-modal-tcol-arrow"></div><div class="di-tt-modal-tcol-val">New</div>';
    table.appendChild(headerRow);
    for (let i = 0; i < 4; i++) {
      const row = document.createElement("div");
      row.className = "di-tt-modal-trow";
      const changed = current[i] !== proposed[i];
      if (!changed) row.classList.add("di-tt-modal-trow-unchanged");
      const swatch = document.createElement("div");
      swatch.className = "di-tt-modal-tcol-swatch";
      const sw = document.createElement("span");
      sw.className = "di-tt-modal-swatch";
      sw.style.background = LEVEL_COLORS[i];
      swatch.appendChild(sw);
      const label = document.createElement("div");
      label.className = "di-tt-modal-tcol-label";
      const levelText = document.createElement("span");
      levelText.textContent = `Level ${i + 1}`;
      const tuneText = document.createElement("span");
      tuneText.className = "di-tt-modal-tcol-tune";
      tuneText.textContent = ` (${LEVEL_TUNING_LABEL[i]})`;
      label.appendChild(levelText);
      label.appendChild(tuneText);
      const before = document.createElement("div");
      before.className = "di-tt-modal-tcol-val di-tt-modal-tcol-before";
      before.textContent = String(current[i]);
      const arrow = document.createElement("div");
      arrow.className = "di-tt-modal-tcol-arrow";
      if (!changed) {
        arrow.textContent = "=";
      } else if (proposed[i] > current[i]) {
        arrow.textContent = "↑";
        arrow.classList.add("di-tt-modal-arrow-up");
      } else {
        arrow.textContent = "↓";
        arrow.classList.add("di-tt-modal-arrow-down");
      }
      const after = document.createElement("div");
      after.className = "di-tt-modal-tcol-val di-tt-modal-tcol-after";
      after.textContent = String(proposed[i]);
      row.appendChild(swatch);
      row.appendChild(label);
      row.appendChild(before);
      row.appendChild(arrow);
      row.appendChild(after);
      table.appendChild(row);
    }
    body.appendChild(table);
    const foot = document.createElement("div");
    foot.className = "di-tt-modal-foot";
    foot.textContent = "Px = x-th percentile of active-day counts.";
    body.appendChild(foot);
    card.appendChild(body);
    const actions = document.createElement("div");
    actions.className = "di-tt-modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "di-tt-modal-btn di-tt-modal-btn-secondary";
    cancelBtn.textContent = "Cancel";
    const applyBtn = document.createElement("button");
    applyBtn.className = "di-tt-modal-btn di-tt-modal-btn-primary";
    applyBtn.textContent = "Apply";
    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);
    card.appendChild(actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    applyPopoverPalette([backdrop, card], themeKey);
    const close = () => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
      e.stopPropagation();
    });
    card.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    cancelBtn.addEventListener("click", close);
    applyBtn.addEventListener("click", () => {
      onApply(proposed);
      close();
    });
    applyBtn.focus();
  }
  const WINDOW_DAYS = 180;
  const MIN_ACTIVE_DAYS = 14;
  const SATURATION_RATIO = 0.9;
  const MIN_IMPROVEMENT = 0.2;
  function computeAutoThresholds(samples, minSamples = MIN_ACTIVE_DAYS) {
    if (samples.length < minSamples) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const vals = [
      1,
      nearestRank(sorted, 40),
      nearestRank(sorted, 70),
      nearestRank(sorted, 90)
    ];
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] <= vals[i - 1]) vals[i] = vals[i - 1] + 1;
    }
    return vals;
  }
  function nearestRank(sorted, percentile) {
    const n = sorted.length;
    if (n === 0) return 0;
    const idx = Math.max(0, Math.ceil(percentile / 100 * n) - 1);
    return sorted[idx];
  }
  async function fetchActiveDayCounts(db, userId, metric, days = WINDOW_DAYS) {
    const cutoff = isoDateDaysAgo(days);
    const rows = await db[metric].where("userId").equals(userId).and((r) => r.date >= cutoff && r.count > 0).toArray();
    return rows.map((r) => r.count);
  }
  function isoDateDaysAgo(days) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }
  function simulateDistribution(counts, thresholds) {
    const dist = { empty: 0, l1: 0, l2: 0, l3: 0, l4: 0 };
    const [t1, t2, t3, t4] = thresholds;
    for (const c of counts) {
      if (c < t1) dist.empty++;
      else if (c < t2) dist.l1++;
      else if (c < t3) dist.l2++;
      else if (c < t4) dist.l3++;
      else dist.l4++;
    }
    return dist;
  }
  function maxBucketRatio(dist) {
    const buckets = [dist.empty, dist.l1, dist.l2, dist.l3, dist.l4];
    const total = buckets.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    return Math.max(...buckets) / total;
  }
  function wouldTuningImprove(counts, current, proposed, minImprovement = MIN_IMPROVEMENT) {
    const before = maxBucketRatio(simulateDistribution(counts, current));
    const after = maxBucketRatio(simulateDistribution(counts, proposed));
    return before - after >= minImprovement;
  }
  function detectSaturation(counts, thresholds, ratio = SATURATION_RATIO) {
    const total = counts.length;
    if (total === 0) return null;
    let hi = 0;
    let lo = 0;
    for (const c of counts) {
      if (c >= thresholds[3]) hi++;
      else if (c >= thresholds[0] && c < thresholds[1]) lo++;
    }
    if (hi / total >= ratio) return "high";
    if (lo / total >= ratio) return "low";
    return null;
  }
  function mostRecentBoundary(now, interval) {
    const y = now.getFullYear();
    const m = now.getMonth();
    let boundaryMonth = 0;
    switch (interval) {
      case "monthly":
        boundaryMonth = m;
        break;
      case "quarterly":
        boundaryMonth = Math.floor(m / 3) * 3;
        break;
      case "semiannual":
        boundaryMonth = m < 6 ? 0 : 6;
        break;
      case "yearly":
        boundaryMonth = 0;
        break;
    }
    return new Date(y, boundaryMonth, 1, 0, 0, 0, 0);
  }
  const dismissedThisSession = new Set();
  function dismissSuggestion(userId) {
    dismissedThisSession.add(userId);
  }
  function wasDismissed(userId) {
    return dismissedThisSession.has(userId);
  }
  const METRIC_LABEL = {
    uploads: "Uploads",
    approvals: "Approvals",
    notes: "Notes"
  };
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
    for (const el2 of elements) {
      for (const [prop, val] of Object.entries(palette)) {
        el2.style.setProperty(prop, val);
      }
    }
  }
  function buildThemeSection(popover, settingsManager, settingsBtn, handleClose, paletteTargets) {
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
      const options = theme.grassOptions;
      if (!options || !Array.isArray(options)) {
        grassFlyout.style.display = "none";
        return;
      }
      const currentIdx = settingsManager.getGrassIndex(themeKey);
      const title = document.createElement("div");
      title.style.cssText = "font-size:10px;color:var(--di-text-muted, #888);font-weight:600;margin-bottom:2px;";
      title.textContent = "Grass Color";
      grassFlyout.appendChild(title);
      options.forEach((opt, idx) => {
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
          document.querySelectorAll(".theme-icon").forEach((el2) => el2.classList.remove("active"));
          icon.classList.add("active");
          applyPopoverPalette(paletteTargets, key);
        }
        toggleGrassFlyout(icon, key);
      };
      grid.appendChild(icon);
    });
    popover.appendChild(grid);
    document.addEventListener(
      "click",
      createClickOutsideHandler(
        popover,
        () => {
          if (popover.style.display === "block") handleClose();
        },
        { ignore: [settingsBtn, grassFlyout] }
      )
    );
    popover.addEventListener("click", (e) => {
      const target = e.target;
      if (!grassFlyout.contains(target) && !target.closest(".theme-icon")) {
        grassFlyout.style.display = "none";
      }
    });
    return { grassFlyout };
  }
  function buildSnapToggle(popover, settingsManager) {
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
  }
  function buildThresholdsSection(popover, options, markSettingsChanged) {
    const { settingsManager, db, metric, targetUserId, closeSettings } = options;
    const validateThresholds = () => {
      const modes = ["uploads", "approvals", "notes"];
      for (const m of modes) {
        const vals = settingsManager.getThresholdsForView(targetUserId, m);
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
    const threshHeaderRow = document.createElement("div");
    threshHeaderRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;margin-bottom:6px;border-top:1px solid var(--di-border-input, #ddd);";
    const threshHeader = document.createElement("div");
    threshHeader.className = "popover-header";
    threshHeader.style.margin = "0";
    threshHeader.textContent = "Set thresholds";
    threshHeaderRow.appendChild(threshHeader);
    const autoTuneBtn = document.createElement("button");
    autoTuneBtn.className = "di-autotune-btn";
    autoTuneBtn.title = "Auto-tune from this user's recent 180-day activity";
    autoTuneBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>';
    threshHeaderRow.appendChild(autoTuneBtn);
    popover.appendChild(threshHeaderRow);
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
      const metricMode = mode;
      const vals = settingsManager.getThresholdsForView(targetUserId, metricMode);
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
          const newVals = [vals[0], vals[1], vals[2], vals[3]];
          newVals[idx] = parseInt(input.value);
          if (settingsManager.hasProfileThresholds(targetUserId, metricMode)) {
            settingsManager.setProfileThresholds(
              targetUserId,
              metricMode,
              newVals
            );
          } else {
            settingsManager.setThresholds(metricMode, newVals);
          }
          markSettingsChanged();
          vals[idx] = newVals[idx];
        };
        row.appendChild(label);
        row.appendChild(input);
        editor.appendChild(row);
      });
    };
    modeSelect.addEventListener("change", () => renderEditor(modeSelect.value));
    renderEditor(modeSelect.value);
    autoTuneBtn.addEventListener("click", async () => {
      const currentMetric = modeSelect.value;
      autoTuneBtn.disabled = true;
      try {
        const samples = await fetchActiveDayCounts(
          db,
          targetUserId,
          currentMetric
        );
        const proposed = computeAutoThresholds(samples);
        if (proposed === null) {
          showToast({
            type: "warn",
            message: `Not enough activity data for ${currentMetric} (need ≥${MIN_ACTIVE_DAYS} active days in last 180).`
          });
          return;
        }
        const current = settingsManager.getThresholdsForView(
          targetUserId,
          currentMetric
        );
        if (proposed.every((v, i) => v === current[i])) {
          showToast({
            type: "info",
            message: `${METRIC_LABEL[currentMetric]} thresholds already match the recent activity — nothing to change.`
          });
          return;
        }
        showThresholdPreviewModal({
          metric: currentMetric,
          current,
          proposed,
          themeKey: settingsManager.getTheme(),
          onApply: (values) => {
            applyAndOfferUndo(currentMetric, current, values);
          }
        });
      } finally {
        autoTuneBtn.disabled = false;
      }
    });
    function applyAndOfferUndo(metric2, previousValues, nextValues) {
      const hadOverride = settingsManager.hasProfileThresholds(
        targetUserId,
        metric2
      );
      settingsManager.setProfileThresholds(targetUserId, metric2, nextValues);
      settingsManager.setProfileTuneTime(targetUserId, metric2, Date.now());
      renderEditor(modeSelect.value);
      closeSettings();
      showToast({
        type: "success",
        message: `${METRIC_LABEL[metric2]} thresholds tuned for this profile.`,
        duration: 8e3,
        actions: [
          {
            label: "Undo",
            onClick: () => {
              if (hadOverride) {
                settingsManager.setProfileThresholds(
                  targetUserId,
                  metric2,
                  previousValues
                );
              } else {
                settingsManager.clearProfileThreshold(targetUserId, metric2);
              }
              dismissSuggestion(targetUserId);
              renderEditor(modeSelect.value);
              closeSettings();
            }
          }
        ]
      });
    }
    return { modeSelect, renderEditor, validateThresholds };
  }
  function buildAutoTuneSection(popover, settingsManager) {
    const scheduleRow = document.createElement("div");
    scheduleRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:12px;";
    const schedCheckbox = document.createElement("input");
    schedCheckbox.type = "checkbox";
    schedCheckbox.id = "di-autotune-schedule";
    schedCheckbox.style.cssText = "margin:0;cursor:pointer;";
    const schedLabelLeft = document.createElement("label");
    schedLabelLeft.htmlFor = "di-autotune-schedule";
    schedLabelLeft.textContent = "Auto-tune every";
    schedLabelLeft.style.cssText = "font-size:11px;color:var(--di-text, #333);cursor:pointer;user-select:none;";
    const schedSelect = document.createElement("select");
    schedSelect.style.cssText = "font-size:11px;line-height:1;padding:2px 4px;margin:0;height:20px;border:1px solid var(--di-border-input, #ddd);border-radius:4px;background:var(--di-bg-tertiary, #f0f0f0);color:var(--di-text, #333);flex:0 0 auto;cursor:pointer;";
    const intervalOptions = [
      ["monthly", "Month"],
      ["quarterly", "Quarter"],
      ["semiannual", "Half year"],
      ["yearly", "Year"]
    ];
    for (const [value, label] of intervalOptions) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      schedSelect.appendChild(opt);
    }
    const initialSchedule = settingsManager.getAutoTuneSchedule();
    schedCheckbox.checked = initialSchedule.enabled;
    schedSelect.value = initialSchedule.interval;
    schedSelect.disabled = !initialSchedule.enabled;
    const persistSchedule = () => {
      settingsManager.setAutoTuneSchedule({
        enabled: schedCheckbox.checked,
        interval: schedSelect.value
      });
    };
    schedCheckbox.onchange = () => {
      schedSelect.disabled = !schedCheckbox.checked;
      persistSchedule();
    };
    schedSelect.onchange = () => {
      persistSchedule();
    };
    const schedHelp = document.createElement("span");
    schedHelp.textContent = "?";
    schedHelp.setAttribute("role", "button");
    schedHelp.setAttribute("aria-label", "Schedule interval reference");
    schedHelp.setAttribute("tabindex", "0");
    schedHelp.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--di-bg-tertiary, #f0f0f0);color:var(--di-text-muted, #888);font-size:10px;font-weight:600;cursor:help;border:1px solid var(--di-border-input, #ddd);flex:0 0 auto;user-select:none;";
    const schedHelpTip = document.createElement("div");
    schedHelpTip.style.cssText = "position:fixed;display:none;z-index:10005;background:var(--di-bg, #fff);color:var(--di-text, #333);border:1px solid var(--di-border-input, #ddd);border-radius:6px;padding:8px 10px;font-size:11px;line-height:1.55;box-shadow:0 4px 12px var(--di-shadow, rgba(0,0,0,0.2));max-width:240px;";
    schedHelpTip.innerHTML = "<div><strong>Monthly</strong> · 1st of every month</div><div><strong>Quarterly</strong> · 1st of Jan / Apr / Jul / Oct</div><div><strong>Half year</strong> · 1st of Jan / Jul</div><div><strong>Yearly</strong> · 1st of Jan</div>";
    document.body.appendChild(schedHelpTip);
    const positionSchedHelpTip = () => {
      const r = schedHelp.getBoundingClientRect();
      schedHelpTip.style.visibility = "hidden";
      schedHelpTip.style.display = "block";
      const tw = schedHelpTip.offsetWidth;
      const vw = window.innerWidth;
      let left = r.right - tw;
      if (left < 8) left = 8;
      if (left + tw > vw - 8) left = vw - tw - 8;
      schedHelpTip.style.left = left + "px";
      schedHelpTip.style.top = r.bottom + 6 + "px";
      schedHelpTip.style.visibility = "visible";
    };
    const showSchedHelpTip = () => {
      positionSchedHelpTip();
    };
    const hideSchedHelpTip = () => {
      schedHelpTip.style.display = "none";
    };
    schedHelpTip.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    schedHelp.addEventListener("mouseenter", showSchedHelpTip);
    schedHelp.addEventListener("mouseleave", hideSchedHelpTip);
    schedHelp.addEventListener("click", (e) => {
      e.stopPropagation();
      if (schedHelpTip.style.display === "block") {
        hideSchedHelpTip();
      } else {
        showSchedHelpTip();
      }
    });
    schedHelp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        showSchedHelpTip();
      } else if (e.key === "Escape") {
        hideSchedHelpTip();
      }
    });
    document.addEventListener("click", (e) => {
      if (schedHelpTip.style.display !== "block") return;
      const t = e.target;
      if (t !== schedHelp && !schedHelpTip.contains(t)) hideSchedHelpTip();
    });
    scheduleRow.appendChild(schedCheckbox);
    scheduleRow.appendChild(schedLabelLeft);
    scheduleRow.appendChild(schedSelect);
    scheduleRow.appendChild(schedHelp);
    popover.appendChild(scheduleRow);
    return { schedHelpTip };
  }
  function buildCacheInfoSection(popover, db, onRefresh) {
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
  }
  function createSettingsPopover(options) {
    const { settingsManager, settingsBtn, closeSettings } = options;
    const popover = document.createElement("div");
    popover.id = "danbooru-grass-settings-popover";
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
    let settingsChanged = false;
    let validateThresholds = () => ({
      valid: true
    });
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
    const paletteTargets = [popover];
    const { grassFlyout } = buildThemeSection(
      popover,
      settingsManager,
      settingsBtn,
      handleClose,
      paletteTargets
    );
    paletteTargets.push(grassFlyout);
    buildSnapToggle(popover, settingsManager);
    const thresholdsAPI = buildThresholdsSection(popover, options, () => {
      settingsChanged = true;
    });
    validateThresholds = thresholdsAPI.validateThresholds;
    const { schedHelpTip } = buildAutoTuneSection(popover, settingsManager);
    paletteTargets.push(schedHelpTip);
    buildCacheInfoSection(popover, options.db, options.onRefresh);
    applyPopoverPalette(paletteTargets, settingsManager.getTheme());
    return {
      popover,
      close: handleClose,
      refresh: (mainMetric) => {
        if (mainMetric && ["uploads", "approvals", "notes"].includes(mainMetric) && thresholdsAPI.modeSelect.value !== mainMetric) {
          thresholdsAPI.modeSelect.value = mainMetric;
        }
        thresholdsAPI.renderEditor(thresholdsAPI.modeSelect.value);
      }
    };
  }
  function escapeHtml$1(text) {
    const el2 = document.createElement("div");
    el2.textContent = text;
    return el2.innerHTML;
  }
  async function isTopLevelTag(rateLimiter, tagName) {
    const impUrl = `/tag_implications.json?search[antecedent_name_matches]=${encodeURIComponent(tagName)}&search[status]=active`;
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
      if (inside.some((el2) => el2?.contains(target))) return;
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
  const RATING_LABELS$1 = {
    g: "General",
    s: "Sensitive",
    q: "Questionable",
    e: "Explicit"
  };
  const ensureCard = () => {
    let el2 = document.getElementById(cardId);
    if (el2) return el2;
    el2 = document.createElement("div");
    el2.id = cardId;
    el2.style.cssText = [
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
    document.body.appendChild(el2);
    return el2;
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
    const rating = post.rating ? RATING_LABELS$1[post.rating] ?? post.rating : "?";
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
  function attachPostHoverCard(el2, postId, fetcher, positionRef) {
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
    el2.addEventListener("mouseenter", () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      const token = ++currentToken;
      debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        const details = await fetchWithCache(postId, fetcher);
        if (token !== currentToken) return;
        if (!details) return;
        const card = ensureCard();
        card.innerHTML = buildCardHtml(details);
        positionCard(card, el2, positionRef ?? el2);
      }, 100);
    });
    el2.addEventListener("mouseleave", hide);
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
    const closeHandler = createClickOutsideHandler(pop, () => {
      pop.style.setProperty("display", "none", "important");
      hidePostHoverCard();
      document.removeEventListener("mousedown", closeHandler);
    });
    setTimeout(() => {
      document.addEventListener("mousedown", closeHandler);
    }, 100);
  }
  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  function metricLabel(metric) {
    switch (metric) {
      case "uploads":
        return "Uploads";
      case "approvals":
        return "Approvals";
      case "notes":
        return "Notes";
      default:
        return metric;
    }
  }
  function monthLongName(month) {
    return MONTH_NAMES[month] ?? "";
  }
  function monthPrefix(year, month) {
    return `${year}-${String(month + 1).padStart(2, "0")}-`;
  }
  function sumMonth(daily, prefix) {
    let total = 0;
    for (const [date, count] of Object.entries(daily)) {
      if (date.startsWith(prefix)) total += count;
    }
    return total;
  }
  function denominatorDaysFor(year, month, today) {
    const todayY = today.getFullYear();
    const todayM = today.getMonth();
    if (year > todayY || year === todayY && month > todayM) return 0;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    if (year === todayY && month === todayM) {
      return Math.min(today.getDate(), daysInMonth);
    }
    return daysInMonth;
  }
  function buildSeries(daily, year, month, today, denominatorDays) {
    if (denominatorDaysFor(year, month, today) === 0) return [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prefix = monthPrefix(year, month);
    const dayCounts = new Array(daysInMonth).fill(0);
    let lastDayWithData = 0;
    for (const [date, count] of Object.entries(daily)) {
      if (!date.startsWith(prefix)) continue;
      const day = parseInt(date.slice(8, 10), 10);
      if (!(day >= 1 && day <= daysInMonth)) continue;
      dayCounts[day - 1] = count;
      if (count > 0) lastDayWithData = Math.max(lastDayWithData, day);
    }
    const days = Math.min(
      daysInMonth,
      Math.max(denominatorDays, lastDayWithData)
    );
    return dayCounts.slice(0, days);
  }
  function buildYearSeries(daily, year, today) {
    if (year > today.getFullYear()) return [];
    const totals = new Array(12).fill(0);
    let lastMonthWithData = -1;
    for (const [date, count] of Object.entries(daily)) {
      if (!date.startsWith(`${year}-`)) continue;
      const index = parseInt(date.slice(5, 7), 10) - 1;
      if (!(index >= 0 && index <= 11)) continue;
      totals[index] += count;
      if (count > 0) lastMonthWithData = Math.max(lastMonthWithData, index);
    }
    const elapsed = year === today.getFullYear() ? today.getMonth() + 1 : 12;
    const months = Math.min(12, Math.max(elapsed, lastMonthWithData + 1));
    return totals.slice(0, months);
  }
  function computeMonthStats(daily, year, month, opts) {
    const { today, metric } = opts;
    const prefix = monthPrefix(year, month);
    let denominatorDays = denominatorDaysFor(year, month, today);
    let total = 0;
    let activeDays = 0;
    let busiest = null;
    for (const [date, count] of Object.entries(daily)) {
      if (!date.startsWith(prefix)) continue;
      total += count;
      if (count > 0) {
        activeDays += 1;
        if (busiest === null || count > busiest.count || count === busiest.count && date < busiest.date) {
          busiest = { date, count };
        }
      }
    }
    denominatorDays = Math.max(denominatorDays, activeDays);
    const series = buildSeries(daily, year, month, today, denominatorDays);
    const yearSeries = buildYearSeries(daily, year, today);
    const activeRatio = denominatorDays > 0 ? activeDays / denominatorDays : 0;
    const average = denominatorDays > 0 ? Math.round(total / denominatorDays * 10) / 10 : 0;
    let momPct = null;
    let momIsNew = false;
    if (month > 0) {
      const prevTotal = sumMonth(daily, monthPrefix(year, month - 1));
      if (prevTotal > 0) {
        momPct = Math.round((total - prevTotal) / prevTotal * 100);
      } else if (total > 0) {
        momIsNew = true;
      }
    }
    return {
      year,
      month,
      metric,
      total,
      activeDays,
      denominatorDays,
      activeRatio,
      busiest,
      average,
      momPct,
      momIsNew,
      empty: total === 0,
      series,
      yearSeries
    };
  }
  const CACHE_PREFIX = "di.grass.dec";
  const PAGE_LIMIT = 1e3;
  const MAX_PAGES = 3;
  function cacheKeyFor(userId, metric, year) {
    return `${CACHE_PREFIX}.${userId}.${metric}.${year}`;
  }
  function decemberRange(year) {
    return `${year}-12-01...${year + 1}-01-01`;
  }
  function readMemo(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      const value = parseInt(raw, 10);
      return Number.isFinite(value) ? value : null;
    } catch (e) {
      return null;
    }
  }
  function writeMemo(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {
    }
  }
  async function countByPaging(dataManager, metric, user, year) {
    const endpoint = metric === "approvals" ? "/post_approvals.json" : "/note_versions.json";
    const idParam = metric === "approvals" ? "search[user_id]" : "search[updater_id]";
    if (!user.id) return null;
    let total = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        limit: String(PAGE_LIMIT),
        page: String(page),
        [idParam]: String(user.id),
        "search[created_at]": decemberRange(year),
        only: "id"
      });
      const resp = await dataManager.rateLimiter.fetch(
        `${endpoint}?${params.toString()}`
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const rows = await resp.json();
      if (!Array.isArray(rows)) return null;
      total += rows.length;
      if (rows.length < PAGE_LIMIT) return total;
    }
    return null;
  }
  async function fetchDecemberTotal(dataManager, user, metric, year) {
    try {
      if (metric === "uploads") {
        const name = (user.name || "").replace(/ /g, "_");
        if (!name) return null;
        return await dataManager.fetchRemoteCount(
          `user:${name} date:${decemberRange(year)}`
        );
      }
      return await countByPaging(dataManager, metric, user, year);
    } catch (e) {
      return null;
    }
  }
  async function resolvePrevDecemberTotal(args) {
    const { dataManager, user, metric, year } = args;
    const userId = user.id || user.name;
    if (!userId) return null;
    if (await dataManager.checkYearCompletion(userId, metric, year)) {
      return dataManager.sumDailyCounts(
        metric,
        userId,
        `${year}-12-01`,
        `${year}-12-31`
      );
    }
    const key = cacheKeyFor(userId, metric, year);
    const memo = readMemo(key);
    if (memo !== null) return memo;
    const fetched = await fetchDecemberTotal(dataManager, user, metric, year);
    if (fetched === null) return null;
    writeMemo(key, fetched);
    return fetched;
  }
  const POPOVER_ID = "danbooru-grass-month-popover";
  const WIDTH = 272;
  const SPARK_W = 96;
  const SPARK_H = 30;
  const BAR_STEP = 3;
  const BAR_W = 2;
  const MIN_BAR_H = 1.5;
  const TREND_PAD = 4;
  const TREND_DOT_R = 1.2;
  const TREND_NOW_R = 3.6;
  const HIDE_GRACE_MS$2 = 400;
  const FADE_MS$2 = 200;
  let el = null;
  let hideTimer = null;
  let fadeTimer = null;
  function clearTimers() {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (fadeTimer !== null) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
  }
  function ensureEl() {
    if (el && document.body.contains(el)) return el;
    const node = document.createElement("div");
    node.id = POPOVER_ID;
    node.className = "di-grass-month-popover";
    node.style.opacity = "0";
    node.addEventListener("mouseenter", keepGrassMonthPopoverOpen);
    node.addEventListener("mouseleave", scheduleHideGrassMonthPopover);
    document.body.appendChild(node);
    el = node;
    return node;
  }
  function trendCurrentClass(stats) {
    if (stats.momIsNew) return "di-gmp-trend-up";
    if (stats.momPct === null) return "di-gmp-trend-current";
    if (stats.momPct > 0) return "di-gmp-trend-up";
    if (stats.momPct < 0) return "di-gmp-trend-down";
    return "di-gmp-trend-current";
  }
  function yearTrendSvg(stats) {
    const { yearSeries } = stats;
    const peak = yearSeries.reduce((max, v) => v > max ? v : max, 0);
    if (yearSeries.length === 0 || peak <= 0) return "";
    const innerW = SPARK_W - TREND_PAD * 2;
    const innerH = SPARK_H - TREND_PAD * 2;
    const stepX = yearSeries.length > 1 ? innerW / (yearSeries.length - 1) : 0;
    const xAt = (i) => yearSeries.length > 1 ? TREND_PAD + i * stepX : SPARK_W / 2;
    const yAt = (v) => TREND_PAD + innerH - v / peak * innerH;
    const points = yearSeries.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
    const dots = yearSeries.map(
      (v, i) => `<circle class="di-gmp-trend-dot" cx="${xAt(i).toFixed(1)}" cy="${yAt(
      v
    ).toFixed(1)}" r="${TREND_DOT_R}"></circle>`
    ).join("");
    const now = stats.month < yearSeries.length ? `<circle class="di-gmp-trend-now ${trendCurrentClass(
    stats
  )}" cx="${xAt(stats.month).toFixed(1)}" cy="${yAt(
    yearSeries[stats.month]
  ).toFixed(1)}" r="${TREND_NOW_R}"></circle>` : "";
    return `<svg class="di-gmp-spark di-gmp-trend" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" aria-hidden="true"><polyline class="di-gmp-trend-line" points="${points}"></polyline>${dots}${now}</svg>`;
  }
  function momFragment(stats) {
    if (stats.momIsNew) {
      return '<span class="di-gmp-mom di-gmp-mom--new">new</span>';
    }
    if (stats.momPct === null) return "";
    const prev = monthLongName((stats.month + 11) % 12);
    const up = stats.momPct > 0;
    const down = stats.momPct < 0;
    const arrow = up ? "▲" : down ? "▼" : "±";
    const mod = up ? "up" : down ? "down" : "flat";
    return `<span class="di-gmp-mom di-gmp-mom--${mod}">${arrow} ${Math.abs(
    stats.momPct
  )}% vs ${prev}</span>`;
  }
  function sparklineSvg(stats) {
    const { series } = stats;
    const peak = series.reduce((max, v) => v > max ? v : max, 0);
    if (series.length === 0 || peak <= 0) return "";
    const used = series.length * BAR_STEP - (BAR_STEP - BAR_W);
    const offsetX = Math.max(0, (SPARK_W - used) / 2);
    const peakDay = stats.busiest ? parseInt(stats.busiest.date.slice(8, 10), 10) : -1;
    const bars = series.map((count, i) => {
      if (count <= 0) return "";
      const h = Math.max(MIN_BAR_H, count / peak * SPARK_H);
      const x = offsetX + i * BAR_STEP;
      const cls = i + 1 === peakDay ? ' class="di-gmp-spark-peak"' : "";
      return `<rect${cls} x="${x.toFixed(1)}" y="${(SPARK_H - h).toFixed(
      1
    )}" width="${BAR_W}" height="${h.toFixed(1)}" rx="1"></rect>`;
    }).join("");
    return `<svg class="di-gmp-spark" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" aria-hidden="true">${bars}</svg>`;
  }
  function busiestText(stats) {
    if (!stats.busiest) return "—";
    const day = parseInt(stats.busiest.date.slice(8, 10), 10);
    return `${monthLongName(stats.month)} ${day} — ${stats.busiest.count.toLocaleString()}`;
  }
  function renderContent(stats, caretLeft) {
    const header = `${monthLongName(stats.month)} ${stats.year} · ${metricLabel(
    stats.metric
  )}`;
    const caret = `<div class="di-gmp-caret" style="left:${caretLeft}px"></div>`;
    if (stats.empty) {
      return `${caret}
      <div class="di-gmp-header">${header}</div>
      <div class="di-gmp-empty">No activity in ${monthLongName(stats.month)}</div>`;
    }
    const ratioPct = Math.round(
      Math.min(1, Math.max(0, stats.activeRatio)) * 100
    );
    return `${caret}
    <div class="di-gmp-header">
      <span>${header}</span>
      ${yearTrendSvg(stats)}
    </div>
    <div class="di-gmp-headline">
      <div class="di-gmp-headline-main">
        <span class="di-gmp-total">${stats.total.toLocaleString()}</span>
        ${momFragment(stats)}
      </div>
      ${sparklineSvg(stats)}
    </div>
    <div class="di-gmp-rows">
      <div class="di-gmp-row">
        <span class="di-gmp-k">Active</span>
        <span class="di-gmp-v">${stats.activeDays} / ${stats.denominatorDays} days</span>
      </div>
      <div class="di-gmp-bar"><div class="di-gmp-bar-fill" style="width:${ratioPct}%"></div></div>
      <div class="di-gmp-row">
        <span class="di-gmp-k">Busiest</span>
        <span class="di-gmp-v">${busiestText(stats)}</span>
      </div>
      <div class="di-gmp-row">
        <span class="di-gmp-k">Average</span>
        <span class="di-gmp-v">${stats.average} / day</span>
      </div>
    </div>`;
  }
  function showGrassMonthPopover(opts) {
    clearTimers();
    const node = ensureEl();
    node.classList.remove("di-grass-month-popover--fading");
    applyPopoverChrome(node, { width: `${WIDTH}px`, zIndex: "10002" });
    node.style.transition = `opacity ${FADE_MS$2}ms ease`;
    const { top, left, caretLeft } = calcPopoverPositionBelow(opts.anchor, WIDTH);
    node.innerHTML = renderContent(opts.stats, caretLeft);
    node.style.top = `${top}px`;
    node.style.left = `${left}px`;
    applyPopoverPalette([node], opts.themeKey);
    requestAnimationFrame(() => {
      if (el) el.style.opacity = "1";
    });
  }
  function scheduleHideGrassMonthPopover() {
    clearTimers();
    hideTimer = setTimeout(() => {
      if (el) {
        el.classList.add("di-grass-month-popover--fading");
        el.style.opacity = "0";
      }
      fadeTimer = setTimeout(hideGrassMonthPopover, FADE_MS$2);
    }, HIDE_GRACE_MS$2);
  }
  function keepGrassMonthPopoverOpen() {
    clearTimers();
    if (el) {
      el.classList.remove("di-grass-month-popover--fading");
      el.style.opacity = "1";
    }
  }
  function hideGrassMonthPopover() {
    clearTimers();
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }
  function isGrassMonthPopoverVisible() {
    return el !== null && document.body.contains(el);
  }
  function isGrassMonthPopoverHidePending() {
    return hideTimer !== null || fadeTimer !== null;
  }
  const log$b = createLogger("GraphRenderer");
  const GRASS_INLINE_CSS = `
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
  function ensureGrassStyles() {
    const styleId = "danbooru-grass-styles";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = GRASS_INLINE_CSS;
    document.head.appendChild(style);
  }
  function renderGrassHeader(args) {
    const { header, total, year, availableYears, onYearChange } = args;
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
  function buildGrassUrlBuilder(metric, sanitizedName, userIdVal) {
    return (date, _count) => {
      if (!date) return null;
      switch (metric) {
        case "uploads":
          return `/posts?tags=user:${sanitizedName}+date:${date}`;
        case "approvals":
          return "#";
        case "notes": {
          const next = new Date(`${date}T00:00:00Z`);
          next.setUTCDate(next.getUTCDate() + 1);
          const nextDate = next.toISOString().slice(0, 10);
          return `/note_versions?search[updater_id]=${userIdVal}&search[created_at]=${date}..${nextDate}`;
        }
        default:
          return null;
      }
    };
  }
  function injectGrassDayLabels(container2) {
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
  }
  function updateGrassTooltip(tooltip, event, content) {
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
  }
  function updateGrassTooltipTouch(tooltip, touch, content) {
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
  }
  function buildPaintConfig(args) {
    const { scrollWrapper, year, source, thresholds, settingsManager } = args;
    return {
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
          range: settingsManager.resolveLevels(
            settingsManager.getTheme(),
            CONFIG.THEMES[settingsManager.getTheme()] || CONFIG.THEMES.light
          ),
          domain: thresholds,
          type: "threshold"
        }
      },
      theme: "light"
    };
  }
  function findStatisticsAnchor() {
    let stats = document.querySelector(CONFIG.SELECTORS.STATISTICS_SECTION);
    if (!stats) {
      const table = document.querySelector(
        "#a-show > div:nth-child(1) > div:nth-child(2) > table"
      );
      if (table) stats = table.parentElement;
    }
    if (!stats) {
      document.querySelectorAll("h1, h2").forEach((el2) => {
        if (el2.textContent?.trim() === "Statistics") stats = el2.parentElement;
      });
    }
    return stats;
  }
  function ensureGrassWrapper(stats) {
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
    return wrapper;
  }
  function createGrassMeasurers(args) {
    const { container: container2, hourlyPanelMinWidth, getCurrentYear } = args;
    let cachedNaturalWidth = null;
    let cachedCurrentToDecWidth = null;
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
    const measureCurrentToDecWidth = () => {
      if (cachedCurrentToDecWidth !== null) return cachedCurrentToDecWidth;
      const heatmapEl = container2.querySelector(
        "#cal-heatmap"
      );
      if (!heatmapEl) return null;
      const domains = heatmapEl.querySelectorAll(".ch-domain");
      if (domains.length === 0) return null;
      const isCurrentYear = getCurrentYear() === ( new Date()).getFullYear();
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
      if (!panel) return hourlyPanelMinWidth;
      const w = panel.offsetWidth;
      return w > 0 ? w : hourlyPanelMinWidth;
    };
    const resetCaches = () => {
      cachedNaturalWidth = null;
      cachedCurrentToDecWidth = null;
    };
    return {
      measureNaturalWidth,
      measureCurrentToDecWidth,
      measureHourlyMinWidth,
      resetCaches
    };
  }
  function createApplyConstraints(args) {
    const {
      container: container2,
      wrapper,
      stats,
      layout,
      getSavedLayoutMode,
      measureNaturalWidth,
      measureHourlyMinWidth
    } = args;
    return () => {
      const wrapperWidth = wrapper.offsetWidth;
      const statsWidth = stats.offsetWidth;
      const gap = 20;
      const savedLayoutMode = getSavedLayoutMode();
      let isWrapped;
      if (savedLayoutMode !== null) {
        isWrapped = savedLayoutMode === "below";
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
      if (layout.savedWidth) {
        const numericWidth = parseFloat(String(layout.savedWidth));
        const clampedWidth = Math.max(
          minWidth,
          Math.min(numericWidth, naturalCap, maxAvailableWidth)
        );
        container2.style.flex = "0 0 auto";
        container2.style.width = `${clampedWidth}px`;
        const clampedX = Math.max(
          0,
          Math.min(layout.savedX ?? 0, maxAvailableWidth - clampedWidth)
        );
        container2.style.transform = `translateX(${clampedX}px)`;
      } else {
        if (natural !== null) {
          const target = Math.max(minWidth, Math.min(natural, maxAvailableWidth));
          container2.style.flex = "0 0 auto";
          container2.style.width = `${target}px`;
        } else {
          container2.style.flex = "1";
        }
        container2.style.transform = "translateX(0px)";
      }
    };
  }
  function attachLayoutResizeObserver(args) {
    const { wrapper, applyConstraints, syncPanelPosition } = args;
    if (typeof ResizeObserver === "undefined") return;
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
  function ensureGlobalTooltip() {
    if (document.getElementById("danbooru-grass-tooltip")) return;
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
  class GraphRenderer {
    containerId;
    cal;
    settingsManager;
    db;
    dataManager;
reapplyGraphConstraints = null;
savedLayoutMode = null;
currentYear = null;
currentMetric = "uploads";
currentDailyData = {};
currentUserInfo = null;
monthPopoverGeneration = 0;
hourlyTap = null;
hourlyTouchAbort = null;
legendTap = null;
legendTouchAbort = null;
postPaintTimeoutId = null;
monthLabelTouchAbort = null;
activeTapMonth = null;
themeChangeHandler = null;
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
      const stats = findStatisticsAnchor();
      if (!stats) {
        log$b.error("Injection point not found");
        return false;
      }
      const wrapper = ensureGrassWrapper(stats);
      const container2 = document.createElement("div");
      container2.id = this.containerId;
      container2.style.position = "relative";
      const grassSettings = await dataManager.getGrassSettings(userId);
      this.savedLayoutMode = grassSettings?.layoutMode ?? null;
      const layout = {
        inlineWidth: grassSettings?.inlineWidth ?? (typeof grassSettings?.width === "number" ? grassSettings.width : null),
        inlineX: grassSettings?.inlineXOffset ?? grassSettings?.xOffset ?? 0,
        belowWidth: grassSettings?.belowWidth ?? null,
        belowX: grassSettings?.belowXOffset ?? 0,
        savedWidth: null,
        savedX: 0
      };
      layout.savedWidth = this.savedLayoutMode === "below" ? layout.belowWidth : layout.inlineWidth;
      layout.savedX = this.savedLayoutMode === "below" ? layout.belowX : layout.inlineX;
      const persistSettings = () => {
        void dataManager.saveGrassSettings(userId, {
          layoutMode: this.savedLayoutMode,
          inlineWidth: layout.inlineWidth,
          inlineXOffset: layout.inlineX,
          belowWidth: layout.belowWidth,
          belowXOffset: layout.belowX
        });
      };
      const HOURLY_PANEL_MIN_WIDTH = 310;
      const {
        measureNaturalWidth,
        measureCurrentToDecWidth,
        measureHourlyMinWidth,
        resetCaches
      } = createGrassMeasurers({
        container: container2,
        hourlyPanelMinWidth: HOURLY_PANEL_MIN_WIDTH,
        getCurrentYear: () => this.currentYear
      });
      const applyConstraints = createApplyConstraints({
        container: container2,
        wrapper,
        stats,
        layout,
        getSavedLayoutMode: () => this.savedLayoutMode,
        measureNaturalWidth,
        measureHourlyMinWidth
      });
      const syncPanelPosition = () => {
        const panel = document.getElementById("danbooru-grass-panel");
        if (!panel) return;
        const xOffset = parseFloat(
          container2.style.transform?.replace(/translateX\(|px\)/g, "") || "0"
        ) || 0;
        panel.style.marginLeft = xOffset > 0 ? `${xOffset}px` : "0";
      };
      this.reapplyGraphConstraints = () => {
        resetCaches();
        applyConstraints();
        syncPanelPosition();
      };
      setTimeout(() => {
        applyConstraints();
        syncPanelPosition();
      }, 0);
      attachLayoutResizeObserver({ wrapper, applyConstraints, syncPanelPosition });
      container2.style.minWidth = "300px";
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
      const sharedHandleArgs = {
        container: container2,
        wrapper,
        stats,
        layout,
        measureNaturalWidth,
        measureCurrentToDecWidth,
        measureHourlyMinWidth,
        applyConstraints,
        syncPanelPosition,
        persistSettings
      };
      container2.appendChild(
        this.createGrassHandle({
          type: "resize",
          side: "left",
          ...sharedHandleArgs
        })
      );
      container2.appendChild(
        this.createGrassHandle({
          type: "resize",
          side: "right",
          ...sharedHandleArgs
        })
      );
      container2.appendChild(
        this.createGrassHandle({ type: "move", ...sharedHandleArgs })
      );
      const currentTheme = this.settingsManager.getTheme();
      this.settingsManager.applyTheme(currentTheme);
      wrapper.appendChild(container2);
      this.populateSummaryGrid();
      ensureGlobalTooltip();
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
      const legendRow2 = document.createElement("div");
      legendRow2.id = "danbooru-grass-summary-legend";
      legendRow2.style.cssText = `
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 4px;
        margin-top: 6px;
        font-size: 10px;
        color: var(--grass-text, #57606a);
      `;
      legendRow2.innerHTML = '<span style="margin-right:2px">Less</span>' + [0, 1, 2, 3, 4].map(
        (l) => `<div class="legend-rect" data-level="${l}" style="width:10px; height:10px; border-radius:2px; background:var(--grass-level-${l})"></div>`
      ).join("") + '<span style="margin-left:2px">More</span>';
      wrapper.appendChild(legendRow2);
      panel.appendChild(wrapper);
    }
positionTooltipAboveCell(tooltip, cellRect) {
      const tooltipRect = tooltip.getBoundingClientRect();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const viewportWidth = window.innerWidth;
      let left = cellRect.left + scrollX + cellRect.width / 2 - tooltipRect.width / 2;
      let top = cellRect.top + scrollY - tooltipRect.height - 8;
      if (top < scrollY + 5) {
        top = cellRect.bottom + scrollY + 8;
      }
      const maxLeft = scrollX + viewportWidth - tooltipRect.width - 5;
      if (left > maxLeft) left = maxLeft;
      if (left < scrollX + 5) left = scrollX + 5;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }
updateSummaryGrid(hourlyCounts, metric) {
      const grid = document.getElementById("danbooru-grass-summary-grid");
      if (!grid) return;
      const cells = grid.querySelectorAll(".large-grass-cell");
      if (cells.length !== 24) return;
      this.hourlyTouchAbort?.abort();
      this.hourlyTouchAbort = null;
      this.hourlyTap?.destroy();
      this.hourlyTap = null;
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
      const isTouch = isTouchDevice();
      if (isTouch) {
        this.hourlyTouchAbort = new AbortController();
        const hideTooltip = () => {
          const tooltip = document.getElementById("danbooru-grass-tooltip");
          if (tooltip) tooltip.style.opacity = "0";
        };
        this.hourlyTap = createTwoStepTap({
          insideElements: () => [
            grid,
            document.getElementById("danbooru-grass-tooltip")
          ],
          onFirstTap: (hour) => {
            const tooltip = document.getElementById("danbooru-grass-tooltip");
            const cellEl = grid.children[hour];
            if (!tooltip || !cellEl) return;
            const cellCount = hourlyCounts[hour] || 0;
            tooltip.style.opacity = "1";
            tooltip.innerHTML = `<strong>${hour.toString().padStart(2, "0")}:00</strong>, ${cellCount} ${metric}`;
            this.positionTooltipAboveCell(
              tooltip,
              cellEl.getBoundingClientRect()
            );
          },

onSecondTap: () => hideTooltip(),
          onReset: () => hideTooltip(),
          navigateOnSameTap: false
        });
      }
      const signal = this.hourlyTouchAbort?.signal;
      const tap = this.hourlyTap;
      cells.forEach((cell, i) => {
        const count = hourlyCounts[i] || 0;
        let level = 0;
        if (count > 0) {
          level = Math.floor(count / max * 5);
          if (level > 4) level = 4;
        }
        cell.style.background = `var(--grass-level-${level})`;
        cell.removeAttribute("title");
        if (isTouch) {
          cell.onmouseenter = null;
          cell.onmouseleave = null;
          const tracker = new TapTracker();
          cell.addEventListener(
            "touchstart",
            (e) => tracker.onTouchStart(e),
            { passive: true, signal }
          );
          cell.addEventListener(
            "touchmove",
            (e) => tracker.onTouchMove(e),
            { passive: true, signal }
          );
          cell.addEventListener(
            "touchend",
            (e) => {
              if (tracker.onTouchEnd(e)) {
                tap?.tap(i);
              }
            },
            { signal }
          );
        } else {
          cell.onmouseenter = (_e) => {
            const tooltip = document.getElementById("danbooru-grass-tooltip");
            if (!tooltip) return;
            tooltip.style.opacity = "1";
            tooltip.innerHTML = `<strong>${i.toString().padStart(2, "0")}:00</strong>, ${count} ${metric}`;
            this.positionTooltipAboveCell(tooltip, cell.getBoundingClientRect());
          };
          cell.onmouseleave = () => {
            const tooltip = document.getElementById("danbooru-grass-tooltip");
            if (tooltip) tooltip.style.opacity = "0";
          };
        }
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
      const el2 = document.getElementById("grass-loading");
      if (el2) {
        el2.style.display = isLoading ? "block" : "none";
        el2.textContent = message;
      }
      const cal = document.getElementById("cal-heatmap");
      if (cal) cal.style.opacity = isLoading ? "0.5" : "1";
    }






buildGrassFooter(args) {
      const { mainContainer, metric, year, userIdVal, onYearChange, onRefresh } = args;
      if (document.getElementById("danbooru-grass-footer")) return;
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
      const {
        popover,
        close: closeSettings,
        refresh: refreshSettings
      } = createSettingsPopover({
        settingsManager: this.settingsManager,
        db: this.db,
        metric,
        settingsBtn,
        targetUserId: String(userIdVal),
        closeSettings: onSettingsClose,
        onRefresh
      });
      settingsBtn.onclick = (e) => {
        const current = popover.style.display;
        if (current === "block") {
          closeSettings();
        } else {
          refreshSettings(this.currentMetric);
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
schedulePostPaintInteractions(args) {
      if (this.postPaintTimeoutId !== null) {
        clearTimeout(this.postPaintTimeoutId);
      }
      this.postPaintTimeoutId = setTimeout(() => {
        this.postPaintTimeoutId = null;
        const tooltip = d3__namespace.select("#danbooru-grass-tooltip");
        const isTouch = isTouchDevice();
        if (!args.skipScroll) this.scrollToCurrentMonth();
        this.attachCellInteractions({
          tooltip,
          isTouch,
          metric: args.metric,
          userIdVal: args.userIdVal,
          getUrl: args.getUrl
        });
        this.attachLegendInteractions({
          tooltip,
          isTouch,
          metric: args.metric,
          userIdVal: args.userIdVal
        });
        this.attachMonthLabelInteractions({ isTouch });
      }, 300);
    }
attachCellInteractions(args) {
      const { tooltip, isTouch, metric, userIdVal, getUrl } = args;
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
          const count = datum.v ?? 0;
          const dateStr = new Date(datum.t).toISOString().split("T")[0];
          if (metric === "approvals" && count > 0) {
            const node = tooltip.node();
            const rect = node?.getBoundingClientRect();
            const pageX = (rect?.left ?? 0) + window.scrollX;
            const pageY = (rect?.bottom ?? 0) + window.scrollY;
            const synthetic = { pageX, pageY };
            void this.showApprovalsDetail(dateStr, userIdVal, synthetic);
            tooltip.style("opacity", 0);
            return;
          }
          const link = getUrl(dateStr, count);
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
        updateGrassTooltip(
          tooltip,
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
          const link = getUrl(dateStr, count);
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
          const target = document.elementFromPoint(touchStartX, touchStartY);
          if (!target) return;
          const datum = d3__namespace.select(target).datum();
          if (!datum || !datum.t) return;
          calTap.tap(datum);
          const count = datum.v ?? 0;
          const dateStr = new Date(datum.t).toISOString().split("T")[0];
          updateGrassTooltipTouch(
            tooltip,
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
    }
attachLegendInteractions(args) {
      const { tooltip, isTouch, metric, userIdVal } = args;
      const t = this.settingsManager.getThresholdsForView(
        String(userIdVal),
        metric
      );
      const legendThresholds = [
        `${t[0] > 1 ? `0-${t[0] - 1}` : "0"} (Less)`,
        `${t[0]}-${t[1] - 1}`,
        `${t[1]}-${t[2] - 1}`,
        `${t[2]}-${t[3] - 1}`,
        `${t[3]}+ (More)`
      ];
      this.legendTouchAbort?.abort();
      this.legendTouchAbort = null;
      this.legendTap?.destroy();
      this.legendTap = null;
      const legendDivs = d3__namespace.selectAll("#danbooru-grass-legend > div");
      if (isTouch) {
        legendDivs.each(function() {
          const el2 = this;
          el2.style.padding = "7px";
          el2.style.boxSizing = "content-box";
        });
        this.legendTouchAbort = new AbortController();
        const legendSignal = this.legendTouchAbort.signal;
        const tooltipEl = document.getElementById("danbooru-grass-tooltip");
        this.legendTap = createTwoStepTap({
          insideElements: () => [
            document.getElementById("danbooru-grass-legend"),
            document.getElementById("danbooru-grass-tooltip")
          ],
          onFirstTap: (i) => {
            if (!tooltipEl) return;
            tooltipEl.style.opacity = "1";
            tooltipEl.innerHTML = legendThresholds[i];
            const swatchEl = document.querySelectorAll(
              "#danbooru-grass-legend > div"
            )[i];
            if (swatchEl) {
              this.positionTooltipAboveCell(
                tooltipEl,
                swatchEl.getBoundingClientRect()
              );
            }
          },


onSecondTap: () => {
            if (tooltipEl) tooltipEl.style.opacity = "0";
          },
          onReset: () => {
            if (tooltipEl) tooltipEl.style.opacity = "0";
          },
          navigateOnSameTap: false
        });
        const tap = this.legendTap;
        legendDivs.each(function(_d, i) {
          if (i < legendThresholds.length) {
            const el2 = this;
            const tracker = new TapTracker();
            el2.addEventListener(
              "touchstart",
              (e) => tracker.onTouchStart(e),
              { passive: true, signal: legendSignal }
            );
            el2.addEventListener(
              "touchmove",
              (e) => tracker.onTouchMove(e),
              { passive: true, signal: legendSignal }
            );
            el2.addEventListener(
              "touchend",
              (e) => {
                if (tracker.onTouchEnd(e)) tap.tap(i);
              },
              { signal: legendSignal }
            );
          }
        });
      } else {
        legendDivs.each(function(_d, i) {
          if (i >= 0 && i < legendThresholds.length) {
            d3__namespace.select(this).on("mouseover", (event) => {
              updateGrassTooltip(tooltip, event, legendThresholds[i]);
            }).on("mouseout", () => tooltip.style("opacity", 0));
          }
        });
      }
    }






createGrassHandle(args) {
      const {
        type,
        side,
        container: container2,
        wrapper,
        stats,
        layout,
        measureNaturalWidth,
        measureCurrentToDecWidth,
        measureHourlyMinWidth,
        applyConstraints,
        syncPanelPosition,
        persistSettings
      } = args;
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
            layout.savedWidth = candidateMode === "below" ? layout.belowWidth : layout.inlineWidth;
            layout.savedX = candidateMode === "below" ? layout.belowX : layout.inlineX;
            const needsNaturalMeasure = !layout.savedWidth;
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
              layout.belowWidth = nextWidth;
              layout.belowX = finalX;
            } else {
              layout.inlineWidth = nextWidth;
              layout.inlineX = finalX;
            }
            layout.savedWidth = nextWidth;
            layout.savedX = finalX;
          }
          persistSettings();
          syncPanelPosition();
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      };
      handle.className = "di-grass-handle";
      return handle;
    }



async renderGraph(dataMap, year, metric, userInfo, availableYears, onYearChange, onRefresh, skipScroll = false) {
      let dailyData = dataMap;
      let hourlyData = null;
      if (dataMap && dataMap.daily) {
        dailyData = dataMap.daily;
        hourlyData = dataMap.hourly;
      }
      this.currentYear = year;
      this.currentMetric = metric;
      this.currentDailyData = dailyData || {};
      this.currentUserInfo = typeof userInfo === "string" ? { name: userInfo, id: "" } : userInfo;
      const total = Object.values(dailyData || {}).reduce(
        (acc, v) => acc + v,
        0
      );
      const header = document.querySelector("#danbooru-grass-container h2");
      if (header) {
        renderGrassHeader({ header, total, year, availableYears, onYearChange });
      }
      const win = window;
      if (this.postPaintTimeoutId !== null) {
        clearTimeout(this.postPaintTimeoutId);
        this.postPaintTimeoutId = null;
      }
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
      const getUrl = buildGrassUrlBuilder(metric, sanitizedName, userIdVal);
      ensureGrassStyles();
      container2.innerHTML = "";
      container2.style.display = "flex";
      container2.style.flexDirection = "row";
      container2.style.alignItems = "flex-start";
      container2.style.overflow = "hidden";
      injectGrassDayLabels(container2);
      const scrollWrapper = document.createElement("div");
      scrollWrapper.id = "cal-heatmap-scroll";
      scrollWrapper.style.minHeight = "140px";
      container2.appendChild(scrollWrapper);
      const mainContainer = document.getElementById("danbooru-grass-container");
      if (!mainContainer) return;
      this.buildGrassFooter({
        mainContainer,
        metric,
        year,
        userIdVal,
        onYearChange,
        onRefresh
      });
      const currentThresholds = this.settingsManager.getThresholdsForView(
        String(userIdVal),
        metric
      );
      const makePaintConfig = () => buildPaintConfig({
        scrollWrapper,
        year,
        source,
        thresholds: currentThresholds,
        settingsManager: this.settingsManager
      });
      win.cal.paint(makePaintConfig()).then(() => {
        requestAnimationFrame(() => {
          this.reapplyGraphConstraints?.();
        });
        const onThemeChange = () => {
          try {
            const sw = document.getElementById("cal-heatmap-scroll");
            const savedScroll = sw ? sw.scrollLeft : 0;
            win.cal.destroy();
            win.cal.paint(makePaintConfig()).then(() => {
              if (sw) sw.scrollLeft = savedScroll;
              this.reapplyGraphConstraints?.();
              this.schedulePostPaintInteractions({
                metric,
                userIdVal,
                getUrl,
                skipScroll: true
              });
            });
          } catch (e) {
          }
          this.updateSummaryGrid(hourlyData, metric);
        };
        if (this.themeChangeHandler) {
          window.removeEventListener(
            "DanbooruInsights:ThemeChanged",
            this.themeChangeHandler
          );
        }
        this.themeChangeHandler = onThemeChange;
        window.addEventListener("DanbooruInsights:ThemeChanged", onThemeChange);
        this.updateSummaryGrid(hourlyData, metric);
        this.schedulePostPaintInteractions({
          metric,
          userIdVal,
          getUrl,
          skipScroll
        });
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
attachMonthLabelInteractions(args) {
      const { isTouch } = args;
      const year = this.currentYear;
      if (year === null) return;
      const labels = document.querySelectorAll(
        "#cal-heatmap-scroll .ch-domain-text"
      );
      if (labels.length === 0) return;
      const metric = this.currentMetric || "uploads";
      const themeKey = this.settingsManager.getTheme();
      const statsFor = (month) => computeMonthStats(this.currentDailyData, year, month, {
        today: new Date(),
        metric
      });
      if (isTouch) {
        this.attachMonthLabelTouch(labels, statsFor, themeKey);
        return;
      }
      labels.forEach((label, month) => {
        label.style.cursor = "pointer";
        let dwell = null;
        label.addEventListener("mouseover", () => {
          keepGrassMonthPopoverOpen();
          if (dwell !== null) clearTimeout(dwell);
          dwell = setTimeout(() => {
            this.openMonthPopover({
              anchor: label,
              stats: statsFor(month),
              themeKey
            });
          }, 200);
        });
        label.addEventListener("mouseout", () => {
          if (dwell !== null) {
            clearTimeout(dwell);
            dwell = null;
          }
          scheduleHideGrassMonthPopover();
        });
      });
    }
openMonthPopover(args) {
      this.monthPopoverGeneration++;
      showGrassMonthPopover(args);
      this.patchJanuaryMom(args);
    }
patchJanuaryMom(args) {
      const { anchor, stats, themeKey } = args;
      const user = this.currentUserInfo;
      if (stats.month !== 0 || stats.empty || !user || !this.dataManager) return;
      const generation = this.monthPopoverGeneration;
      void resolvePrevDecemberTotal({
        dataManager: this.dataManager,
        user,
        metric: stats.metric,
        year: stats.year - 1
      }).then((prevTotal) => {
        if (prevTotal === null) return;
        if (generation !== this.monthPopoverGeneration) return;
        if (!isGrassMonthPopoverVisible()) return;
        if (isGrassMonthPopoverHidePending()) return;
        const patched = prevTotal > 0 ? {
          ...stats,
          momPct: Math.round((stats.total - prevTotal) / prevTotal * 100)
        } : { ...stats, momIsNew: true };
        showGrassMonthPopover({ anchor, stats: patched, themeKey });
      });
    }
attachMonthLabelTouch(labels, statsFor, themeKey) {
      this.monthLabelTouchAbort?.abort();
      this.monthLabelTouchAbort = new AbortController();
      const { signal } = this.monthLabelTouchAbort;
      this.activeTapMonth = null;
      labels.forEach((label, month) => {
        label.style.cursor = "pointer";
        label.addEventListener(
          "click",
          (e) => {
            e.stopPropagation();
            if (isGrassMonthPopoverVisible() && this.activeTapMonth === month) {
              hideGrassMonthPopover();
              this.activeTapMonth = null;
            } else {
              this.openMonthPopover({
                anchor: label,
                stats: statsFor(month),
                themeKey
              });
              this.activeTapMonth = month;
            }
          },
          { signal }
        );
      });
      document.addEventListener(
        "click",
        (e) => {
          const target = e.target;
          if (target?.closest("#danbooru-grass-month-popover")) return;
          if (isGrassMonthPopoverVisible()) {
            hideGrassMonthPopover();
            this.activeTapMonth = null;
          }
        },
        { signal }
      );
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
      let currentYear = ( new Date()).getFullYear();
      let currentMetric = this.settings.getLastMode(userId) || "uploads";
      const joinYear = targetUser.joinDate.getFullYear();
      const years = [];
      const startYear = Math.max(joinYear, 2005);
      for (let y = currentYear; y >= startYear; y--) years.push(y);
      let viewGeneration = 0;
      const updateView = async () => {
        const gen = ++viewGeneration;
        const isCurrent = () => gen === viewGeneration;
        const metric = currentMetric;
        let year = currentYear;
        let availableYears = [...years];
        if (metric === "approvals") {
          const promoDate = await dataManager.fetchPromotionDate(targetUser.name);
          if (!isCurrent()) return;
          if (promoDate) {
            const promoYear = parseInt(promoDate.slice(0, 4), 10);
            availableYears = availableYears.filter((y) => y >= promoYear);
            if (year < promoYear) {
              year = promoYear;
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
            year,
            metric,
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
          if (!isCurrent()) return;
          renderer.updateControls(
            availableYears,
            year,
            metric,
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
            if (isCurrent())
              renderer.setLoading(true, `Fetching... ${count} items`);
          };
          const data = await dataManager.getMetricData(
            metric,
            targetUser,
            year,
            onProgress
          );
          if (!isCurrent()) return;
          await renderer.renderGraph(
            data,
            year,
            metric,
            targetUser,
            availableYears,
            onYearChange,
            async () => {
              renderer.setLoading(true);
              await dataManager.clearCache(currentMetric, targetUser);
              void updateView();
            }
          );
          if (!isCurrent()) return;
          window.dispatchEvent(new CustomEvent("di:sync-complete"));
          void (async () => {
            const ran = await this.maybeRunScheduledAutoTune(
              userId,
              () => updateView()
            );
            if (!ran) {
              await this.maybeSuggestAutoTune(userId, metric, () => updateView());
            }
          })();
        } catch (e) {
          log$a.error("Failed to render grass graph", { error: e });
          if (!isCurrent()) return;
          const message = e instanceof Error ? e.message : "Unknown error occurred";
          renderer.renderError(message, () => updateView());
        } finally {
          if (isCurrent()) renderer.setLoading(false);
        }
      };
      void updateView();
    }
async maybeSuggestAutoTune(userId, metric, refreshView) {
      try {
        if (this.settings.hasProfileThresholds(userId, metric)) return;
        if (wasDismissed(userId)) return;
        const samples = await fetchActiveDayCounts(this.db, userId, metric);
        if (samples.length < MIN_ACTIVE_DAYS) return;
        const current = this.settings.getThresholdsForView(userId, metric);
        const saturation = detectSaturation(samples, current);
        if (saturation === null) return;
        const proposed = computeAutoThresholds(samples);
        if (proposed === null) return;
        if (!wouldTuningImprove(samples, current, proposed)) return;
        showToast({
          type: "info",
          message: "This user's activity doesn't fit the current thresholds well. Tune for this profile?",
          duration: 0,


onClose: () => dismissSuggestion(userId),
          actions: [
            {
              label: "Apply",
              onClick: () => {
                this.settings.setProfileThresholds(userId, metric, proposed);
                this.settings.setProfileTuneTime(userId, metric, Date.now());
                refreshView();
                showToast({
                  type: "success",
                  message: "Thresholds tuned for this profile.",
                  duration: 8e3,
                  actions: [
                    {
                      label: "Undo",
                      onClick: () => {
                        this.settings.clearProfileThreshold(userId, metric);
                        dismissSuggestion(userId);
                        refreshView();
                      }
                    }
                  ]
                });
              }
            },
            {
              label: "Dismiss",
              onClick: () => dismissSuggestion(userId)
            }
          ]
        });
      } catch (e) {
        log$a.warn("Auto-tune suggestion check failed", { error: e });
      }
    }
async maybeRunScheduledAutoTune(userId, refreshView) {
      try {
        const schedule = this.settings.getAutoTuneSchedule();
        if (!schedule.enabled) return false;
        if (wasDismissed(userId)) return false;
        const boundaryMs = mostRecentBoundary(
new Date(),
          schedule.interval
        ).getTime();
        const metrics = ["uploads", "approvals", "notes"];
        const candidates = [];
        for (const metric of metrics) {
          if (this.settings.getProfileTuneTime(userId, metric) >= boundaryMs) {
            continue;
          }
          const samples = await fetchActiveDayCounts(this.db, userId, metric);
          if (samples.length < MIN_ACTIVE_DAYS) continue;
          const proposed = computeAutoThresholds(samples);
          if (proposed === null) continue;
          const previous = this.settings.getThresholdsForView(userId, metric);
          const hadOverride = this.settings.hasProfileThresholds(userId, metric);
          const changed = !proposed.every((v, i) => v === previous[i]);
          candidates.push({ metric, previous, proposed, hadOverride, changed });
        }
        if (candidates.length === 0) return false;
        const changing = candidates.filter((c) => c.changed);
        if (changing.length === 0) {
          const now = Date.now();
          for (const c of candidates) {
            this.settings.setProfileTuneTime(userId, c.metric, now);
          }
          return true;
        }
        const labelMap = {
          uploads: "Uploads",
          approvals: "Approvals",
          notes: "Notes"
        };
        const labelList = changing.map((c) => labelMap[c.metric]).join(", ");
        showToast({
          type: "info",
          message: `Scheduled auto-tune ready: ${labelList}. Apply for this profile?`,
          duration: 0,


onClose: () => dismissSuggestion(userId),
          actions: [
            {
              label: "Apply",
              onClick: () => this.applyScheduledTune(userId, changing, refreshView)
            },
            {
              label: "Dismiss",
              onClick: () => {
                const now = Date.now();
                for (const c of candidates) {
                  this.settings.setProfileTuneTime(userId, c.metric, now);
                }
              }
            }
          ]
        });
        return true;
      } catch (e) {
        log$a.warn("Scheduled auto-tune check failed", { error: e });
        return false;
      }
    }
applyScheduledTune(userId, changing, refreshView) {
      const now = Date.now();
      for (const c of changing) {
        this.settings.setProfileThresholds(userId, c.metric, c.proposed);
        this.settings.setProfileTuneTime(userId, c.metric, now);
      }
      refreshView();
      showToast({
        type: "success",
        message: `Auto-tuned ${changing.length} metric${changing.length === 1 ? "" : "s"} for this profile.`,
        duration: 8e3,
        actions: [
          {
            label: "Undo",
            onClick: () => {
              for (const c of changing) {
                if (c.hadOverride) {
                  this.settings.setProfileThresholds(
                    userId,
                    c.metric,
                    c.previous
                  );
                } else {
                  this.settings.clearProfileThreshold(userId, c.metric);
                }
              }
              dismissSuggestion(userId);
              refreshView();
            }
          }
        ]
      });
    }
  }
  const ENABLED_KEY = "di.perf.enabled";
  const SAMPLE_BUFFER_SIZE = 100;
  class PerfLogger {
    enabled;
    marks = new Map();
samples = new Map();
    seq = 0;
    constructor() {
      this.enabled = false;
    }
    readFlag() {
      try {
        return localStorage.getItem(ENABLED_KEY) === "1";
      } catch {
        return false;
      }
    }
isEnabled() {
      return false;
    }
setEnabled(on) {
      return;
    }
mark(label, meta) {
      return;
    }
measure(label, meta) {
      return void 0;
    }
start(label) {
      this.mark(label);
    }
end(label, meta) {
      return this.measure(label, meta);
    }
async wrap(label, fn, meta) {
      return fn();
    }
event(label, delta, meta) {
      return;
    }
stats(label) {
      return null;
    }
dumpStats() {
      return;
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
  const CACHE_TTL_MS$2 = 24 * 60 * 60 * 1e3;
  const GLOBAL_TOTAL_KEY = "di.cache.global_total";
  const GLOBAL_TOP50_KEY = "di.cache.global_top50_general";
  function readCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (typeof entry.expiresAt !== "number" || Date.now() >= entry.expiresAt) {
        return null;
      }
      return entry.value;
    } catch {
      return null;
    }
  }
  function writeCache(key, value) {
    try {
      const entry = {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS$2
      };
      localStorage.setItem(key, JSON.stringify(entry));
    } catch (e) {
    }
  }
  async function getGlobalTotalPosts(rateLimiter) {
    const cached = readCache(GLOBAL_TOTAL_KEY);
    if (cached !== null && cached > 0) return cached;
    try {
      const count = await fetchRemoteCount$1(rateLimiter, "status:any");
      if (count > 0) writeCache(GLOBAL_TOTAL_KEY, count);
      return count;
    } catch (e) {
      return 0;
    }
  }
  async function getGlobalTopGeneralTags(rateLimiter) {
    const cached = readCache(GLOBAL_TOP50_KEY);
    if (cached !== null && cached.length > 0) return new Map(cached);
    try {
      const url = "/related_tag.json?commit=Search&search[category]=0&search[order]=Frequency&search[query]=status%3Aany&limit=50";
      const resp = await rateLimiter.fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!Array.isArray(json.related_tags)) return new Map();
      const entries = [];
      for (const item of json.related_tags) {
        const name = item.tag?.name;
        const count = item.tag?.post_count;
        if (typeof name === "string" && typeof count === "number" && count > 0) {
          entries.push([name, count]);
        }
      }
      if (entries.length > 0) writeCache(GLOBAL_TOP50_KEY, entries);
      return new Map(entries);
    } catch (e) {
      return new Map();
    }
  }
  const LIFT_THRESHOLD = 2;
  const USER_COUNT_FLOOR = 3;
  function applyGeneralTagCloudFilter(entries, topGlobalTags, globalTotal, liftThreshold, userCountFloor) {
    if (globalTotal <= 0 || topGlobalTags.size === 0) return entries;
    return entries.filter((entry) => {
      const globalCount = topGlobalTags.get(entry.tagName);
      if (globalCount === void 0) return true;
      if (entry.userCount < userCountFloor) return false;
      const globalRate = globalCount / globalTotal;
      if (globalRate <= 0) return true;
      const lift = entry.frequency / globalRate;
      return lift >= liftThreshold;
    });
  }
  const log$8 = createLogger("SubTagResolver");
  const CACHE_TTL_MS$1 = 180 * 24 * 60 * 60 * 1e3;
  const CACHE_SCHEMA_VERSION = 2;
  const KEY_PREFIX = "consequent:";
  const CHUNK_SIZE = 30;
  async function fetchSubTagsForParents(rateLimiter, db, parents) {
    const result = new Map();
    if (parents.length === 0) return result;
    const now = Date.now();
    const missing = [];
    const table = db?.tag_implications_cache;
    if (table) {
      const keys = parents.map((p) => KEY_PREFIX + p);
      try {
        const records = await table.bulkGet(keys);
        records.forEach((rec, idx) => {
          const parent = parents[idx];
          if (rec && isCacheRecordFresh(rec, now)) {
            result.set(parent, new Set(rec.subs ?? []));
          } else {
            missing.push(parent);
          }
        });
      } catch (e) {
        log$8.warn("Failed to read implication cache, refetching all", { error: e });
        missing.push(...parents);
      }
    } else {
      missing.push(...parents);
    }
    if (missing.length === 0) return result;
    const fetchedByParent = await fetchInChunks(rateLimiter, missing);
    for (const parent of missing) {
      result.set(parent, fetchedByParent.get(parent) ?? new Set());
    }
    if (table) {
      const records = missing.map((parent) => ({
        tagName: KEY_PREFIX + parent,


isTopLevel: false,
        subs: [...fetchedByParent.get(parent) ?? new Set()],
        fetchedAt: now,
        schemaVersion: CACHE_SCHEMA_VERSION
      }));
      try {
        await table.bulkPut(records);
      } catch (e) {
        log$8.warn("Failed to write sub-tag cache (continuing)", { error: e });
      }
    }
    return result;
  }
  function isCacheRecordFresh(rec, now) {
    if (rec.schemaVersion !== CACHE_SCHEMA_VERSION) return false;
    const age = now - rec.fetchedAt;
    return age >= 0 && age < CACHE_TTL_MS$1;
  }
  async function fetchInChunks(rateLimiter, parents) {
    const out = new Map();
    parents.forEach((p) => out.set(p, new Set()));
    for (let i = 0; i < parents.length; i += CHUNK_SIZE) {
      const chunk = parents.slice(i, i + CHUNK_SIZE);
      try {
        const imps = await fetchChunk(rateLimiter, chunk);
        for (const imp of imps) {
          const parent = imp?.consequent_name;
          const sub = imp?.antecedent_name;
          if (typeof parent === "string" && typeof sub === "string") {
            const set = out.get(parent);
            if (set) set.add(sub);
          }
        }
      } catch (e) {
        log$8.warn("Sub-tag chunk fetch failed (leaving empty)", {
          chunkSize: chunk.length,
          error: e
        });
      }
    }
    return out;
  }
  async function fetchChunk(rateLimiter, chunk) {
    const csv = chunk.join(",");
    const url = `/tag_implications.json?search[consequent_name_comma]=${encodeURIComponent(csv)}&search[status]=active&limit=1000`;
    const resp = await rateLimiter.fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    return Array.isArray(json) ? json : [];
  }
  function applySubTagBreakdown(parentSubs, userTagCounts, maxItems = 10, othersThreshold = 0.95) {
    if (parentSubs.size === 0) return [];
    if (maxItems < 1) return [];
    const rows = [];
    let total = 0;
    for (const sub of parentSubs) {
      const c = userTagCounts.get(sub) ?? 0;
      if (c > 0) {
        rows.push({ tagName: sub, count: c });
        total += c;
      }
    }
    if (rows.length === 0 || total === 0) return [];
    rows.sort((a, b) => b.count - a.count);
    const out = [];
    let cumulative = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const share = r.count / total;
      const remainingSlots = maxItems - out.length;
      const cumulativeOverThreshold = cumulative > othersThreshold;
      const lastSlotWithMore = remainingSlots === 1 && i < rows.length - 1;
      if (cumulativeOverThreshold || lastSlotWithMore) {
        const tailRows = rows.slice(i);
        const tailCount = tailRows.reduce((s, x) => s + x.count, 0);
        out.push({
          tagName: "Others",
          count: tailCount,
          share: tailCount / total,
          isOther: true
        });
        break;
      }
      out.push({ tagName: r.tagName, count: r.count, share, isOther: false });
      cumulative += share;
    }
    return out;
  }
  function selectTopKByCount(candidates, k) {
    const sorted = candidates.slice().sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.tagName.localeCompare(b.tagName);
    });
    return sorted.slice(0, Math.max(0, k));
  }
  function charPoolSize(N) {
    const n = Number.isFinite(N) && N > 0 ? N : 0;
    let f;
    if (n <= 5e3) f = 10;
    else if (n <= 1e4) f = 15;
    else if (n <= 2e4) f = 20;
    else if (n <= 4e4) f = 25;
    else if (n <= 7e4) f = 35;
    else if (n <= 11e4) f = 45;
    else if (n <= 16e4) f = 55;
    else if (n <= 25e4) f = 65;
    else if (n <= 5e5) f = 75;
    else f = 80;
    return { filtered: f, raw: Math.ceil(f * 1.5) };
  }
  function copyPoolSize(N) {
    const n = Number.isFinite(N) && N > 0 ? N : 0;
    let f;
    if (n <= 5e3) f = 10;
    else if (n <= 1e4) f = 12;
    else if (n <= 2e4) f = 15;
    else if (n <= 4e4) f = 18;
    else if (n <= 7e4) f = 22;
    else if (n <= 11e4) f = 26;
    else if (n <= 16e4) f = 30;
    else if (n <= 25e4) f = 34;
    else if (n <= 5e5) f = 37;
    else f = 40;
    return { filtered: f, raw: Math.ceil(f * 1.5) };
  }
  const ACTIVITY_TYPES = [
    "upload",
    "edit",
    "note",
    "wiki",
    "artist",
    "commentary",
    "pool",
    "forum",
    "approval",
    "comment",
    "appeal",
    "suspicious"
];
  const STATUS_BORDER_COLORS = {
    active: "transparent",
    pending: "#0969da",
appealed: "#8250df",
flagged: "#cf222e",
deleted: "#6e7781"
};
  const ACTIVITY_COLORS = {
    upload: "#2196f3",
edit: "#3f51b5",
note: "#ff9800",
wiki: "#9c27b0",
artist: "#e91e63",
commentary: "#00bcd4",
pool: "#8bc34a",
forum: "#795548",
approval: "#4caf50",
comment: "#ffc107",
appeal: "#f44336",
suspicious: "#1b1f24"
};
  function derivePostStatus(post, appealedIds) {
    if (appealedIds.has(post.id)) return "appealed";
    if (post.is_pending) return "pending";
    if (post.is_flagged) return "flagged";
    if (post.is_deleted || post.is_banned) return "deleted";
    return "active";
  }
  function pick180ThumbUrl(post) {
    const variant = post.variants?.find((v) => v.type === "180x180");
    return variant?.url || getBestThumbnailUrl(post);
  }
  function toPostPreview(post, appealedIds) {
    return {
      id: post.id,
      thumbUrl: pick180ThumbUrl(post),
      score: post.score ?? (post.up_score ?? 0) + (post.down_score ?? 0),


generalTags: post.tag_count_general,


rating: post.rating ?? "",
      status: derivePostStatus(post, appealedIds)
    };
  }
  const SUSPICIOUS_SCORE_MAX = -3;
  const MINTAG_MAX = 10;
  function isSuspiciousUpload(preview) {
    return preview.score <= SUSPICIOUS_SCORE_MAX;
  }
  function isMintagged(preview) {
    return preview.uploaderTagCount !== void 0 && preview.uploaderTagCount <= MINTAG_MAX;
  }
  const ABANDONED_GAP_MS = 15 * 60 * 1e3;
  function abandonedGapMs(versions) {
    const tsOf = (v) => Date.parse(v.updated_at ?? v.created_at ?? "");
    const v1 = versions.find((v) => v.version === 1);
    const v2 = versions.find((v) => v.version === 2);
    if (!v1 || !v2) return null;
    const t1 = tsOf(v1);
    const t2 = tsOf(v2);
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
    return t2 - t1;
  }
  function isAbandonedByGap(versions) {
    const gap = abandonedGapMs(versions);
    return gap !== null && gap >= ABANDONED_GAP_MS;
  }
  const INDEX_PAGE_LIMIT = 200;
  const withIndexLimit = (url) => `${url}&limit=${INDEX_PAGE_LIMIT}`;
  const ANCHOR_PREFIX = {
    upload: "post_",
    edit: "post-version-",
    note: "note-version-",
    wiki: "wiki-page-version-",
    artist: "artist-version-",
    commentary: "artist-commentary-version-",
    pool: "pool-version-",
    forum: "forum-post-",
    approval: "post-approval-",
    comment: "comment_",
    appeal: "post-appeal-"
  };
  function withAnchor(url, type, anchorId) {
    const prefix = ANCHOR_PREFIX[type];
    if (!prefix || !anchorId || anchorId <= 0) return url;
    return `${url}#${prefix}${anchorId}`;
  }
  const INDEX_URL_BY_NAME = {
    upload: (name) => `/posts?tags=${encodeURIComponent(`user:${name}`)}`,
    suspicious: (name) => `/posts?tags=${encodeURIComponent(`user:${name} status:deleted`)}`
  };
  const INDEX_URL_BY_ID = {
    edit: "/post_versions?search[is_new]=false&search[updater_id]=",
    note: "/note_versions?search[updater_id]=",
    wiki: "/wiki_page_versions?search[updater_id]=",
    artist: "/artist_versions?search[updater_id]=",
    commentary: "/artist_commentary_versions?search[updater_id]=",
    pool: "/pool_versions?search[updater_id]=",
    forum: "/forum_posts?search[creator_id]=",
    approval: "/post_approvals?search[user_id]=",
    comment: "/comments?group_by=comment&search[creator_id]=",
    appeal: "/post_appeals?search[creator_id]="
  };
  function activityTypeIndexUrl(type, user, anchorId) {
    let base;
    const byName = INDEX_URL_BY_NAME[type];
    if (byName) {
      const name = user.name ? user.name.replace(/ /g, "_") : "";
      base = name ? byName(name) : void 0;
    } else {
      const idPrefix = INDEX_URL_BY_ID[type];
      base = idPrefix && user.id ? `${idPrefix}${user.id}` : void 0;
    }
    return base ? withAnchor(withIndexLimit(base), type, anchorId) : void 0;
  }
  function classifyUploadType(meta) {
    if (!meta) return "upload";
    if (meta.isDeleted || meta.isBanned) return "suspicious";
    return (meta.score ?? 0) <= SUSPICIOUS_SCORE_MAX ? "suspicious" : "upload";
  }
  function classifyCommentType(score) {
    return (score ?? 0) <= SUSPICIOUS_SCORE_MAX ? "suspicious" : "comment";
  }
  const PREVIEW_POST_FIELDS = "id,rating,score,up_score,down_score,tag_count_general,is_pending,is_flagged,is_deleted,is_banned,variants,preview_file_url";
  function buildPreviewPostUrls(normalizedName, limit) {
    const enc = (query) => encodeURIComponent(query);
    return {
      postsUrl: `/posts.json?tags=${enc(
      `user:${normalizedName} status:any`
    )}&limit=${limit}&only=${PREVIEW_POST_FIELDS}`,
      appealedUrl: `/posts.json?tags=${enc(
      `user:${normalizedName} status:appealed`
    )}&limit=${limit}&only=id`
    };
  }
  function buildMintagVersionsUrl(userId, limit) {
    return `/post_versions.json?search[is_new]=true&search[updater_id]=${encodeURIComponent(userId)}&limit=${limit}&only=post_id,added_tags`;
  }
  function buildPostVersionsUrl(postId) {
    return `/post_versions.json?search[post_id]=${postId}&only=version,updated_at,created_at&limit=100`;
  }
  function buildUploaderTagCounts(versions) {
    const counts = new Map();
    for (const v of versions) {
      if (v.post_id !== void 0 && Array.isArray(v.added_tags)) {
        counts.set(v.post_id, v.added_tags.length);
      }
    }
    return counts;
  }
  function segOrderKey(seg) {
    return seg.anchorId ?? seg.postId ?? 0;
  }
  function mergeRecentActivity(perType, limit = 100) {
    const all = [];
    for (const arr of perType) {
      for (const seg of arr) {
        if (Number.isFinite(seg.ts)) all.push(seg);
      }
    }
    all.sort((a, b) => b.ts - a.ts || segOrderKey(b) - segOrderKey(a));
    const recent = all.slice(0, limit);
    const counts = {};
    for (const type of ACTIVITY_TYPES) {
      counts[type] = 0;
    }
    for (const seg of recent) {
      counts[seg.type] += 1;
    }
    const suspiciousPostIds = [
      ...new Set(
        recent.filter((s) => s.type === "suspicious" && (s.postId ?? 0) > 0).map((s) => s.postId)
      )
    ];
    const oldestAnchorByType = {};
    for (const seg of recent) {
      if ((seg.anchorId ?? 0) > 0) oldestAnchorByType[seg.type] = seg.anchorId;
    }
    return { recent, counts, suspiciousPostIds, oldestAnchorByType };
  }
  const SUSPICIOUS_URL_ID_CAP = 200;
  function suspiciousPostsUrl(ids) {
    const unique = [...new Set(ids.filter((id) => id > 0))].slice(
      0,
      SUSPICIOUS_URL_ID_CAP
    );
    if (unique.length === 0) return void 0;
    const query = `id:${unique.join(",")} status:any`;
    const url = withIndexLimit(`/posts?tags=${encodeURIComponent(query)}`);
    return `${url}#post_${unique[unique.length - 1]}`;
  }
  function balancedChunks(items, perRow) {
    const n = items.length;
    if (n === 0 || perRow <= 0) return [];
    const rows = Math.ceil(n / perRow);
    const base = Math.floor(n / rows);
    const extra = n % rows;
    const out = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const size = base + (r < extra ? 1 : 0);
      out.push(items.slice(idx, idx + size));
      idx += size;
    }
    return out;
  }
  const COMMENTARY_UPLOAD_EPSILON_MS = 1e3;
  function filterUploadCoupledCommentary(segments, postCreatedAt, epsilonMs = COMMENTARY_UPLOAD_EPSILON_MS) {
    const kept = [];
    for (const seg of segments) {
      const uploadedAt = postCreatedAt.get(seg.postId);
      if (uploadedAt !== void 0 && Math.abs(seg.ts - uploadedAt) <= epsilonMs) {
        continue;
      }
      kept.push({ type: "commentary", ts: seg.ts, anchorId: seg.anchorId });
    }
    return kept;
  }
  const log$7 = createLogger("Analytics");
  const workerLog = createLogger("Analytics:Worker");
  const TOTAL_COUNT_MEMO_MS = 3e4;
  function distributionItemKey(item) {
    return item.tagName || item.originalTag || item.name || "";
  }
  function computeUntaggedTranslation(counts) {
    const { t, a, b, c, ab, ac } = counts;
    return Math.max(0, t - a - b - c + ab + ac);
  }
  function buildUntaggedTranslationQueries(prefix) {
    return {
      t: `${prefix} *_text`,
      a: `${prefix} english_text`,
      b: `${prefix} *_text translation_request`,
      c: `${prefix} *_text translated`,
      ab: `${prefix} english_text translation_request`,
      ac: `${prefix} english_text translated`,
      bc: `${prefix} translation_request translated`
    };
  }
  const BACKFILL_FAILURE_THRESHOLD = 3;
  const BACKFILL_COOLDOWN_MS = 24 * 60 * 60 * 1e3;
  function backfillFailureStorageKey(uploaderId) {
    return `di_backfill_failure_${uploaderId}`;
  }
  function isBackfillInCooldown(state2, now = Date.now()) {
    if (!state2) return false;
    return state2.failureCount >= BACKFILL_FAILURE_THRESHOLD && now - state2.lastAttemptAt < BACKFILL_COOLDOWN_MS;
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
totalCountMemo = new Map();
constructor(db, rateLimiter) {
      super(db, rateLimiter ?? null);
    }
async tryGetCachedStats(cacheKey, uploaderId, forceRefresh, maxAgeMs) {
      if (forceRefresh || !uploaderId) return null;
      const cached = await this.getStats(cacheKey, uploaderId, maxAgeMs);
      return cached ?? null;
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
            log$7.warn(`Failed thumb fetch after ${retries} tries`, {
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
      const total = await this.db.posts.where("uploader_id").equals(uploaderId).count();
      if (total === 0) return [];
      const cacheKey = `milestones_${customStep}_${isNsfwEnabled ? "1" : "0"}`;
      const stampKey = `${cacheKey}__count`;
      if (!forceRefresh) {
        const [cached, stamp] = await Promise.all([
          this.getStats(cacheKey, uploaderId),
          this.getStats(stampKey, uploaderId)
        ]);
        if (cached && stamp === total) return cached;
      }
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
                    (e) => log$7.error("Failed to update post in DB", {
                      postId: local["id"],
                      error: e
                    })
                  );
                }
              });
            }
          }
        } catch (e) {
          log$7.warn("Failed to fetch missing milestone thumbnails", { error: e });
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
      await Promise.all([
        this.saveStats(cacheKey, uploaderId, results),
        this.saveStats(stampKey, uploaderId, total)
      ]);
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
      const cached = await this.tryGetCachedStats(cacheKey, uploaderId, forceRefresh, getCountCacheTtlMs());
      if (cached) return cached;
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
          const count = await this.fetchRemoteCount(tagQuery);
          return {
            name: status,
            count,
            label: status.charAt(0).toUpperCase() + status.slice(1)
          };
        } catch (e) {
          log$7.warn("Failed to fetch count for status", { status, error: e });
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
      const cached = await this.tryGetCachedStats(cacheKey, uploaderId, forceRefresh, getCountCacheTtlMs());
      if (cached) return cached;
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
          const count = await this.fetchRemoteCount(tagQuery);
          return { rating, count, label: labelMap[rating] };
        } catch (e) {
          log$7.warn("Failed to fetch count for rating", { rating, error: e });
          return { rating, count: 0, label: labelMap[rating] };
        }
      });
      try {
        const results = await Promise.all(tasks);
        if (uploaderId) await this.saveStats(cacheKey, uploaderId, results);
        return results;
      } catch (e) {
        log$7.error("Failed to fetch rating distribution", { error: e });
        return [];
      }
    }
async getTagCloudData(userInfo, categoryId, forceRefresh = false) {
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
      const cached = await this.tryGetCachedStats(
        cacheKey,
        uploaderId,
        forceRefresh,
        getCountCacheTtlMs()
      );
      if (cached) return cached;
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const order = categoryId === 0 ? "Cosine" : "Frequency";
      const limit = categoryId === 0 ? 50 : 30;
      const url = `/related_tag.json?commit=Search&search[category]=${categoryId}&search[order]=${order}&search[query]=user:${encodeURIComponent(normalizedName)}&limit=${limit}`;
      try {
        const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
          return [];
        const queryPostCount = resp.post_count || 0;
        let entries = resp.related_tags.map((item) => ({
          tagName: item.tag.name,
          frequency: item.frequency,
          userCount: Math.round(item.frequency * queryPostCount)
        }));
        if (categoryId === 0) {
          const [globalTotal, topGlobalTags] = await Promise.all([
            getGlobalTotalPosts(this.rateLimiter),
            getGlobalTopGeneralTags(this.rateLimiter)
          ]);
          entries = applyGeneralTagCloudFilter(
            entries,
            topGlobalTags,
            globalTotal,
            LIFT_THRESHOLD,
            USER_COUNT_FLOOR
          );
        }
        const items = entries.slice(0, 30).map((entry) => ({
          name: entry.tagName.replace(/_/g, " "),
          tagName: entry.tagName,
          frequency: entry.frequency,
          count: entry.userCount
        })).sort((a, b) => b.frequency - a.frequency);
        if (uploaderId) await this.saveStats(cacheKey, uploaderId, items);
        return items;
      } catch (e) {
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
        const cached = await this.getStats(
          cacheKey,
          uploaderId,
          getCountCacheTtlMs()
        );
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
        return [];
      }
    }
async getCharacterDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      if (reportSubStatus) reportSubStatus("Fetching Character Distribution...");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "character_dist";
      const cached = await this.tryGetCachedStats(
        cacheKey,
        uploaderId,
        forceRefresh,
        getCountCacheTtlMs()
      );
      if (cached) return cached;
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const url = `/related_tag.json?commit=Search&search[category]=4&search[order]=Frequency&search[query]=user:${encodeURIComponent(normalizedName)}&limit=1000`;
      try {
        const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
          return [];
        const tags = resp.related_tags;
        const N = await this.getTotalPostCount(userInfo);
        const { filtered: filteredCap, raw: rawCap } = charPoolSize(N);
        const rawCandidates = tags.slice(0, rawCap);
        const filterResults = await this.mapConcurrent(
          rawCandidates,
          6,
          async (item) => await isTopLevelTag(this.rateLimiter, item.tag.name) ? item : null
        );
        const filteredCandidates = filterResults.filter((item) => item !== null).slice(0, filteredCap);
        const preItems = filteredCandidates.map((item) => ({
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
          () => this.mapConcurrent(preItems, 6, async (obj) => {
            if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
            try {
              const c = await this.fetchRemoteCount(
                `user:${normalizedName} ${obj.tagName}`
              );
              obj.count = c || obj._item?.tag.post_count || 0;
            } catch (_e) {
              log$7.debug("Failed to fetch user tag count", { error: _e });
            }
          }),
          { distribution: "character", n: preItems.length, concurrency: 6 }
        );
        const top10 = selectTopKByCount(preItems, 10);
        for (const obj of top10) delete obj._item;
        await this.attachSubTagBreakdowns(top10, tags, `user:${normalizedName}`);
        const sumCount = top10.reduce(
          (acc, curr) => acc + curr.count,
          0
        );
        const othersCount = Math.max(0, N - sumCount);
        if (othersCount > 0) {
          top10.push({
            name: "Others",
            tagName: "",
            count: othersCount,
            frequency: 0,
            thumb: "",
            isOther: true
          });
        }
        await this.carryOverThumbs(cacheKey, uploaderId, top10);
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
        log$7.warn("Failed to fetch character distribution", { error: e });
        return [];
      }
    }
async getCopyrightDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      if (reportSubStatus) reportSubStatus("Fetching Copyright Distribution...");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "copyright_dist";
      const cached = await this.tryGetCachedStats(
        cacheKey,
        uploaderId,
        forceRefresh,
        getCountCacheTtlMs()
      );
      if (cached) return cached;
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const url = `/related_tag.json?commit=Search&search[category]=3&search[order]=Frequency&search[query]=user:${encodeURIComponent(normalizedName)}&limit=1000`;
      try {
        const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
          return [];
        const tags = resp.related_tags;
        const N = await this.getTotalPostCount(userInfo);
        const { filtered: filteredCap, raw: rawCap } = copyPoolSize(N);
        const rawCandidates = tags.slice(0, rawCap);
        const filterResults = await this.mapConcurrent(
          rawCandidates,
          6,
          async (item) => await isTopLevelTag(this.rateLimiter, item.tag.name) ? item : null
        );
        const filteredCandidates = filterResults.filter((item) => item !== null).slice(0, filteredCap);
        const preItems = filteredCandidates.map((item) => ({
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
          () => this.mapConcurrent(preItems, 6, async (obj) => {
            if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
            try {
              const c = await this.fetchRemoteCount(
                `user:${normalizedName} ${obj.tagName}`
              );
              obj.count = c || obj._item?.tag.post_count || 0;
            } catch (_e) {
              log$7.debug("Failed to fetch user tag count", { error: _e });
            }
          }),
          { distribution: "copyright", n: preItems.length, concurrency: 6 }
        );
        const top10 = selectTopKByCount(preItems, 10);
        for (const obj of top10) delete obj._item;
        await this.attachSubTagBreakdowns(top10, tags, `user:${normalizedName}`);
        const sumCount = top10.reduce(
          (acc, curr) => acc + curr.count,
          0
        );
        const othersCount = Math.max(0, N - sumCount);
        if (othersCount > 0) {
          top10.push({
            name: "Others",
            tagName: "",
            count: othersCount,
            frequency: 0,
            thumb: "",
            isOther: true
          });
        }
        await this.carryOverThumbs(cacheKey, uploaderId, top10);
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
        log$7.warn("Failed to fetch copyright distribution", { error: e });
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
async attachSubTagBreakdowns(top10, allUserTags, countQueryPrefix) {
      const topLevelNames = top10.map((t) => t.tagName).filter((n) => typeof n === "string" && n.length > 0);
      if (topLevelNames.length === 0) return;
      const subsByParent = await fetchSubTagsForParents(
        this.rateLimiter,
        this.db,
        topLevelNames
      );
      const userTagNames = new Set();
      for (const item of allUserTags) {
        if (item.frequency > 0) userTagNames.add(item.tag.name);
      }
      const subsToFetch = new Set();
      for (const subs of subsByParent.values()) {
        for (const sub of subs) {
          if (userTagNames.has(sub)) subsToFetch.add(sub);
        }
      }
      if (subsToFetch.size === 0) return;
      const userTagCounts = new Map();
      await this.mapConcurrent([...subsToFetch], 5, async (sub) => {
        try {
          const c = await this.fetchRemoteCount(`${countQueryPrefix} ${sub}`);
          if (c > 0) userTagCounts.set(sub, c);
        } catch (e) {
        }
      });
      for (const item of top10) {
        if (!item.tagName) continue;
        const parentSubs = subsByParent.get(item.tagName);
        if (!parentSubs || parentSubs.size === 0) continue;
        const breakdown = applySubTagBreakdown(parentSubs, userTagCounts);
        if (breakdown.length > 0) item.subTags = breakdown;
      }
    }
async getFavCopyrightDistribution(userInfo, forceRefresh = false, reportSubStatus = null) {
      if (!userInfo.name) return [];
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "fav_copyright_dist";
      const cached = await this.tryGetCachedStats(
        cacheKey,
        uploaderId,
        forceRefresh,
        getCountCacheTtlMs()
      );
      if (cached) return cached;
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const url = `/related_tag.json?commit=Search&search[category]=3&search[order]=Frequency&search[query]=ordfav:${encodeURIComponent(normalizedName)}&limit=1000`;
      try {
        const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
          return [];
        const tags = resp.related_tags;
        const N = await this.getTotalPostCount(userInfo);
        const { filtered: filteredCap, raw: rawCap } = copyPoolSize(N);
        const rawCandidates = tags.slice(0, rawCap);
        const filterResults = await this.mapConcurrent(
          rawCandidates,
          6,
          async (item) => {
            const tagName = item.tag.name;
            const impUrl = `/tag_implications.json?search[antecedent_name_matches]=${encodeURIComponent(tagName)}&search[status]=active`;
            try {
              const imps = await this.rateLimiter.fetch(impUrl).then((r) => r.json());
              if (Array.isArray(imps) && imps.length > 0) return null;
              return item;
            } catch {
              return item;
            }
          }
        );
        const filteredCandidates = filterResults.filter((item) => item !== null).slice(0, filteredCap);
        const preItems = filteredCandidates.map((item) => ({
          name: item.tag.name.replace(/_/g, " "),
          tagName: item.tag.name,
          count: 0,
          frequency: item.frequency,
          thumb: null,
          isOther: false,
          _item: item
        }));
        await this.mapConcurrent(preItems, 6, async (obj) => {
          if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
          try {
            obj.count = await this.fetchRemoteCount(
              `fav:${normalizedName} ${obj.tagName}`
            );
          } catch (e) {
            log$7.warn("Count fetch failed for fav copyright tag", {
              tagName: obj.tagName,
              error: e
            });
          }
        });
        const top10 = selectTopKByCount(preItems, 10);
        for (const obj of top10) delete obj._item;
        await this.attachSubTagBreakdowns(top10, tags, `fav:${normalizedName}`);
        let totalFavCount = 0;
        try {
          totalFavCount = await this.fetchRemoteCount(`fav:${normalizedName}`);
        } catch (e) {
          log$7.debug("Failed to fetch total fav count", { error: e });
        }
        const sumCount = top10.reduce(
          (acc, curr) => acc + curr.count,
          0
        );
        const othersCount = Math.max(0, totalFavCount - sumCount);
        if (othersCount > 0) {
          top10.push({
            name: "Others",
            tagName: "",
            count: othersCount,
            frequency: 0,
            thumb: "",
            isOther: true
          });
        }
        await this.carryOverThumbs(cacheKey, uploaderId, top10);
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
        log$7.warn("Failed to fetch fav copyright distribution", { error: e });
        return [];
      }
    }
async getTopPostsByType(userInfo, forceRefresh = false) {
      if (!userInfo.name) return { g: null, s: null, q: null, e: null };
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "top_posts_by_type";
      const cached = await this.tryGetCachedStats(cacheKey, uploaderId, forceRefresh);
      if (cached) return cached;
      const fetchTop = async (ratingTag, extraQuery = "") => {
        try {
          const normalizedName = userInfo.name.replace(/ /g, "_");
          const query = `user:${normalizedName} order:score rating:${ratingTag} status:active ${extraQuery}`;
          const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=1&only=id,preview_file_url,file_url,variants,rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
          const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (Array.isArray(resp) && resp.length > 0) {
            return resp[0];
          }
        } catch (e2) {
          log$7.warn("Failed to fetch top post for rating", { ratingTag, error: e2 });
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
      const cached = await this.tryGetCachedStats(cacheKey, uploaderId, forceRefresh);
      if (cached) return cached;
      const fetchTop = async (ratingTag) => {
        try {
          const normalizedName = userInfo.name.replace(/ /g, "_");
          const query = `user:${normalizedName} order:score ${ratingTag} age:<1w status:active`;
          const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=1&only=id,preview_file_url,file_url,variants,rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
          const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (Array.isArray(resp) && resp.length > 0) {
            return resp[0];
          }
        } catch (e) {
          log$7.warn("Failed to fetch recent top post", { ratingTag, error: e });
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
async getRecentPostsPreview(userInfo, limit = 20) {
      if (!userInfo.name) return [];
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const { postsUrl, appealedUrl } = buildPreviewPostUrls(normalizedName, limit);
      const versionsUrl = userInfo.id ? buildMintagVersionsUrl(userInfo.id, limit) : null;
      try {
        const [posts, appealed, versions] = await Promise.all([
          this.rateLimiter.fetch(postsUrl).then((r) => r.json()),
          this.rateLimiter.fetch(appealedUrl).then((r) => r.json()).catch(() => []),
          versionsUrl ? this.rateLimiter.fetch(versionsUrl).then((r) => r.json()).catch(() => []) : Promise.resolve([])
        ]);
        if (!Array.isArray(posts)) return [];
        const appealedIds = new Set(
          (Array.isArray(appealed) ? appealed : []).map(
            (p) => p.id
          )
        );
        const tagCounts = buildUploaderTagCounts(
          Array.isArray(versions) ? versions : []
        );
        return posts.map((p) => ({
          ...toPostPreview(p, appealedIds),
          uploaderTagCount: tagCounts.get(p.id)
        }));
      } catch (e) {
        log$7.warn("Failed to fetch recent posts preview", {
          user: userInfo.name,
          error: e
        });
        return [];
      }
    }
async getAbandonedPostIds(postIds) {
      if (!postIds.length) return new Set();
      const flags = await this.mapConcurrent(
        postIds,
        6,
        async (postId) => {
          try {
            const rows = await this.rateLimiter.fetch(buildPostVersionsUrl(postId)).then((r) => r.json());
            return Array.isArray(rows) && isAbandonedByGap(rows) ? postId : null;
          } catch (e) {
            log$7.warn("Abandoned-gap lookup failed", { postId, error: e });
            return null;
          }
        }
      );
      return new Set(flags.filter((id) => id !== null));
    }
async getActivityDistribution(userInfo, limit = 100) {
      const userId = userInfo.id;
      if (!userId) return mergeRecentActivity([], limit);
      const v = (type, endpoint, extra) => ({
        type,
        endpoint,
        param: "updater_id",
        extra
      });
      const descriptors = [
        v("upload", "/post_versions.json", "search[is_new]=true"),
        v("edit", "/post_versions.json", "search[is_new]=false"),
        v("note", "/note_versions.json"),
        v("wiki", "/wiki_page_versions.json"),
        v("artist", "/artist_versions.json"),
        v("commentary", "/artist_commentary_versions.json"),
        v("pool", "/pool_versions.json"),
        { type: "forum", endpoint: "/forum_posts.json", param: "creator_id" },
        { type: "approval", endpoint: "/post_approvals.json", param: "user_id" },
        { type: "comment", endpoint: "/comments.json", param: "creator_id" },
        { type: "appeal", endpoint: "/post_appeals.json", param: "creator_id" }
      ];
      const perType = await this.mapConcurrent(descriptors, 6, async (d) => {
        if (d.type === "upload")
          return this.fetchUploadActivity(d, userId, limit);
        if (d.type === "commentary") {
          return this.fetchCommentaryActivity(d, userId, limit);
        }
        if (d.type === "comment") {
          return this.fetchCommentActivity(d, userId, limit);
        }
        return this.fetchActivityType(d, userId, limit);
      });
      return mergeRecentActivity(perType, limit);
    }
async fetchUploadActivity(d, userId, limit) {
      try {
        const url = `${d.endpoint}?search[${d.param}]=${encodeURIComponent(userId)}${d.extra ? `&${d.extra}` : ""}&limit=${limit}&only=id,post_id,updated_at,created_at`;
        const rows = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!Array.isArray(rows)) return [];
        const segs = rows.map(
          (r) => ({
            postId: r.post_id ?? -1,
            ts: Date.parse(r.updated_at ?? r.created_at ?? "")
          })
        );
        const meta = await this.fetchPostBadnessMeta(segs.map((s) => s.postId));
        return segs.map((s) => {
          const type = classifyUploadType(meta.get(s.postId));
          return type === "suspicious" ? { type, ts: s.ts, postId: s.postId } : { type, ts: s.ts, anchorId: s.postId };
        });
      } catch (e) {
        log$7.warn("Activity feed fetch failed", { type: "upload", error: e });
        return [];
      }
    }
async fetchCommentActivity(d, userId, limit) {
      try {
        const url = `${d.endpoint}?search[${d.param}]=${encodeURIComponent(userId)}&limit=${limit}&only=id,post_id,score,created_at`;
        const rows = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!Array.isArray(rows)) return [];
        return rows.map(
          (r) => {
            const type = classifyCommentType(r.score);
            const ts = Date.parse(r.created_at ?? "");
            return type === "suspicious" && r.post_id ? { type, ts, postId: r.post_id } : { type, ts, anchorId: r.id };
          }
        );
      } catch (e) {
        log$7.warn("Activity feed fetch failed", { type: "comment", error: e });
        return [];
      }
    }
async fetchPostBadnessMeta(postIds) {
      const unique = [...new Set(postIds.filter((id) => id > 0))].slice(0, 200);
      const map = new Map();
      if (unique.length === 0) return map;
      try {
        const query = `id:${unique.join(",")} status:any`;
        const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=${unique.length}&only=id,is_deleted,is_banned,score`;
        const rows = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (Array.isArray(rows)) {
          for (const p of rows) {
            if (p.id !== void 0) {
              map.set(p.id, {
                isDeleted: !!p.is_deleted,
                isBanned: !!p.is_banned,
                score: p.score
              });
            }
          }
        }
      } catch (e) {
        log$7.warn("Post badness lookup failed", { count: unique.length, error: e });
      }
      return map;
    }
async fetchActivityType(d, userId, limit) {
      try {
        const url = `${d.endpoint}?search[${d.param}]=${encodeURIComponent(userId)}${d.extra ? `&${d.extra}` : ""}&limit=${limit}&only=id,updated_at,created_at`;
        const rows = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!Array.isArray(rows)) return [];
        return rows.map(
          (r) => ({
            type: d.type,
            ts: Date.parse(r.updated_at ?? r.created_at ?? ""),
            anchorId: r.id
})
        );
      } catch (e) {
        log$7.warn("Activity feed fetch failed", { type: d.type, error: e });
        return [];
      }
    }
async fetchCommentaryActivity(d, userId, limit) {
      try {
        const url = `${d.endpoint}?search[${d.param}]=${encodeURIComponent(userId)}&limit=${limit}&only=id,post_id,updated_at,created_at`;
        const rows = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (!Array.isArray(rows)) return [];
        const segments = rows.map(
          (r) => ({
            type: "commentary",
            postId: r.post_id ?? -1,
            ts: Date.parse(r.updated_at ?? r.created_at ?? ""),
            anchorId: r.id
})
        );
        const uploadTimes = await this.fetchPostUploadTimes(
          segments.map((s) => s.postId)
        );
        return filterUploadCoupledCommentary(segments, uploadTimes);
      } catch (e) {
        log$7.warn("Activity feed fetch failed", { type: "commentary", error: e });
        return [];
      }
    }
async fetchPostUploadTimes(postIds) {
      const unique = [...new Set(postIds.filter((id) => id > 0))].slice(0, 200);
      const map = new Map();
      if (unique.length === 0) return map;
      try {
        const query = `id:${unique.join(",")} status:any`;
        const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=${unique.length}&only=id,created_at`;
        const rows = await this.rateLimiter.fetch(url).then((r) => r.json());
        if (Array.isArray(rows)) {
          for (const p of rows) {
            const ts = Date.parse(p.created_at ?? "");
            if (p.id !== void 0 && Number.isFinite(ts)) map.set(p.id, ts);
          }
        }
      } catch (e) {
        log$7.warn("Post upload-time lookup failed", {
          count: unique.length,
          error: e
        });
      }
      return map;
    }
async getRandomPosts(userInfo) {
      if (!userInfo.name) return { sfw: null, nsfw: null };
      const fetchRandom = async (ratingTag) => {
        try {
          const normalizedName = userInfo.name.replace(/ /g, "_");
          const query = `user:${normalizedName} ${ratingTag} status:active`;
          const url = `/posts/random.json?tags=${encodeURIComponent(query)}&only=id,preview_file_url,file_url,variants,rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
          const resp = await this.rateLimiter.fetch(url).then((r) => r.json());
          if (resp && resp.id) {
            return resp;
          }
        } catch (e) {
          log$7.warn("Failed to fetch random post", { ratingTag, error: e });
        }
        return null;
      };
      const [sfw, nsfw] = await Promise.all([
        fetchRandom("is:sfw"),
        fetchRandom("is:nsfw")
      ]);
      return { sfw, nsfw };
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
setBackfillFailureState(uploaderId, state2) {
      localStorage.setItem(
        backfillFailureStorageKey(uploaderId),
        JSON.stringify(state2)
      );
    }
clearBackfillFailureState(uploaderId) {
      localStorage.removeItem(backfillFailureStorageKey(uploaderId));
    }
recordBackfillFailure(uploaderId) {
      const next = recordFailure(this.getBackfillFailureState(uploaderId));
      this.setBackfillFailureState(uploaderId, next);
      log$7.warn("Backfill failure recorded", {
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
              log$7.warn("Backfill HTTP error — pausing backfill", {
                status: resp.status
              });
              this.recordBackfillFailure(uploaderId);
            } else {
              log$7.warn(
                "Backfill HTTP 429 — pausing batch (rate-limiter cooldown active)"
              );
            }
            return;
          }
          batch = await resp.json();
        } catch (e) {
          log$7.warn("Backfill fetch failed", { error: e });
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
      const fetchCount = (tagQuery) => this.fetchRemoteCount(tagQuery).catch((e) => {
        log$7.warn("Count query failed for user stats", { tagQuery, error: e });
        return 0;
      });
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
        log$7.error("Failed to fetch promotion history", { error: e });
        return [];
      }
    }
async getLevelChangeHistory(userInfo, forceRefresh = false) {
      if (!userInfo.name) return [];
      const normalizedName = userInfo.name.replace(/ /g, "_");
      const uploaderId = parseInt(userInfo.id || "0");
      const cacheKey = "level_change_history";
      const cached = await this.tryGetCachedStats(cacheKey, uploaderId, forceRefresh);
      if (cached) {
        return cached.map((e) => ({ ...e, date: new Date(e.date) }));
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
        log$7.warn("Failed to fetch level change history", { error: e });
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
      const cached = await this.tryGetCachedStats(
        cacheKey,
        uploaderId,
        forceRefresh,
        getCountCacheTtlMs()
      );
      if (cached) return cached;
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
            results[item.idx].count = await this.fetchRemoteCount(item.query);
          } catch (e) {
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
      const cached = await this.tryGetCachedStats(
        cacheKey,
        uploaderId,
        forceRefresh,
        getCountCacheTtlMs()
      );
      if (cached) return cached;
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
      const fetchCount = (query) => this.fetchRemoteCount(query).catch(() => 0);
      await this.mapConcurrent(
        categories.map((cat, i) => ({ ...cat, idx: i })),
        3,
        async (item) => {
          if (reportSubStatus)
            reportSubStatus(`Fetching Translation: ${item.name}`);
          try {
            if (item.useInclusionExclusion) {
              const q = buildUntaggedTranslationQueries(`user:${normalizedName}`);
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
                  log$7.warn(
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
      const cached = await this.tryGetCachedStats(
        cacheKey,
        uploaderId,
        forceRefresh,
        getCountCacheTtlMs()
      );
      if (cached) return cached;
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
                item.subQueries.map(
                  (q) => this.fetchRemoteCount(q).catch(() => 0)
                )
              );
              results[item.idx].count = counts.reduce((sum, n) => sum + n, 0);
            } else if (item.query) {
              results[item.idx].count = await this.fetchRemoteCount(item.query);
            }
          } catch (e) {
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
      const cached = await this.tryGetCachedStats(
        cacheKey,
        uploaderId,
        forceRefresh,
        getCountCacheTtlMs()
      );
      if (cached) return cached;
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
          obj.count = await this.fetchRemoteCount(
            `user:${normalizedName} ${tag}`
          );
        } catch (e) {
        }
      });
      const filtered = results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
      await this.carryOverThumbs(cacheKey, uploaderId, filtered);
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
      const cached = await this.tryGetCachedStats(
        cacheKey,
        uploaderId,
        forceRefresh,
        getCountCacheTtlMs()
      );
      if (cached) return cached;
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
          obj.count = await this.fetchRemoteCount(
            `user:${normalizedName} ${obj.originalTag}`
          );
        } catch (e) {
        }
      });
      const filtered = results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
      await this.carryOverThumbs(cacheKey, uploaderId, filtered);
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
      const cached = await this.tryGetCachedStats(
        cacheKey,
        uploaderId,
        forceRefresh,
        getCountCacheTtlMs()
      );
      if (cached) return cached;
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
          obj.count = await this.fetchRemoteCount(
            `user:${normalizedName} ${obj.originalTag}`
          );
        } catch (e) {
        }
      });
      const filtered = results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
      await this.carryOverThumbs(cacheKey, uploaderId, filtered);
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
async carryOverThumbs(cacheKey, uploaderId, items) {
      if (!uploaderId) return;
      const cached = await this.getStats(cacheKey, uploaderId);
      if (!cached) return;
      const thumbByTag = new Map();
      for (const prev of cached) {
        const key = distributionItemKey(prev);
        if (key && prev.thumb) thumbByTag.set(key, prev.thumb);
      }
      if (thumbByTag.size === 0) return;
      for (const item of items) {
        if (item.isOther || item.thumb) continue;
        const prev = thumbByTag.get(distributionItemKey(item));
        if (prev) item.thumb = prev;
      }
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
      const memoKey = userInfo.id || userInfo.name;
      const memo = this.totalCountMemo.get(memoKey);
      if (memo && Date.now() - memo.at < TOTAL_COUNT_MEMO_MS) {
        return memo.promise;
      }
      const pending = this.fetchTotalPostCount(userInfo);
      this.totalCountMemo.set(memoKey, { at: Date.now(), promise: pending });
      void pending.then(
        (value) => {
          if (!value) this.totalCountMemo.delete(memoKey);
        },
        () => this.totalCountMemo.delete(memoKey)
      );
      return pending;
    }
async fetchTotalPostCount(userInfo) {
      try {
        const normalizedName = userInfo.name.replace(/ /g, "_");
        return await this.fetchRemoteCount(`user:${normalizedName}`);
      } catch (e) {
        log$7.warn("Counts API failed", { error: e });
      }
      try {
        const profileUrl = `/users/${userInfo.id}.json`;
        const profile = await this.rateLimiter.fetch(profileUrl).then((r) => r.json());
        if (profile && typeof profile.post_upload_count === "number") {
          return profile.post_upload_count;
        }
      } catch (_e2) {
      }
      try {
        const parsed = this.parseUploadCountFromDom();
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      } catch (_e3) {
      }
      return 0;
    }
parseUploadCountFromDom() {
      const rows = document.querySelectorAll("#danbooru-grass-wrapper table tr");
      for (const row of rows) {
        const labelCell = row.querySelector("th") ?? row.querySelector("td");
        const label = (labelCell?.textContent ?? "").trim().toLowerCase();
        if (label !== "uploads") continue;
        const cells = row.querySelectorAll("td");
        const valueCell = cells[cells.length - 1] ?? row.querySelector("td");
        const valueText = (valueCell?.querySelector("a") ?? valueCell)?.textContent;
        return parseInt((valueText ?? "").replace(/,/g, ""), 10);
      }
      const statsLink = document.querySelector(
        "#danbooru-grass-wrapper > div:nth-child(1) > table > tbody > tr:nth-child(6) > td > a:nth-child(1)"
      );
      return statsLink ? parseInt((statsLink.textContent ?? "").replace(/,/g, ""), 10) : NaN;
    }
async syncAllPosts(userInfo, onProgress) {
      if (!userInfo.id) {
        log$7.error("User ID required for sync");
        return { complete: false, started: false };
      }
      const uploaderId = parseInt(userInfo.id ?? "0");
      if (AnalyticsDataManager.isGlobalSyncing) {
        log$7.warn("Sync already in progress");
        return { complete: false, started: false };
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
        const resume = await this.calculateResumeStartId(uploaderId);
        const { startId } = resume;
        let { currentNo } = resume;
        perfStats.startId = startId;
        perfStats.initialCurrentNo = currentNo;
        let pageOffset = 1;
        let hasMore = true;
        let pageFailed = false;
        const seenIds = new Set();
        const buffer = new Map();
        let nextExpectedPage = 1;
        const MAX_CONCURRENCY = 5;
        const worker = this.createSyncPageWorker({
          userInfo,
          uploaderId,
          startId,
          getCurrentNo: () => currentNo,
          bumpCurrentNo: () => ++currentNo,
          total,
          buffer,
          getNextExpectedPage: () => nextExpectedPage,
          bumpNextExpectedPage: () => ++nextExpectedPage,
          claimPage: () => pageOffset++,
          getHasMore: () => hasMore,
          setHasMore: (v) => {
            hasMore = v;
          },
          markFailed: () => {
            pageFailed = true;
          },
          markSeen: (ids) => {
            for (const id of ids) seenIds.add(id);
          },
          reportProgress,
          perfStats
        });
        const workers = [];
        for (let i = 0; i < MAX_CONCURRENCY; i++) {
          workers.push(worker(i));
        }
        await Promise.all(workers);
        if (!pageFailed && perfStats.pagesCommitted > 0) {
          await this.pruneGhostPosts(uploaderId, startId, seenIds);
        }
        await this.finalizeSyncMetadata({
          userInfo,
          uploaderId,
          startId,
          total,
          reportProgress,
          succeeded: !pageFailed
        });
        perfStats.finalCurrentNo = currentNo;
        return { complete: !pageFailed, started: true };
      } finally {
        perfLogger.end("dbi:db:sync:full:total", perfStats);
        AnalyticsDataManager.isGlobalSyncing = false;
        AnalyticsDataManager.onProgressCallback = null;
      }
    }
async calculateResumeStartId(uploaderId) {
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
      perfLogger.end("dbi:db:sync:full:resumeCheck", {
        startId,
        initialCurrentNo: currentNo,
        hasHistory: newestArr.length > 0
      });
      return { startId, currentNo };
    }
async pruneGhostPosts(uploaderId, startId, seenIds) {
      const allIds = await this.db.posts.where("uploader_id").equals(uploaderId).primaryKeys();
      const ghostIds = allIds.filter((id) => id > startId && !seenIds.has(id));
      if (ghostIds.length === 0) return 0;
      await this.db.posts.bulkDelete(ghostIds);
      log$7.debug("Pruned remotely-deleted posts", {
        uploaderId,
        startId,
        pruned: ghostIds.length
      });
      return ghostIds.length;
    }
createSyncPageWorker(args) {
      const {
        userInfo,
        uploaderId,
        startId,
        getCurrentNo,
        bumpCurrentNo,
        total,
        buffer,
        getNextExpectedPage,
        bumpNextExpectedPage,
        claimPage,
        getHasMore,
        setHasMore,
        markFailed,
        markSeen,
        reportProgress,
        perfStats
      } = args;
      const limit = 200;
      const WORKER_DELAY = 400;
      return async (workerId) => {
        const workerLabel = `dbi:db:sync:full:worker.${workerId}`;
        const pageLabel = `dbi:db:sync:full:page.w${workerId}`;
        const bulkPutLabel = `dbi:db:sync:full:bulkPut.w${workerId}`;
        let pagesFetched = 0;
        let pagesCommittedByWorker = 0;
        perfLogger.start(workerLabel);
        if (workerId > 0) await new Promise((r) => setTimeout(r, workerId * 200));
        try {
          while (getHasMore()) {
            const currentPage = claimPage();
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
                getCurrentNo(),
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
                  if (!fetchResp.ok) throw new Error(`HTTP ${fetchResp.status}`);
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
                setHasMore(false);
                return;
              }
              pageFetchedCount = items.length;
              pagesFetched++;
              buffer.set(currentPage, items);
              while (buffer.has(getNextExpectedPage())) {
                const expected = getNextExpectedPage();
                const batchItems = buffer.get(expected);
                buffer.delete(expected);
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
                      no: bumpCurrentNo()
                    };
                  });
                  perfLogger.start(bulkPutLabel);
                  await bulkPutSafe(
                    this.db.posts,
                    bulkData,
                    () => evictOldestNonCurrentUser(this.db, uploaderId)
                  );
                  markSeen(bulkData.map((r) => r.id));
                  perfLogger.end(bulkPutLabel, {
                    workerId,
                    page: expected,
                    count: bulkData.length
                  });
                  pagesCommittedByWorker++;
                  perfStats.pagesCommitted++;
                  const current = getCurrentNo();
                  reportProgress(current, total > current ? total : current);
                }
                bumpNextExpectedPage();
              }
            } catch (e) {
              workerLog.error("Page failed, stopping sync", {
                workerId,
                page: currentPage,
                error: e
              });
              markFailed();
              setHasMore(false);
            } finally {
              perfLogger.end(pageLabel, {
                workerId,
                page: currentPage,
                fetched: pageFetchedCount,
                attempts: pageAttempts
              });
            }
            if (getHasMore()) {
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
    }
async finalizeSyncMetadata(args) {
      const { userInfo, uploaderId, startId, total, reportProgress, succeeded } = args;
      if (succeeded) {
        const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
        localStorage.setItem(lastSyncKey, ( new Date()).toISOString());
        if (startId === 0) {
          localStorage.setItem(`di_post_metadata_v2_${uploaderId}`, "1");
        }
      }
      await this.cleanupStaleData(userInfo.id);
      reportProgress(total, total, "PREPARING");
      await this.refreshCriticalStats(userInfo, startId === 0);
      await requestPersistence();
    }
async quickSyncAllPosts(userInfo, onProgress) {
      if (!userInfo.id || !userInfo.name) return;
      if (AnalyticsDataManager.isGlobalSyncing) {
        log$7.warn("Sync already in progress");
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
        await this.refreshCriticalStats(userInfo, true);
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
        log$7.warn("Stale data cleanup failed", { error: e });
      }
    }
async refreshCriticalStats(userInfo, isFullSync = false) {
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




perfLogger.wrap(
            "dbi:db:refresh:topPostsByType",
            () => this.getTopPostsByType(userInfo, true)
          ),
          perfLogger.wrap(
            "dbi:db:refresh:recentPopular",
            () => this.getRecentPopularPosts(userInfo, true)
          )
        ]);
      } catch (e) {
        log$7.warn("Failed to refresh critical stats", { error: e });
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
  function createPhaseTracker(label, total, report) {
    let done = 0;
    const fmt = () => `${label} · ${done}/${total}`;
    report({ label: fmt() });
    return {
      subStatus: (msg) => report({ label: fmt(), detail: msg }),
      step: () => {
        done++;
        report({ label: fmt() });
      },
      finish: () => {
        done = total;
        report({ label: fmt() });
      }
    };
  }
  const TAG_CLOUD_MIN_UPLOADS = 100;
  const SCATTER_MIN_UPLOADS = 300;
  async function swrStats(dataManager, cacheKey, uploaderId, freshFetch, label, maxAgeMs) {
    if (!uploaderId) {
      const data2 = await perfLogger.wrap(label, freshFetch);
      return { data: data2 };
    }
    if (maxAgeMs !== void 0) {
      const fresh = await dataManager.getStats(
        cacheKey,
        uploaderId,
        maxAgeMs
      );
      if (fresh !== null) return { data: fresh };
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
  async function fetchHeavyDistributionsSwr(dataManager, user, uploaderId, sub, forceRevalidate) {
    const ttl = forceRevalidate ? void 0 : getCountCacheTtlMs();
    const defs = [
      {
        key: "character",
        cacheKey: "character_dist",
        label: "dbi:net:fetchData:character",
        fetch: () => {
          sub("Loading character distribution…");
          return dataManager.getCharacterDistribution(user, true, sub);
        }
      },
      {
        key: "copyright",
        cacheKey: "copyright_dist",
        label: "dbi:net:fetchData:copyright",
        fetch: () => {
          sub("Loading copyright distribution…");
          return dataManager.getCopyrightDistribution(user, true, sub);
        }
      },
      {
        key: "fav_copyright",
        cacheKey: "fav_copyright_dist",
        label: "dbi:net:fetchData:favCopyright",
        fetch: () => {
          sub("Loading favourite-copyright distribution…");
          return dataManager.getFavCopyrightDistribution(user, true, sub);
        }
      },
      {
        key: "breasts",
        cacheKey: "breasts_dist",
        label: "dbi:net:fetchData:breasts",
        fetch: () => {
          sub("Loading breast-size distribution…");
          return dataManager.getBreastsDistribution(user, true, sub);
        }
      },
      {
        key: "hair_length",
        cacheKey: "hair_length_dist",
        label: "dbi:net:fetchData:hairLength",
        fetch: () => {
          sub("Loading hair-length distribution…");
          return dataManager.getHairLengthDistribution(user, true, sub);
        }
      },
      {
        key: "hair_color",
        cacheKey: "hair_color_dist",
        label: "dbi:net:fetchData:hairColor",
        fetch: () => {
          sub("Loading hair-color distribution…");
          return dataManager.getHairColorDistribution(user, true, sub);
        }
      },
      {
        key: "gender",
        cacheKey: "gender_dist",
        label: "dbi:net:fetchData:gender",
        fetch: () => {
          sub("Loading gender distribution…");
          return dataManager.getGenderDistribution(user, true, sub);
        }
      },
      {
        key: "commentary",
        cacheKey: "commentary_dist",
        label: "dbi:net:fetchData:commentary",
        fetch: () => {
          sub("Loading commentary distribution…");
          return dataManager.getCommentaryDistribution(user, true, sub);
        }
      },
      {
        key: "translation",
        cacheKey: "translation_dist",
        label: "dbi:net:fetchData:translation",
        fetch: () => {
          sub("Loading translation distribution…");
          return dataManager.getTranslationDistribution(user, true, sub);
        }
      }
    ];
    const results = await Promise.all(
      defs.map(
        (d) => swrStats(
          dataManager,
          d.cacheKey,
          uploaderId,
          d.fetch,
          d.label,
          ttl
        )
      )
    );
    const distributions = {};
    const revalidators = [];
    results.forEach((r, i) => {
      distributions[defs[i].key] = r.data;
      revalidators.push([defs[i].cacheKey, r.startRevalidate]);
    });
    return { distributions, revalidators };
  }
  class UserAnalyticsDataService {
    db;
    rateLimiter;
constructor(db, rateLimiter = null) {
      this.db = db;
      this.rateLimiter = rateLimiter;
    }






async fetchDashboardData(context, prefetched, onProgress, forceDistRevalidate = false) {
      const dataManager = new AnalyticsDataManager(this.db, this.rateLimiter);
      const user = context.targetUser;
      const isNsfwEnabled = getNsfwEnabled();
      const progress = onProgress ?? (() => {
      });
      const tracker = createPhaseTracker("Loading dashboard", 14, progress);
      const sub = tracker.subStatus;
      sub("Loading summary stats…");
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
        distributionsSwr,
        statusSwr,
        ratingSwr,
        topPostsSwr,
        recentPopularSwr,
        milestones1kSwr,
        scatterData,
        levelChangesSwr,
        timelineMilestones,
        tagCloudGeneralSwr,
        userStats,
        needsBackfill
      ] = await Promise.all([
        (prefetched ? Promise.resolve(prefetched.syncStats) : perfLogger.wrap("dbi:net:fetchData:syncStats", () => {
          sub("Loading sync stats…");
          return dataManager.getSyncStats(user);
        })).finally(() => tracker.step()),
        (prefetched ? Promise.resolve(prefetched.totalCount) : perfLogger.wrap("dbi:net:fetchData:totalCount", () => {
          sub("Loading total post count…");
          return dataManager.getTotalPostCount(user);
        })).finally(() => tracker.step()),




fetchHeavyDistributionsSwr(
          dataManager,
          user,
          uploaderId,
          sub,
          forceDistRevalidate
        ).finally(() => tracker.step()),




swrStats(
          dataManager,
          "status_dist",
          uploaderId,
          () => {
            sub("Loading status counts…");
            return dataManager.getStatusDistribution(user, firstUploadDate, true);
          },
          "dbi:net:fetchData:status",
          getCountCacheTtlMs()
        ).finally(() => tracker.step()),
        swrStats(
          dataManager,
          "rating_dist",
          uploaderId,
          () => {
            sub("Loading rating counts…");
            return dataManager.getRatingDistribution(user, firstUploadDate, true);
          },
          "dbi:net:fetchData:rating",
          getCountCacheTtlMs()
        ).finally(() => tracker.step()),






swrStats(
          dataManager,
          "top_posts_by_type",
          uploaderId,
          () => {
            sub("Loading top posts by rating…");
            return dataManager.getTopPostsByType(user, true);
          },
          "dbi:net:fetchData:topPosts",
          getCountCacheTtlMs()
        ).finally(() => tracker.step()),
        swrStats(
          dataManager,
          "recent_popular_posts",
          uploaderId,
          () => {
            sub("Loading recent popular posts…");
            return dataManager.getRecentPopularPosts(user, true);
          },
          "dbi:net:fetchData:recentPopular",
          getCountCacheTtlMs()
        ).finally(() => tracker.step()),
        swrStats(
          dataManager,
          `milestones_1000_${isNsfwEnabled ? "1" : "0"}`,
          uploaderId,
          () => {
            sub("Loading milestones…");
            return dataManager.getMilestones(user, isNsfwEnabled, 1e3, true);
          },
          "dbi:net:fetchData:milestones1k",
          getCountCacheTtlMs()
        ).finally(() => tracker.step()),


(prefetched && prefetched.totalCount < SCATTER_MIN_UPLOADS ? Promise.resolve([]) : perfLogger.wrap("dbi:net:fetchData:scatterData", () => {
          sub("Loading scatter data…");
          return dataManager.getScatterData(user);
        })).finally(() => tracker.step()),
        swrStats(
          dataManager,
          "level_change_history",
          uploaderId,
          () => {
            sub("Loading level change history…");
            return dataManager.getLevelChangeHistory(user, true);
          },
          "dbi:net:fetchData:levelChanges",
          getCountCacheTtlMs()
        ).finally(() => tracker.step()),
        perfLogger.wrap("dbi:net:fetchData:timelineMilestones", () => {
          sub("Loading timeline milestones…");
          return dataManager.getTimelineMilestones(user);
        }).finally(() => tracker.step()),


(prefetched && prefetched.totalCount < TAG_CLOUD_MIN_UPLOADS ? Promise.resolve({ data: [] }) : swrStats(
          dataManager,
          "tag_cloud_general",
          uploaderId,
          () => {
            sub("Loading tag cloud…");
            return dataManager.getTagCloudData(user, 0, true);
          },
          "dbi:net:fetchData:tagCloudGeneral",
          getCountCacheTtlMs()
        )).finally(() => tracker.step()),
        perfLogger.wrap("dbi:net:fetchData:userStats", () => {
          sub("Loading user stats…");
          return dataManager.getUserStats(user);
        }).finally(() => tracker.step()),
        perfLogger.wrap("dbi:net:fetchData:needsBackfill", () => {
          sub("Checking post metadata backfill…");
          return dataManager.needsPostMetadataBackfill(user);
        }).finally(() => tracker.step())
      ]);
      tracker.finish();
      const distributions = {
        status: statusSwr.data,
        rating: ratingSwr.data,
        ...distributionsSwr.distributions
      };
      return {
        stats,
        total,
        summaryStats,
        distributions,
        statusStartRevalidate: statusSwr.startRevalidate,
        ratingStartRevalidate: ratingSwr.startRevalidate,




distributionRevalidators: distributionsSwr.revalidators,
        tagCloudGeneralStartRevalidate: tagCloudGeneralSwr.startRevalidate,
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
        tagCloudGeneral: tagCloudGeneralSwr.data,
        userStats,
        needsBackfill,
        dataManager
      };
    }
  }
  const TOOLTIP_CLASS = "di-subtag-tooltip";
  const HIDE_GRACE_MS$1 = 120;
  let state = null;
  function showSubtagTooltip(opts) {
    if (opts.items.length === 0) return;
    hideSubtagTooltip();
    const el2 = createBodyTooltip(TOOLTIP_CLASS);
    renderTooltipDom(el2, opts.parentDisplayName, opts.items);
    if (isTouchDevice()) {
      el2.style.opacity = "1";
      el2.style.pointerEvents = "auto";
      const measured = el2.getBoundingClientRect();
      const { top, left } = calcPopoverPositionBelowCentered(
        opts.anchor,
        measured.width
      );
      el2.style.top = `${top}px`;
      el2.style.left = `${left}px`;
    } else {
      const { top, left } = calcPopoverPosition(opts.anchor);
      el2.style.top = `${top}px`;
      el2.style.left = `${left}px`;
      el2.style.opacity = "1";
      el2.style.pointerEvents = "auto";
      const rect = el2.getBoundingClientRect();
      const margin = 8;
      const overflowBottom = rect.bottom + margin - window.innerHeight;
      if (overflowBottom > 0) {
        const minTopDoc = window.scrollY + margin;
        el2.style.top = `${Math.max(minTopDoc, top - overflowBottom)}px`;
      }
    }
    el2.onmouseenter = () => {
      if (state?.hideTimer) {
        clearTimeout(state.hideTimer);
        state.hideTimer = void 0;
      }
      if (opts.onPointerEnter) opts.onPointerEnter();
    };
    el2.onmouseleave = () => {
      scheduleSubtagTooltipHide();
      if (opts.onPointerLeave) opts.onPointerLeave();
    };
    const handler = createClickOutsideHandler(el2, () => hideSubtagTooltip(), {
      ignore: opts.outsideIgnore ?? opts.anchor
    });
    const attachTimer = setTimeout(() => {
      document.addEventListener("click", handler);
    }, 0);
    const cleanup = () => {
      clearTimeout(attachTimer);
      document.removeEventListener("click", handler);
    };
    state = { el: el2, cleanupClickOutside: cleanup, onHide: opts.onHide };
    if (opts.onShow) opts.onShow();
  }
  function hideSubtagTooltip() {
    if (!state) return;
    if (state.hideTimer) {
      clearTimeout(state.hideTimer);
      state.hideTimer = void 0;
    }
    if (state.cleanupClickOutside) state.cleanupClickOutside();
    state.el.style.opacity = "0";
    state.el.style.pointerEvents = "none";
    state.el.onmouseenter = null;
    state.el.onmouseleave = null;
    const onHide = state.onHide;
    state = null;
    if (onHide) onHide();
  }
  function scheduleSubtagTooltipHide() {
    if (!state) return;
    if (state.hideTimer) clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => hideSubtagTooltip(), HIDE_GRACE_MS$1);
  }
  function cancelSubtagTooltipHide() {
    if (!state?.hideTimer) return;
    clearTimeout(state.hideTimer);
    state.hideTimer = void 0;
  }
  function isSubtagTooltipVisible() {
    return state !== null;
  }
  function renderTooltipDom(el2, parentDisplayName, items) {
    el2.textContent = "";
    el2.classList.add(TOOLTIP_CLASS);
    const heading = document.createElement("div");
    heading.className = "di-subtag-tooltip-heading";
    heading.textContent = parentDisplayName;
    el2.appendChild(heading);
    const list = document.createElement("div");
    list.className = "di-subtag-tooltip-list";
    el2.appendChild(list);
    for (const item of items) {
      const useAnchor = item.href !== "";
      const row = useAnchor ? document.createElement("a") : document.createElement("span");
      row.className = "di-subtag-tooltip-item" + (item.isOther ? " di-subtag-tooltip-item--other" : "");
      row.title = item.displayName;
      if (useAnchor && row instanceof HTMLAnchorElement) {
        row.href = item.href;
        row.target = "_blank";
        row.rel = "noopener noreferrer";
      }
      const name = document.createElement("span");
      name.className = "di-subtag-tooltip-item-name";
      name.textContent = item.displayName;
      const share = document.createElement("span");
      share.className = "di-subtag-tooltip-item-share";
      share.textContent = `${(item.share * 100).toFixed(1)}%`;
      const count = document.createElement("span");
      count.className = "di-subtag-tooltip-item-count";
      count.textContent = item.count.toLocaleString();
      row.appendChild(name);
      row.appendChild(share);
      row.appendChild(count);
      list.appendChild(row);
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
  const log$6 = createLogger("UserAnalyticsCharts");
  const PIE_SVG_SIZE = 220;
  const PIE_RADIUS = 70;
  const RATING_COLORS = {
    g: "#28a745",
    s: "#fd7e14",
    q: "#6f42c1",
    e: "#dc3545"
  };
  const RATING_LABELS = {
    g: "General",
    s: "Sensitive",
    q: "Questionable",
    e: "Explicit"
  };
  const PIE_PALETTE = [
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
  const STATUS_COLORS = {
    active: "#2da44e",
    deleted: "#d73a49",
    pending: "#0969da",
    flagged: "#cf222e",
    banned: "#6e7781",
    appealed: "#bf3989"
  };
  const LEGEND_TITLES = {
    copyright: "COPYRIGHTS",
    character: "CHARACTERS",
    fav_copyright: "FAVORITE COPYRIGHTS",
    status: "STATUS",
    rating: "RATINGS",
    hair_length: "HAIR LENGTH",
    hair_color: "HAIR COLOR",
    breasts: "BREASTS",
    gender: "GENDER",
    commentary: "COMMENTARY",
    translation: "TRANSLATION"
  };
  const HAIR_LENGTH_ORDER = [
    "Bald",
    "Very Short Hair",
    "Short Hair",
    "Medium Hair",
    "Long Hair",
    "Very Long Hair",
    "Absurdly Long Hair"
  ];
  function preprocessFrequencyTab(data) {
    const total = data.reduce((acc, c) => acc + c.count, 0);
    return data.map((d) => ({
      ...d,
      frequency: total > 0 ? d.count / total : 0,
      value: total > 0 ? d.count / total : 0,
      label: d.name,
      details: { ...d, thumb: null }
    }));
  }
  function processSlices(data, currentPieTab) {
    return data.map((d, i) => {
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
        name: item.name,



subTags: item.subTags
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
          label: currentPieTab === "rating" ? RATING_LABELS[item.rating] || item.rating || "" : item.label || item.name || "",
          color: currentPieTab === "rating" ? RATING_COLORS[item.rating] || "#999" : currentPieTab === "hair_color" && item.color ? item.color : item.color || (item.isOther ? "#bdbdbd" : PIE_PALETTE[i % PIE_PALETTE.length]),
          details
        };
      } else {
        let sliceColor = item.isOther ? "#bdbdbd" : PIE_PALETTE[i % PIE_PALETTE.length];
        if (currentPieTab === "hair_color" && item.color) {
          sliceColor = item.color;
        }
        return {
          value: item.count ?? 0,
          label: item.name ?? "",
          color: sliceColor,
          details: tagDetails()
        };
      }
    });
  }
  function setShadowVisibility(chartWrapper, visible) {
    const shadow = chartWrapper.querySelector(".di-pie-shadow");
    if (shadow) shadow.style.opacity = visible ? "1" : "0";
  }
  function buildSubChartSlices(parent, parentColor) {
    const allSubs = parent.subTags ?? [];
    const displaySubs = allSubs.filter((s) => !s.isOther);
    if (displaySubs.length === 0) {
      if (!parentColor) return [];
      const parentLabel = (parent.name || parent.tagName || "").replace(
        /_/g,
        " "
      );
      return [
        {
          value: Math.max(1, parent.count ?? 0),
          label: parentLabel,
          color: parentColor,
          details: {
            kind: "tag",
            tagName: parent.tagName,
            name: parentLabel,
            count: parent.count ?? 0,
            isOther: false,
            thumb: null
          }
        }
      ];
    }
    const applyOthers = allSubs.filter((s) => s.isOther);
    const subSum = displaySubs.reduce((acc, s) => acc + s.count, 0);
    const applyOthersCount = applyOthers.reduce((acc, s) => acc + s.count, 0);
    const parentCount = parent.count ?? 0;
    const postCoverageOthers = Math.max(
      0,
      parentCount - subSum - applyOthersCount
    );
    const totalOthers = applyOthersCount + postCoverageOthers;
    const slices = displaySubs.map((s, i) => ({
      value: s.count,
      label: s.tagName.replace(/_/g, " "),
      color: PIE_PALETTE[i % PIE_PALETTE.length],
      details: {
        kind: "tag",
        tagName: s.tagName,
        name: s.tagName.replace(/_/g, " "),
        count: s.count,
        isOther: false,
        thumb: null
      }
    }));
    if (totalOthers > 0) {
      slices.push({
        value: totalOthers,
        label: "Others",
        color: "#bdbdbd",
        details: {
          kind: "tag",
          name: "Others",
          count: totalOthers,
          isOther: true,
          thumb: null
        }
      });
    }
    return slices;
  }
  function subSlicesToTooltipItems(slices, parentCount, queryPrefix) {
    const base = parentCount > 0 ? parentCount : slices.reduce((acc, s) => acc + s.value, 0);
    return slices.map((s) => {
      const details = s.details;
      const isOther = !!details.isOther;
      const tagName = isOther ? "Others" : details.tagName ?? "";
      return {
        tagName,
        displayName: isOther ? "Others" : tagName.replace(/_/g, " "),
        count: s.value,
        share: base > 0 ? s.value / base : 0,
        href: isOther ? "" : `/posts?tags=${encodeURIComponent(`${queryPrefix} ${tagName}`)}`,
        isOther
      };
    });
  }
  function buildSliceTooltipHtml(args) {
    const { details, color, label, currentPieTab, percentage } = args;
    const safeThumb = safeThumbUrl(details.thumb);
    const thumbHtml = safeThumb ? `
        <div style="width: 80px; height: 80px; border-radius: 4px; overflow: hidden; background: #333; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
          <img src="${escapeHtml$1(safeThumb)}" style="width: 100%; height: 100%; object-fit: cover;">
        </div>` : "";
    const sliceColor = safeColor(color);
    const safeLabel = escapeHtml$1(label);
    const isOtherSlice = details.kind === "tag" && !!details.isOther;
    if (currentPieTab === "rating") {
      return `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div>
              <div style="font-weight: bold; color: ${sliceColor}; margin-bottom: 4px; font-size: 14px;">${safeLabel}</div>
              <div style="font-size: 11px; color: #ccc;">Count: <strong style="color:#fff;">${details.count.toLocaleString()}</strong></div>
              <div style="font-size: 11px; color: #ccc;">Ratio: <strong style="color:#fff;">${percentage}</strong></div>
            </div>
          </div>
        `;
    }
    return `
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
  function buildChartScaffolding(pieContent, isFirefox) {
    pieContent.innerHTML = "";
    const chartWrapper = document.createElement("div");
    chartWrapper.className = "pie-chart-wrapper";
    chartWrapper.style.width = `${PIE_SVG_SIZE}px`;
    chartWrapper.style.height = `${PIE_SVG_SIZE}px`;
    chartWrapper.style.cursor = "pointer";
    if (!isFirefox) {
      chartWrapper.style.transformStyle = "preserve-3d";
      chartWrapper.style.transform = "rotateX(40deg) rotateY(0deg)";
      chartWrapper.style.transition = "transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
      const shadow = document.createElement("div");
      shadow.className = "di-pie-shadow";
      shadow.style.position = "absolute";
      shadow.style.top = "50%";
      shadow.style.left = "50%";
      shadow.style.width = "140px";
      shadow.style.height = "140px";
      shadow.style.transform = "translate(-50%, -50%) translateZ(-10px)";
      shadow.style.borderRadius = "50%";
      shadow.style.background = "var(--di-shadow, rgba(0,0,0,0.2))";
      shadow.style.filter = "blur(5px)";
      shadow.style.transition = "opacity 0.15s ease-out";
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
    d3__namespace.select(chartWrapper).append("svg").attr("width", PIE_SVG_SIZE).attr("height", PIE_SVG_SIZE).style("overflow", "visible").append("g").attr("transform", `translate(${PIE_SVG_SIZE / 2},${PIE_SVG_SIZE / 2})`);
    const legendDiv = document.createElement("div");
    legendDiv.className = "danbooru-grass-legend-scroll";
    legendDiv.style.display = "flex";
    legendDiv.style.flexDirection = "column";
    legendDiv.style.marginLeft = "20px";
    legendDiv.style.maxHeight = `${PIE_SVG_SIZE}px`;
    legendDiv.style.overflowY = "auto";
    legendDiv.style.paddingRight = "5px";
    const scrollbarStyle = document.createElement("style");
    scrollbarStyle.innerHTML = `
          .danbooru-grass-legend-scroll::-webkit-scrollbar { width: 6px; }
          .danbooru-grass-legend-scroll::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 3px; }
          .danbooru-grass-legend-scroll::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 3px; }
          .danbooru-grass-legend-scroll::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
       `;
    legendDiv.appendChild(scrollbarStyle);
    pieContent.appendChild(legendDiv);
    return chartWrapper;
  }
  function bindDesktopPieInteractions(args) {
    const {
      svg,
      validData,
      pie,
      arc,
      arcHover,
      tooltip,
      isTouch,
      currentPieTab,
      pctFor,
      handlePieClick
    } = args;
    svg.selectAll("path").data(pie(validData), (d) => d.data.label).join(
      (enter) => enter.append("path").attr("class", "danbooru-grass-pie-path").attr("d", arc).attr("fill", (d) => d.data.color).style("opacity", "0.9").style("cursor", "pointer"),








(update) => update.attr("class", "danbooru-grass-pie-path").attr("d", arc).attr("fill", (d) => d.data.color).style("opacity", "0.9").style("filter", null),




(exit) => exit.remove()
    ).attr("stroke", "var(--di-chart-bg, #fff)").style("stroke-width", "1px").on(
      "mouseover",
      function(event, d) {
        if (isTouch) return;
        d3__namespace.select(this).transition().duration(200).attr(
          "d",
          (td) => arcHover(td) ?? ""
        ).style("opacity", "1").style("filter", "drop-shadow(0px 0px 8px rgba(255,255,255,0.4))");
        const html = buildSliceTooltipHtml({
          details: d.data.details,
          color: d.data.color,
          label: d.data.label,
          currentPieTab,
          percentage: pctFor(d.data.label)
        });
        tooltip.html(html).style("left", event.pageX + 15 + "px").style("top", event.pageY + 15 + "px").style("opacity", 1);
      }
    ).on("mousemove", (event) => {
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
  }
  function bindTouchPieInteractions(args) {
    const {
      container: container2,
      chartWrapper,
      svg,
      arc,
      arcHover,
      tooltip,
      currentPieTab,
      pctFor,
      handlePieClick,
      hideTooltip
    } = args;
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
      const target = svg.selectAll("path.danbooru-grass-pie-path").filter((d) => d === datum).node();
      if (!target) return;
      resetSlices();
      pieTap.tap(datum);
      d3__namespace.select(target).transition().duration(200).attr(
        "d",
        (td) => arcHover(td) ?? ""
      ).style("opacity", "1");
      const html = buildSliceTooltipHtml({
        details: datum.data.details,
        color: datum.data.color,
        label: datum.data.label,
        currentPieTab,
        percentage: pctFor(datum.data.label)
      });
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
    svg.selectAll("path.danbooru-grass-pie-path").on("touchstart", (event, datum) => {
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
  function renderPieLegend(args) {
    const {
      legendDiv,
      processedData,
      currentPieTab,
      pctFor,
      normalizedName,
      chartModeControl
    } = args;
    const legendTitle = LEGEND_TITLES[currentPieTab] ?? "DIST.";
    const styleTag = legendDiv.querySelector("style")?.outerHTML ?? "";
    const subtagTooltipEnabled = currentPieTab === "copyright" || currentPieTab === "fav_copyright" || currentPieTab === "character";
    const queryPrefix = currentPieTab === "fav_copyright" ? `ordfav:${normalizedName}` : `user:${normalizedName}`;
    const listHtml = processedData.map((d, idx) => {
      const pct = pctFor(d.label);
      const isOtherSlice = d.details.kind === "tag" && !!d.details.isOther;
      let targetUrl = "#";
      if (!isOtherSlice) {
        const query = buildSearchQuery(
          d.details,
          d.label,
          normalizedName,
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
      const isLegendHoverRow = subtagTooltipEnabled && d.details.kind === "tag";
      const subtagAttr = isLegendHoverRow ? ` data-di-subtag-idx="${idx}"` : "";
      return `
               <div${subtagAttr} style="display:flex; align-items:center; font-size:0.85em; margin-bottom:5px;">
                  <div style="width:12px; height:12px; background:${swatchColor}; border-radius:2px; margin-right:8px; border:1px solid var(--di-shadow-light, rgba(0,0,0,0.1)); flex-shrink:0;"></div>
                  ${isOtherSlice ? `<div style="color:var(--di-text-secondary, #666); width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${safeLabel}">${safeLabel}</div>` : `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="di-hover-underline" style="color:var(--di-text-secondary, #666); width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:none;" title="${safeLabel}">${safeLabel}</a>`}
                  <div style="font-weight:bold; color:var(--di-text, #333); margin-left:auto;" title="${countTitle}">${pct}</div>
               </div>`;
    }).join("");
    legendDiv.innerHTML = styleTag + `
           <div style="font-size:0.8em; color:var(--di-text-muted, #888); margin-bottom:8px; text-transform:uppercase; position:sticky; top:0; background:var(--di-chart-bg, #fff); padding-bottom:4px; border-bottom:1px solid var(--di-border-light, #eee);">${legendTitle}</div>
           ${listHtml}
      `;
    if (subtagTooltipEnabled) {
      wireSubtagTooltipHandlers(
        legendDiv,
        processedData,
        queryPrefix,
        chartModeControl
      );
    }
  }
  const legendContainerListenerRegistry = new WeakMap();
  function wireSubtagTooltipHandlers(legendDiv, processedData, queryPrefix, chartModeControl) {
    const ENTER_DEBOUNCE_MS = 120;
    const EXIT_GRACE_MS = 150;
    let pendingEnter = null;
    let pendingExit = null;
    const cancelPendingEnter = () => {
      if (pendingEnter !== null) {
        clearTimeout(pendingEnter);
        pendingEnter = null;
      }
    };
    const cancelPendingExit = () => {
      if (pendingExit !== null) {
        clearTimeout(pendingExit);
        pendingExit = null;
      }
    };
    const scheduleExit = () => {
      cancelPendingExit();
      pendingExit = setTimeout(() => {
        pendingExit = null;
        hideSubtagTooltip();
        chartModeControl?.exit();
      }, EXIT_GRACE_MS);
    };
    const legendEl = legendDiv;
    const prevListeners = legendContainerListenerRegistry.get(legendEl);
    if (prevListeners) {
      legendEl.removeEventListener("mouseenter", prevListeners.enter);
      legendEl.removeEventListener("mouseleave", prevListeners.leave);
    }
    const enterHandler = () => cancelPendingExit();
    const leaveHandler = () => {
      cancelPendingEnter();
      scheduleExit();
    };
    legendEl.addEventListener("mouseenter", enterHandler);
    legendEl.addEventListener("mouseleave", leaveHandler);
    legendContainerListenerRegistry.set(legendEl, {
      enter: enterHandler,
      leave: leaveHandler
    });
    const rows = legendDiv.querySelectorAll("[data-di-subtag-idx]");
    rows.forEach((row) => {
      const idx = parseInt(row.dataset["diSubtagIdx"] || "-1", 10);
      if (idx < 0 || idx >= processedData.length) return;
      const slice = processedData[idx];
      if (slice.details.kind !== "tag") return;
      if (slice.details.isOther) {
        row.addEventListener("mouseenter", () => {
          cancelPendingExit();
          cancelPendingEnter();
          hideSubtagTooltip();
          chartModeControl?.exit();
        });
        return;
      }
      const parentName = slice.label;
      const parentColor = slice.color;
      const parentItem = {
        name: parentName,
        tagName: slice.details.tagName ?? "",
        count: slice.details.count ?? 0,
        frequency: slice.details.frequency ?? 0,
        thumb: slice.details.thumb ?? null,
        isOther: false,
        subTags: slice.details.subTags
      };
      const subSlices = buildSubChartSlices(parentItem);
      const items = subSlicesToTooltipItems(
        subSlices,
        parentItem.count,
        queryPrefix
      );
      const hasBreakdown = items.length > 0;
      let touchUsed = false;
      const showTooltipAndChart = () => {
        if (hasBreakdown) {
          showSubtagTooltip({
            parentDisplayName: parentName,
            items,
            anchor: row,
            onShow: () => chartModeControl?.enter(parentItem, parentColor),






onHide: () => subRowHighlight.reset(),
            onPointerEnter: cancelPendingExit,
            onPointerLeave: scheduleExit
          });
          if (chartModeControl && !chartModeControl.isTouch) {
            subRowHighlight.attach(items);
          }
        } else {
          hideSubtagTooltip();
          chartModeControl?.enter(parentItem, parentColor);
        }
      };
      const subRowHighlight = (() => {
        let highlightedTag = null;
        const reset = () => {
          if (!chartModeControl) return;
          const svg = chartModeControl.svg;
          const arc = chartModeControl.arc;
          svg.selectAll("path.danbooru-grass-pie-path").transition().duration(150).attr("d", (td) => arc(td) ?? "").style("opacity", "0.9");
          highlightedTag = null;
        };
        const highlight = (tagName) => {
          if (!chartModeControl) return;
          const target = chartModeControl.findSubSliceByTag(tagName);
          if (!target) return;
          const svg = chartModeControl.svg;
          const arc = chartModeControl.arc;
          const arcHover = chartModeControl.arcHover;
          svg.selectAll("path.danbooru-grass-pie-path").transition().duration(150).attr("d", (td) => arc(td) ?? "").style("opacity", "0.35");
          d3__namespace.select(target).transition().duration(150).attr(
            "d",
            (td) => arcHover(td) ?? ""
          ).style("opacity", "1");
          highlightedTag = tagName;
        };
        const attach = (rowItems) => {
          const tooltipEl = document.querySelector(".di-subtag-tooltip");
          if (!tooltipEl) return;
          const tooltipRows = tooltipEl.querySelectorAll(
            ".di-subtag-tooltip-item"
          );
          tooltipRows.forEach((rowEl, i) => {
            const item = rowItems[i];
            if (!item || item.isOther) return;
            rowEl.addEventListener("mouseenter", () => highlight(item.tagName));
          });
          tooltipEl.addEventListener("mouseleave", () => {
            if (highlightedTag) reset();
          });
        };
        return { attach, reset };
      })();
      row.addEventListener("mouseenter", () => {
        if (touchUsed) return;
        cancelPendingExit();
        cancelPendingEnter();
        if (hasBreakdown) cancelSubtagTooltipHide();
        pendingEnter = setTimeout(() => {
          pendingEnter = null;
          showTooltipAndChart();
        }, ENTER_DEBOUNCE_MS);
      });
      row.addEventListener("mouseleave", () => {
        if (touchUsed) return;
        cancelPendingEnter();
      });
      if (hasBreakdown) {
        row.addEventListener(
          "touchstart",
          () => {
            touchUsed = true;
          },
          { passive: true }
        );
        const anchorEl = row.querySelector("a[href]");
        if (anchorEl) {
          anchorEl.addEventListener("click", (e) => {
            if (!touchUsed) return;
            if (isSubtagTooltipVisible()) return;
            e.preventDefault();
            showTooltipAndChart();
          });
        }
      }
    });
  }
  async function fetchDistributionForTab(tabName, dataManager, user, firstUploadDate) {
    if (tabName === "rating") {
      return dataManager.getRatingDistribution(user, firstUploadDate);
    }
    if (tabName === "status") {
      const data = await dataManager.getStatusDistribution(user, firstUploadDate);
      return data.map((d) => ({
        ...d,
        color: STATUS_COLORS[d.name] || "#888"
      }));
    }
    if (tabName === "character") {
      return dataManager.getCharacterDistribution(user);
    }
    if (tabName === "copyright") {
      return dataManager.getCopyrightDistribution(user);
    }
    if (tabName === "fav_copyright") {
      return dataManager.getFavCopyrightDistribution(user);
    }
    if (tabName === "breasts") {
      return preprocessFrequencyTab(
        await dataManager.getBreastsDistribution(user)
      );
    }
    if (tabName === "gender") {
      return preprocessFrequencyTab(
        await dataManager.getGenderDistribution(user)
      );
    }
    if (tabName === "commentary") {
      return preprocessFrequencyTab(
        await dataManager.getCommentaryDistribution(user)
      );
    }
    if (tabName === "translation") {
      return preprocessFrequencyTab(
        await dataManager.getTranslationDistribution(user)
      );
    }
    return [];
  }
  function runTabCrossfade(args) {
    const { pieContent, mode, loadTab, getCurrentTab } = args;
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
      if (getCurrentTab() !== mode) {
        snapshot.remove();
        return;
      }
      requestAnimationFrame(() => {
        snapshot.style.opacity = "0";
        setTimeout(() => snapshot.remove(), TRANSITION_MS2);
      });
    });
  }
  function renderPieFrame(args) {
    const {
      container: container2,
      pieData,
      currentPieTab,
      context,
      handlePieClick,
      setSubChartActive
    } = args;
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
      data.sort(
        (a, b) => HAIR_LENGTH_ORDER.indexOf(a.name ?? "") - HAIR_LENGTH_ORDER.indexOf(b.name ?? "")
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
    const processedData = processSlices(data, currentPieTab);
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
      chartWrapper = buildChartScaffolding(pieContent, isFirefox);
    }
    const svg = d3__namespace.select(chartWrapper).select("svg g");
    const pie = d3__namespace.pie().value((d) => d.value).sort(null);
    const arc = d3__namespace.arc().innerRadius(0).outerRadius(PIE_RADIUS);
    const arcHover = d3__namespace.arc().innerRadius(0).outerRadius(PIE_RADIUS * 1.2);
    const tooltip = d3__namespace.select(createBodyTooltip("danbooru-grass-pie-tooltip")).style("background", "rgba(30, 30, 30, 0.95)").style("color", "#fff").style("padding", "8px 12px").style("border-radius", "6px").style("font-size", "12px").style("cursor", isTouch ? "pointer" : "default");
    const hideTooltip = () => {
      tooltip.style("opacity", 0).style("pointer-events", "none");
    };
    const applyChartData = (slicesToShow, localPctFor) => {
      svg.selectAll("path").interrupt();
      bindDesktopPieInteractions({
        svg,
        validData: slicesToShow,
        pie,
        arc,
        arcHover,
        tooltip,
        isTouch,
        currentPieTab,
        pctFor: localPctFor,
        handlePieClick
      });
      if (isTouch) {
        bindTouchPieInteractions({
          container: container2,
          chartWrapper,
          svg,
          arc,
          arcHover,
          tooltip,
          currentPieTab,
          pctFor: localPctFor,
          handlePieClick,
          hideTooltip
        });
      }
    };
    applyChartData(validData, pctFor);
    const SUB_CHART_TRANSITION_MS = 350;
    const FADE_HALF_MS = SUB_CHART_TRANSITION_MS / 2;
    const baselineChartTransition = chartWrapper.style.transition;
    let crossfadeGen = 0;
    const crossfadeChartTransition = (apply) => {
      const cw = chartWrapper;
      const myGen = ++crossfadeGen;
      const extendedTransition = baselineChartTransition ? `${baselineChartTransition}, opacity ${FADE_HALF_MS}ms ease` : `opacity ${FADE_HALF_MS}ms ease`;
      cw.style.transition = extendedTransition;
      cw.style.opacity = "0";
      setTimeout(() => {
        if (myGen !== crossfadeGen) return;
        apply();
        requestAnimationFrame(() => {
          if (myGen !== crossfadeGen) return;
          void cw.getBoundingClientRect();
          cw.style.opacity = "1";
        });
        setTimeout(() => {
          if (myGen === crossfadeGen) {
            cw.style.transition = baselineChartTransition;
          }
        }, FADE_HALF_MS);
      }, FADE_HALF_MS);
    };
    let subChartActive = null;
    const enterSubChartMode = (parent, parentColor) => {
      const subSlices = buildSubChartSlices(parent, parentColor);
      if (subSlices.length === 0) return;
      const subPctStrings = computePercentages(
        subSlices.map((s) => s.value),
        1
      );
      const subPctByLabel = new Map(
        subSlices.map((s, i) => [s.label, subPctStrings[i]])
      );
      const subPctFor = (label) => subPctByLabel.get(label) ?? "0.0%";
      subChartActive = {
        tagToLabel: new Map(
          subSlices.filter((s) => s.details.kind === "tag" && !s.details.isOther).map((s) => [
            s.details.tagName ?? s.label,
            s.label
          ])
        ),
        parentTag: parent.tagName
      };
      setSubChartActive?.(true);
      crossfadeChartTransition(() => {
        setShadowVisibility(chartWrapper, false);
        applyChartData(subSlices, subPctFor);
      });
    };
    const exitSubChartMode = (forParentTag) => {
      if (!subChartActive) return;
      if (forParentTag && subChartActive.parentTag !== forParentTag) return;
      subChartActive = null;
      setSubChartActive?.(false);
      crossfadeChartTransition(() => {
        setShadowVisibility(chartWrapper, true);
        applyChartData(validData, pctFor);
      });
    };
    const findSubSliceByTag = (tagName) => {
      const label = subChartActive?.tagToLabel.get(tagName);
      if (!label) return null;
      return svg.selectAll("path.danbooru-grass-pie-path").filter(
        (d) => d.data.label === label
      ).node() ?? null;
    };
    const legendDiv = pieContent.querySelector(".danbooru-grass-legend-scroll");
    if (legendDiv) {
      renderPieLegend({
        legendDiv,
        processedData,
        currentPieTab,
        pctFor,
        normalizedName: contextUser.normalizedName ?? "",
        chartModeControl: {
          enter: enterSubChartMode,
          exit: exitSubChartMode,
          findSubSliceByTag,
          isTouch,
          svg,
          arc,
          arcHover
        }
      });
    }
  }
  function renderPieWidget(container2, distributions, initialNsfwEnabled, dataManager, context, firstUploadDate) {
    const pieData = { ...distributions };
    let currentPieTab = "copyright";
    let renderPending = false;
    let isNsfwEnabled = initialNsfwEnabled;
    for (const key of ["breasts", "gender", "commentary", "translation"]) {
      if (pieData[key]) {
        pieData[key] = preprocessFrequencyTab(pieData[key]);
      }
    }
    let subChartIsActive = false;
    let pendingFreshRender = false;
    const requestRender = () => {
      if (renderPending) return;
      renderPending = true;
      requestAnimationFrame(() => {
        renderPieContent();
        renderPending = false;
      });
    };
    const PIE_KEY_BY_CONTENT = {
      character_dist: "character",
      copyright_dist: "copyright",
      fav_copyright_dist: "fav_copyright",
      breasts_dist: "breasts",
      hair_length_dist: "hair_length",
      hair_color_dist: "hair_color",
      gender_dist: "gender",
      commentary_dist: "commentary",
      translation_dist: "translation",
      status_dist: "status",
      rating_dist: "rating"
    };
    const PIE_CONTENT_BY_KEY = Object.fromEntries(
      Object.entries(PIE_KEY_BY_CONTENT).map(([content, tab]) => [tab, content])
    );
    const onPieDataUpdate = (e) => {
      if (!document.body.contains(container2)) {
        window.removeEventListener(
          "DanbooruInsights:DataUpdated",
          onPieDataUpdate
        );
        return;
      }
      const { contentType, data } = e.detail;
      const key = PIE_KEY_BY_CONTENT[contentType];
      if (!key || !pieData[key] || !Array.isArray(data)) return;
      const incoming = data;
      let next;
      if (key === "status") {
        next = incoming.map((d) => ({
          ...d,
          color: STATUS_COLORS[d.name] || "#888"
        }));
      } else if (key === "breasts" || key === "gender" || key === "commentary" || key === "translation") {
        next = preprocessFrequencyTab(incoming);
      } else {
        next = incoming.map((d) => ({ ...d }));
      }
      const prevByName = new Map(
        pieData[key].map((it) => [it.name, it])
      );
      next.forEach((it) => {
        if (!it.thumb) {
          const prev = prevByName.get(it.name);
          if (prev?.thumb) it.thumb = prev.thumb;
        }
      });
      pieData[key] = next;
      if (currentPieTab === key) {
        if (subChartIsActive) {
          pendingFreshRender = true;
          return;
        }
        requestRender();
      }
    };
    window.addEventListener("DanbooruInsights:DataUpdated", onPieDataUpdate);
    const refreshingTabs = new Set();
    const updatePieUpdatingBadge = () => {
      const badge = container2.querySelector(".di-pie-updating-badge");
      badge?.classList.toggle("is-active", refreshingTabs.has(currentPieTab));
    };
    const onPieTabRefreshing = (e) => {
      if (!document.body.contains(container2)) {
        window.removeEventListener(
          "DanbooruInsights:PieTabRefreshing",
          onPieTabRefreshing
        );
        return;
      }
      const { contentType, active } = e.detail;
      const tab = PIE_KEY_BY_CONTENT[contentType];
      if (!tab) return;
      if (active) refreshingTabs.add(tab);
      else refreshingTabs.delete(tab);
      if (tab === currentPieTab) updatePieUpdatingBadge();
    };
    window.addEventListener(
      "DanbooruInsights:PieTabRefreshing",
      onPieTabRefreshing
    );
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
      renderPieFrame({
        container: container2,
        pieData,
        currentPieTab,
        context,
        handlePieClick,
        setSubChartActive: (active) => {
          subChartIsActive = active;
          if (!active && pendingFreshRender) {
            pendingFreshRender = false;
            requestRender();
          }
        }
      });
    };
    const updatePieTabs = () => {
      const btns = container2.querySelectorAll(".di-pie-tab");
      btns.forEach((btn) => {
        const el2 = btn;
        const mode = el2.getAttribute("data-mode");
        if (mode === currentPieTab) {
          el2.style.background = "var(--di-text-secondary, #666)";
          el2.style.color = "var(--di-bg, #fff)";
          el2.style.boxShadow = "0 1px 3px var(--di-shadow-light, rgba(0,0,0,0.1))";
        } else {
          el2.style.background = "var(--di-bg-tertiary, #f0f0f0)";
          el2.style.color = "var(--di-text-secondary, #666)";
          el2.style.boxShadow = "none";
        }
      });
    };
    container2.innerHTML = `
     <div style="width:100%; display:flex; flex-direction:column;">
         <div style="position:relative; display:flex; align-items:center; margin-bottom:10px; width:100%;">
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
             <span class="di-pie-updating-badge" title="Refreshing this tab's counts in the background">
                 <span class="di-pie-updating-spin">⟳</span>Updating…
             </span>
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
        const data = await fetchDistributionForTab(
          tabName,
          dataManager,
          context.targetUser,
          firstUploadDate
        );
        pieData[tabName] = data;
        if (currentPieTab === tabName) {
          renderPieContent();
          updatePieTabs();
        }
      } catch (e) {
        log$6.error("Failed to load pie chart data", { error: e });
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
          const contentKey = PIE_CONTENT_BY_KEY[mode];
          if (contentKey) {
            window.dispatchEvent(
              new CustomEvent("DanbooruInsights:PieTabActivated", {
                detail: { contentType: contentKey }
              })
            );
          }
          updatePieUpdatingBadge();
          const pieContent = container2.querySelector(
            ".pie-content"
          );
          if (!pieContent) {
            void loadTab(mode);
            return;
          }
          runTabCrossfade({
            pieContent,
            mode,
            loadTab,
            getCurrentTab: () => currentPieTab
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
  function renderTopPostsWidget(container2, topPosts, recentPopularPosts, randomPosts, initialNsfwEnabled, dataManager, context) {
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
        return `<div>${icon} <strong>${label}:</strong> ${escapeHtml$1(displayTags)}</div>`;
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
          const newRandoms = await dataManager.getRandomPosts(context.targetUser);
          topPostGroups["random"] = newRandoms;
          renderTopPostContent();
        } catch (err) {
          log$6.error("Failed to refresh random post", { error: err });
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
  async function renderMilestonesWidget(container2, db, dataManager, context, initialNsfwEnabled) {
    let isNsfwEnabled = initialNsfwEnabled;
    let currentMilestoneStep = "auto";
    let isMilestoneExpanded = false;
    const renderMilestones = async () => {
      const milestones = await dataManager.getMilestones(
        context.targetUser,
        isNsfwEnabled,
        currentMilestoneStep
      );
      const uploaderId = parseInt(context.targetUser?.id ?? "0");
      const totalPosts = uploaderId ? await db.posts.where("uploader_id").equals(uploaderId).count() : 0;
      const nextTarget = dataManager.getNextMilestone(
        totalPosts,
        currentMilestoneStep
      );
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
      msHtml += `<div id="${containerId}" class="di-milestone-collapsed" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap:10px; max-height:110px; overflow:hidden; transition: max-height 0.3s ease;">`;
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
          milestoneContainer.classList.remove("di-milestone-collapsed");
          milestoneContainer.style.maxHeight = milestoneContainer.scrollHeight + "px";
          btn.textContent = "Show Less";
        }
        btn.onclick = () => {
          isMilestoneExpanded = !isMilestoneExpanded;
          if (isMilestoneExpanded) {
            milestoneContainer.classList.remove("di-milestone-collapsed");
            milestoneContainer.style.maxHeight = milestoneContainer.scrollHeight + "px";
            btn.textContent = "Show Less";
          } else {
            milestoneContainer.classList.add("di-milestone-collapsed");
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
  async function renderHistoryChart(container2, dataManager, context, milestones1k, levelChanges) {
    let minDate = null;
    if (levelChanges.length > 0) {
      minDate = levelChanges[0].date;
    }
    const isTouch2 = isTouchDevice();
    const monthly = await dataManager.getMonthlyStats(
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
  const log$5 = createLogger("Scatter");
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
  function computeScatterScale(state2, scatterData, w, h) {
    const padL = 40;
    const padR = 20;
    const padT = 60;
    const padB = 50;
    const drawW = w - padL - padR;
    const drawH = h - padT - padB;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxVal = 0;
    if (state2.selectedYear) {
      minX = new Date(state2.selectedYear, 0, 1).getTime();
      maxX = new Date(state2.selectedYear, 11, 31, 23, 59, 59).getTime();
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
        const val = state2.mode === "tags" ? d.t || 0 : d.s;
        if (val > maxVal) maxVal = val;
      }
    }
    if (maxVal === 0) maxVal = 100;
    let stepY;
    if (state2.mode === "tags") {
      if (maxVal < 50) stepY = 10;
      else if (maxVal < 200) stepY = 25;
      else stepY = 50;
    } else {
      stepY = niceStepForCount(maxVal, 6);
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
      mode: state2.mode,
      stepY
    };
  }
  function filterVisiblePoints(state2, scatterData, scale) {
    const dvFilter = state2.mode === "score" ? state2.activeDownvoteFilter : null;
    return scatterData.filter((d) => {
      if (!state2.activeRatingFilters[d.r]) return false;
      if (d.d < scale.minDate || d.d > scale.maxDate) return false;
      if (dvFilter !== null) {
        if (d.dn === void 0) return false;
        if (-d.dn <= dvFilter) return false;
      }
      return true;
    });
  }
  function niceStepForCount(maxVal, targetSections = 6) {
    if (maxVal <= 0 || targetSections <= 0) return 1;
    const raw = maxVal / targetSections;
    const exp = Math.floor(Math.log10(raw));
    const base = Math.pow(10, exp);
    const ratio = raw / base;
    const niceMults = base < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
    let best = niceMults[0];
    let bestDiff = Math.abs(ratio - best);
    for (const m of niceMults) {
      const diff = Math.abs(ratio - m);
      if (diff < bestDiff) {
        best = m;
        bestDiff = diff;
      }
    }
    return best * base;
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
  function drawScatterAxis(ctx, state2, scale, w, canvas) {
    const pal = getPalette(canvas);
    ctx.beginPath();
    ctx.strokeStyle = pal.border;
    ctx.moveTo(scale.padL, scale.padT + scale.drawH);
    ctx.lineTo(w - PAD_R, scale.padT + scale.drawH);
    ctx.stroke();
    ctx.fillStyle = pal.chartAxisSecondary;
    ctx.textAlign = "center";
    if (state2.selectedYear) {
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
  function drawScatterPoints(ctx, points, state2, scale) {
    const thresholdActive = state2.activeYThreshold !== null;
    const y10Active = !thresholdActive && state2.y10Highlight && state2.mode === "tags";
    const threshold = state2.activeYThreshold ?? 0;
    const highlightedPoints = [];
    points.forEach((pt) => {
      const xVal = pt.d;
      const yVal = state2.mode === "tags" ? pt.t || 0 : pt.s;
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
  function regenerateYGridHits(state2, dom, scale, userName, twoStepTap, rerender) {
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
          if (state2.activeYThreshold === val) return;
          state2.activeYThreshold = val;
          rerender();
        });
        hit.addEventListener("mouseleave", () => {
          if (state2.activeYThreshold !== val) return;
          state2.activeYThreshold = null;
          rerender();
        });
        hit.addEventListener("click", (e) => {
          e.stopPropagation();
          const url = buildPostsUrlForThreshold(userName, state2.mode, val);
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
  function renderScatterCanvas(state2, dom, scatterData, context, levelChanges, options, userName, twoStepTap, rerender) {
    const { ctx, canvas, canvasContainer, scatterDiv, overlayDiv } = dom;
    if (!scatterDiv.isConnected || !ctx) return;
    if (!state2.dragStart) {
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
    const newScale = computeScatterScale(state2, scatterData, w, h);
    Object.assign(state2.scale, newScale);
    if (state2.selectedYear) {
      dom.resetBtn.style.display = "block";
      dom.yearLabel.textContent = String(state2.selectedYear);
      dom.yearLabel.style.display = "block";
    } else {
      dom.resetBtn.style.display = "none";
      dom.yearLabel.style.display = "none";
    }
    const visiblePoints = filterVisiblePoints(state2, scatterData, state2.scale);
    if (state2.activeYThreshold !== null) {
      const t = state2.activeYThreshold;
      const matched = visiblePoints.reduce((acc, d) => {
        const yVal = state2.mode === "tags" ? d.t || 0 : d.s;
        return yVal >= t ? acc + 1 : acc;
      }, 0);
      dom.countLabel.textContent = `${matched} items`;
    } else {
      dom.countLabel.textContent = `${visiblePoints.length} items`;
    }
    const { y10Pos } = drawScatterGrid(ctx, state2.scale, w, canvas);
    const finalY10 = drawY10Emphasis(ctx, state2.scale, w, y10Pos);
    if (state2.scale.mode !== "tags" || finalY10 === null || !options.userStats) {
      dom.y10Hit.style.display = "none";
    } else {
      dom.y10Hit.style.display = "block";
      dom.y10Hit.style.top = `${finalY10 - 9}px`;
    }
    if (state2.activeYThreshold !== null) {
      drawYThresholdLine(ctx, state2.scale, w, state2.activeYThreshold);
    }
    regenerateYGridHits(state2, dom, state2.scale, userName, twoStepTap, rerender);
    drawScatterAxis(ctx, state2, state2.scale, w, canvas);
    drawScatterPoints(ctx, visiblePoints, state2, state2.scale);
    drawScatterOverlays(overlayDiv, state2.scale, context, levelChanges);
  }
  function updateDownvoteButtonStyles(state2, dom) {
    dom.downvoteButtons.forEach((btn) => {
      const t = parseInt(btn.dataset.threshold ?? "0");
      const isActive = state2.activeDownvoteFilter === t;
      const isDisabled = state2.backfillInProgress || state2.backfillFailed;
      btn.disabled = isDisabled;
      btn.style.opacity = isDisabled ? "0.5" : "1";
      btn.style.cursor = isDisabled ? "not-allowed" : "pointer";
      btn.style.background = isActive ? "#d73a49" : "var(--di-bg, #fff)";
      btn.style.color = isActive ? "#fff" : "var(--di-text, #333)";
      btn.style.borderColor = isActive ? "#d73a49" : "var(--di-border-input, #ddd)";
      btn.title = isDisabled ? state2.backfillFailed ? "Downvote data unavailable (fetch failed)" : "Backfilling downvote data..." : `Show only posts with more than ${t} downvotes`;
    });
  }
  function updateDownvoteVisibility(state2, dom) {
    dom.downvoteContainer.style.display = state2.mode === "score" ? "flex" : "none";
  }
  function wireModeToggle(state2, dom, rerender, clearYThreshold) {
    dom.toggleButtons.forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.mode;
        if (state2.mode === id) return;
        state2.mode = id;
        Array.from(dom.toggleContainer.children).forEach((b) => {
          const bEl = b;
          bEl.style.background = bEl.dataset.mode === id ? "var(--di-link, #007bff)" : "var(--di-bg, #fff)";
          bEl.style.color = bEl.dataset.mode === id ? "var(--di-btn-active-text, #fff)" : "var(--di-text, #333)";
        });
        if (id !== "score" && state2.activeDownvoteFilter !== null) {
          state2.activeDownvoteFilter = null;
          updateDownvoteButtonStyles(state2, dom);
        }
        updateDownvoteVisibility(state2, dom);
        clearYThreshold();
        rerender();
      };
    });
  }
  function wireDownvoteFilter(state2, dom, rerender) {
    dom.downvoteButtons.forEach((btn) => {
      btn.onclick = () => {
        if (btn.disabled) return;
        const t = parseInt(btn.dataset.threshold ?? "0");
        if (state2.activeDownvoteFilter === t) {
          state2.activeDownvoteFilter = null;
        } else {
          state2.activeDownvoteFilter = t;
        }
        updateDownvoteButtonStyles(state2, dom);
        rerender();
      };
    });
    updateDownvoteButtonStyles(state2, dom);
  }
  function wireRatingFilter(state2, dom, rerender) {
    dom.ratingButtons.forEach(({ key, root, circle, color }) => {
      root.onclick = () => {
        state2.activeRatingFilters[key] = !state2.activeRatingFilters[key];
        if (state2.activeRatingFilters[key]) {
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
  function wireYearReset(state2, dom, rerender, clearYThreshold) {
    dom.resetBtn.onclick = () => {
      state2.selectedYear = null;
      dom.resetBtn.style.display = "none";
      dom.yearLabel.style.display = "none";
      clearYThreshold();
      rerender();
    };
  }
  function wireY10Tooltip(state2, dom, options, context, rerender) {
    const closeY10Tooltip = () => {
      dom.y10Tooltip.style.display = "none";
      state2.y10Highlight = false;
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
      state2.y10Highlight = true;
      rerender();
    });
    dom.y10Hit.addEventListener("mouseleave", () => {
      if (dom.y10Tooltip.style.display !== "none") return;
      state2.y10Highlight = false;
      rerender();
    });
    dom.y10Hit.onclick = (e) => {
      e.stopPropagation();
      if (!options.userStats) return;
      state2.y10Highlight = true;
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
  function wireBackfillUi(state2, dom, options, scatterData, rerender) {
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
      state2.backfillInProgress = false;
      progressLabel.remove();
      updateDownvoteButtonStyles(state2, dom);
      if (options.refreshScatterData) {
        try {
          const fresh = await options.refreshScatterData();
          scatterData.length = 0;
          scatterData.push(...fresh);
          rerender();
        } catch (e) {
          log$5.warn("Refresh after backfill failed", { error: e });
        }
      }
    }).catch((e) => {
      log$5.warn("Backfill failed", { error: e });
      state2.backfillInProgress = false;
      state2.backfillFailed = true;
      progressLabel.textContent = "failed";
      updateDownvoteButtonStyles(state2, dom);
    });
  }
  function wireYearZoom(state2, dom, rerender, clearYThreshold) {
    dom.canvas.addEventListener("click", (e) => {
      if (Date.now() - state2.lastDragEndTime < 100) return;
      const rect = dom.canvasContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const axisY = state2.scale.padT + state2.scale.drawH;
      if (y > axisY && y < axisY + 40 && !state2.selectedYear) {
        const t = (x - state2.scale.padL) / state2.scale.drawW * state2.scale.timeRange + state2.scale.minDate;
        const clickedDate = new Date(t);
        const clickedYear = clickedDate.getFullYear();
        if (clickedYear >= new Date(state2.scale.minDate).getFullYear() && clickedYear <= new Date(state2.scale.maxDate).getFullYear()) {
          clearYThreshold();
          state2.selectedYear = clickedYear;
          rerender();
        }
      }
    });
    dom.canvas.addEventListener("mousemove", (e) => {
      if (state2.dragStart) return;
      const rect = dom.canvasContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let isHand = false;
      const axisY = state2.scale.padT + state2.scale.drawH;
      if (y > axisY && y < axisY + 40 && !state2.selectedYear) {
        const t = (x - state2.scale.padL) / state2.scale.drawW * state2.scale.timeRange + state2.scale.minDate;
        const hoveredYear = new Date(t).getFullYear();
        if (hoveredYear >= new Date(state2.scale.minDate).getFullYear() && hoveredYear <= new Date(state2.scale.maxDate).getFullYear()) {
          isHand = true;
        }
      }
      dom.canvas.style.cursor = isHand ? "pointer" : "crosshair";
    });
  }
  function wireDragSelection(state2, dom, scatterData, showPopover, clearYThreshold) {
    const isTouch = isTouchDevice();
    dom.canvas.style.cursor = isTouch ? "default" : "crosshair";
    if (isTouch) return;
    dom.canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      state2.ignoreNextClick = false;
      const rect = dom.canvasContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < state2.scale.padL || x > state2.scale.padL + state2.scale.drawW || y < state2.scale.padT || y > state2.scale.padT + state2.scale.drawH)
        return;
      state2.dragStart = { x, y };
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
        const xMin = (Math.min(x1, x2) - state2.scale.padL) / state2.scale.drawW * state2.scale.timeRange + state2.scale.minDate;
        const xMax = (Math.max(x1, x2) - state2.scale.padL) / state2.scale.drawW * state2.scale.timeRange + state2.scale.minDate;
        const valMin = (state2.scale.padT + state2.scale.drawH - Math.max(y1, y2)) / state2.scale.drawH * state2.scale.maxVal;
        const valMax = (state2.scale.padT + state2.scale.drawH - Math.min(y1, y2)) / state2.scale.drawH * state2.scale.maxVal;
        const dvSel = state2.scale.mode === "score" ? state2.activeDownvoteFilter : null;
        const count = scatterData.filter((d) => {
          if (!state2.activeRatingFilters[d.r]) return false;
          if (dvSel !== null) {
            if (d.dn === void 0) return false;
            if (-d.dn <= dvSel) return false;
          }
          const yVal = state2.scale.mode === "tags" ? d.t || 0 : d.s;
          return d.d >= xMin && d.d <= xMax && yVal >= valMin && yVal <= valMax;
        }).length;
        const d1 = new Date(xMin).toISOString().slice(0, 10);
        const d2 = new Date(xMax).toISOString().slice(0, 10);
        const valLabel = state2.scale.mode === "tags" ? "Tags" : "Score";
        dom.rangeLabel.innerHTML = `${d1} ~ ${d2}<br>${valLabel}: ${Math.round(valMin)} ~ ${Math.round(valMax)} · ${count.toLocaleString()} posts`;
        dom.rangeLabel.style.display = "block";
      }, 50);
    };
    window.addEventListener("mousemove", (e) => {
      if (!state2.dragStart) return;
      const rect = dom.canvasContainer.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const rL = state2.scale.padL;
      const rT = state2.scale.padT;
      const rW = state2.scale.drawW;
      const currentX = Math.max(rL, Math.min(rL + rW, mx));
      const currentY = Math.max(rT, Math.min(rect.height, my));
      const x = Math.min(state2.dragStart.x, currentX);
      const y = Math.min(state2.dragStart.y, currentY);
      const w = Math.abs(currentX - state2.dragStart.x);
      const h = Math.abs(currentY - state2.dragStart.y);
      dom.selectionDiv.style.left = x + "px";
      dom.selectionDiv.style.top = y + "px";
      dom.selectionDiv.style.width = w + "px";
      dom.selectionDiv.style.height = h + "px";
      updateRangeLabel(state2.dragStart.x, currentX, state2.dragStart.y, currentY);
    });
    window.addEventListener("mouseup", (e) => {
      if (!state2.dragStart) return;
      const ds = state2.dragStart;
      state2.dragStart = null;
      dom.rangeLabel.style.display = "none";
      if (rangeLabelTimer) {
        clearTimeout(rangeLabelTimer);
        rangeLabelTimer = null;
      }
      const rect = dom.canvasContainer.getBoundingClientRect();
      const endX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const endY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      if (Math.abs(endX - ds.x) >= 5 || Math.abs(endY - ds.y) >= 5) {
        state2.ignoreNextClick = true;
        state2.lastDragEndTime = Date.now();
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
      const xMin = (x1 - state2.scale.padL) / state2.scale.drawW * state2.scale.timeRange + state2.scale.minDate;
      const xMax = (x2 - state2.scale.padL) / state2.scale.drawW * state2.scale.timeRange + state2.scale.minDate;
      const valMin = (state2.scale.padT + state2.scale.drawH - y2) / state2.scale.drawH * state2.scale.maxVal;
      const valMax = (state2.scale.padT + state2.scale.drawH - y1) / state2.scale.drawH * state2.scale.maxVal;
      const dvRes = state2.scale.mode === "score" ? state2.activeDownvoteFilter : null;
      const result = scatterData.filter((d) => {
        if (!state2.activeRatingFilters[d.r]) return false;
        if (dvRes !== null) {
          if (d.dn === void 0) return false;
          if (-d.dn <= dvRes) return false;
        }
        const yVal = state2.scale.mode === "tags" ? d.t || 0 : d.s;
        return d.d >= xMin && d.d <= xMax && yVal >= valMin && yVal <= valMax;
      });
      if (result.length === 0) {
        dom.selectionDiv.style.display = "none";
        return;
      }
      const sortedList = result.sort((a, b) => {
        const vA = state2.scale.mode === "tags" ? a.t || 0 : a.s;
        const vB = state2.scale.mode === "tags" ? b.t || 0 : b.s;
        return vB - vA;
      });
      let aDMin = Infinity, aDMax = -Infinity;
      let aVMin = Infinity, aVMax = -Infinity;
      sortedList.forEach((d) => {
        if (d.d < aDMin) aDMin = d.d;
        if (d.d > aDMax) aDMax = d.d;
        const v = state2.scale.mode === "tags" ? d.t || 0 : d.s;
        if (v < aVMin) aVMin = v;
        if (v > aVMax) aVMax = v;
      });
      showPopover(e.clientX, e.clientY, sortedList, aDMin, aDMax, aVMin, aVMax);
    });
  }
  function createScatterPopover(state2, dom, options) {
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
      const isTags = state2.scale.mode === "tags";
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
        parent.querySelectorAll(".pop-item").forEach((el2) => {
          const htmlEl = el2;
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
    const state2 = createInitialScatterState(options);
    const userName = context.targetUser?.normalizedName ?? "";
    const twoStepTap = createTwoStepTap({
      insideElements: () => Array.from(dom.gridHitsContainer.children),
      onFirstTap: (val) => {
        state2.activeYThreshold = val;
        rerender();
      },
      onSecondTap: (val) => {
        const url = buildPostsUrlForThreshold(userName, state2.mode, val);
        state2.activeYThreshold = null;
        rerender();
        window.open(url, "_blank");
      },
      onReset: () => {
        state2.activeYThreshold = null;
        rerender();
      }
    });
    const clearYThreshold = () => {
      if (state2.activeYThreshold !== null) {
        state2.activeYThreshold = null;
        twoStepTap.reset();
      }
    };
    const rerender = () => renderScatterCanvas(
      state2,
      dom,
      scatterData,
      context,
      levelChanges,
      options,
      userName,
      twoStepTap,
      rerender
    );
    wireModeToggle(state2, dom, rerender, clearYThreshold);
    wireDownvoteFilter(state2, dom, rerender);
    wireRatingFilter(state2, dom, rerender);
    wireYearReset(state2, dom, rerender, clearYThreshold);
    wireY10Tooltip(state2, dom, options, context, rerender);
    const showPopover = createScatterPopover(state2, dom, options);
    wireYearZoom(state2, dom, rerender, clearYThreshold);
    wireDragSelection(state2, dom, scatterData, showPopover, clearYThreshold);
    updateDownvoteVisibility(state2, dom);
    container2.appendChild(dom.wrapper);
    wireBackfillUi(state2, dom, options, scatterData, rerender);
    requestAnimationFrame(rerender);
    window.addEventListener("resize", rerender);
  }
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
    const cloudTooltip = createBodyTooltip("di-tag-cloud-mobile-tooltip");
    cloudTooltip.style.background = "rgba(30,30,30,0.95)";
    cloudTooltip.style.color = "#fff";
    cloudTooltip.style.padding = "8px 12px";
    cloudTooltip.style.borderRadius = "6px";
    cloudTooltip.style.fontSize = "12px";
    cloudTooltip.style.pointerEvents = isTouch ? "auto" : "none";
    cloudTooltip.style.cursor = isTouch ? "pointer" : "default";
    cloudTooltip.style.zIndex = "99999";
    cloudTooltip.style.transition = "opacity 0.15s";
    cloudTooltip.style.whiteSpace = "nowrap";
    const tooltip = d3__namespace.select(createBodyTooltip("di-tag-cloud-tooltip")).style("background", "rgba(30, 30, 30, 0.95)").style("color", "#fff").style("padding", "5px 10px").style("border-radius", "6px").style("font-size", "12px").style("white-space", "nowrap");
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
          cloudTooltip.innerHTML = `<strong>${escapeHtml$1(d.text)}</strong> — ${(d.frequency * 100).toFixed(2)}% · ${d.count.toLocaleString()} posts`;
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
        for (const el2 of oldChildren) {
          el2.style.transition = `opacity ${TRANSITION_MS}ms ease`;
          el2.style.opacity = "0";
        }
        newWrapper.style.opacity = "1";
        setTimeout(() => {
          for (const el2 of oldChildren) {
            if (el2.parentNode === cloudContainer) cloudContainer.removeChild(el2);
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
        for (const el2 of oldChildren) {
          el2.style.transition = `opacity ${TRANSITION_MS}ms ease`;
          el2.style.opacity = "0";
        }
        loadingDiv.style.opacity = "1";
        setTimeout(() => {
          for (const el2 of oldChildren) {
            if (el2.parentNode === cloudContainer) cloudContainer.removeChild(el2);
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
  const log$4 = createLogger("WidgetLocked");
  function renderWidgetLockedPlaceholder(container2, options) {
    const { widgetTitle, icon, currentCount, requiredCount, unlockMessage } = options;
    if (requiredCount <= 0) {
      log$4.warn(
        "renderWidgetLockedPlaceholder called with non-positive required",
        {
          requiredCount
        }
      );
      return;
    }
    const cappedCurrent = Math.max(0, Math.min(currentCount, requiredCount));
    const percent = Math.round(cappedCurrent / requiredCount * 100);
    container2.replaceChildren();
    container2.classList.add("di-widget-locked");
    const card = document.createElement("div");
    card.className = "di-widget-locked-card";
    const header = document.createElement("div");
    header.className = "di-widget-locked-header";
    if (icon) {
      const iconEl = document.createElement("span");
      iconEl.className = "di-widget-locked-icon";
      iconEl.textContent = icon;
      header.appendChild(iconEl);
    }
    const title = document.createElement("span");
    title.className = "di-widget-locked-title";
    title.textContent = widgetTitle;
    header.appendChild(title);
    card.appendChild(header);
    const state2 = document.createElement("div");
    state2.className = "di-widget-locked-state";
    state2.textContent = "⏳ More uploads needed";
    card.appendChild(state2);
    const progressTrack = document.createElement("div");
    progressTrack.className = "di-widget-locked-progress";
    progressTrack.setAttribute("role", "progressbar");
    progressTrack.setAttribute("aria-valuenow", String(cappedCurrent));
    progressTrack.setAttribute("aria-valuemin", "0");
    progressTrack.setAttribute("aria-valuemax", String(requiredCount));
    const progressFill = document.createElement("div");
    progressFill.className = "di-widget-locked-progress-fill";
    progressFill.style.width = `${percent}%`;
    progressTrack.appendChild(progressFill);
    card.appendChild(progressTrack);
    const counter = document.createElement("div");
    counter.className = "di-widget-locked-counter";
    counter.textContent = `${currentCount} / ${requiredCount}`;
    card.appendChild(counter);
    const message = document.createElement("div");
    message.className = "di-widget-locked-message";
    message.textContent = unlockMessage;
    card.appendChild(message);
    container2.appendChild(card);
  }
  const PAGE_SIZE = 20;
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
    header.appendChild(titleDiv);
    container2.appendChild(header);
    const contentDiv = document.createElement("div");
    contentDiv.className = "di-created-tags-wrap";
    container2.appendChild(contentDiv);
    const getStatusHtml = (item) => {
      if (item.aliasedTo) {
        const aliasDisplay = item.aliasedTo.replace(/_/g, " ");
        const aliasHref = encodeURIComponent(item.aliasedTo);
        return `<span class="di-created-tags-status" style="color:#8250df;background:#f3e8ff;">🔀 <a href="/wiki_pages/${aliasHref}" target="_blank" style="color:#8250df;">${escapeHtml$1(aliasDisplay)}</a></span>`;
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
    const sortableHeader = (mode, label, rightAlign = false) => {
      const isActive = sortMode === mode;
      const dir = isActive ? sortDir : SORT_DEFAULT_DIR[mode];
      const glyph = dir === "desc" ? "▼" : "▲";
      const cls = isActive ? " di-cts-th--active" : "";
      return `<span class="di-cts-th${cls}" role="button" tabindex="0" data-sort="${mode}" style="justify-content:${rightAlign ? "flex-end" : "flex-start"};" title="Click to sort (again to flip direction)">${label}<span class="di-cts-arrow${isActive ? " di-cts-arrow--active" : ""}">${glyph}</span></span>`;
    };
    const renderTable = () => {
      const totalPages = Math.ceil(items.length / PAGE_SIZE);
      const start = currentPage * PAGE_SIZE;
      const pageItems = items.slice(start, start + PAGE_SIZE);
      let html = `<table class="di-created-tags-table">
      <thead><tr>
        <th>${sortableHeader("name", "Tag Name")}</th>
        <th style="text-align:right;">${sortableHeader("posts", "Posts", true)}</th>
        <th>Status</th>
        <th>${sortableHeader("date", "Date")}</th>
      </tr></thead>
      <tbody>`;
      for (const item of pageItems) {
        const wikiTarget = encodeURIComponent(item.aliasedTo ?? item.tagName);
        html += `<tr class="di-created-tags-row">
        <td><a href="/wiki_pages/${wikiTarget}" target="_blank" style="color:#0075f8;">${escapeHtml$1(item.displayName)}</a></td>
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
      const applySort = (mode) => {
        if (sortMode === mode) {
          sortDir = sortDir === "desc" ? "asc" : "desc";
        } else {
          sortMode = mode;
          sortDir = SORT_DEFAULT_DIR[mode];
        }
        currentPage = 0;
        sortItems();
        renderTable();
      };
      contentDiv.querySelectorAll(".di-cts-th[data-sort]").forEach((el2) => {
        const mode = el2.dataset.sort;
        el2.onclick = () => applySort(mode);
        el2.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            applySort(mode);
          }
        };
      });
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
        sortItems();
        renderTable();
      } catch (e) {
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
  const APP_VERSION = "9.9.2";
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
  const FADE_MS$1 = 200;
  const handles = new WeakMap();
  function createModal(options) {
    const existingEl = document.getElementById(options.id);
    if (existingEl) {
      const existingHandle = handles.get(existingEl);
      if (existingHandle) return existingHandle;
    }
    const overlay = existingEl ?? document.createElement("div");
    if (!existingEl) {
      overlay.id = options.id;
      if (options.resolveTheme?.() === "dark") {
        overlay.setAttribute("data-di-theme", "dark");
      }
      overlay.innerHTML = options.innerHtml;
      document.body.appendChild(overlay);
    }
    const isCurrentlyVisible = () => options.useFadeTransition ? overlay.classList.contains("visible") : overlay.style.display !== "none" && overlay.style.display !== "";
    const toggle = (show) => {
      if (show) {
        if (history.state?.diModalOpen !== options.id) {
          history.pushState({ diModalOpen: options.id }, "", location.href);
        }
        overlay.style.display = "flex";
        if (options.useFadeTransition) {
          requestAnimationFrame(() => overlay.classList.add("visible"));
        }
        lockBodyScroll();
        return;
      }
      if (history.state?.diModalOpen === options.id) {
        history.back();
        return;
      }
      options.onBeforeClose?.();
      if (options.useFadeTransition) {
        overlay.classList.remove("visible");
        setTimeout(() => {
          overlay.style.display = "none";
          unlockBodyScroll();
          options.onAfterClose?.();
        }, FADE_MS$1);
      } else {
        overlay.style.display = "none";
        unlockBodyScroll();
        options.onAfterClose?.();
      }
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) toggle(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isCurrentlyVisible()) toggle(false);
    });
    window.addEventListener("popstate", () => {
      if (isCurrentlyVisible() && history.state?.diModalOpen !== options.id) {
        toggle(false);
      }
    });
    const handle = { overlay, toggle };
    handles.set(overlay, handle);
    return handle;
  }
  const POPOVER_WIDTH = 440;
  const HIDE_GRACE_MS = 1e3;
  const FADE_MS = 350;
  const CACHE_TTL_MS = 6e4;
  const RECENT_POSTS_LIMIT = 10;
  const ACTIVITY_SEGMENT_LIMIT = 200;
  const ACTIVITY_PER_ROW = 80;
  const ACTIVITY_LABELS = {
    upload: "Uploads",
    edit: "Tag edits",
    note: "Notes",
    wiki: "Wiki",
    artist: "Artist",
    commentary: "Commentary",
    pool: "Pools",
    forum: "Forum",
    approval: "Approvals",
    comment: "Comments",
    appeal: "Appeals",
    suspicious: "Suspicious"
  };
  function relativeTime(ts) {
    const sec = Math.max(0, (Date.now() - ts) / 1e3);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }
  function makeSectionLabel(text) {
    const el2 = document.createElement("div");
    el2.className = "di-preview-section-label";
    el2.textContent = text;
    return el2;
  }
  const REASON_DOWNVOTED = "heavily downvoted";
  const REASON_MINTAG = "uploader added few tags";
  const REASON_ABANDONED = "abandoned (left untagged)";
  function makeCell(post) {
    const cell = document.createElement("a");
    cell.className = "di-preview-cell";
    cell.href = `${location.origin}/posts/${post.id}`;
    cell.target = "_blank";
    cell.rel = "noopener";
    cell.dataset.postId = String(post.id);
    const suspicious = isSuspiciousUpload(post);
    const mintagged = !suspicious && isMintagged(post);
    const titleParts = [];
    if (post.status !== "active") titleParts.push(post.status);
    if (suspicious) titleParts.push(REASON_DOWNVOTED);
    else if (mintagged) titleParts.push(REASON_MINTAG);
    if (titleParts.length) cell.title = titleParts.join(" · ");
    let thumb;
    if (post.thumbUrl) {
      const img = document.createElement("img");
      img.className = "di-preview-thumb";
      img.src = post.thumbUrl;
      img.loading = "lazy";
      img.alt = `post ${post.id}`;
      thumb = img;
    } else {
      thumb = document.createElement("div");
      thumb.className = "di-preview-thumb--empty";
    }
    thumb.style.borderColor = STATUS_BORDER_COLORS[post.status];
    thumb.dataset.rating = post.rating;
    cell.appendChild(thumb);
    const label = document.createElement("div");
    label.className = "di-preview-label";
    if (suspicious) label.classList.add("di-preview-label--flag");
    else if (mintagged) label.classList.add("di-preview-label--mintag");
    const ratingPart = post.rating ? `${post.rating.toUpperCase()} ` : "";
    label.textContent = `${ratingPart}▲${post.score} ◫${post.generalTags ?? "?"}`;
    cell.appendChild(label);
    return cell;
  }
  function renderSkeleton(grid) {
    grid.textContent = "";
    for (let i = 0; i < RECENT_POSTS_LIMIT; i++) {
      const cell = document.createElement("div");
      cell.className = "di-preview-cell di-preview-skeleton";
      grid.appendChild(cell);
    }
  }
  function renderMessage(grid, text) {
    grid.textContent = "";
    const msg = document.createElement("div");
    msg.className = "di-preview-msg";
    msg.textContent = text;
    grid.appendChild(msg);
  }
  function renderGridSpinner(grid) {
    grid.textContent = "";
    const spinner = document.createElement("div");
    spinner.className = "di-preview-loading";
    grid.appendChild(spinner);
  }
  function showActivityLoading(strip, legend) {
    strip.textContent = "";
    strip.classList.add("di-activity-loading");
    legend.textContent = "";
  }
  function renderGrid(grid, posts) {
    if (!posts.length) {
      renderMessage(grid, "No recent uploads.");
      return;
    }
    grid.textContent = "";
    for (const post of posts.slice(0, RECENT_POSTS_LIMIT)) {
      grid.appendChild(makeCell(post));
    }
    applyNsfwBlur(grid);
  }
  function upgradeAbandonedCells(grid, abandonedIds) {
    abandonedIds.forEach((id) => {
      const cell = grid.querySelector(
        `.di-preview-cell[data-post-id="${id}"]`
      );
      if (!cell) return;
      const label = cell.querySelector(".di-preview-label");
      if (label) {
        label.classList.remove("di-preview-label--mintag");
        label.classList.add("di-preview-label--flag");
      }
      if (cell.title) {
        cell.title = cell.title.replace(REASON_MINTAG, REASON_ABANDONED);
      }
    });
  }
  function mintaggedPostIds(posts) {
    return posts.filter((p) => !isSuspiciousUpload(p) && isMintagged(p)).map((p) => p.id);
  }
  function runAbandonedPass(posts, fetchAbandoned, ctx) {
    if (!fetchAbandoned) return;
    const ids = mintaggedPostIds(posts);
    if (!ids.length) return;
    void fetchAbandoned(ids).then(
      (abandoned) => {
        const grid = ctx.getGrid();
        if (ctx.isCurrent() && grid) upgradeAbandonedCells(grid, abandoned);
      },
      () => {
      }
    );
  }
  function unifiedShownPosts(fresh, result) {
    if (fresh) return fresh;
    return result.status === "fulfilled" ? result.value : [];
  }
  function applyNsfwBlur(grid) {
    const blur = !getNsfwEnabled();
    grid.querySelectorAll("[data-rating]").forEach((thumb) => {
      const r = thumb.dataset.rating;
      thumb.classList.toggle(
        "di-preview-thumb--nsfw",
        blur && (r === "q" || r === "e")
      );
    });
  }
  function makeNsfwToggle(grid) {
    const label = document.createElement("label");
    label.className = "di-preview-nsfw-toggle";
    label.title = "Show NSFW thumbnails (rating Q/E)";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = getNsfwEnabled();
    cb.addEventListener("change", () => {
      setNsfwEnabled(cb.checked);
      applyNsfwBlur(grid);
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode("NSFW"));
    return { label, checkbox: cb };
  }
  function legendRow(swatch, text) {
    const row = document.createElement("div");
    row.className = "di-preview-legend-row";
    swatch.classList.add("di-preview-legend-swatch");
    row.appendChild(swatch);
    const label = document.createElement("span");
    label.textContent = text;
    row.appendChild(label);
    return row;
  }
  function borderSwatch(status) {
    const s = document.createElement("span");
    s.style.border = `2px solid ${STATUS_BORDER_COLORS[status]}`;
    return s;
  }
  function labelSwatch(cls) {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = "■";
    return s;
  }
  function makeColorLegend() {
    const wrap = document.createElement("span");
    wrap.className = "di-preview-legend-wrap";
    const icon = document.createElement("span");
    icon.className = "di-preview-legend-icon";
    icon.textContent = "?";
    icon.setAttribute("role", "button");
    icon.setAttribute("aria-label", "What the colours mean");
    icon.tabIndex = 0;
    const pop = document.createElement("div");
    pop.className = "di-preview-legend-pop";
    pop.appendChild(legendRow(borderSwatch("pending"), "Pending"));
    pop.appendChild(legendRow(borderSwatch("appealed"), "Appealed"));
    pop.appendChild(legendRow(borderSwatch("flagged"), "Flagged"));
    pop.appendChild(legendRow(borderSwatch("deleted"), "Deleted / banned"));
    pop.appendChild(
      legendRow(
        labelSwatch("di-preview-label--mintag"),
        "Mintagged — uploader added few tags"
      )
    );
    pop.appendChild(
      legendRow(labelSwatch("di-preview-label--flag"), "Downvoted / abandoned")
    );
    wrap.appendChild(icon);
    wrap.appendChild(pop);
    if (isTouchDevice()) {
      icon.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        wrap.classList.toggle("di-preview-legend-wrap--open");
      });
    }
    return wrap;
  }
  function renderActivityMessage(strip, legend, text) {
    strip.classList.remove("di-activity-loading");
    strip.textContent = "";
    legend.textContent = "";
    const msg = document.createElement("div");
    msg.className = "di-activity-empty";
    msg.textContent = text;
    legend.appendChild(msg);
  }
  function renderActivity(strip, legend, dist, activityHref) {
    if (!dist.recent.length) {
      renderActivityMessage(strip, legend, "No recent activity.");
      return;
    }
    strip.classList.remove("di-activity-loading");
    strip.textContent = "";
    legend.textContent = "";
    for (const row of balancedChunks(dist.recent, ACTIVITY_PER_ROW)) {
      const rowEl = document.createElement("div");
      rowEl.className = "di-activity-row";
      for (const seg of row) {
        const cell = document.createElement("div");
        cell.className = "di-activity-seg";
        if (seg.type === "suspicious") {
          cell.classList.add("di-activity-seg--flag");
        }
        cell.dataset.type = seg.type;
        cell.style.background = ACTIVITY_COLORS[seg.type];
        cell.title = `${ACTIVITY_LABELS[seg.type]} · ${relativeTime(seg.ts)}`;
        rowEl.appendChild(cell);
      }
      strip.appendChild(rowEl);
    }
    for (const type of ACTIVITY_TYPES) {
      const count = dist.counts[type];
      if (!count) continue;
      const item = document.createElement("span");
      item.className = "di-activity-legend-item";
      item.dataset.type = type;
      const swatch = document.createElement("span");
      swatch.className = "di-activity-swatch";
      if (type === "suspicious") swatch.classList.add("di-activity-seg--flag");
      swatch.style.background = ACTIVITY_COLORS[type];
      item.appendChild(swatch);
      const labelText = `${ACTIVITY_LABELS[type]} ${count}`;
      const text = document.createElement("span");
      text.className = "di-activity-legend-item__text";
      text.dataset.text = labelText;
      const inner = document.createElement("span");
      inner.textContent = labelText;
      text.appendChild(inner);
      item.appendChild(text);
      const href = activityHref?.(type, dist);
      if (href) {
        item.classList.add("di-activity-legend-item--link");
        item.title = `Open ${ACTIVITY_LABELS[type]} list`;
        item.dataset.href = href;
        if (!isTouchDevice()) {
          item.addEventListener(
            "click",
            () => window.open(href, "_blank", "noopener")
          );
        }
      }
      legend.appendChild(item);
    }
  }
  function renderPostsResult(grid, result) {
    if (result.status === "fulfilled") renderGrid(grid, result.value);
    else renderMessage(grid, "Failed to load recent posts.");
  }
  function renderActivityResult(strip, legend, result, activityHref) {
    if (result.status === "fulfilled" && result.value) {
      renderActivity(strip, legend, result.value, activityHref);
    } else {
      renderActivityMessage(strip, legend, "Activity unavailable.");
    }
  }
  function applyPeerHighlight(strip, legend, type) {
    strip.querySelectorAll(".di-activity-seg").forEach((s) => {
      s.classList.toggle(
        "di-activity-seg--mute",
        type !== null && s.dataset.type !== type
      );
    });
    legend.querySelectorAll(".di-activity-legend-item").forEach((i) => {
      i.classList.toggle(
        "di-activity-legend-item--active",
        type !== null && i.dataset.type === type
      );
    });
  }
  function attachPeerHighlight(strip, legend, onClear) {
    strip.addEventListener("pointerover", (e) => {
      if (e.pointerType === "touch") return;
      const seg = e.target.closest(
        ".di-activity-seg"
      );
      if (seg && strip.contains(seg)) {
        applyPeerHighlight(strip, legend, seg.dataset.type ?? null);
      }
    });
    legend.addEventListener("pointerover", (e) => {
      if (e.pointerType === "touch") return;
      const item = e.target.closest(
        ".di-activity-legend-item"
      );
      const type = item && legend.contains(item) ? item.dataset.type ?? null : null;
      applyPeerHighlight(strip, legend, type);
    });
    const clear = (e) => {
      if (e.pointerType === "touch") return;
      applyPeerHighlight(strip, legend, null);
      onClear?.();
    };
    strip.addEventListener("pointerleave", clear);
    legend.addEventListener("pointerleave", clear);
  }
  function attachLegendTwoStep(strip, legend) {
    const controller = createTwoStepTap({
      insideElements: () => [legend, strip],
      onFirstTap: (type) => applyPeerHighlight(strip, legend, type),
      onSecondTap: (type) => {
        const item = legend.querySelector(
          `.di-activity-legend-item[data-type="${type}"]`
        );
        const href = item?.dataset.href;
        if (href) window.open(href, "_blank", "noopener");
      },
      onReset: () => applyPeerHighlight(strip, legend, null),
      resetOnScroll: true
    });
    const tracker = new TapTracker();
    legend.addEventListener("touchstart", (e) => tracker.onTouchStart(e), {
      passive: true
    });
    legend.addEventListener("touchmove", (e) => tracker.onTouchMove(e), {
      passive: true
    });
    legend.addEventListener(
      "touchend",
      (e) => {
        if (!tracker.onTouchEnd(e)) return;
        const item = e.target.closest(
          ".di-activity-legend-item"
        );
        const type = item?.dataset.type;
        if (type) controller.tap(type);
      },
      { passive: true }
    );
    return controller;
  }
  function syncPopoverTheme(el2) {
    const dark = resolveEffectiveDashboardTheme(new SettingsManager().getDarkMode()) === "dark";
    if (dark) el2.setAttribute("data-di-theme", "dark");
    else el2.removeAttribute("data-di-theme");
  }
  function buildPopoverDom(opts) {
    const el2 = document.createElement("div");
    el2.className = "di-preview-popover";
    applyPopoverChrome(el2, { width: `${POPOVER_WIDTH}px`, zIndex: "10001" });
    el2.style.padding = "0";
    el2.style.display = "none";
    const caret = document.createElement("div");
    caret.className = "di-preview-caret";
    el2.appendChild(caret);
    const body = document.createElement("div");
    body.className = "di-preview-body";
    const grid = document.createElement("div");
    grid.className = "di-preview-grid";
    const headA = document.createElement("div");
    headA.className = "di-preview-section-head";
    headA.appendChild(makeSectionLabel("Recent uploads"));
    headA.appendChild(makeColorLegend());
    const nsfw = makeNsfwToggle(grid);
    headA.appendChild(nsfw.label);
    body.appendChild(headA);
    body.appendChild(grid);
    let strip = null;
    let legend = null;
    let legendTap = null;
    if (opts.hasActivity) {
      const section = document.createElement("div");
      section.className = "di-activity-section";
      section.appendChild(makeSectionLabel("Activity"));
      strip = document.createElement("div");
      strip.className = "di-activity-strip";
      legend = document.createElement("div");
      legend.className = "di-activity-legend";
      attachPeerHighlight(strip, legend, () => legendTap?.reset());
      if (isTouchDevice()) {
        legendTap = attachLegendTwoStep(strip, legend);
      }
      section.appendChild(strip);
      section.appendChild(legend);
      body.appendChild(section);
    }
    el2.appendChild(body);
    el2.addEventListener("mouseenter", opts.onEnter);
    el2.addEventListener("mouseleave", opts.onLeave);
    document.body.appendChild(el2);
    return { el: el2, caret, grid, nsfwToggle: nsfw.checkbox, strip, legend, legendTap };
  }
  function createCachedFetcher(fetchFn, ttlMs, isCacheable = () => true) {
    let cached = null;
    let cachedTs = 0;
    let inflight = null;
    const isFresh = () => cached !== null && Date.now() - cachedTs < ttlMs;
    return {
      peekFresh: () => isFresh() ? cached : null,
      get() {
        if (isFresh()) return Promise.resolve(cached);
        let pending = inflight;
        if (!pending) {
          pending = fetchFn();
          inflight = pending;
          const settled = pending;
          const clear = () => {
            if (inflight === settled) inflight = null;
          };
          void pending.then(clear, clear);
        }
        return pending.then((value) => {
          if (isCacheable(value)) {
            cached = value;
            cachedTs = Date.now();
          }
          return value;
        });
      }
    };
  }
  function createDashboardPreviewPopover(options) {
    const { anchor, fetchPosts, fetchActivity, activityHref, fetchAbandoned } = options;
    let refs = null;
    let pinned = false;
    let visible = false;
    let generation = 0;
    let hideTimer2 = null;
    const postsFetcher = createCachedFetcher(
      fetchPosts,
      CACHE_TTL_MS,
      (posts) => posts.length > 0
    );
    const activityFetcher = fetchActivity ? createCachedFetcher(
      fetchActivity,
      CACHE_TTL_MS,
      (dist) => dist.recent.length > 0
    ) : null;
    let clickOutside = null;
    let onKeydown = null;
    function cancelHideTimer() {
      if (hideTimer2 !== null) {
        clearTimeout(hideTimer2);
        hideTimer2 = null;
      }
    }
    function teardownDismiss() {
      if (clickOutside) {
        document.removeEventListener("click", clickOutside);
        clickOutside = null;
      }
      if (onKeydown) {
        document.removeEventListener("keydown", onKeydown);
        onKeydown = null;
      }
    }
    function hide() {
      cancelHideTimer();
      teardownDismiss();
      visible = false;
      pinned = false;
      generation++;
      if (refs) {
        refs.el.style.display = "none";
        refs.el.classList.remove("di-preview-popover--fading");
      }
    }
    function keepOpen() {
      cancelHideTimer();
      if (refs) refs.el.classList.remove("di-preview-popover--fading");
    }
    function startFadeOut() {
      hideTimer2 = null;
      if (pinned || !refs || !visible) return;
      refs.el.classList.add("di-preview-popover--fading");
      hideTimer2 = setTimeout(hide, FADE_MS);
    }
    function scheduleHide() {
      if (pinned) return;
      cancelHideTimer();
      hideTimer2 = setTimeout(startFadeOut, HIDE_GRACE_MS);
    }
    function setupDismiss() {
      teardownDismiss();
      if (!pinned || !refs) return;
      const handler = createClickOutsideHandler(refs.el, hide, { ignore: anchor });
      clickOutside = handler;
      setTimeout(() => {
        if (clickOutside === handler) document.addEventListener("click", handler);
      }, 0);
      onKeydown = (e) => {
        if (e.key === "Escape") hide();
      };
      document.addEventListener("keydown", onKeydown);
    }
    function reposition() {
      if (!refs) return;
      const pos = calcPopoverPositionBelow(anchor, POPOVER_WIDTH);
      refs.el.style.top = `${pos.top}px`;
      refs.el.style.left = `${pos.left}px`;
      refs.caret.style.left = `${pos.caretLeft}px`;
    }
    const enhanceAbandoned = (gen, posts) => runAbandonedPass(posts, fetchAbandoned, {
      isCurrent: () => gen === generation && visible,
      getGrid: () => refs?.grid ?? null
    });
    function loadPosts(gen) {
      if (!refs) return;
      const grid = refs.grid;
      const fresh = postsFetcher.peekFresh();
      if (fresh) {
        renderGrid(grid, fresh);
        enhanceAbandoned(gen, fresh);
        return;
      }
      renderSkeleton(grid);
      void postsFetcher.get().then(
        (posts) => {
          if (gen === generation && visible) {
            renderGrid(grid, posts);
            enhanceAbandoned(gen, posts);
          }
        },
        () => {
          if (gen === generation && visible) {
            renderMessage(grid, "Failed to load recent posts.");
          }
        }
      );
    }
    function loadActivity(gen) {
      if (!activityFetcher || !refs || !refs.strip || !refs.legend) return;
      const { strip, legend } = refs;
      const fresh = activityFetcher.peekFresh();
      if (fresh) {
        renderActivity(strip, legend, fresh, activityHref);
        return;
      }
      showActivityLoading(strip, legend);
      void activityFetcher.get().then(
        (dist) => {
          if (gen === generation && visible) {
            renderActivity(strip, legend, dist, activityHref);
          }
        },
        () => {
          if (gen === generation && visible) {
            renderActivityMessage(strip, legend, "Activity unavailable.");
          }
        }
      );
    }
    async function loadUnified(gen) {
      if (!refs) return;
      const { grid, strip, legend } = refs;
      const freshPosts = postsFetcher.peekFresh();
      const freshAct = activityFetcher ? activityFetcher.peekFresh() : null;
      if (freshPosts) renderGrid(grid, freshPosts);
      else renderGridSpinner(grid);
      if (strip && legend) {
        if (freshAct) renderActivity(strip, legend, freshAct, activityHref);
        else showActivityLoading(strip, legend);
      }
      const [postsR, actR] = await Promise.allSettled([
        postsFetcher.get(),
        activityFetcher ? activityFetcher.get() : Promise.resolve(null)
      ]);
      if (gen !== generation || !visible) return;
      if (!freshPosts) renderPostsResult(grid, postsR);
      if (strip && legend && !freshAct) {
        renderActivityResult(strip, legend, actR, activityHref);
      }
      enhanceAbandoned(gen, unifiedShownPosts(freshPosts, postsR));
    }
    function show(opts) {
      pinned = opts?.pinned ?? false;
      if (!refs) {
        refs = buildPopoverDom({
          hasActivity: !!fetchActivity,
          onEnter: keepOpen,
          onLeave: scheduleHide
        });
      }
      refs.el.classList.remove("di-preview-popover--fading");
      syncPopoverTheme(refs.el);
      refs.nsfwToggle.checked = getNsfwEnabled();
      refs.el.style.display = "block";
      visible = true;
      cancelHideTimer();
      const gen = ++generation;
      reposition();
      setupDismiss();
      if (isTouchDevice() && pinned) {
        void loadUnified(gen);
      } else {
        loadPosts(gen);
        loadActivity(gen);
      }
    }
    function destroy() {
      hide();
      if (refs) {
        refs.legendTap?.destroy();
        refs.el.remove();
        refs = null;
      }
    }
    return { show, hide, scheduleHide, keepOpen, destroy };
  }
  const log$3 = createLogger("UserAnalytics");
  function paintLoadingSpinner(content) {
    content.innerHTML = `
        <div id="analytics-loading-report" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:100px 0; color:var(--di-text-secondary, #666);">
           <div class="di-spinner"></div>
           <div id="analytics-loading-label" style="font-size:1.2em; font-weight:600; margin-top: 20px;">Generating Report...</div>
           <div id="analytics-loading-detail" style="font-size:0.9em; color:var(--di-text-muted, #888); margin-top:10px; min-height:1.2em;">Analyzing contributions and trends</div>
        </div>
      `;
    return (state2) => {
      const labelEl = document.getElementById("analytics-loading-label");
      const detailEl = document.getElementById("analytics-loading-detail");
      if (labelEl) labelEl.textContent = state2.label;
      if (detailEl) detailEl.textContent = state2.detail ?? "";
    };
  }
  async function runPreCheck(dataManager, user) {
    perfLogger.start("dbi:render:precheck");
    const [preStats, preTotal] = await Promise.all([
      perfLogger.wrap(
        "dbi:render:precheck:syncStats",
        () => dataManager.getSyncStats(user)
      ),
      perfLogger.wrap(
        "dbi:render:precheck:totalCount",
        () => dataManager.getTotalPostCount(user)
      )
    ]);
    perfLogger.end("dbi:render:precheck", {
      total: preTotal,
      synced: preStats.count
    });
    return { preStats, preTotal };
  }
  function renderZeroUploadsView(content, user) {
    content.innerHTML = "";
    const header = document.createElement("div");
    header.style.marginBottom = "25px";
    header.innerHTML = `
          <h2 style="margin-top:0; color:var(--di-text, #333); margin-bottom:4px;">Analytics Dashboard</h2>
          <p style="color:var(--di-text-secondary, #666); margin:0;">Detailed statistics and history for <span class="${getLevelClass(user.level_string)}">${escapeHtml$1(user.name)}</span></p>
        `;
    content.appendChild(header);
    const empty = document.createElement("div");
    empty.style.cssText = "text-align:center; padding:60px 20px; color:var(--di-text-secondary, #666);";
    empty.innerHTML = `
          <div style="font-size:48px; margin-bottom:20px;">📭</div>
          <h3 style="margin-top:0;">No uploads to analyze</h3>
          <p>This user has not uploaded any posts yet, so there is nothing to report.</p>
        `;
    content.appendChild(empty);
    content.insertAdjacentHTML("beforeend", dashboardFooterHtml());
  }
  function warnIfSyncIncomplete(outcome) {
    if (!outcome.started || outcome.complete) return;
    showToast({
      type: "warn",
      message: "Sync incomplete — some posts could not be fetched. It will resume next time you open the report."
    });
  }
  function scheduleRevalidateAll(starters) {
    for (const [name, starter] of starters) {
      if (!starter) continue;
      setTimeout(() => {
        starter().catch((e) => {
          log$3.warn(`SWR revalidate failed for ${name}`, { error: e });
        });
      }, 0);
    }
  }
  let lazyPieRevalidateListener = null;
  function schedulePieRevalidate(entries, priorityCacheKey) {
    const fire = (cacheKey, starter) => {
      const setRefreshing = (active) => window.dispatchEvent(
        new CustomEvent("DanbooruInsights:PieTabRefreshing", {
          detail: { contentType: cacheKey, active }
        })
      );
      setRefreshing(true);
      return starter().then((fresh) => {
        if (fresh === null) return;
        window.dispatchEvent(
          new CustomEvent("DanbooruInsights:DataUpdated", {
            detail: { contentType: cacheKey, data: fresh }
          })
        );
      }).catch((e) => {
        log$3.warn(`Pie revalidate failed for ${cacheKey}`, { error: e });
      }).finally(() => setRefreshing(false));
    };
    const pending = new Map();
    for (const [cacheKey, starter] of entries) {
      if (!starter || cacheKey === priorityCacheKey) continue;
      pending.set(cacheKey, starter);
    }
    if (lazyPieRevalidateListener) {
      window.removeEventListener(
        "DanbooruInsights:PieTabActivated",
        lazyPieRevalidateListener
      );
    }
    const listener = (e) => {
      const detail = e.detail;
      const cacheKey = detail?.contentType;
      if (!cacheKey) return;
      const starter = pending.get(cacheKey);
      if (!starter) return;
      pending.delete(cacheKey);
      void fire(cacheKey, starter);
    };
    lazyPieRevalidateListener = listener;
    window.addEventListener("DanbooruInsights:PieTabActivated", listener);
    setTimeout(() => {
      const priority = entries.find(
        ([k, s]) => k === priorityCacheKey && s !== void 0
      );
      if (priority && priority[1]) void fire(priority[0], priority[1]);
    }, 0);
  }
  function renderSummaryCards(parent, data, user) {
    const { stats, total, summaryStats, timelineMilestones, levelChanges } = data;
    const { maxUploads, maxDate, firstUploadDate, lastUploadDate } = summaryStats;
    const today = new Date();
    const oneDay = 1e3 * 60 * 60 * 24;
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
                ${""}
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
    if (user.created_at) {
      const joinDate = new Date(user.created_at);
      daysSinceJoin = Math.floor((today.getTime() - joinDate.getTime()) / oneDay);
      joinDateStr = joinDate.toISOString().split("T")[0];
    }
    const firstUploadDateStr = firstUploadDate ? firstUploadDate.toISOString().split("T")[0] : "";
    const tlEvents = [];
    if (user.created_at) {
      const joinDate = new Date(user.created_at);
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
      const daysAgo = Math.floor((today.getTime() - m.date.getTime()) / oneDay);
      tlEvents.push({
        date: m.date,
        icon,
        html: `${icon} <strong>${label}:</strong> ${daysAgo.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${dateStr})</span>`
      });
    });
    levelChanges.forEach((lc) => {
      const icon = lc.isPromotion ? "⬆️" : "⬇️";
      const dateStr = lc.date.toISOString().split("T")[0];
      const daysAgo = Math.floor((today.getTime() - lc.date.getTime()) / oneDay);
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
    summaryWrapper.innerHTML += makeCard("User History", "", "📅", dateDetails);
    parent.appendChild(summaryWrapper);
    const historyTimeline = parent.querySelector(
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
    const btnPlayPause = parent.querySelector(
      "#analytics-upload-btn-play-pause"
    );
    const uploadCard = parent.querySelector(
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
  }
  async function renderDashboardWidgets(parent, content, data, app, nsfw, firstUploadDate, totalUploads) {
    const {
      distributions,
      topPosts,
      recentPopularPosts,
      randomPostsPromise,
      milestones1k,
      scatterData,
      levelChanges,
      tagCloudGeneral,
      userStats,
      needsBackfill,
      dataManager
    } = data;
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
      nsfw.enabled,
      app.dataManager,
      app.context,
      firstUploadDate
    );
    perfLogger.end("dbi:render:widget:pie");
    perfLogger.start("dbi:render:widget:topPosts");
    const topPostsResult = renderTopPostsWidget(
      topPostContainer,
      topPosts,
      recentPopularPosts,
      randomPostsPromise,
      nsfw.enabled,
      app.dataManager,
      app.context
    );
    perfLogger.end("dbi:render:widget:topPosts");
    topStatsRow.appendChild(pieContainer);
    topStatsRow.appendChild(topPostContainer);
    parent.appendChild(topStatsRow);
    content.appendChild(parent);
    const milestonesDiv = document.createElement("div");
    milestonesDiv.style.marginTop = "20px";
    parent.appendChild(milestonesDiv);
    const milestonesResult = await perfLogger.wrap(
      "dbi:render:widget:milestones",
      () => renderMilestonesWidget(
        milestonesDiv,
        app.db,
        app.dataManager,
        app.context,
        nsfw.enabled
      )
    );
    nsfw.apply = async () => {
      pieResult.onNsfwChange(nsfw.enabled);
      topPostsResult.onNsfwChange(nsfw.enabled);
      await milestonesResult.onNsfwChange(nsfw.enabled);
    };
    await perfLogger.wrap(
      "dbi:render:widget:history",
      () => renderHistoryChart(
        parent,
        app.dataManager,
        app.context,
        milestones1k,
        levelChanges
      )
    );
    const createdTagsContainer = document.createElement("div");
    createdTagsContainer.style.marginTop = "35px";
    parent.appendChild(createdTagsContainer);
    perfLogger.start("dbi:render:widget:createdTags");
    renderCreatedTagsWidget(
      createdTagsContainer,
      app.dataManager,
      app.context.targetUser
    );
    perfLogger.end("dbi:render:widget:createdTags");
    const tagCloudContainer = document.createElement("div");
    tagCloudContainer.style.marginTop = "35px";
    parent.appendChild(tagCloudContainer);
    perfLogger.start("dbi:render:widget:tagCloud");
    if (totalUploads < TAG_CLOUD_MIN_UPLOADS) {
      renderWidgetLockedPlaceholder(tagCloudContainer, {
        widgetTitle: "Tag Cloud",
        icon: "🏷️",
        currentCount: totalUploads,
        requiredCount: TAG_CLOUD_MIN_UPLOADS,
        unlockMessage: "Tag cloud unlocks at 100 uploads to ensure the analysis has enough data to be useful."
      });
    } else {
      renderTagCloudWidget(tagCloudContainer, {
        initialData: tagCloudGeneral,
        fetchData: (catId) => app.dataManager.getTagCloudData(app.context.targetUser, catId),
        userName: app.context.targetUser.normalizedName,
        categories: [
          { id: 0, label: "General", color: "#0075f8" },
          { id: 1, label: "Artist", color: "#a00" },
          { id: 3, label: "Copy", color: "#a800aa" },
          { id: 4, label: "Char", color: "#00ab2c" }
        ]
      });
    }
    perfLogger.end("dbi:render:widget:tagCloud");
    perfLogger.start("dbi:render:widget:scatter");
    if (totalUploads < SCATTER_MIN_UPLOADS) {
      const scatterContainer = document.createElement("div");
      scatterContainer.style.marginTop = "35px";
      parent.appendChild(scatterContainer);
      renderWidgetLockedPlaceholder(scatterContainer, {
        widgetTitle: "Score Distribution",
        icon: "📊",
        currentCount: totalUploads,
        requiredCount: SCATTER_MIN_UPLOADS,
        unlockMessage: "Score distribution unlocks at 300 uploads so the scatter plot has enough points to reveal patterns."
      });
    } else if (scatterData.length > 0) {
      renderScatterPlot(parent, scatterData, app.context, levelChanges, {
        userStats,
        needsBackfill,
        runBackfill: needsBackfill ? (onProgress) => dataManager.backfillPostMetadata(app.context.targetUser, onProgress) : void 0,
        refreshScatterData: () => dataManager.getScatterData(app.context.targetUser),
        fetchPostDetails: (postId) => dataManager.fetchPostDetails(postId)
      });
    }
    perfLogger.end("dbi:render:widget:scatter", {
      points: scatterData.length,
      gated: totalUploads < SCATTER_MIN_UPLOADS
    });
    parent.insertAdjacentHTML("beforeend", dashboardFooterHtml());
  }
  function buildDashboardHeader(user, app, nsfw) {
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "flex-start";
    header.style.marginBottom = "25px";
    header.innerHTML = `
      <div>
         <h2 style="margin-top:0; color:var(--di-text, #333); margin-bottom:4px;">Analytics Dashboard</h2>
         <p style="color:var(--di-text-secondary, #666); margin:0;">Detailed statistics and history for <span class="${getLevelClass(user.level_string)}">${escapeHtml$1(user.name)}</span></p>
      </div>
       <div id="analytics-header-controls" style="display:none; align-items:center;">
         <label style="display:flex; align-items:center; margin-right:15px; font-size:13px; color:var(--di-text-secondary, #666); cursor:pointer; user-select:none;">
            <input type="checkbox" id="user-analytics-nsfw-toggle" ${nsfw.enabled ? "checked" : ""} style="margin-right:6px;">
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
    const dBtn = header.querySelector("#analytics-reset-btn");
    setTimeout(() => {
      const nsfwToggle = header.querySelector(
        "#user-analytics-nsfw-toggle"
      );
      if (nsfwToggle) {
        nsfwToggle.onchange = (e) => {
          nsfw.enabled = e.target.checked;
          setNsfwEnabled(nsfw.enabled);
          if (nsfw.apply) void nsfw.apply();
        };
      }
      if (dBtn) {
        dBtn.onclick = async () => {
          if (confirm(
            "⚠ FULL RESET WARNING ⚠\n\nThis will DELETE all local analytics data for this user and require a full re-sync.\n\nContinue?"
          )) {
            dBtn.innerHTML = "⌛";
            await app.dataManager.clearUserData(app.context.targetUser);
            showToast({ type: "success", message: "Data cleared." });
            app.toggleModal(false);
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
      const lastSyncKey = `danbooru_grass_last_sync_${app.context.targetUser.id}`;
      const lastSyncStr = localStorage.getItem(lastSyncKey);
      if (lastSyncStr) {
        const lastSyncDate = new Date(lastSyncStr);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - lastSyncDate.getTime());
        const diffDays = Math.ceil(diffTime / (1e3 * 60 * 60 * 24));
        if (diffDays > CONFIG.FULL_REFRESH_HINT_DAYS && dBtn) {
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
    return header;
  }
  function renderResumeSyncView(content, stats, total, app) {
    const syncDiv = document.createElement("div");
    syncDiv.style.textAlign = "center";
    syncDiv.style.padding = "40px 20px";
    syncDiv.style.color = "var(--di-text-secondary, #666)";
    let msg = `We have <strong>${stats.count}</strong> posts synced, but the user has <strong>${total || "more"}</strong>.`;
    if (total === 0 && stats.count > 0)
      msg = `We have <strong>${stats.count}</strong> posts synced. Total count unavailable.`;
    if (stats.count === 0)
      msg = `To generate the report, we need to fetch all post metadata for <strong>${escapeHtml$1(app.context.targetUser.name)}</strong>.`;
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
    const progressEls = () => ({
      progressDiv: syncDiv.querySelector(
        "#analytics-main-progress"
      ),
      bar: syncDiv.querySelector("#analytics-main-bar"),
      percent: syncDiv.querySelector("#analytics-main-percent"),
      countText: syncDiv.querySelector("#analytics-main-count")
    });
    if (AnalyticsDataManager.isGlobalSyncing) {
      btn.innerHTML = "Fetching in background...";
      btn.disabled = true;
      btn.style.backgroundColor = "#94d3a2";
      btn.style.cursor = "not-allowed";
      const { progressDiv, bar, percent, countText } = progressEls();
      progressDiv.style.display = "block";
      const { current, total: progressTotal } = AnalyticsDataManager.syncProgress;
      if (progressTotal > 0) {
        const p = Math.round(current / progressTotal * 100);
        bar.style.width = `${p}%`;
        percent.textContent = `${p}%`;
        countText.textContent = `${current} / ${progressTotal}`;
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
      const { progressDiv, bar, percent, countText } = progressEls();
      progressDiv.style.display = "block";
      AnalyticsDataManager.onProgressCallback = (c, max) => {
        const p = max > 0 ? Math.round(c / max * 100) : 0;
        bar.style.width = `${p}%`;
        percent.textContent = max > 0 ? `${p}%` : "Scanning...";
        countText.textContent = `${c} / ${max > 0 ? max : "?"}`;
      };
      const outcome = await app.dataManager.syncAllPosts(
        app.context.targetUser,
        () => {
        }
      );
      warnIfSyncIncomplete(outcome);
      if (outcome.started) app.markSyncCompleted();
      void app.updateHeaderStatus();
      void app.renderDashboard();
    };
  }
  async function runQuickSync(content, dataManager, user) {
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
    await dataManager.quickSyncAllPosts(
      user,
      (c, t, msg) => {
        if (qBar && t > 0) qBar.style.width = `${Math.round(c / t * 100)}%`;
        if (qMsg && msg && msg !== "PREPARING") qMsg.textContent = msg;
      }
    );
  }
  class UserAnalyticsApp {
    db;
    settings;
    context;
    rateLimiter;
    dataManager;
    dataService;
    modalId;
    btnId;
    modal = null;
    isFullySynced;
    isRendering;
initialStatusCheck = null;
totalPostCount = null;
syncJustRan = false;
previewPopover = null;
constructor(db, settings, context, rateLimiter) {
      this.db = db;
      this.settings = settings;
      this.context = context;
      const rl = CONFIG.RATE_LIMITER;
      this.rateLimiter = rateLimiter ?? new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);
      this.dataManager = new AnalyticsDataManager(db, this.rateLimiter);
      this.dataService = new UserAnalyticsDataService(db, this.rateLimiter);
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
      const overlayId = `${this.modalId}-overlay`;
      const windowId = `${this.modalId}-window`;
      const closeId = `${this.modalId}-close`;
      const contentId = `${this.modalId}-content`;
      this.modal = createModal({
        id: overlayId,
        useFadeTransition: true,
        resolveTheme: () => resolveEffectiveDashboardTheme(this.settings.getDarkMode()),
        innerHtml: `
        <div id="${windowId}">
          <div id="${closeId}">&times;</div>
          <div id="${contentId}">
            <h1 style="margin-top:0; color:var(--di-text, #333);">Analytics Dashboard</h1>
            <p style="color:var(--di-text-secondary, #666);">Select a metric to view detailed reports.</p>
            <!-- Placeholder for future charts -->
          </div>
        </div>
      `,
        onAfterClose: () => {
          void this.updateHeaderStatus();
        }
      });
      const closeBtn = document.getElementById(closeId);
      if (closeBtn) {
        closeBtn.onclick = () => this.toggleModal(false);
      }
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
        btn.setAttribute("role", "button");
        btn.setAttribute("aria-label", "Open user analytics report");
        btn.innerHTML = "📊";
        btn.style.margin = "0";
        const previewPopover = createDashboardPreviewPopover({
          anchor: btn,
          fetchPosts: () => this.dataManager.getRecentPostsPreview(
            this.context.targetUser,
            RECENT_POSTS_LIMIT
          ),
          fetchActivity: () => this.dataManager.getActivityDistribution(
            this.context.targetUser,
            ACTIVITY_SEGMENT_LIMIT
          ),




activityHref: (type, dist) => type === "suspicious" ? suspiciousPostsUrl(dist.suspiciousPostIds) ?? activityTypeIndexUrl(type, this.context.targetUser) : activityTypeIndexUrl(
            type,
            this.context.targetUser,
            dist.oldestAnchorByType[type]
          ),

fetchAbandoned: (postIds) => this.dataManager.getAbandonedPostIds(postIds)
        });
        this.previewPopover = previewPopover;
        let hoverTimer = null;
        if (!isTouchDevice()) {
          btn.addEventListener("mouseenter", () => {
            previewPopover.keepOpen();
            if (hoverTimer !== null) clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => previewPopover.show(), 200);
          });
          btn.addEventListener("mouseleave", () => {
            if (hoverTimer !== null) {
              clearTimeout(hoverTimer);
              hoverTimer = null;
            }
            previewPopover.scheduleHide();
          });
        } else {
          btn.title = "Open Analytics Report";
        }
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (hoverTimer !== null) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
          }
          if (this.initialStatusCheck) {
            try {
              await this.initialStatusCheck;
            } catch {
            }
          }
          const total = this.totalPostCount;
          if (total !== null && total <= CONFIG.MAX_PREVIEW_ONLY_UPLOADS) {
            previewPopover.show({ pinned: true });
            return;
          }
          previewPopover.hide();
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
      const state2 = {
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
        const percent = state2.total > 0 ? Math.floor(state2.current / state2.total * 100) : 0;
        let headerHtml = "";
        let subHtml = "";
        let containerColor = "#ff4444";
        if (state2.phase === "PREPARING") {
          containerColor = "inherit";
          headerHtml = `<div style="color:#00ba7c; font-weight:bold;">Synced: ${state2.current.toLocaleString()} / ${state2.total.toLocaleString()} (${percent}%)</div>`;
          subHtml = `<div style="font-size:0.8em; color:#ffeb3b; margin-top:2px;">${state2.message || "Preparing Report"}${dotStr}</div>`;
        } else {
          containerColor = "#ff4444";
          headerHtml = `<div style="font-weight:bold;">Synced: ${state2.current.toLocaleString()} / ${state2.total.toLocaleString()} (${percent}%)</div>`;
          subHtml = `<div style="font-size:0.8em; color:var(--di-text-muted, #888); margin-top:2px;">${state2.message || `Fetching data${dotStr}`}</div>`;
        }
        void this.updateHeaderStatus(headerHtml + subHtml, containerColor);
      };
      render();
      animInterval = setInterval(render, 500);
      const onProgress = (current, total, msg) => {
        state2.current = current;
        state2.total = total;
        if (msg) state2.message = msg;
        const isComplete = total > 0 && current >= total;
        if (msg === "PREPARING" || isComplete) {
          state2.phase = "PREPARING";
        } else {
          state2.phase = "FETCHING";
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
        let syncOutcome = { complete: true, started: true };
        if (syncTotal <= MAX_QUICK_SYNC_POSTS) {
          await this.dataManager.quickSyncAllPosts(
            this.context.targetUser,
            onProgress
          );
        } else {
          syncOutcome = await this.dataManager.syncAllPosts(
            this.context.targetUser,
            onProgress
          );
          warnIfSyncIncomplete(syncOutcome);
        }
        if (syncOutcome.started) this.syncJustRan = true;
        if (animInterval) clearInterval(animInterval);
        if (shouldRender) {
          if (syncOutcome.complete) {
            const finalStats = await this.dataManager.getSyncStats(
              this.context.targetUser
            );
            void this.updateHeaderStatus(
              `Synced: ${finalStats.count.toLocaleString()} / ${finalStats.count.toLocaleString()}`,
              "#00ba7c"
            );
          } else {
            void this.updateHeaderStatus();
          }
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
          setTimeout(() => {
            if (btn?.innerHTML === "ERR") btn.innerHTML = originalText;
          }, 2e3);
        }
        void this.updateHeaderStatus("Sync Failed", "#ff4444");
      }
    }
markSyncCompleted() {
      this.syncJustRan = true;
    }
async updateHeaderStatus(progressText = null, customColor = null) {
      const el2 = document.getElementById(`${this.modalId}-header-status`);
      if (!el2) return;
      if (progressText) {
        el2.innerHTML = progressText;
        el2.style.color = customColor || "#d73a49";
        return;
      }
      const stats = await this.dataManager.getSyncStats(this.context.targetUser);
      const total = await this.dataManager.getTotalPostCount(
        this.context.targetUser
      );
      this.totalPostCount = total;
      const count = stats.count;
      const lastSyncKey = `danbooru_grass_last_sync_${this.context.targetUser.id}`;
      const lastSync = localStorage.getItem(lastSyncKey);
      const lastSyncText = lastSync ? new Date(lastSync).toLocaleDateString() : "Never";
      const settingsManager = new SettingsManager();
      const tolerance = settingsManager.getSyncThreshold();
      const isSynced = total === 0 || count >= total - tolerance;
      this.isFullySynced = isSynced;
      const statusColor = total === 0 || stats.lastSync && isSynced ? "#28a745" : "#d73a49";
      el2.innerHTML = "";
      el2.style.color = statusColor;
      el2.title = `Last synced: ${lastSyncText}`;
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
      const miniReport = this.buildMiniReportButton();
      if (miniReport) row1.appendChild(miniReport);
      el2.appendChild(row1);
      const row2 = document.createElement("div");
      if (stats.lastSync && isSynced) {
        row2.innerHTML = `<span style="font-size:1em; font-weight:normal; color:#28a745;">${lastSyncText}</span>`;
      } else {
        row2.textContent = "Not fully synced";
      }
      el2.appendChild(row2);
    }
buildMiniReportButton() {
      if (!isTouchDevice() || !this.previewPopover) return null;
      const reportBtn = document.createElement("span");
      reportBtn.setAttribute("role", "button");
      reportBtn.setAttribute("aria-label", "Open quick mini-report");
      reportBtn.title = "Quick mini-report";
      reportBtn.textContent = "📋";
      reportBtn.style.cursor = "pointer";
      reportBtn.style.marginLeft = "6px";
      reportBtn.style.fontSize = "12px";
      reportBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.previewPopover?.show({ pinned: true });
      };
      return reportBtn;
    }
showSyncSettingsPopover(target) {
      const existing = document.getElementById("danbooru-grass-sync-settings");
      if (existing) {
        existing.remove();
        return;
      }
      const settingsManager = new SettingsManager();
      const currentVal = settingsManager.getSyncThreshold();
      const currentCountTtl = getCountCacheTtlMin();
      const popover = document.createElement("div");
      popover.id = "danbooru-grass-sync-settings";
      if (resolveEffectiveDashboardTheme(settingsManager.getDarkMode()) === "dark") {
        popover.setAttribute("data-di-theme", "dark");
      }
      applyPopoverChrome(popover, { width: "220px" });
      const { top, left } = calcPopoverPosition(target);
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      const originalDarkMode = settingsManager.getDarkMode();
      popover.innerHTML = `
      <div style="margin-bottom:8px; line-height:1.4;">
        <strong>Partial Sync Threshold</strong><br>
        Allow report view without sync if: <br>
        (Total - Synced) <= Threshold
      </div>
      <div>
         <input type="number" id="sync-thresh-input" value="${currentVal}" min="0" style="width:60px; padding:3px; border:1px solid var(--di-border-input, #ddd); border-radius:3px; background:var(--di-bg, #fff); color:var(--di-text, #333);">
      </div>
      <div style="margin-top:10px; padding-top:8px; border-top:1px solid var(--di-border-light, #eee); line-height:1.4;">
        <strong>Count Refresh (min)</strong><br>
        Refresh post-count values older than this on dashboard open.
      </div>
      <div style="margin-top:4px;">
         <input type="number" id="count-ttl-input" value="${currentCountTtl}" min="1" style="width:60px; padding:3px; border:1px solid var(--di-border-input, #ddd); border-radius:3px; background:var(--di-bg, #fff); color:var(--di-text, #333);">
      </div>
      ${DASHBOARD_THEME_SELECT_HTML}
      <div class="di-popover-actions">
        <button id="popover-cancel-btn" class="di-popover-btn di-popover-btn-cancel">Cancel</button>
        <button id="popover-save-btn" class="di-popover-btn di-popover-btn-save" disabled>Save</button>
      </div>
    `;
      document.body.appendChild(popover);
      const syncThreshInput = popover.querySelector(
        "#sync-thresh-input"
      );
      const countTtlInput = popover.querySelector(
        "#count-ttl-input"
      );
      const darkModeSelect = popover.querySelector(
        "#dark-mode-select"
      );
      darkModeSelect.value = originalDarkMode;
      const saveBtn = popover.querySelector(
        "#popover-save-btn"
      );
      const cancelBtn = popover.querySelector(
        "#popover-cancel-btn"
      );
      const checkDirty = () => {
        const isDirty = syncThreshInput.value !== String(currentVal) || countTtlInput.value !== String(currentCountTtl) || darkModeSelect.value !== originalDarkMode;
        saveBtn.disabled = !isDirty;
      };
      syncThreshInput.addEventListener("input", checkDirty);
      countTtlInput.addEventListener("input", checkDirty);
      darkModeSelect.addEventListener("change", checkDirty);
      const closeHandler = createClickOutsideHandler(
        popover,
        () => closePopover(),
        { ignore: target }
      );
      setTimeout(() => document.addEventListener("click", closeHandler), 0);
      const closePopover = () => {
        popover.remove();
        document.removeEventListener("click", closeHandler);
      };
      cancelBtn.onclick = closePopover;
      saveBtn.onclick = () => {
        const syncThreshVal = parseInt(syncThreshInput.value, 10);
        const countTtlVal = parseInt(countTtlInput.value, 10);
        if (isNaN(syncThreshVal) || syncThreshVal < 0) {
          showToast({
            type: "warn",
            message: "Partial Sync Threshold must be a non-negative number."
          });
          return;
        }
        if (isNaN(countTtlVal) || countTtlVal < 1) {
          showToast({
            type: "warn",
            message: "Count Refresh must be ≥ 1 minute."
          });
          return;
        }
        let needsHeaderRefresh = false;
        if (syncThreshVal !== currentVal) {
          settingsManager.setSyncThreshold(syncThreshVal);
          needsHeaderRefresh = true;
        }
        if (countTtlVal !== currentCountTtl) {
          setCountCacheTtlMin(countTtlVal);
        }
        if (darkModeSelect.value !== originalDarkMode) {
          settingsManager.setDarkMode(
            darkModeSelect.value
          );
          applyDashboardTheme(settingsManager);
        }
        closePopover();
        if (needsHeaderRefresh) {
          void this.updateHeaderStatus();
        }
      };
    }
toggleModal(show) {
      if (!this.modal) return;
      this.modal.toggle(show);
      if (show) {
        void this.renderDashboard();
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
        let reportProgress = paintLoadingSpinner(content);
        const { preStats, preTotal } = await runPreCheck(
          this.dataManager,
          this.context.targetUser
        );
        perfMeta.preTotal = preTotal;
        if (preTotal === 0 && preStats.count === 0) {
          perfMeta.path = "syncSkipped";
          this.isFullySynced = true;
          renderZeroUploadsView(content, this.context.targetUser);
          return;
        }
        let didQuickSync = false;
        if (preTotal > 0 && preTotal <= CONFIG.MAX_OPTIMIZED_POSTS && preStats.count < preTotal) {
          perfMeta.path = "quickSync";
          didQuickSync = true;
          await runQuickSync(content, this.dataManager, this.context.targetUser);
          this.isFullySynced = true;
          this.syncJustRan = true;
          void this.updateHeaderStatus();
          reportProgress = paintLoadingSpinner(content);
        } else {
          perfMeta.path = "syncSkipped";
        }
        const prefetched = didQuickSync ? void 0 : { syncStats: preStats, totalCount: preTotal };
        const forceDistRevalidate = this.syncJustRan;
        this.syncJustRan = false;
        const dashboardData = await perfLogger.wrap(
          "dbi:net:fetchData:total",
          () => this.dataService.fetchDashboardData(
            this.context,
            prefetched,
            reportProgress,
            forceDistRevalidate
          )
        );
        const {
          stats,
          total,
          summaryStats,
          statusStartRevalidate,
          ratingStartRevalidate,
          topPostsStartRevalidate,
          recentPopularStartRevalidate,
          milestones1kStartRevalidate,
          levelChangesStartRevalidate,
          distributionRevalidators,
          tagCloudGeneralStartRevalidate
        } = dashboardData;
        const { firstUploadDate } = summaryStats;
        const nsfw = { enabled: getNsfwEnabled(), apply: null };
        const header = buildDashboardHeader(this.context.targetUser, this, nsfw);
        content.appendChild(header);
        content.innerHTML = "";
        content.appendChild(header);
        const tolerance = 10;
        const needsSync = total > 0 && stats.count < total - tolerance || total === 0 && stats.count === 0;
        if (needsSync) {
          renderResumeSyncView(content, stats, total, this);
          return;
        }
        const headerControls = header.querySelector(
          "#analytics-header-controls"
        );
        if (headerControls) headerControls.style.display = "flex";
        const dashboardDiv = document.createElement("div");
        renderSummaryCards(dashboardDiv, dashboardData, this.context.targetUser);
        await renderDashboardWidgets(
          dashboardDiv,
          content,
          dashboardData,
          this,
          nsfw,
          firstUploadDate,
          preTotal
        );
        void this.updateHeaderStatus();
        schedulePieRevalidate(
          [
            ["status_dist", statusStartRevalidate],
            ["rating_dist", ratingStartRevalidate],
            ...distributionRevalidators
          ],

"copyright_dist"
        );
        scheduleRevalidateAll([
          ["topPosts", topPostsStartRevalidate],
          ["recentPopular", recentPopularStartRevalidate],
          ["milestones1k", milestones1kStartRevalidate],
          ["levelChanges", levelChangesStartRevalidate],
          ["tagCloudGeneral", tagCloudGeneralStartRevalidate]
        ]);
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
  const IMPLICATIONS_CACHE_SCHEMA_VERSION = 2;
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
  function isImplicationCacheValid(fetchedAt, now, schemaVersion) {
    if (schemaVersion !== IMPLICATIONS_CACHE_SCHEMA_VERSION) return false;
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
_pendingCountsUpdatedAt = null;
markCountsRefreshed() {
      this._pendingCountsUpdatedAt = Date.now();
    }
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
              updatedAt: cached.updatedAt,


countsUpdatedAt: cached.countsUpdatedAt
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
        const needExisting = this._pendingLastFullScanAt === null || this._pendingCountsUpdatedAt === null;
        const existing = needExisting ? await this.db.tag_analytics.get(this.tagName) : null;
        const lastFullScanAt = this._pendingLastFullScanAt !== null ? this._pendingLastFullScanAt : existing?.lastFullScanAt;
        const countsUpdatedAt = this._pendingCountsUpdatedAt !== null ? this._pendingCountsUpdatedAt : existing?.countsUpdatedAt;
        await this.db.tag_analytics.put({
          tagName: this.tagName,
          updatedAt: Date.now(),
          data,
          lastFullScanAt,
          countsUpdatedAt
        });
        this._pendingLastFullScanAt = null;
        this._pendingCountsUpdatedAt = null;
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
        const url = `/tag_implications.json?search[antecedent_name_comma]=${encodeURIComponent(chunk.join(","))}&search[status]=active&limit=1000`;
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
          if (r && isImplicationCacheValid(r.fetchedAt, now, r.schemaVersion)) {
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
          records.push({
            tagName,
            isTopLevel,
            fetchedAt: now,
            schemaVersion: IMPLICATIONS_CACHE_SCHEMA_VERSION
          });
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
async fetchCountWithRetry(tagQuery, retries = 1) {
      for (let i = 0; i <= retries; i++) {
        try {
          return await fetchRemoteCount$1(this.rateLimiter, tagQuery);
        } catch (e) {
          if (i === retries) {
            log$2.warn(`Failed to fetch count after ${retries + 1} attempts`, {
              tagQuery,
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
        total: `${tagName} has:commentary`,
        translated: `${tagName} has:commentary commentary`,
        requested: `${tagName} has:commentary commentary_request`
      };
      const results = {};
      const keys = Object.keys(queries);
      await Promise.all(
        keys.map(async (key) => {
          results[key] = await this.fetchCountWithRetry(queries[key]);
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
async fetchTranslationCounts(tagName) {
      const direct = {
        translated: `${tagName} translated`,
        requested: `${tagName} translation_request`
      };
      const incl = buildUntaggedTranslationQueries(tagName);
      const [translated, requested, t, a, b, c, ab, ac] = await Promise.all([
        this.fetchCountWithRetry(direct.translated),
        this.fetchCountWithRetry(direct.requested),
        this.fetchCountWithRetry(incl.t),
        this.fetchCountWithRetry(incl.a),
        this.fetchCountWithRetry(incl.b),
        this.fetchCountWithRetry(incl.c),
        this.fetchCountWithRetry(incl.ab),
        this.fetchCountWithRetry(incl.ac)
      ]);
      const untagged = computeUntaggedTranslation({ t, a, b, c, ab, ac });
      return { translated, requested, untagged };
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
        results[status] = await this.fetchCountWithRetry(
          `${tagName} status:${status}`
        );
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
        let tagQuery = `${tagName} rating:${rating}`;
        if (startDate) {
          tagQuery += ` date:>=${startDate}`;
        }
        results[rating] = await this.fetchCountWithRetry(tagQuery);
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
              resolved[slice.key] = await fetchRemoteCount$1(
                this.rateLimiter,
                `${tagName} ${slice.key}`
              );
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
      }
    }
    async fetchHistoryBackwards(tagName, forwardStartDate, targetTotal, currentForwardTotal) {
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
        try {
          const count = await fetchRemoteCount$1(
            this.rateLimiter,
            `${tagName} date:${dateRange}`
          );
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
      try {
        return await fetchRemoteCount$1(this.rateLimiter, `${tagName} age:..1d`);
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
        fetchTasks.map(
          (task) => fetchRemoteCount$1(
            this.rateLimiter,
            `${tagName} status:any date:${task.queryDate}`
          ).then((count) => ({
            date: task.dateStr,
            yearMonth: task.yearMonth,
            count,
            ok: true
          })).catch((e) => {
            log$2.warn(`Failed month ${task.dateStr}`, { error: e });
            return {
              date: task.dateStr,
              yearMonth: task.yearMonth,
              count: 0,
              ok: false
            };
          })
        )
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
      } else if (type === "translation") {
        const tr = tagData.translationCounts;
        counts = {
          translated: tr?.translated || 0,
          translation_request: tr?.requested || 0,
          "*_text -english_text -translation_request -translated": tr?.untagged || 0
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
        } else if (type === "translation") {
          if (key === "translated") name = "Translated";
          else if (key === "translation_request") name = "Requested";
          else if (key === "*_text -english_text -translation_request -translated")
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
        if (type === "translation") {
          if (key === "translated") return "#28a745";
          if (key === "translation_request") return "#ffc107";
          if (key === "*_text -english_text -translation_request -translated")
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
      const tooltip = d3__namespace.select(createBodyTooltip("tag-pie-tooltip")).style("background", "rgba(30, 30, 30, 0.9)").style("color", "#fff").style("padding", "5px 10px").style("border-radius", "4px").style("font-size", "11px").style("box-shadow", "0 2px 5px var(--di-shadow, rgba(0,0,0,0.2))");
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
      const tooltip = d3__namespace.select(createBodyTooltip("tag-analytics-tooltip")).style("z-index", "11000").style("background", "rgba(0, 0, 0, 0.8)").style("color", "#fff").style("padding", "8px").style("border-radius", "4px").style("font-size", "12px").style("transition", "opacity 0.2s");
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
          <div style="display: flex; justify-content: space-between; font-size: 0.85em; padding: 3px 5px; border-bottom: 1px solid #f5f5f5; background: linear-gradient(90deg, var(--di-ranking-row-fill, rgba(0,0,0,0.06)) ${percentage}%, transparent ${percentage}%);">
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
    modal = null;
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
        this.injectAnalyticsButton(null, 50, "Refreshing volatile data...");
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
        const countsTtlMs = getCountCacheTtlMs();
        const countsAnchor = cachedData.countsUpdatedAt ?? cachedData.updatedAt ?? 0;
        const countsAge = Date.now() - countsAnchor;
        if (countsAge > countsTtlMs) {
          log.debug(
            `Refreshing deferred counts: age ${(countsAge / 6e4).toFixed(1)}m > ttl ${(countsTtlMs / 6e4).toFixed(1)}m`
          );
          this.injectAnalyticsButton(
            null,
            80,
            "Refreshing status and rating counts..."
          );
          const startDate = cachedData.historyData && cachedData.historyData.length > 0 ? new Date(cachedData.historyData[0].date).toISOString().split("T")[0] : null;
          const [freshStatus, freshRating] = await Promise.all([
            this.dataService.fetchStatusCounts(tagName),
            this.dataService.fetchRatingCounts(tagName, startDate)
          ]);
          cachedData.statusCounts = freshStatus;
          cachedData.ratingCounts = freshRating;
          this.dataService.markCountsRefreshed();
        }
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
      const smallTagTotalFetches = 7;
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
        commentaryCounts,
        translationCounts
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
        trackSmall(
          "Analyzing translation",
          this.dataService.fetchTranslationCounts(tagName)
        ),
        this.dataService.backfillUploaderNames(initialPosts)
      ]);
      meta.historyData = historyData;
      meta.firstPost = firstPost ?? void 0;
      meta.hundredthPost = hundredthPost ?? void 0;
      meta.timeToHundred = timeToHundred ?? void 0;
      meta.statusCounts = statusCounts;
      meta.commentaryCounts = commentaryCounts;
      meta.translationCounts = translationCounts;
      meta.ratingCounts = localStatsAllTime.ratingCounts;
      this.dataService.markCountsRefreshed();
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
      meta.translationCounts = quickStats.translationCounts;
      const heavyResults = await heavyResultsPromise;
      const [resolvedRankings, historyData, milestones, first100Stats] = heavyResults;
      firstPost = initialStats.firstPost;
      hundredthPost = initialStats.hundredthPost;
      if (first100Override.value) ;
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
      this.injectAnalyticsButton(null, 95, "Fetching rating counts... (95%)");
      const ratingCounts = await measure(
        "Rating Counts",
        this.dataService.fetchRatingCounts(tagName, minDateStr)
      );
      meta.ratingCounts = ratingCounts;
      this.dataService.markCountsRefreshed();
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
        },
        {
          id: "translation",
          label: "Analyzing translation status...",
          promise: measure(
            "Translation Status",
            this.dataService.fetchTranslationCounts(tagName)
          )
        }
      ];
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
        commentaryCounts,
        translationCounts
      ] = quickResults;
      return {
        statusCounts,
        latestPost,
        newPostCount,
        trendingPost,
        trendingPostNSFW,
        copyrightCounts,
        characterCounts,
        commentaryCounts,
        translationCounts
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
              referenceTotal = await fetchRemoteCount$1(
                this.rateLimiter,
                `${tagName} status:any date:<${monthlyData.historyCutoff}`
              );
            } catch (e) {
              log.warn(
                "Failed to fetch cutoff total, falling back to meta.post_count",
                { error: e }
              );
            }
          }
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
      const currentCountTtl = getCountCacheTtlMin();
      const originalDarkMode = this.settings.getDarkMode();
      const popover = document.createElement("div");
      popover.id = "tag-analytics-settings-popover";
      if (resolveEffectiveDashboardTheme(this.settings.getDarkMode()) === "dark") {
        popover.setAttribute("data-di-theme", "dark");
      }
      applyPopoverChrome(popover, { width: "260px", zIndex: "11001" });
      const { top, left } = calcPopoverPosition(target);
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
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
  </div>

  <div class="di-section di-divider">
    <strong>Count Refresh (min)</strong><br>
    Refresh post-count values older than this on dashboard open.
  </div>
  <div class="di-row">
     <input type="number" id="count-ttl-input" value="${currentCountTtl}" min="1" step="1">
  </div>

  ${DASHBOARD_THEME_SELECT_HTML}

  <div class="di-popover-actions">
    <button id="popover-cancel-btn" class="di-popover-btn di-popover-btn-cancel">Cancel</button>
    <button id="popover-save-btn" class="di-popover-btn di-popover-btn-save" disabled>Save</button>
  </div>
`;
      document.body.appendChild(popover);
      const daysInput = popover.querySelector(
        "#retention-days-input"
      );
      const thresholdInput = popover.querySelector(
        "#sync-threshold-input"
      );
      const countTtlInput = popover.querySelector(
        "#count-ttl-input"
      );
      const darkModeSelect = popover.querySelector(
        "#dark-mode-select"
      );
      darkModeSelect.value = originalDarkMode;
      const saveBtn = popover.querySelector(
        "#popover-save-btn"
      );
      const cancelBtn = popover.querySelector(
        "#popover-cancel-btn"
      );
      const checkDirty = () => {
        const isDirty = daysInput.value !== String(currentDays) || thresholdInput.value !== String(currentThreshold) || countTtlInput.value !== String(currentCountTtl) || darkModeSelect.value !== originalDarkMode;
        saveBtn.disabled = !isDirty;
      };
      daysInput.addEventListener("input", checkDirty);
      thresholdInput.addEventListener("input", checkDirty);
      countTtlInput.addEventListener("input", checkDirty);
      darkModeSelect.addEventListener("change", checkDirty);
      const closeHandler = createClickOutsideHandler(
        popover,
        () => closePopover(),
        { ignore: target }
      );
      setTimeout(() => document.addEventListener("click", closeHandler), 0);
      const closePopover = () => {
        popover.remove();
        document.removeEventListener("click", closeHandler);
      };
      cancelBtn.onclick = closePopover;
      saveBtn.onclick = () => {
        const days = parseInt(daysInput.value, 10);
        const threshold = parseInt(thresholdInput.value, 10);
        const countTtl = parseInt(countTtlInput.value, 10);
        if (isNaN(days) || days < 1) {
          showToast({
            type: "warn",
            message: "Data Retention must be ≥ 1 day."
          });
          return;
        }
        if (isNaN(threshold) || threshold < 1) {
          showToast({
            type: "warn",
            message: "Sync Threshold must be ≥ 1."
          });
          return;
        }
        if (isNaN(countTtl) || countTtl < 1) {
          showToast({
            type: "warn",
            message: "Count Refresh must be ≥ 1 minute."
          });
          return;
        }
        const retentionChanged = days !== currentDays;
        const thresholdChanged = threshold !== currentThreshold;
        if (retentionChanged) this.dataService.setRetentionDays(days);
        if (thresholdChanged) this.dataService.setSyncThreshold(threshold);
        if (countTtl !== currentCountTtl) setCountCacheTtlMin(countTtl);
        if (darkModeSelect.value !== originalDarkMode) {
          this.settings.setDarkMode(
            darkModeSelect.value
          );
          applyDashboardTheme(this.settings);
        }
        closePopover();
        if (retentionChanged || thresholdChanged) {
          showToast({
            type: "success",
            message: "Settings saved. Cleaning up old data now…"
          });
          void this.dataService.cleanupOldCache();
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
      this.modal = createModal({
        id: "tag-analytics-modal",
        resolveTheme: () => resolveEffectiveDashboardTheme(this.settings.getDarkMode()),
        innerHtml: `
        <div>
          <button id="tag-analytics-close">&times;</button>
          <div id="tag-analytics-content">
            <h2>Loading...</h2>
          </div>
        </div>
      `,
        onBeforeClose: () => {
          this.chartRenderer.cleanup();
          d3__namespace.select("body").selectAll(".tag-analytics-tooltip").remove();
        }
      });
      const overlay = this.modal.overlay;
      overlay.style.position = "fixed";
      overlay.style.top = "0";
      overlay.style.left = "0";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.backgroundColor = "rgba(0,0,0,0.5)";
      overlay.style.zIndex = "10000";
      overlay.style.justifyContent = "center";
      overlay.style.alignItems = "center";
      overlay.style.display = "none";
      const closeBtn = document.getElementById("tag-analytics-close");
      if (closeBtn) closeBtn.onclick = () => this.toggleModal(false);
    }
toggleModal(show) {
      if (!this.modal) this.createModal();
      if (!this.modal) return;
      this.modal.toggle(show);
      if (show) {
        const closeBtn = document.getElementById("tag-analytics-close");
        if (closeBtn) closeBtn.focus();
      }
    }
updateNsfwVisibility() {
      const isNsfwEnabled = getNsfwEnabled();
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
      const topRowPieTabsHtml = `
      ${tagData.copyrightCounts ? '<button class="di-pie-tab" data-type="copyright" title="Copyright">Copy</button>' : ""}
      ${tagData.characterCounts ? '<button class="di-pie-tab" data-type="character" title="Character">Char</button>' : ""}
      <button class="di-pie-tab active" data-type="status">Status</button>
      <button class="di-pie-tab" data-type="rating">Rating</button>
    `;
      const bottomRowPieTabsHtml = `
      <button class="di-pie-tab" data-type="commentary">Commentary</button>
      <button class="di-pie-tab" data-type="translation">Translation</button>
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
                    <div class="pie-tabs-row">${topRowPieTabsHtml}</div>
                    <div class="pie-tabs-row">${bottomRowPieTabsHtml}</div>
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
        nsfwCheck.checked = getNsfwEnabled();
        nsfwCheck.onchange = (e) => {
          setNsfwEnabled(e.target.checked);
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
    migrateNsfwKey();
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
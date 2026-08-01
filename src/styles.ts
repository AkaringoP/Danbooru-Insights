/**
 * Centralized CSS styles for Danbooru Insights to prevent duplicate injection
 * and improve performance by utilizing CSS classes and pseudo-classes.
 */
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
    /* "Refreshing counts" pill on the pie header — signals the current tab's
       per-tag counts are being revalidated in the background so a briefly
       stale cached value isn't mistaken for final. Toggled via .is-active. */
    .di-pie-updating-badge {
        display: none;
        align-items: center;
        gap: 5px;
        font-size: 10px;
        color: var(--di-text-muted, #888);
        background: var(--di-bg-tertiary, #f0f0f0);
        border-radius: 10px;
        padding: 2px 8px;
        white-space: nowrap;
        flex-shrink: 0;
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
    .di-gmp-header {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--di-text-muted, #888);
      margin-bottom: 8px;
    }
    .di-gmp-headline {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
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

/**
 * Injects the global stylesheet into the document head exactly once.
 */
export function injectGlobalStyles() {
  if (document.getElementById('danbooru-insights-global-css')) return;
  const style = document.createElement('style');
  style.id = 'danbooru-insights-global-css';
  style.textContent = GLOBAL_CSS;
  document.head.appendChild(style);
}

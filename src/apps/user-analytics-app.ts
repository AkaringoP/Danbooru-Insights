import {CONFIG} from '../config';
import {
  applyDashboardTheme,
  resolveEffectiveDashboardTheme,
} from '../ui/theme-palette';
import {AnalyticsDataManager} from '../core/analytics-data-manager';
import {RateLimitedFetch} from '../core/rate-limiter';
import {
  SettingsManager,
  getNsfwEnabled,
  setNsfwEnabled,
  getCountCacheTtlMin,
  setCountCacheTtlMin,
} from '../core/settings';
import {perfLogger} from '../core/perf-logger';
import {UserAnalyticsDataService} from './user-analytics-data';
import type {ProgressState, ReportProgress} from './progress-tracker';
import {escapeHtml, getLevelClass} from '../utils';
import {
  renderPieWidget,
  renderTopPostsWidget,
  renderMilestonesWidget,
  renderHistoryChart,
} from './user-analytics-charts';
import {renderScatterPlot} from './user-analytics-scatter';
import {renderTagCloudWidget} from '../ui/tag-cloud-widget';
import {renderWidgetLockedPlaceholder} from '../ui/widget-locked-placeholder';
import {TAG_CLOUD_MIN_UPLOADS, SCATTER_MIN_UPLOADS} from './widget-gates';
import {renderCreatedTagsWidget} from './created-tags-widget';
import {dashboardFooterHtml} from '../ui/dashboard-footer';
import {createModal, type ModalHandle} from '../ui/modal';
import {
  applyPopoverChrome,
  calcPopoverPosition,
  createClickOutsideHandler,
  DASHBOARD_THEME_SELECT_HTML,
} from '../ui/popover-utils';
import {
  createDashboardPreviewPopover,
  RECENT_POSTS_LIMIT,
  ACTIVITY_SEGMENT_LIMIT,
} from '../ui/dashboard-preview-popover';
import {
  activityTypeIndexUrl,
  suspiciousPostsUrl,
} from '../core/dashboard-preview';
import {createLogger} from '../core/logger';
import {isTouchDevice} from '../ui/two-step-tap';
import {showToast} from '../ui/toast';
import type {Database} from '../core/database';
import type {ProfileContext} from '../core/profile-context';

const log = createLogger('UserAnalytics');

/** ProfileContext with a guaranteed non-null targetUser (post-validation). */
type ValidatedProfileContext = ProfileContext & {
  targetUser: NonNullable<ProfileContext['targetUser']>;
};

// ---------------------------------------------------------------------------
// renderDashboard sub-functions. Module-private — broken out from the class
// so each phase of the render pipeline has a clear name and is independently
// testable. The class method still owns orchestration (re-entry guard,
// perfLogger total span, the isRendering flag, branch sequencing).
// ---------------------------------------------------------------------------

/**
 * Paints the "Generating Report..." spinner card into the modal content.
 * Returns a `ReportProgress` callback so the orchestrator (or just a
 * caller that knows what's happening) can swap the headline/detail text
 * as work progresses. The returned callback is a no-op if the spinner
 * DOM has been replaced (e.g. by `renderDashboardWidgets`) — that's the
 * usual "fetch settled, dashboard rendered" race and is safe.
 */
function paintLoadingSpinner(content: HTMLElement): ReportProgress {
  content.innerHTML = `
        <div id="analytics-loading-report" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:100px 0; color:var(--di-text-secondary, #666);">
           <div class="di-spinner"></div>
           <div id="analytics-loading-label" style="font-size:1.2em; font-weight:600; margin-top: 20px;">Generating Report...</div>
           <div id="analytics-loading-detail" style="font-size:0.9em; color:var(--di-text-muted, #888); margin-top:10px; min-height:1.2em;">Analyzing contributions and trends</div>
        </div>
      `;
  return (state: ProgressState) => {
    const labelEl = document.getElementById('analytics-loading-label');
    const detailEl = document.getElementById('analytics-loading-detail');
    if (labelEl) labelEl.textContent = state.label;
    if (detailEl) detailEl.textContent = state.detail ?? '';
  };
}

/**
 * Pre-check stage. Issues two perf-wrapped lookups in parallel and returns
 * the local sync stats + the remote total count, used to decide between
 * zero-uploads / quick-sync / sync-skipped paths.
 */
async function runPreCheck(
  dataManager: AnalyticsDataManager,
  user: ValidatedProfileContext['targetUser'],
): Promise<{
  preStats: Awaited<ReturnType<AnalyticsDataManager['getSyncStats']>>;
  preTotal: number;
}> {
  perfLogger.start('dbi:render:precheck');
  const [preStats, preTotal] = await Promise.all([
    perfLogger.wrap('dbi:render:precheck:syncStats', () =>
      dataManager.getSyncStats(user),
    ),
    perfLogger.wrap('dbi:render:precheck:totalCount', () =>
      dataManager.getTotalPostCount(user),
    ),
  ]);
  perfLogger.end('dbi:render:precheck', {
    total: preTotal,
    synced: preStats.count,
  });
  return {preStats, preTotal};
}

/**
 * Zero-uploads view — renders the header + 📭 empty-state message + footer.
 * Hit when `preTotal === 0 && preStats.count === 0`. The full dashboard
 * render is skipped (several distribution fetchers hit /posts/random.json
 * which 404s on a user with no posts).
 */
function renderZeroUploadsView(
  content: HTMLElement,
  user: ValidatedProfileContext['targetUser'],
): void {
  content.innerHTML = '';
  const header = document.createElement('div');
  header.style.marginBottom = '25px';
  header.innerHTML = `
          <h2 style="margin-top:0; color:var(--di-text, #333); margin-bottom:4px;">Analytics Dashboard</h2>
          <p style="color:var(--di-text-secondary, #666); margin:0;">Detailed statistics and history for <span class="${getLevelClass(user.level_string)}">${escapeHtml(user.name)}</span></p>
        `;
  content.appendChild(header);

  const empty = document.createElement('div');
  empty.style.cssText =
    'text-align:center; padding:60px 20px; color:var(--di-text-secondary, #666);';
  empty.innerHTML = `
          <div style="font-size:48px; margin-bottom:20px;">📭</div>
          <h3 style="margin-top:0;">No uploads to analyze</h3>
          <p>This user has not uploaded any posts yet, so there is nothing to report.</p>
        `;
  content.appendChild(empty);
  content.insertAdjacentHTML('beforeend', dashboardFooterHtml());
}

/** Awaited shape of `UserAnalyticsDataService.fetchDashboardData`. */
type DashboardData = Awaited<
  ReturnType<UserAnalyticsDataService['fetchDashboardData']>
>;

/**
 * Fire SWR-revalidate starters as detached microtasks so they don't block
 * the visible render. setTimeout(0) yields to the browser once — enough
 * for paint to commit before the API requests go out. Failures are
 * logged at WARN since the cached value is still on screen.
 */
function scheduleRevalidateAll(
  starters: Array<[string, (() => Promise<unknown>) | undefined]>,
): void {
  for (const [name, starter] of starters) {
    if (!starter) continue;
    setTimeout(() => {
      starter().catch((e: unknown) => {
        log.warn(`SWR revalidate failed for ${name}`, {error: e});
      });
    }, 0);
  }
}

/**
 * Module-scoped so re-opening the dashboard replaces the previous open's lazy
 * listener rather than stacking a new one every renderDashboard. The modal is
 * a singleton — only one pie is live at a time — so a single slot is enough.
 */
let lazyPieRevalidateListener: ((e: Event) => void) | null = null;

/**
 * Like scheduleRevalidateAll but for pie-relevant distributions. Each entry is
 * `[cacheKey, starter]`; when a starter resolves with data that differs from
 * what was painted (non-null), it dispatches DanbooruInsights:DataUpdated so
 * the open pie live-patches that tab's proportions/counts/thumbs — no reopen
 * needed (audit R2 follow-up). `null` (unchanged) or an absent starter (cache
 * within TTL) dispatch nothing, so a fresh open costs no repaint.
 *
 * Only the visible tab (`priorityCacheKey`) revalidates on open. The other
 * eight heavy distributions each fetch N per-tag counts on the shared limiter,
 * so firing all nine on every post-sync open floods the queue (~250 calls for
 * a 46k-post user) to converge tabs the user may never open. Instead each
 * non-priority starter is registered *lazily*: the pie dispatches
 * `PieTabActivated` on a tab switch and we revalidate that tab then — once,
 * with its "Updating…" badge. A tab that is never viewed never revalidates.
 *
 * Exported for the eager/lazy split's regression tests.
 */
export function schedulePieRevalidate(
  entries: Array<[string, (() => Promise<unknown>) | undefined]>,
  priorityCacheKey: string,
): void {
  const fire = (cacheKey: string, starter: () => Promise<unknown>) => {
    // Announce refresh start/end so the pie can show an "Updating…" badge on
    // the current tab (a briefly-stale cached count then reads as pending, not
    // final). Fires regardless of whether the data actually changed.
    const setRefreshing = (active: boolean) =>
      window.dispatchEvent(
        new CustomEvent('DanbooruInsights:PieTabRefreshing', {
          detail: {contentType: cacheKey, active},
        }),
      );
    setRefreshing(true);
    return starter()
      .then(fresh => {
        // Starter resolves with fresh data only when it differs from what
        // was painted; null means unchanged → nothing to repaint.
        if (fresh === null) return;
        window.dispatchEvent(
          new CustomEvent('DanbooruInsights:DataUpdated', {
            detail: {contentType: cacheKey, data: fresh},
          }),
        );
      })
      .catch((e: unknown) => {
        log.warn(`Pie revalidate failed for ${cacheKey}`, {error: e});
      })
      .finally(() => setRefreshing(false));
  };

  // Register the non-priority starters as lazy: fired once, when the pie
  // reports the user switched to that tab. `undefined` starters (cache within
  // TTL, nothing to do) are skipped so switching to an already-fresh tab is a
  // no-op.
  const pending = new Map<string, () => Promise<unknown>>();
  for (const [cacheKey, starter] of entries) {
    if (!starter || cacheKey === priorityCacheKey) continue;
    pending.set(cacheKey, starter);
  }
  if (lazyPieRevalidateListener) {
    window.removeEventListener(
      'DanbooruInsights:PieTabActivated',
      lazyPieRevalidateListener,
    );
  }
  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail as
      | {contentType?: string}
      | undefined;
    const cacheKey = detail?.contentType;
    if (!cacheKey) return;
    const starter = pending.get(cacheKey);
    if (!starter) return; // already fired, or was within TTL — nothing to do
    pending.delete(cacheKey);
    void fire(cacheKey, starter);
  };
  lazyPieRevalidateListener = listener;
  window.addEventListener('DanbooruInsights:PieTabActivated', listener);

  // Fire only the *visible* tab's revalidate on open. The pie shows one tab at
  // a time; converging just the tab the user is looking at (default: copyright)
  // keeps the post-paint burst to that one distribution instead of nine.
  setTimeout(() => {
    const priority = entries.find(
      ([k, s]) => k === priorityCacheKey && s !== undefined,
    );
    if (priority && priority[1]) void fire(priority[0], priority[1]);
  }, 0);
}

/**
 * Renders the three summary cards (animated upload-stats pane, user
 * history with scrollable timeline, plus the per-card play/pause /
 * overflow-gradient wiring).
 *
 * The function appends a `.di-summary-grid` wrapper to `parent`; the
 * caller is responsible for appending `parent` (the dashboardDiv) to the
 * modal content.
 */
// T-26 baseline: 250 LOC / complexity 26 (T-22 archive flagged this; the
// per-card builders — uploadCard / userHistoryCard / timeline event
// collector — are the natural next split). Punted from Phase 5c because
// the body decomposition target was met by other helpers.
// eslint-disable-next-line max-lines-per-function, complexity
function renderSummaryCards(
  parent: HTMLElement,
  data: DashboardData,
  user: ValidatedProfileContext['targetUser'],
): void {
  const {stats, total, summaryStats, timelineMilestones, levelChanges} = data;
  const {maxUploads, maxDate, firstUploadDate, lastUploadDate} = summaryStats;
  const today = new Date();
  const oneDay = 1000 * 60 * 60 * 24;

  const summaryWrapper = document.createElement('div');
  summaryWrapper.className = 'di-summary-grid';
  summaryWrapper.style.display = 'grid';
  summaryWrapper.style.gridTemplateColumns =
    'repeat(auto-fit, minmax(300px, 1fr))';
  summaryWrapper.style.gap = '15px';
  summaryWrapper.style.marginBottom = '35px';

  /** Creates a summary card HTML string. */
  const makeCard = (
    title: string,
    val: string | number,
    icon: string,
    details: string = '',
  ) => `
          <div style="background:var(--di-bg, #fff); border:1px solid var(--di-border-light, #eee); border-radius:8px; padding:15px; display:flex; align-items:flex-start;">
             <div style="font-size:2em; margin-right:15px; margin-top:5px;">${icon}</div>
             <div style="flex:1; min-width:0;">
                <div style="font-size:0.85em; color:var(--di-text-secondary, #666); text-transform:uppercase; letter-spacing:0.5px;">${title}</div>
                ${val ? `<div style="font-size:1.5em; font-weight:bold; color:var(--di-text, #333);">${val}</div>` : ''}
                ${details ? `<div style="font-size:0.85em; color:var(--di-text-secondary, #666);">${details}</div>` : ''}
             </div>
          </div>
       `;

  // Calculations for Card 1 (Uploads) All-Time
  let avgUploads: number | string = 0;
  let daysSinceFirst = 0;
  if (firstUploadDate) {
    daysSinceFirst = Math.floor(
      (today.getTime() - firstUploadDate.getTime()) / oneDay,
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

  // Calculations for Card 1 (Uploads) 1-Year
  const {count1Year, maxUploads1Year, maxDate1Year} = summaryStats;
  let avgUploads1Year: number | string = 0;
  const daysSinceFirst1Year = Math.min(daysSinceFirst, 365);
  if (daysSinceFirst1Year > 0) {
    avgUploads1Year = ((count1Year || 0) / daysSinceFirst1Year).toFixed(2);
  }

  const uploadDetails1Year = `
       <div style="display:flex; flex-direction:column; gap:4px; border-left:2px solid var(--di-border-light, #eee); padding-left:12px;">
           <div>📈 <strong>Average:</strong> ${avgUploads1Year} posts / day</div>
           <div>🔥 <strong>Max:</strong> ${maxUploads1Year || 0} posts <span style="color:var(--di-text-muted, #888);">(${maxDate1Year || 'N/A'})</span></div>
       </div>
    `;

  // Calculations for Card 1 (Uploads) 3rd Pane (Consistency)
  const {maxStreak, maxStreakStart, maxStreakEnd, activeDays} = summaryStats;
  let activeRatio = '0.0';
  if (daysSinceFirst > 0) {
    activeRatio = ((activeDays / daysSinceFirst) * 100).toFixed(1);
  } else if (activeDays > 0) {
    activeRatio = '100.0';
  }

  let activeAvg = '0.0';
  if (activeDays > 0) {
    activeAvg = (stats.count / activeDays).toFixed(1);
  }

  const streakPeriod =
    maxStreakStart && maxStreakEnd
      ? ` <span style="color:var(--di-text-muted, #888);">(${maxStreakStart} ~ ${maxStreakEnd})</span>`
      : '';

  const consistencyDetails = `
       <div style="display:flex; flex-direction:column; gap:4px; border-left:2px solid var(--di-border-light, #eee); padding-left:12px;">
           <div>🏃‍♂️ <strong>Max Streak:</strong> ${maxStreak} days${streakPeriod}</div>
           <div>🌟 <strong>Active Ratio:</strong> ${activeRatio}% <span style="color:var(--di-text-muted, #888);">(${activeDays}/${daysSinceFirst.toLocaleString()} days)</span></div>
           <div>🎯 <strong>Active Avg:</strong> ${activeAvg} posts/day</div>
       </div>
    `;

  // Animated Slide Card for Uploads (Static Icon, Slide Out Left, Slide In Right, 3 Panes)
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

  // Calculations for Card 2 (Latest Post & Days)
  const lastDate = lastUploadDate
    ? lastUploadDate.toISOString().split('T')[0]
    : 'N/A';

  let daysSinceJoin = 0;
  let joinDateStr = '';
  if (user.created_at) {
    const joinDate = new Date(user.created_at);
    daysSinceJoin = Math.floor((today.getTime() - joinDate.getTime()) / oneDay);
    joinDateStr = joinDate.toISOString().split('T')[0];
  }

  const firstUploadDateStr = firstUploadDate
    ? firstUploadDate.toISOString().split('T')[0]
    : '';

  // Build timeline events (all types merged, sorted by date ASC)
  interface TimelineEvent {
    date: Date;
    icon: string;
    html: string;
  }
  const tlEvents: TimelineEvent[] = [];

  // Join
  if (user.created_at) {
    const joinDate = new Date(user.created_at);
    tlEvents.push({
      date: joinDate,
      icon: '🎊',
      html: `🎊 <strong>Join:</strong> ${daysSinceJoin.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${joinDateStr})</span>`,
    });
  }

  // 1st Post
  if (firstUploadDate) {
    tlEvents.push({
      date: firstUploadDate,
      icon: '🚀',
      html: `🚀 <strong>1st Post:</strong> ${daysSinceFirst.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${firstUploadDateStr})</span>`,
    });
  }

  // Timeline milestones (100th, 1000th, 10000th, ...)
  const milestoneIcons: Record<number, string> = {100: '💯'};
  timelineMilestones.forEach(m => {
    const icon = milestoneIcons[m.index] ?? '🏅';
    const label = `${m.index.toLocaleString()}th Post`;
    const dateStr = m.date.toISOString().split('T')[0];
    const daysAgo = Math.floor((today.getTime() - m.date.getTime()) / oneDay);
    tlEvents.push({
      date: m.date,
      icon,
      html: `${icon} <strong>${label}:</strong> ${daysAgo.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${dateStr})</span>`,
    });
  });

  // Level changes
  levelChanges.forEach(lc => {
    const icon = lc.isPromotion ? '⬆️' : '⬇️';
    const dateStr = lc.date.toISOString().split('T')[0];
    const daysAgo = Math.floor((today.getTime() - lc.date.getTime()) / oneDay);
    const fromLevelClass = getLevelClass(lc.fromLevel);
    const toLevelClass = getLevelClass(lc.toLevel);
    tlEvents.push({
      date: lc.date,
      icon,
      html: `${icon} <strong class="${fromLevelClass}">${lc.fromLevel}</strong> → <strong class="${toLevelClass}">${lc.toLevel}</strong> ${daysAgo.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${dateStr})</span>`,
    });
  });

  // Latest Post (with total post count as Nth)
  if (lastUploadDate) {
    const daysAgoLast = Math.floor(
      (today.getTime() - lastUploadDate.getTime()) / oneDay,
    );
    const latestLabel =
      total > 0 ? `${total.toLocaleString()}th Post` : 'Latest Post';
    tlEvents.push({
      date: lastUploadDate,
      icon: '📌',
      html: `📌 <strong>${latestLabel}:</strong> ${daysAgoLast.toLocaleString()} days ago <span style="color:var(--di-text-muted, #888);">(${lastDate})</span>`,
    });
  }

  // Sort by date ASC
  tlEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

  const timelineRows = tlEvents
    .map(
      ev =>
        `<div class="di-timeline-row" style="white-space:nowrap;">${ev.html}</div>`,
    )
    .join('');

  // Details for Card 2 — scrollable timeline (3 rows visible by default).
  // Discoverability for overflowing rows uses two layers:
  //   1. `di-user-history-timeline` — slim custom scrollbar (Chrome/Firefox).
  //   2. `di-user-history-wrap` + `has-overflow` class — bottom fade gradient
  //      for macOS Safari where overlay scrollbars auto-hide regardless of
  //      custom ::-webkit-scrollbar styles.
  const dateDetails = `
       <div class="di-user-history-wrap">
         <div class="di-user-history-timeline" style="display:flex; flex-direction:column; gap:4px; border-left:2px solid var(--di-border-light, #eee); padding-left:12px; max-height:66px; overflow-y:auto;">
             ${timelineRows}
         </div>
       </div>
    `;

  summaryWrapper.innerHTML += makeCard('User History', '', '📅', dateDetails);

  parent.appendChild(summaryWrapper);

  // Toggle `.has-overflow` on the wrap so the bottom fade gradient only
  // shows when there's actually more content below the fold. Also hide
  // the fade when the user has scrolled to the bottom.
  const historyTimeline = parent.querySelector(
    '.di-user-history-timeline',
  ) as HTMLElement | null;
  const historyWrap = historyTimeline?.parentElement as HTMLElement | null;
  if (historyTimeline && historyWrap) {
    if (historyTimeline.scrollHeight > historyTimeline.clientHeight + 1) {
      historyWrap.classList.add('has-overflow');
      historyTimeline.addEventListener('scroll', () => {
        const atBottom =
          historyTimeline.scrollTop + historyTimeline.clientHeight >=
          historyTimeline.scrollHeight - 1;
        historyWrap.classList.toggle('scrolled-to-bottom', atBottom);
      });
    }
  }

  // Bind Play/Pause Button Logic
  const btnPlayPause = parent.querySelector(
    '#analytics-upload-btn-play-pause',
  ) as HTMLElement;
  const uploadCard = parent.querySelector(
    '#danbooru-insights-upload-card',
  ) as HTMLElement;
  if (btnPlayPause && uploadCard) {
    let isPaused = false;
    btnPlayPause.addEventListener('click', () => {
      isPaused = !isPaused;
      if (isPaused) {
        uploadCard.classList.add('paused');
        btnPlayPause.title = 'Play Animation';
        btnPlayPause.innerHTML = `
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                         <polygon points="5 3 19 12 5 21 5 3"></polygon>
                     </svg>
                  `;
      } else {
        uploadCard.classList.remove('paused');
        btnPlayPause.title = 'Pause Animation';
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

/**
 * Renders the post-summary widget row: pie chart, top posts, milestones,
 * monthly activity, created tags, tag cloud, scatter plot. Each widget
 * carries its own perfLogger span; the NSFW fan-out callback is wired
 * onto the shared `nsfw` bus once all three NSFW-aware widgets have
 * built their `onNsfwChange` handlers.
 *
 * Footer is appended last (caller used to do it; now lives here for
 * locality with the widget chain).
 */
async function renderDashboardWidgets(
  parent: HTMLElement,
  content: HTMLElement,
  data: DashboardData,
  app: UserAnalyticsApp,
  nsfw: NsfwBus,
  firstUploadDate: Date | null,
  totalUploads: number,
): Promise<void> {
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
    dataManager,
  } = data;

  // --- ROW 2: Top Stats (Pie + Top Post) ---
  const topStatsRow = document.createElement('div');
  topStatsRow.style.display = 'grid';
  topStatsRow.style.gridTemplateColumns =
    'repeat(auto-fit, minmax(300px, 1fr))'; // Responsive
  topStatsRow.style.gap = '15px';
  topStatsRow.style.marginBottom = '35px';

  const pieContainer = document.createElement('div');
  pieContainer.style.background = 'var(--di-bg, #fff)';
  pieContainer.style.border = '1px solid var(--di-border-light, #eee)';
  pieContainer.style.borderRadius = '8px';
  pieContainer.style.padding = '15px';
  pieContainer.style.display = 'flex';
  pieContainer.style.flexDirection = 'column';
  pieContainer.style.color = 'var(--di-text-muted, #888)';

  const topPostContainer = document.createElement('div');
  topPostContainer.style.background = 'var(--di-bg, #fff)';
  topPostContainer.style.border = '1px solid var(--di-border-light, #eee)';
  topPostContainer.style.borderRadius = '8px';
  topPostContainer.style.padding = '15px';
  topPostContainer.style.display = 'flex';
  topPostContainer.style.flexDirection = 'column';

  // --- PIE CHART WIDGET ---
  perfLogger.start('dbi:render:widget:pie');
  const pieResult = renderPieWidget(
    pieContainer,
    distributions,
    nsfw.enabled,
    app.dataManager,
    app.context,
    firstUploadDate,
  );
  perfLogger.end('dbi:render:widget:pie');

  // --- TOP POSTS WIDGET ---
  // Random posts are passed as a Promise so the widget renders now with
  // a placeholder and swaps in the real post when the fetch resolves —
  // keeps Random (the only uncached source) off the blocking path.
  perfLogger.start('dbi:render:widget:topPosts');
  const topPostsResult = renderTopPostsWidget(
    topPostContainer,
    topPosts,
    recentPopularPosts,
    randomPostsPromise,
    nsfw.enabled,
    app.dataManager,
    app.context,
  );
  perfLogger.end('dbi:render:widget:topPosts');

  topStatsRow.appendChild(pieContainer);
  topStatsRow.appendChild(topPostContainer);
  parent.appendChild(topStatsRow);
  content.appendChild(parent);

  // 3. Milestones Widget
  const milestonesDiv = document.createElement('div');
  milestonesDiv.style.marginTop = '20px';
  parent.appendChild(milestonesDiv);

  const milestonesResult = await perfLogger.wrap(
    'dbi:render:widget:milestones',
    () =>
      renderMilestonesWidget(
        milestonesDiv,
        app.db,
        app.dataManager,
        app.context,
        nsfw.enabled,
      ),
  );

  // Wire the NSFW fan-out — the header's onchange handler reads
  // `nsfw.apply` lazily so the apply fn is in place by the time the
  // checkbox is clickable (widgets are built before the user can see
  // the dashboard).
  nsfw.apply = async () => {
    pieResult.onNsfwChange(nsfw.enabled);
    topPostsResult.onNsfwChange(nsfw.enabled);
    await milestonesResult.onNsfwChange(nsfw.enabled);
  };

  // 4. Monthly Activity Chart
  await perfLogger.wrap('dbi:render:widget:history', () =>
    renderHistoryChart(
      parent,
      app.dataManager,
      app.context,
      milestones1k,
      levelChanges,
    ),
  );

  // 5. Created Tags Widget (lazy load) — after Monthly Activity
  const createdTagsContainer = document.createElement('div');
  createdTagsContainer.style.marginTop = '35px';
  parent.appendChild(createdTagsContainer);
  perfLogger.start('dbi:render:widget:createdTags');
  renderCreatedTagsWidget(
    createdTagsContainer,
    app.dataManager,
    app.context.targetUser,
  );
  perfLogger.end('dbi:render:widget:createdTags');

  // 6. Tag Cloud Widget — gated by upload count (v9.6.0).
  const tagCloudContainer = document.createElement('div');
  tagCloudContainer.style.marginTop = '35px';
  parent.appendChild(tagCloudContainer);
  perfLogger.start('dbi:render:widget:tagCloud');
  if (totalUploads < TAG_CLOUD_MIN_UPLOADS) {
    renderWidgetLockedPlaceholder(tagCloudContainer, {
      widgetTitle: 'Tag Cloud',
      icon: '🏷️',
      currentCount: totalUploads,
      requiredCount: TAG_CLOUD_MIN_UPLOADS,
      unlockMessage:
        'Tag cloud unlocks at 100 uploads to ensure the analysis has enough data to be useful.',
    });
  } else {
    renderTagCloudWidget(tagCloudContainer, {
      initialData: tagCloudGeneral,
      fetchData: (catId: number) =>
        app.dataManager.getTagCloudData(app.context.targetUser, catId),
      userName: app.context.targetUser.normalizedName,
      categories: [
        {id: 0, label: 'General', color: '#0075f8'},
        {id: 1, label: 'Artist', color: '#a00'},
        {id: 3, label: 'Copy', color: '#a800aa'},
        {id: 4, label: 'Char', color: '#00ab2c'},
      ],
    });
  }
  perfLogger.end('dbi:render:widget:tagCloud');

  // 7. Scatter Plot Widget — gated by upload count (v9.6.0).
  // Scatter wiring goes through the dataManager instance that
  // fetchDashboardData created — keep the original references to preserve
  // identity-sensitive call paths.
  perfLogger.start('dbi:render:widget:scatter');
  if (totalUploads < SCATTER_MIN_UPLOADS) {
    const scatterContainer = document.createElement('div');
    scatterContainer.style.marginTop = '35px';
    parent.appendChild(scatterContainer);
    renderWidgetLockedPlaceholder(scatterContainer, {
      widgetTitle: 'Score Distribution',
      icon: '📊',
      currentCount: totalUploads,
      requiredCount: SCATTER_MIN_UPLOADS,
      unlockMessage:
        'Score distribution unlocks at 300 uploads so the scatter plot has enough points to reveal patterns.',
    });
  } else if (scatterData.length > 0) {
    renderScatterPlot(parent, scatterData, app.context, levelChanges, {
      userStats,
      needsBackfill,
      runBackfill: needsBackfill
        ? onProgress =>
            dataManager.backfillPostMetadata(app.context.targetUser, onProgress)
        : undefined,

      refreshScatterData: () =>
        dataManager.getScatterData(app.context.targetUser),
      fetchPostDetails: (postId: number) =>
        dataManager.fetchPostDetails(postId),
    });
  }
  perfLogger.end('dbi:render:widget:scatter', {
    points: scatterData.length,
    gated: totalUploads < SCATTER_MIN_UPLOADS,
  });

  // 8. Footer credit (always last)
  parent.insertAdjacentHTML('beforeend', dashboardFooterHtml());
}

/**
 * Mutable NSFW bridge between the header (which owns the toggle UI) and
 * the widget bundle (which owns the fan-out `apply()` callback that
 * recomputes pie/topPosts/milestones from the new flag). The header writes
 * `enabled`; renderDashboardWidgets writes `apply` after widget construction.
 */
interface NsfwBus {
  enabled: boolean;
  apply: (() => Promise<void>) | null;
}

/**
 * Builds the dashboard header (title block, NSFW checkbox, full-reset
 * button, stale-data bubble). The deferred (setTimeout 0) wiring stays
 * inside this helper so the closure captures `nsfw` and `app` directly.
 *
 * Returns the header element. Caller is responsible for appending it to
 * the modal content host — the original function appends, clears content,
 * then re-appends; we keep that double-append pattern in the caller so
 * the diff stays minimal.
 */
function buildDashboardHeader(
  user: ValidatedProfileContext['targetUser'],
  app: UserAnalyticsApp,
  nsfw: NsfwBus,
): HTMLElement {
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'flex-start';
  header.style.marginBottom = '25px';
  header.innerHTML = `
      <div>
         <h2 style="margin-top:0; color:var(--di-text, #333); margin-bottom:4px;">Analytics Dashboard</h2>
         <p style="color:var(--di-text-secondary, #666); margin:0;">Detailed statistics and history for <span class="${getLevelClass(user.level_string)}">${escapeHtml(user.name)}</span></p>
      </div>
       <div id="analytics-header-controls" style="display:none; align-items:center;">
         <label style="display:flex; align-items:center; margin-right:15px; font-size:13px; color:var(--di-text-secondary, #666); cursor:pointer; user-select:none;">
            <input type="checkbox" id="user-analytics-nsfw-toggle" ${nsfw.enabled ? 'checked' : ''} style="margin-right:6px;">
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
  const dBtn = header.querySelector('#analytics-reset-btn') as HTMLElement;

  // Defer event wiring by one tick — original code did the same so the
  // header is in the DOM by the time the handlers attach. Functionally
  // equivalent to wiring synchronously (querySelector works on detached
  // subtrees too), but keeping the cadence preserves the deferred stale-
  // data bubble which relies on the reset button being in DOM for the
  // `dBtn.parentNode` offset-anchor trick.
  setTimeout(() => {
    const nsfwToggle = header.querySelector(
      '#user-analytics-nsfw-toggle',
    ) as HTMLInputElement;
    if (nsfwToggle) {
      nsfwToggle.onchange = e => {
        nsfw.enabled = (e.target as HTMLInputElement).checked;
        setNsfwEnabled(nsfw.enabled);
        // Delegate the actual widget refresh to the apply callback that
        // renderDashboardWidgets installs after widget construction.
        if (nsfw.apply) void nsfw.apply();
      };
    }

    if (dBtn) {
      dBtn.onclick = async () => {
        if (
          confirm(
            '⚠ FULL RESET WARNING ⚠\n\nThis will DELETE all local analytics data for this user and require a full re-sync.\n\nContinue?',
          )
        ) {
          dBtn.innerHTML = '⌛';
          await app.dataManager.clearUserData(app.context.targetUser);
          showToast({type: 'success', message: 'Data cleared.'});
          app.toggleModal(false);
        }
      };
      dBtn.onmouseover = () => {
        dBtn.style.background = '#ffeef0';
        dBtn.style.borderColor = '#d73a49';
      };
      dBtn.onmouseout = () => {
        dBtn.style.background = 'none';
        dBtn.style.borderColor = 'var(--di-border-light, #eee)';
      };
    }

    // Stale Data Check (last sync older than FULL_REFRESH_HINT_DAYS) — shows
    // a transient yellow bubble anchored above the reset button, auto-removed
    // after 10s. Bumped 7d → 30d in v9.7.2: partial syncs now keep counts /
    // popular posts / milestones fresh, so this only nudges users whose
    // older-post metadata may have drifted (a low-urgency, monthly cadence).
    const lastSyncKey = `danbooru_grass_last_sync_${app.context.targetUser.id}`;
    const lastSyncStr = localStorage.getItem(lastSyncKey);
    if (lastSyncStr) {
      const lastSyncDate = new Date(lastSyncStr);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - lastSyncDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays > CONFIG.FULL_REFRESH_HINT_DAYS && dBtn) {
        const bubble = document.createElement('div');
        bubble.innerHTML = 'Full data refresh recommended';
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

        const arrow = document.createElement('div');
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

        (dBtn.parentNode as HTMLElement).style.position = 'relative';
        dBtn.parentNode?.appendChild(bubble);

        setTimeout(() => {
          if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
        }, 10000);
      }
    }
  }, 0);

  return header;
}

/**
 * Renders the "Data Synchronization Required" view. Hit when the local DB
 * is materially behind the remote total — drives a full `syncAllPosts`
 * worker-pool run on button click, with progress mirrored from the
 * AnalyticsDataManager singleton's shared progress channel.
 *
 * The caller is responsible for early-returning after this; the function
 * does not touch the modal's other DOM nor trigger a re-render itself
 * (the click handler re-invokes `app.renderDashboard()` after sync).
 */
function renderResumeSyncView(
  content: HTMLElement,
  stats: {count: number},
  total: number,
  app: UserAnalyticsApp,
): void {
  const syncDiv = document.createElement('div');
  syncDiv.style.textAlign = 'center';
  syncDiv.style.padding = '40px 20px';
  syncDiv.style.color = 'var(--di-text-secondary, #666)';

  let msg = `We have <strong>${stats.count}</strong> posts synced, but the user has <strong>${total || 'more'}</strong>.`;
  if (total === 0 && stats.count > 0)
    msg = `We have <strong>${stats.count}</strong> posts synced. Total count unavailable.`;
  if (stats.count === 0)
    msg = `To generate the report, we need to fetch all post metadata for <strong>${escapeHtml(app.context.targetUser.name)}</strong>.`;

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
        ">${stats.count > 0 ? 'Resume Sync' : 'Start Data Fetch'}</button>

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
    '#analytics-start-sync',
  ) as HTMLButtonElement;

  // Helper: grab the four progress-bar elements freshly each time (the
  // background-sync and click handlers query them independently).
  const progressEls = () => ({
    progressDiv: syncDiv.querySelector(
      '#analytics-main-progress',
    ) as HTMLElement,
    bar: syncDiv.querySelector('#analytics-main-bar') as HTMLElement,
    percent: syncDiv.querySelector('#analytics-main-percent') as HTMLElement,
    countText: syncDiv.querySelector('#analytics-main-count') as HTMLElement,
  });

  // If a sync is already running (e.g. user opened the modal during a
  // background sync), restore the progress UI and subscribe to the global
  // broadcast so this view stays in sync.
  if (AnalyticsDataManager.isGlobalSyncing) {
    btn.innerHTML = 'Fetching in background...';
    btn.disabled = true;
    btn.style.backgroundColor = '#94d3a2'; // Light green/disabled
    btn.style.cursor = 'not-allowed';

    const {progressDiv, bar, percent, countText} = progressEls();
    progressDiv.style.display = 'block';

    const {current, total: progressTotal} = AnalyticsDataManager.syncProgress;
    if (progressTotal > 0) {
      const p = Math.round((current / progressTotal) * 100);
      bar.style.width = `${p}%`;
      percent.textContent = `${p}%`;
      countText.textContent = `${current} / ${progressTotal}`;
    }

    AnalyticsDataManager.onProgressCallback = (c, max) => {
      const p = max > 0 ? Math.round((c / max) * 100) : 0;
      bar.style.width = `${p}%`;
      percent.textContent = max > 0 ? `${p}%` : 'Scanning...';
      countText.textContent = `${c} / ${max > 0 ? max : '?'}`;
    };
  }

  btn.onclick = async () => {
    btn.innerHTML = 'Fetching...';
    btn.disabled = true;
    btn.style.opacity = '0.7';
    const {progressDiv, bar, percent, countText} = progressEls();
    progressDiv.style.display = 'block';

    // Subscribe locally immediately
    AnalyticsDataManager.onProgressCallback = (c, max) => {
      const p = max > 0 ? Math.round((c / max) * 100) : 0;
      bar.style.width = `${p}%`;
      percent.textContent = max > 0 ? `${p}%` : 'Scanning...';
      countText.textContent = `${c} / ${max > 0 ? max : '?'}`;
    };

    // No-op progress callback — internal broadcast above handles UI updates.
    await app.dataManager.syncAllPosts(app.context.targetUser, () => {});

    // A sync ran → force the deferred distributions to revalidate on re-render.
    app.markSyncCompleted();
    void app.updateHeaderStatus();
    void app.renderDashboard();
  };
}

/**
 * Quick-sync view + execution. Replaces `content`'s spinner with a progress
 * bar, drives `dataManager.quickSyncAllPosts` to completion, then leaves
 * the caller to restore the generic "Generating Report..." spinner before
 * the heavier fetchDashboardData call.
 */
async function runQuickSync(
  content: HTMLElement,
  dataManager: AnalyticsDataManager,
  user: ValidatedProfileContext['targetUser'],
): Promise<void> {
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
    '#analytics-quick-sync-bar',
  ) as HTMLElement;
  const qMsg = content.querySelector(
    '#analytics-quick-sync-msg',
  ) as HTMLElement;

  await dataManager.quickSyncAllPosts(
    user,
    (c: number, t: number, msg?: string) => {
      if (qBar && t > 0) qBar.style.width = `${Math.round((c / t) * 100)}%`;
      if (qMsg && msg && msg !== 'PREPARING') qMsg.textContent = msg;
    },
  );
}

export class UserAnalyticsApp {
  db: Database;
  settings: SettingsManager;
  context: ValidatedProfileContext;
  rateLimiter: RateLimitedFetch;
  dataManager: AnalyticsDataManager;
  dataService: UserAnalyticsDataService;
  modalId: string;
  btnId: string;
  modal: ModalHandle | null = null;
  isFullySynced: boolean;
  isRendering: boolean;
  /** Promise for the first updateHeaderStatus() call. Button click handlers
   *  await this before reading isFullySynced to avoid racing against the
   *  initial sync-status check (which runs fire-and-forget on mount). */
  private initialStatusCheck: Promise<void> | null = null;

  /** Total upload count from the last updateHeaderStatus(); drives the
   *  ≤MAX_PREVIEW_ONLY_UPLOADS click→popover shortcut. null until first check. */
  private totalPostCount: number | null = null;

  /** Set by any sync path and consumed by the next renderDashboard. When true,
   *  the deferred pie distributions revalidate post-paint regardless of the
   *  count-cache TTL, so their per-tag counts converge to fresh after a sync
   *  (they are no longer force-refreshed on the blocking path — audit R2). */
  private syncJustRan = false;

  /** The dashboard hover/pinned preview popover, created once in
   *  injectButton(). Hoisted to an instance field so updateHeaderStatus()
   *  can wire the touch-only 📋 mini-report button next to the ⚙️ gear. */
  private previewPopover: ReturnType<
    typeof createDashboardPreviewPopover
  > | null = null;

  /**
   * Initializes the UserAnalyticsApp.
   * @param {Database} db The Dexie database instance.
   * @param {Object} settings The settings manager.
   * @param {ProfileContext} context The profile context.
   */
  constructor(
    db: Database,
    settings: SettingsManager,
    context: ProfileContext,
    rateLimiter?: RateLimitedFetch,
  ) {
    this.db = db;
    this.settings = settings;
    this.context = context as ValidatedProfileContext;
    const rl = CONFIG.RATE_LIMITER;
    this.rateLimiter =
      rateLimiter ?? new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);

    this.dataManager = new AnalyticsDataManager(db, this.rateLimiter);
    // Share the rate limiter so the dashboard fetch + post-paint SWR
    // revalidate flood stay under TabCoordinator / 429-backoff control (H-1).
    this.dataService = new UserAnalyticsDataService(db, this.rateLimiter);

    this.modalId = 'danbooru-grass-modal';
    this.btnId = 'danbooru-grass-analytics-btn';

    this.isFullySynced = false;
    this.isRendering = false;
  }

  /**
   * Initializes and runs the Analytics application.
   */
  run(): void {
    this.createModal(); // Create hidden modal
    this.injectButton(); // Add entry button
  }

  /**
   * Creates the modal DOM structure (hidden by default).
   */
  createModal(): void {
    const overlayId = `${this.modalId}-overlay`;
    const windowId = `${this.modalId}-window`;
    const closeId = `${this.modalId}-close`;
    const contentId = `${this.modalId}-content`;

    this.modal = createModal({
      id: overlayId,
      useFadeTransition: true,
      resolveTheme: () =>
        resolveEffectiveDashboardTheme(this.settings.getDarkMode()),
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
      },
    });

    const closeBtn = document.getElementById(closeId);
    if (closeBtn) {
      closeBtn.onclick = () => this.toggleModal(false);
    }
  }

  /**
   * Injects the entry button next to the username.
   * Tries multiple heuristics to find the correct location.
   */
  injectButton(): void {
    // Priority 1: H1 containing the username
    let targetElement = null;
    const h1s = document.querySelectorAll('h1');

    // Heuristic: The user name H1 usually matches the title or context
    for (const h1 of h1s) {
      if (h1.textContent.includes(this.context.targetUser.name)) {
        targetElement = h1;
        break;
      }
    }

    // Fallback: Just the first H1 if name match fails (e.g. slight difference)
    if (!targetElement && h1s.length > 0) {
      targetElement = h1s[0];
    }

    if (targetElement) {
      // Container for button + status
      const container = document.createElement('span');
      container.style.display = 'inline-flex';
      container.style.alignItems = 'center';
      container.style.marginLeft = '10px';
      container.style.verticalAlign = 'middle';

      // Button
      const btn = document.createElement('span');
      btn.className = 'di-analytics-entry-btn';
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', 'Open user analytics report');
      btn.innerHTML = '📊';
      btn.style.margin = '0'; // Reset margin since container has it

      // Hover/click preview popover. Replaces the old `title` tooltip: data
      // (recent uploads + activity distribution) is fetched real-time via the
      // injected callbacks. Section B (activity) loads in the background.
      const previewPopover = createDashboardPreviewPopover({
        anchor: btn,
        fetchPosts: () =>
          this.dataManager.getRecentPostsPreview(
            this.context.targetUser,
            RECENT_POSTS_LIMIT,
          ),
        fetchActivity: () =>
          this.dataManager.getActivityDistribution(
            this.context.targetUser,
            ACTIVITY_SEGMENT_LIMIT,
          ),
        // `suspicious` links to the exact flagged posts (id: list of the
        // suspicious uploads + the posts suspicious comments sit on); falls
        // back to the name-scoped deleted-uploads search when none resolved.
        // Other types append `#<prefix>_<oldestId>` to scroll to the oldest
        // in-window row (the boundary of what the strip analysed).
        activityHref: (type, dist) =>
          type === 'suspicious'
            ? (suspiciousPostsUrl(dist.suspiciousPostIds) ??
              activityTypeIndexUrl(type, this.context.targetUser))
            : activityTypeIndexUrl(
                type,
                this.context.targetUser,
                dist.oldestAnchorByType[type],
              ),
        // Background pass: escalate mintagged (orange) → abandoned (red) for
        // uploads whose v2 landed well after v1 (left under-tagged).
        fetchAbandoned: postIds =>
          this.dataManager.getAbandonedPostIds(postIds),
      });
      // Hoist so updateHeaderStatus() can attach the touch 📋 next to the gear.
      this.previewPopover = previewPopover;

      // Hover opens a transient popover (skipped on touch — unreachable
      // there; the click path still works). A short dwell debounce avoids
      // firing on an accidental graze. Gate unified to isTouchDevice() so the
      // hover wiring and the touch-only paths (📋 button, legend two-step)
      // agree on what counts as "touch" (R-08).
      let hoverTimer: ReturnType<typeof setTimeout> | null = null;
      if (!isTouchDevice()) {
        btn.addEventListener('mouseenter', () => {
          // Cursor back on the icon during the grace/fade window: keep the
          // open popover alive instead of letting it close and re-load (R-04).
          previewPopover.keepOpen();
          if (hoverTimer !== null) clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => previewPopover.show(), 200);
        });
        btn.addEventListener('mouseleave', () => {
          if (hoverTimer !== null) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
          }
          previewPopover.scheduleHide();
        });
      } else {
        // Touch-capable (incl. a touch laptop driven by a mouse): hover isn't
        // wired, so restore the tooltip the bare 📊 otherwise lacks (R-08). On
        // a true desktop the popover replaces it, so no title there.
        btn.title = 'Open Analytics Report';
      }

      btn.onclick = async e => {
        e.preventDefault();
        e.stopPropagation();
        if (hoverTimer !== null) {
          clearTimeout(hoverTimer);
          hoverTimer = null;
        }

        // Wait for the initial sync-status check before reading
        // isFullySynced / totalPostCount (avoids racing the first check after
        // a page refresh, which would see the constructor's placeholder).
        if (this.initialStatusCheck) {
          try {
            await this.initialStatusCheck;
          } catch {
            // Ignored — errors are already logged in updateHeaderStatus.
          }
        }

        // Tiny uploaders: the full dashboard adds little over the preview, so
        // skip the heavy sync/modal and show the pinned popover instead.
        const total = this.totalPostCount;
        if (total !== null && total <= CONFIG.MAX_PREVIEW_ONLY_UPLOADS) {
          previewPopover.show({pinned: true});
          return;
        }

        // Normal path: dismiss any hover popover, sync if needed, open modal.
        previewPopover.hide();
        if (this.isFullySynced === false) {
          try {
            await this.performPartialSync(btn, false);
          } catch (err) {
            log.error('Auto-sync failed', {error: err});
          }
        }
        this.toggleModal(true);
      };
      container.appendChild(btn);

      // The touch-only 📋 mini-report button now lives in updateHeaderStatus(),
      // sized to match and sitting right after the ⚙️ sync-settings gear.

      // Status Text (Mobile/Compact friendly)
      const statusText = document.createElement('div');
      statusText.id = `${this.modalId}-header-status`;
      statusText.style.fontSize = '0.5em'; // Relative to H1
      statusText.style.fontWeight = 'normal';
      statusText.style.color = 'var(--di-text-muted, #888)';
      statusText.style.marginLeft = '12px';
      statusText.style.lineHeight = '1.2';
      statusText.innerHTML = ''; // Init empty
      container.appendChild(statusText);

      targetElement.appendChild(container);

      // Initial Status Check — kick off but also expose the promise so the
      // button click handler can await it before deciding whether to trigger
      // an auto-sync. Without this, a click placed before the check resolves
      // sees the constructor's placeholder (isFullySynced = false) and fires
      // performPartialSync even on already-synced users.
      this.initialStatusCheck = this.updateHeaderStatus();
      void this.initialStatusCheck;
    } else {
      log.warn('Could not find H1 to inject analytics button');
    }
  }

  /**
   * Performs a partial sync/update.
   * @param {HTMLElement} btn Optional button element to update UI.
   * @param {boolean} shouldRender Whether to re-render the dashboard after sync (default: true).
   */
  // T-26 baseline: complexity 18. Global-sync coordination + UI button
  // state machine + error UX. Decomposition candidate.
  // eslint-disable-next-line complexity
  async performPartialSync(
    btn: HTMLElement | null = null,
    shouldRender: boolean = true,
  ): Promise<void> {
    if (AnalyticsDataManager.isGlobalSyncing) return;

    const originalText = btn ? btn.innerHTML : '';

    // State for Animation
    let animInterval = null;
    let dotCount = 0;
    const state = {
      current: 0,
      total: 0,
      phase: 'FETCHING', // 'FETCHING' or 'PREPARING'
      message: '',
    };

    if (btn) {
      (btn as HTMLButtonElement).disabled = true;
      btn.style.cursor = 'wait';
    }

    // Animation Loop
    const render = () => {
      dotCount = (dotCount % 3) + 1;
      const dotStr = '.'.repeat(dotCount);
      const percent =
        state.total > 0 ? Math.floor((state.current / state.total) * 100) : 0;

      let headerHtml = '';
      let subHtml = '';
      let containerColor = '#ff4444';

      if (state.phase === 'PREPARING') {
        containerColor = 'inherit';
        headerHtml = `<div style="color:#00ba7c; font-weight:bold;">Synced: ${state.current.toLocaleString()} / ${state.total.toLocaleString()} (${percent}%)</div>`;
        subHtml = `<div style="font-size:0.8em; color:#ffeb3b; margin-top:2px;">${state.message || 'Preparing Report'}${dotStr}</div>`;
      } else {
        containerColor = '#ff4444';
        headerHtml = `<div style="font-weight:bold;">Synced: ${state.current.toLocaleString()} / ${state.total.toLocaleString()} (${percent}%)</div>`;
        subHtml = `<div style="font-size:0.8em; color:var(--di-text-muted, #888); margin-top:2px;">${state.message || `Fetching data${dotStr}`}</div>`;
      }

      void this.updateHeaderStatus(headerHtml + subHtml, containerColor);
    };

    // Start Animation
    render();
    animInterval = setInterval(render, 500);

    const onProgress = (current: number, total: number, msg?: string) => {
      state.current = current;
      state.total = total;
      if (msg) state.message = msg;

      const isComplete = total > 0 && current >= total;
      if (msg === 'PREPARING' || isComplete) {
        state.phase = 'PREPARING';
      } else {
        state.phase = 'FETCHING';
      }
    };

    try {
      const MAX_QUICK_SYNC_POSTS = CONFIG.MAX_OPTIMIZED_POSTS;
      const syncTotal = await this.dataManager.getTotalPostCount(
        this.context.targetUser,
      );
      // 0 uploads: nothing to sync, and the dashboard's random-post fetch
      // would 404 on /random for a user with no posts.
      if (syncTotal === 0) {
        if (animInterval) clearInterval(animInterval);
        this.isFullySynced = true;
        void this.updateHeaderStatus();
        if (btn) {
          btn.innerHTML = originalText;
          (btn as HTMLButtonElement).disabled = false;
          btn.style.cursor = 'pointer';
        }
        if (shouldRender) this.toggleModal(true);
        return;
      }
      if (syncTotal <= MAX_QUICK_SYNC_POSTS) {
        await this.dataManager.quickSyncAllPosts(
          this.context.targetUser,
          onProgress,
        );
      } else {
        await this.dataManager.syncAllPosts(
          this.context.targetUser,
          onProgress,
        );
      }

      // A sync ran → the deferred pie distributions' per-tag counts may have
      // moved. Flag it so the next renderDashboard forces their revalidate
      // (past the count-cache TTL) and the live-patch converges them to fresh.
      this.syncJustRan = true;

      if (animInterval) clearInterval(animInterval);

      // Final Status (Green)
      if (shouldRender) {
        const finalStats = await this.dataManager.getSyncStats(
          this.context.targetUser,
        );
        void this.updateHeaderStatus(
          `Synced: ${finalStats.count.toLocaleString()} / ${finalStats.count.toLocaleString()}`,
          '#00ba7c',
        );
      }

      if (btn) {
        btn.innerHTML = originalText;
        (btn as HTMLButtonElement).disabled = false;
        btn.style.cursor = 'pointer';
      }
      if (shouldRender) {
        this.toggleModal(true);
      }
    } catch (e) {
      if (animInterval) clearInterval(animInterval);
      log.error('Sync failed', {error: e});
      if (btn) {
        btn.innerHTML = 'ERR';
        (btn as HTMLButtonElement).disabled = false;
        btn.style.cursor = 'pointer';
        // Leave 'ERR' visible briefly, then restore the button's normal
        // label — otherwise it's stuck reading "ERR" until a reload. Skip if
        // a retry already re-labelled the button ("Fetching…"), so the
        // timer can't clobber a run that started in the meantime.
        setTimeout(() => {
          if (btn?.innerHTML === 'ERR') btn.innerHTML = originalText;
        }, 2000);
      }
      void this.updateHeaderStatus('Sync Failed', '#ff4444');
    }
  }

  /** Flags that a sync completed outside performPartialSync (e.g. the
   *  Resume-Sync view button) so the next renderDashboard forces the deferred
   *  distributions to revalidate. */
  markSyncCompleted(): void {
    this.syncJustRan = true;
  }

  /**
   * Updates the status text in the modal header.
   * @param {string|null} [progressText=null] Text to display (e.g. "Fetching...").
   * @param {string|null} [customColor=null] CSS color for the text.
   * @return {Promise<void>}
   */
  async updateHeaderStatus(
    progressText: string | null = null,
    customColor: string | null = null,
  ) {
    const el = document.getElementById(`${this.modalId}-header-status`);
    if (!el) return;

    if (progressText) {
      // Real-time update during sync
      el.innerHTML = progressText;
      el.style.color = customColor || '#d73a49'; // Use custom or default warning color
      return;
    }

    // Reuse the app's manager: it carries the shared rate limiter, so these
    // count queries stay under TabCoordinator's multi-tab split and the 429
    // global backoff (H-1). A local `new AnalyticsDataManager(this.db)` would
    // get its own token bucket and fire straight through both.
    const stats = await this.dataManager.getSyncStats(this.context.targetUser);

    // Use Robust Total Fetching
    const total = await this.dataManager.getTotalPostCount(
      this.context.targetUser,
    );
    this.totalPostCount = total;

    const count = stats.count;
    const lastSyncKey = `danbooru_grass_last_sync_${this.context.targetUser.id}`;
    const lastSync = localStorage.getItem(lastSyncKey);
    const lastSyncText = lastSync
      ? new Date(lastSync).toLocaleDateString()
      : 'Never';

    // Dynamic Sync Threshold
    const settingsManager = new SettingsManager();
    const tolerance = settingsManager.getSyncThreshold();
    // total === 0: user has never uploaded — vacuously fully synced.
    // Suppresses auto-sync on menu click (would otherwise 404 on /random).
    const isSynced = total === 0 || count >= total - tolerance;
    this.isFullySynced = isSynced; // Store state for auto-sync check

    // Update UI
    const statusColor =
      total === 0 || (stats.lastSync && isSynced) ? '#28a745' : '#d73a49';
    el.innerHTML = '';
    el.style.color = statusColor;
    el.title = `Last synced: ${lastSyncText}`;

    // Row 1: Synced Count + Settings Button
    const row1 = document.createElement('div');
    row1.style.display = 'flex';
    row1.style.alignItems = 'center';

    const text1 = document.createElement('span');
    text1.textContent =
      total === 0
        ? 'No uploads'
        : `Synced: ${count.toLocaleString()} / ${total.toLocaleString()}`;
    text1.style.color = statusColor; // Force color
    text1.style.fontWeight = 'bold'; // Optional: Make it pop a bit more if needed, but user didn't ask. I'll stick to color.
    row1.appendChild(text1);

    // Settings Button (Gear)
    const settingBtn = document.createElement('span');
    settingBtn.innerHTML = '⚙️';
    settingBtn.style.cursor = 'pointer';
    settingBtn.style.marginLeft = '6px';
    settingBtn.style.fontSize = '12px';
    settingBtn.title = 'Configure Sync Threshold';
    settingBtn.onclick = e => {
      e.stopPropagation();
      e.preventDefault();
      this.showSyncSettingsPopover(settingBtn);
    };
    row1.appendChild(settingBtn);

    const miniReport = this.buildMiniReportButton();
    if (miniReport) row1.appendChild(miniReport);

    el.appendChild(row1);

    // Row 2: Date / Status Text
    const row2 = document.createElement('div');
    if (stats.lastSync && isSynced) {
      row2.innerHTML = `<span style="font-size:1em; font-weight:normal; color:#28a745;">${lastSyncText}</span>`;
    } else {
      row2.textContent = 'Not fully synced';
    }
    el.appendChild(row2);
  }

  /**
   * The touch-only 📋 mini-report button, sized to the ⚙️ sync-settings gear
   * and placed right after it in the header status row. On touch the 📊 tap
   * opens the full modal, leaving the hover-only preview unreachable — this
   * opens the pinned preview directly. Returns null on desktop or before the
   * preview popover has been created.
   */
  private buildMiniReportButton(): HTMLSpanElement | null {
    if (!isTouchDevice() || !this.previewPopover) return null;
    const reportBtn = document.createElement('span');
    reportBtn.setAttribute('role', 'button');
    reportBtn.setAttribute('aria-label', 'Open quick mini-report');
    reportBtn.title = 'Quick mini-report';
    reportBtn.textContent = '📋';
    reportBtn.style.cursor = 'pointer';
    reportBtn.style.marginLeft = '6px';
    reportBtn.style.fontSize = '12px';
    reportBtn.onclick = e => {
      e.stopPropagation();
      e.preventDefault();
      this.previewPopover?.show({pinned: true});
    };
    return reportBtn;
  }

  /**
   * Shows the Sync Settings Popover.
   * @param {HTMLElement} target The settings button element.
   */
  showSyncSettingsPopover(target: HTMLElement) {
    // Toggle: if already open, close and return
    const existing = document.getElementById('danbooru-grass-sync-settings');
    if (existing) {
      existing.remove();
      return;
    }

    const settingsManager = new SettingsManager();
    const currentVal = settingsManager.getSyncThreshold();
    const currentCountTtl = getCountCacheTtlMin();

    const popover = document.createElement('div');
    popover.id = 'danbooru-grass-sync-settings';
    // Sync dashboard theme (popover is appended to body, outside dashboard containers)
    if (
      resolveEffectiveDashboardTheme(settingsManager.getDarkMode()) === 'dark'
    ) {
      popover.setAttribute('data-di-theme', 'dark');
    }
    applyPopoverChrome(popover, {width: '220px'});

    const {top, left} = calcPopoverPosition(target);
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
      '#sync-thresh-input',
    ) as HTMLInputElement;
    const countTtlInput = popover.querySelector(
      '#count-ttl-input',
    ) as HTMLInputElement;
    const darkModeSelect = popover.querySelector(
      '#dark-mode-select',
    ) as HTMLSelectElement;
    darkModeSelect.value = originalDarkMode;

    const saveBtn = popover.querySelector(
      '#popover-save-btn',
    ) as HTMLButtonElement;
    const cancelBtn = popover.querySelector(
      '#popover-cancel-btn',
    ) as HTMLButtonElement;

    const checkDirty = (): void => {
      const isDirty =
        syncThreshInput.value !== String(currentVal) ||
        countTtlInput.value !== String(currentCountTtl) ||
        darkModeSelect.value !== originalDarkMode;
      saveBtn.disabled = !isDirty;
    };
    syncThreshInput.addEventListener('input', checkDirty);
    countTtlInput.addEventListener('input', checkDirty);
    darkModeSelect.addEventListener('change', checkDirty);

    const closeHandler = createClickOutsideHandler(
      popover,
      () => closePopover(),
      {ignore: target},
    );
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    const closePopover = (): void => {
      popover.remove();
      document.removeEventListener('click', closeHandler);
    };

    cancelBtn.onclick = closePopover;

    saveBtn.onclick = () => {
      const syncThreshVal = parseInt(syncThreshInput.value, 10);
      const countTtlVal = parseInt(countTtlInput.value, 10);
      if (isNaN(syncThreshVal) || syncThreshVal < 0) {
        showToast({
          type: 'warn',
          message: 'Partial Sync Threshold must be a non-negative number.',
        });
        return;
      }
      if (isNaN(countTtlVal) || countTtlVal < 1) {
        showToast({
          type: 'warn',
          message: 'Count Refresh must be ≥ 1 minute.',
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
          darkModeSelect.value as 'auto' | 'light' | 'dark',
        );
        applyDashboardTheme(settingsManager);
      }

      closePopover();
      if (needsHeaderRefresh) {
        void this.updateHeaderStatus();
      }
    };
  }

  /**
   * Toggles the visibility of the modal.
   * @param {boolean} show True to show, false to hide.
   */
  toggleModal(show: boolean) {
    if (!this.modal) return;
    this.modal.toggle(show);
    if (show) {
      // Fire-and-forget: dashboard render should not block the open animation.
      void this.renderDashboard();
    }
  }

  /**
   * Shows a secondary modal (popover) on top of the dashboard.
   * @param {string} title The title of the modal.
   * @param {string} contentHtml The HTML content to display.
   * @param {string|null} [helpHtml=null] Optional HTML content for the help tooltip.
   */
  showSubModal(
    title: string,
    contentHtml: string,
    helpHtml: string | null = null,
  ) {
    let subOverlay = document.getElementById(`${this.modalId}-sub-overlay`);

    // Remove existing if any (simplifies logic)
    if (subOverlay) {
      subOverlay.remove();
    }

    subOverlay = document.createElement('div');
    subOverlay.id = `${this.modalId}-sub-overlay`;

    // Styles are inline for simplicity or we can inject them.
    // Replicating overlay style with higher z-index
    Object.assign(subOverlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(2px)',
      zIndex: '11000', // Higher than main modal (10000)
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: '0',
      transition: 'opacity 0.2s ease',
      cursor: 'default', // reset cursor
    });

    const subWindow = document.createElement('div');
    Object.assign(subWindow.style, {
      backgroundColor: 'var(--di-bg, #fff)',
      borderRadius: '12px',
      boxShadow: '0 10px 25px var(--di-shadow, rgba(0,0,0,0.2))',
      width: '90%',
      maxWidth: '800px', // Smaller than main dashboard
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transform: 'scale(0.95)',
      transition: 'transform 0.2s ease',
    });

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '15px 20px',
      borderBottom: '1px solid var(--di-border-light, #eee)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: 'var(--di-card-bg, #f9f9f9)',
      position: 'relative',
    });

    // Simple Title Wrapper
    const titleWrapper = document.createElement('div');
    titleWrapper.style.display = 'flex';
    titleWrapper.style.alignItems = 'center';
    titleWrapper.innerHTML = `<h3 style="margin:0; font-size:1.2em; color:var(--di-text, #333);">${title}</h3>`;

    // Help Button if helpHtml exists
    if (helpHtml) {
      const helpBtn = document.createElement('div');
      helpBtn.innerHTML = '❓';
      Object.assign(helpBtn.style, {
        marginLeft: '10px',
        cursor: 'help',
        fontSize: '14px',
        color: 'var(--di-text-muted, #888)', // Replaces opacity to prevent child inheritance issues
        position: 'relative',
      });

      // Hover Tooltip logic for Help
      const tooltip = document.createElement('div');
      Object.assign(tooltip.style, {
        position: 'absolute',
        top: '100%',
        left: '0', // Adjust if needed
        width: '550px',
        background: '#000',
        color: '#fff',
        padding: '10px',
        borderRadius: '4px',
        fontSize: '12px',
        zIndex: '11001',
        display: 'none',
        boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
        marginTop: '5px',
      });
      tooltip.innerHTML = helpHtml;
      helpBtn.appendChild(tooltip);

      helpBtn.onmouseover = () => (tooltip.style.display = 'block');
      helpBtn.onmouseout = () => (tooltip.style.display = 'none');

      titleWrapper.appendChild(helpBtn);
    }

    header.appendChild(titleWrapper);

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    Object.assign(closeBtn.style, {
      background: 'none',
      border: 'none',
      fontSize: '1.5em',
      lineHeight: '1',
      cursor: 'pointer',
      color: 'var(--di-text-secondary, #666)',
    });
    closeBtn.onclick = () => closeSubModal();
    header.appendChild(closeBtn);
    subWindow.appendChild(header);

    // Content
    const contentDiv = document.createElement('div');
    Object.assign(contentDiv.style, {
      padding: '20px',
      overflowY: 'auto',
    });
    contentDiv.innerHTML = contentHtml;
    subWindow.appendChild(contentDiv);

    subOverlay.appendChild(subWindow);
    document.body.appendChild(subOverlay);

    // Animation Entry
    requestAnimationFrame(() => {
      subOverlay.style.opacity = '1';
      subWindow.style.transform = 'scale(1)';
    });

    // Close logic
    const closeSubModal = () => {
      subOverlay.style.opacity = '0';
      subWindow.style.transform = 'scale(0.95)';
      setTimeout(() => {
        if (subOverlay.parentElement) subOverlay.remove();
      }, 200);
    };

    subOverlay.addEventListener('click', e => {
      if (e.target === subOverlay) closeSubModal();
    });
  }

  /**
   * Renders the main dashboard content inside the modal.
   * Handles sync checks, header controls, and widget initialization.
   * @return {Promise<void>}
   */
  async renderDashboard() {
    if (this.isRendering) return;
    this.isRendering = true;

    const perfMeta = {
      path: 'unknown' as 'quickSync' | 'syncSkipped' | 'unknown',
      preTotal: 0,
    };
    perfLogger.start('dbi:render:total');

    try {
      const content = document.getElementById(`${this.modalId}-content`);
      if (!content) return;

      // Show Loading State Immediately. The returned callback is the
      // live updater for the spinner's headline + detail lines — wired
      // into fetchDashboardData below so the user sees real phases as
      // they happen instead of a static "Analyzing contributions" line.
      let reportProgress = paintLoadingSpinner(content);

      // Pre-check (local sync stats + remote total) drives the path decision
      // below. Quick-sync is taken when total posts ≤ MAX_OPTIMIZED_POSTS and
      // the local DB is incomplete.
      const {preStats, preTotal} = await runPreCheck(
        this.dataManager,
        this.context.targetUser,
      );
      perfMeta.preTotal = preTotal;

      // Zero-upload user: short-circuit before fetchDashboardData. Several
      // distribution fetchers (random, hair, fav-copyright) hit
      // /posts/random.json which 404s on a user with no posts.
      if (preTotal === 0 && preStats.count === 0) {
        perfMeta.path = 'syncSkipped';
        this.isFullySynced = true;
        renderZeroUploadsView(content, this.context.targetUser);
        return;
      }

      let didQuickSync = false;
      if (
        preTotal > 0 &&
        preTotal <= CONFIG.MAX_OPTIMIZED_POSTS &&
        preStats.count < preTotal
      ) {
        perfMeta.path = 'quickSync';
        didQuickSync = true;
        await runQuickSync(content, this.dataManager, this.context.targetUser);
        this.isFullySynced = true;
        // A sync ran → force deferred distributions to revalidate (see below).
        this.syncJustRan = true;
        void this.updateHeaderStatus();
        // Restore the generic "Generating Report..." spinner before heavy
        // data fetch. The Quick Sync inner UI replaced the DOM, so capture
        // a fresh updater for the post-sync fetchDashboardData call.
        reportProgress = paintLoadingSpinner(content);
      } else {
        perfMeta.path = 'syncSkipped';
      }

      // Pre-fetch all data! If we did a Quick Sync the syncStats/totalCount
      // values have changed since the pre-check, so we skip the shortcut and
      // let fetchDashboardData re-query them. On the no-sync path the values
      // are still fresh and we hand them through.
      const prefetched = didQuickSync
        ? undefined
        : {syncStats: preStats, totalCount: preTotal};
      // Consume the sync flag (set by performPartialSync / quickSync branch /
      // Resume-Sync button). When a sync ran, force the deferred distributions
      // to revalidate post-paint so their per-tag counts converge to fresh
      // regardless of the count-cache TTL.
      const forceDistRevalidate = this.syncJustRan;
      this.syncJustRan = false;
      const dashboardData = await perfLogger.wrap(
        'dbi:net:fetchData:total',
        () =>
          this.dataService.fetchDashboardData(
            this.context,
            prefetched,
            reportProgress,
            forceDistRevalidate,
          ),
      );
      // Only the values the main flow still touches — needsSync gate,
      // summaryStats.firstUploadDate (passed to pie widget), and the SWR
      // starters scheduled after paint. The rest stay on `dashboardData`
      // and flow through renderSummaryCards / renderDashboardWidgets.
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
        tagCloudGeneralStartRevalidate,
      } = dashboardData;

      const {firstUploadDate} = summaryStats;

      // 1. Header (title + NSFW toggle + reset btn + stale-data bubble).
      // NSFW state lives in a shared bus so the header can flip `enabled`
      // and the widget bundle (rendered below) can register the fan-out
      // `apply` callback.
      const nsfw: NsfwBus = {enabled: getNsfwEnabled(), apply: null};
      const header = buildDashboardHeader(this.context.targetUser, this, nsfw);
      content.appendChild(header);

      // Now clear content and append new data
      content.innerHTML = '';
      content.appendChild(header);

      // Condition: Show Dashboard if Synced OR if we have data and total is unknown
      const tolerance = 10;
      const needsSync =
        (total > 0 && stats.count < total - tolerance) ||
        (total === 0 && stats.count === 0);

      if (needsSync) {
        renderResumeSyncView(content, stats, total, this);
        return; // Stop here, don't render dashboard
      }

      // --- VIEW 2: DASHBOARD (REPORT) ---
      // Show Header Controls
      const headerControls = header.querySelector(
        '#analytics-header-controls',
      ) as HTMLElement;
      if (headerControls) headerControls.style.display = 'flex';

      const dashboardDiv = document.createElement('div');
      renderSummaryCards(dashboardDiv, dashboardData, this.context.targetUser);

      await renderDashboardWidgets(
        dashboardDiv,
        content,
        dashboardData,
        this,
        nsfw,
        firstUploadDate,
        preTotal,
      );

      // Update header status (ensure it's green if ready)
      void this.updateHeaderStatus();

      // Fire SWR revalidations only now that the dashboard is painted — the
      // cached values are already on screen, so this no longer blocks
      // render.total. Starters are undefined when the cache was within TTL
      // (nothing to do), so a fresh open costs nothing here.
      //
      // Pie-relevant distributions go through schedulePieRevalidate: only the
      // visible (copyright) tab revalidates on open; the rest revalidate lazily
      // when the user switches to them. When a revalidate returns changed data
      // it dispatches DataUpdated and the open pie live-patches that tab's
      // proportions/counts/thumbs in place (no reopen needed — audit R2).
      schedulePieRevalidate(
        [
          ['status_dist', statusStartRevalidate],
          ['rating_dist', ratingStartRevalidate],
          ...distributionRevalidators,
        ],
        // The pie opens on the copyright tab (renderPieWidget's default), so
        // it is the only tab converged eagerly.
        'copyright_dist',
      );
      // The rest only warm piestats for the next open (top/recent posts,
      // milestones, level history render from their own widgets; the tag cloud
      // widget refreshes on tab switch).
      scheduleRevalidateAll([
        ['topPosts', topPostsStartRevalidate],
        ['recentPopular', recentPopularStartRevalidate],
        ['milestones1k', milestones1kStartRevalidate],
        ['levelChanges', levelChangesStartRevalidate],
        ['tagCloudGeneral', tagCloudGeneralStartRevalidate],
      ]);
    } finally {
      perfLogger.end('dbi:render:total', perfMeta);
      this.isRendering = false;
    }
  }
}

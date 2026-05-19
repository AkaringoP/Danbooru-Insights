// @vitest-environment jsdom

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import type {Mock} from 'vitest';

// Stub heavy DOM-builders and chart renderers so renderDashboard never has
// to drag in D3, CalHeatmap or the per-widget DOM scaffolding. T-18/T-19
// cover those in their own specs; here we want the orchestration shell.
vi.mock('../src/apps/user-analytics-charts', () => ({
  renderPieWidget: vi.fn(),
  renderTopPostsWidget: vi.fn(),
  renderMilestonesWidget: vi.fn(),
  renderHistoryChart: vi.fn(),
}));
vi.mock('../src/apps/user-analytics-scatter', () => ({
  renderScatterPlot: vi.fn(),
}));
vi.mock('../src/ui/tag-cloud-widget', () => ({
  renderTagCloudWidget: vi.fn(),
  computeFontSizes: vi.fn(() => []),
}));
vi.mock('../src/apps/created-tags-widget', () => ({
  renderCreatedTagsWidget: vi.fn(),
}));
vi.mock('../src/ui/dashboard-footer', () => ({
  dashboardFooterHtml: vi.fn(() => '<div class="di-dashboard-footer"></div>'),
}));
vi.mock('../src/ui/toast', () => ({showToast: vi.fn()}));

import {UserAnalyticsApp} from '../src/apps/user-analytics-app';
import {AnalyticsDataManager} from '../src/core/analytics-data-manager';
import {SettingsManager} from '../src/core/settings';
import {RateLimitedFetch} from '../src/core/rate-limiter';
import type {ProfileContext} from '../src/core/profile-context';
import type {TargetUser} from '../src/types';
import type {Database} from '../src/core/database';

const TARGET_USER: TargetUser = {
  name: 'fixture_user',
  normalizedName: 'fixture_user',
  id: '42',
  created_at: '2020-01-01T00:00:00Z',
  joinDate: new Date('2020-01-01T00:00:00Z'),
  level_string: 'Member',
};

function makeApp(): {
  app: UserAnalyticsApp;
  content: HTMLElement;
  dataManager: AnalyticsDataManager;
} {
  // Real instances where cheap; tests stub the data-manager methods on
  // the instance after construction.
  const db = {} as Database;
  const settings = new SettingsManager();
  const ctx = {
    targetUser: TARGET_USER,
    isOwnProfile: false,
  } as unknown as ProfileContext;
  const rateLimiter = new RateLimitedFetch(1, [0, 0], 1);
  const app = new UserAnalyticsApp(db, settings, ctx, rateLimiter);

  // renderDashboard reads `${modalId}-content`. We bypass createModal()
  // by injecting the content host directly so the spec stays focused on
  // renderDashboard rather than modal scaffolding (which has its own
  // tests under test/main.test.ts).
  const content = document.createElement('div');
  content.id = `${app.modalId}-content`;
  document.body.appendChild(content);

  // toggleModal is normally on ModalHandle; the reset-button path calls
  // app.toggleModal(false) which delegates to modal.toggle. Stub it so
  // the path is callable without a real modal handle.
  app.toggleModal = vi.fn() as unknown as UserAnalyticsApp['toggleModal'];

  return {app, content, dataManager: app.dataManager};
}

function stubDataManager(
  dm: AnalyticsDataManager,
  overrides: Partial<{
    syncStats: {count: number; lastDate: string | null};
    totalCount: number;
    quickSync: Mock;
    clearUserData: Mock;
  }> = {},
): {quickSync: Mock; clearUserData: Mock} {
  const quickSync =
    overrides.quickSync ?? (vi.fn(async () => {}) as unknown as Mock);
  const clearUserData =
    overrides.clearUserData ?? (vi.fn(async () => {}) as unknown as Mock);

  dm.getSyncStats = vi.fn(
    async () => overrides.syncStats ?? {count: 0, lastDate: null},
  ) as unknown as AnalyticsDataManager['getSyncStats'];
  dm.getTotalPostCount = vi.fn(
    async () => overrides.totalCount ?? 0,
  ) as unknown as AnalyticsDataManager['getTotalPostCount'];
  dm.quickSyncAllPosts =
    quickSync as unknown as AnalyticsDataManager['quickSyncAllPosts'];
  dm.clearUserData =
    clearUserData as unknown as AnalyticsDataManager['clearUserData'];

  return {quickSync, clearUserData};
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('UserAnalyticsApp.renderDashboard - early-exit guards', () => {
  it('returns without touching content when isRendering is already true', async () => {
    const {app, content} = makeApp();
    stubDataManager(app.dataManager);
    content.innerHTML = '<div id="sentinel"></div>';

    app.isRendering = true;
    await app.renderDashboard();

    // Re-entry guard short-circuits *before* the loading spinner overwrite.
    expect(content.querySelector('#sentinel')).not.toBeNull();
    // And it does not flip the flag (the in-flight render owns it).
    expect(app.isRendering).toBe(true);
  });

  it('returns gracefully when the modal content host is missing', async () => {
    const {app, content} = makeApp();
    stubDataManager(app.dataManager);
    content.remove();

    await expect(app.renderDashboard()).resolves.toBeUndefined();
    // finally{} must still reset the flag so a later retry works.
    expect(app.isRendering).toBe(false);
  });

  it('resets isRendering in finally{} even when the pre-check throws', async () => {
    const {app} = makeApp();
    app.dataManager.getSyncStats = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as AnalyticsDataManager['getSyncStats'];
    app.dataManager.getTotalPostCount = vi.fn(
      async () => 0,
    ) as unknown as AnalyticsDataManager['getTotalPostCount'];

    await expect(app.renderDashboard()).rejects.toThrow('boom');
    expect(app.isRendering).toBe(false);
  });
});

describe('UserAnalyticsApp.renderDashboard - loading state', () => {
  it('paints a spinner before any data fetch starts', async () => {
    const {app, content} = makeApp();
    // Make the pre-check await forever so we can observe the loading state.
    let releasePrecheck = () => {};
    const blocked = new Promise<number>(resolve => {
      releasePrecheck = () => resolve(0);
    });
    app.dataManager.getSyncStats = vi.fn(async () => ({
      count: 0,
      lastDate: null,
    })) as unknown as AnalyticsDataManager['getSyncStats'];
    app.dataManager.getTotalPostCount = vi.fn(
      () => blocked,
    ) as unknown as AnalyticsDataManager['getTotalPostCount'];

    const renderPromise = app.renderDashboard();

    // Yield so the synchronous spinner write inside renderDashboard runs.
    await Promise.resolve();
    expect(content.querySelector('#analytics-loading-report')).not.toBeNull();
    expect(content.querySelector('.di-spinner')).not.toBeNull();

    releasePrecheck();
    await renderPromise;
  });
});

describe('UserAnalyticsApp.renderDashboard - zero-uploads branch', () => {
  it('renders the empty-state header + 📭 message + footer', async () => {
    const {app, content} = makeApp();
    stubDataManager(app.dataManager, {
      syncStats: {count: 0, lastDate: null},
      totalCount: 0,
    });

    await app.renderDashboard();

    // Header survives the second innerHTML clear by being appended last.
    const h2 = content.querySelector('h2');
    expect(h2?.textContent).toContain('Analytics Dashboard');
    expect(content.textContent).toContain(TARGET_USER.name);

    // Empty-state marker — the 📭 emoji is the canonical signal.
    expect(content.textContent).toContain('📭');
    expect(content.textContent).toContain('No uploads to analyze');

    // Footer is appended for parity with the full dashboard.
    expect(content.querySelector('.di-dashboard-footer')).not.toBeNull();

    expect(app.isFullySynced).toBe(true);
    expect(app.isRendering).toBe(false);
  });

  it('skips quickSyncAllPosts on the zero-uploads path', async () => {
    const {app} = makeApp();
    const {quickSync} = stubDataManager(app.dataManager, {
      syncStats: {count: 0, lastDate: null},
      totalCount: 0,
    });

    await app.renderDashboard();
    expect(quickSync).not.toHaveBeenCalled();
  });
});

describe('UserAnalyticsApp.renderDashboard - quick-sync branch', () => {
  it('invokes quickSyncAllPosts with a progress callback when local DB is behind', async () => {
    const {app} = makeApp();
    // Trigger the quick-sync branch: total>0, total<=MAX, count<total.
    // MAX_OPTIMIZED_POSTS is 1200 per CONFIG; 50 well-within bound.
    let progressCallback:
      | ((c: number, t: number, msg?: string) => void)
      | null = null;
    const quickSync = vi.fn(
      async (
        _user: TargetUser,
        cb: (c: number, t: number, msg?: string) => void,
      ) => {
        progressCallback = cb;
        cb(25, 50, 'Fetching page 1');
        cb(50, 50, 'Done');
      },
    );
    stubDataManager(app.dataManager, {
      syncStats: {count: 0, lastDate: null},
      totalCount: 50,
      quickSync: quickSync as unknown as Mock,
    });

    // fetchDashboardData runs after quickSync — let it throw and assert on
    // the quickSync side effects before the throw.
    const renderPromise = app.renderDashboard().catch(() => {});

    await renderPromise;

    expect(quickSync).toHaveBeenCalledTimes(1);
    expect(quickSync.mock.calls[0][0]).toBe(TARGET_USER);
    expect(typeof progressCallback).toBe('function');
    expect(app.isFullySynced).toBe(true);
  });

  it('does NOT invoke quickSyncAllPosts when total exceeds MAX_OPTIMIZED_POSTS', async () => {
    const {app} = makeApp();
    const {quickSync} = stubDataManager(app.dataManager, {
      // Local cache mostly empty but total is > the quick-sync threshold —
      // path falls through to syncSkipped and fetchDashboardData.
      syncStats: {count: 0, lastDate: null},
      totalCount: 5000,
    });

    await app.renderDashboard().catch(() => {});

    expect(quickSync).not.toHaveBeenCalled();
  });

  it('does NOT invoke quickSyncAllPosts when local cache is already complete', async () => {
    const {app} = makeApp();
    const {quickSync} = stubDataManager(app.dataManager, {
      syncStats: {count: 50, lastDate: '2026-05-01'},
      totalCount: 50,
    });

    await app.renderDashboard().catch(() => {});

    expect(quickSync).not.toHaveBeenCalled();
  });
});

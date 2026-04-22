import {DataManager} from '../core/data-manager';
import {GraphRenderer} from '../ui/graph-renderer';
import {createLogger} from '../core/logger';
import type {RateLimitedFetch} from '../core/rate-limiter';
import type {Database} from '../core/database';
import type {SettingsManager} from '../core/settings';
import type {ProfileContext} from '../core/profile-context';
import type {Metric} from '../types';

const log = createLogger('GrassApp');

/**
 * GrassApp: Encapsulates the contribution graph visualization logic.
 * Manages data fetching, processing, and rendering of the GitHub-style grass graph.
 */
export class GrassApp {
  db: Database;
  settings: SettingsManager;
  context: ProfileContext;
  rateLimiter: RateLimitedFetch | null;

  /**
   * Initializes the GrassApp default instance.
   * @param {Database} db - The shared Dexie database instance.
   * @param {SettingsManager} settings - The settings manager instance.
   * @param {ProfileContext} context - The current profile context containing target user info.
   * @param {RateLimitedFetch=} rateLimiter - Optional shared rate limiter instance.
   */
  constructor(
    db: Database,
    settings: SettingsManager,
    context: ProfileContext,
    rateLimiter?: RateLimitedFetch,
  ) {
    this.db = db;
    this.settings = settings;
    this.context = context;
    this.rateLimiter = rateLimiter ?? null;
  }

  /**
   * Main entry point to execute the contribution graph logic.
   * Handles UI injection, data loading, and interactive rendering.
   * @return {Promise<void>} Resolves when the initial render is complete.
   */
  async run(): Promise<void> {
    const context = this.context;
    const targetUser = context.targetUser;
    if (!targetUser) return;

    const dataManager = new DataManager(this.db, this.rateLimiter);
    // We pass the Shared Settings instance to GraphRenderer
    const renderer = new GraphRenderer(this.settings, this.db);

    const userId = targetUser.id || targetUser.name;
    const injected = await renderer.injectSkeleton(dataManager, userId);
    if (!injected) {
      return;
    }

    // One-time cache revalidation (v9.2.4): check current-year data against
    // remote counts to clear stale rows left by the pre-v9.2.3 page-skip bug.
    const normalizedName = (targetUser.name || '').replace(/ /g, '_');
    await dataManager
      .revalidateCurrentYearCache(userId, normalizedName)
      .catch((e: unknown) => {
        log.warn('Cache revalidation failed, continuing normally', {error: e});
      });

    let currentYear = new Date().getFullYear();
    let currentMetric: Metric = (this.settings.getLastMode(userId) ||
      'uploads') as Metric;

    const joinYear = targetUser.joinDate.getFullYear();
    const years: number[] = [];
    const startYear = Math.max(joinYear, 2005);
    for (let y = currentYear; y >= startYear; y--) years.push(y);

    const updateView = async () => {
      let availableYears = [...years]; // Default full list

      // Filter years for Approvals based on promotion date (UI Only)
      if (currentMetric === 'approvals') {
        const promoDate = await dataManager.fetchPromotionDate(targetUser.name);
        if (promoDate) {
          const promoYear = parseInt(promoDate.slice(0, 4), 10);
          availableYears = availableYears.filter(y => y >= promoYear);
          // Safety: If currentYear is older than promoYear, switch to promoYear
          if (currentYear < promoYear) {
            currentYear = promoYear;
          }
        }
      }

      const onYearChange = (y: number) => {
        currentYear = y;
        void updateView();
      };

      renderer.setLoading(true);
      try {
        // Initial render for layout (skeleton — scroll deferred to final render)
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
          /* skipScroll */ true,
        );

        renderer.updateControls(
          availableYears,
          currentYear,
          currentMetric,
          onYearChange,
          newMetric => {
            currentMetric = newMetric as Metric;
            // Save the new mode preference
            this.settings.setLastMode(userId, currentMetric);
            void updateView();
          },
          /* onRefresh */
          async () => {
            renderer.setLoading(true);
            await dataManager.clearCache(currentMetric, targetUser);
            void updateView();
          },
        );

        const onProgress = (count: number) => {
          renderer.setLoading(true, `Fetching... ${count} items`);
        };

        const data = await dataManager.getMetricData(
          currentMetric,
          targetUser,
          currentYear,
          onProgress,
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
          },
        );

        // Signal the diagnostic panel (if gated on) that the cache
        // is now up to date so it can read post-sync DB state. The
        // listener in main.ts uses `{once: true}`; subsequent
        // year/metric changes re-dispatch harmlessly.
        window.dispatchEvent(new CustomEvent('di:sync-complete'));
      } catch (e: unknown) {
        log.error('Failed to render grass graph', {error: e});
        const message =
          e instanceof Error ? e.message : 'Unknown error occurred';
        renderer.renderError(message, () => updateView());
      } finally {
        renderer.setLoading(false);
      }
    };

    // Initial Load
    void updateView();
  }
}

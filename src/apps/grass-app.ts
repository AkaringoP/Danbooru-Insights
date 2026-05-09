import {DataManager} from '../core/data-manager';
import {GraphRenderer} from '../ui/graph-renderer';
import {createLogger} from '../core/logger';
import {showToast} from '../ui/toast';
import {
  computeAutoThresholds,
  detectSaturation,
  dismissSuggestion,
  fetchActiveDayCounts,
  MIN_ACTIVE_DAYS,
  mostRecentBoundary,
  wasDismissed,
  wouldTuningImprove,
} from '../core/threshold-tuner';
import type {RateLimitedFetch} from '../core/rate-limiter';
import type {Database} from '../core/database';
import type {SettingsManager} from '../core/settings';
import type {ProfileContext} from '../core/profile-context';
import type {Metric, Threshold4} from '../types';

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

        // Order matters: scheduled sweep runs first. If it applies, the
        // saturation prompt sees hasProfileThresholds=true (or a fresh
        // tune time) and skips so the user isn't double-prompted.
        void (async () => {
          const ran = await this.maybeRunScheduledAutoTune(userId, () =>
            updateView(),
          );
          if (!ran) {
            await this.maybeSuggestAutoTune(userId, currentMetric, () =>
              updateView(),
            );
          }
        })();
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

  /**
   * Inspects the just-rendered grass and, if the active-day distribution
   * is saturated *and* a tuning would meaningfully redistribute it, shows
   * a toast offering to apply per-profile thresholds. Silently no-ops when
   * the profile already has an override, was dismissed this session, or
   * tuning would not visibly help.
   */
  async maybeSuggestAutoTune(
    userId: string,
    metric: Metric,
    refreshView: () => void,
  ): Promise<void> {
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
        type: 'info',
        message:
          "This user's activity doesn't fit the current thresholds well. Tune for this profile?",
        duration: 0,
        // X (close) = session-level dismiss — same as the explicit
        // [Dismiss] button so the user isn't bothered again until they
        // refresh the page.
        onClose: () => dismissSuggestion(userId),
        actions: [
          {
            label: 'Apply',
            onClick: () => {
              // hasProfileThresholds was already false at this point (the
              // guard above returned early otherwise), so Undo restores
              // the bare global fallback by clearing the override.
              this.settings.setProfileThresholds(userId, metric, proposed);
              this.settings.setProfileTuneTime(userId, metric, Date.now());
              refreshView();
              showToast({
                type: 'success',
                message: 'Thresholds tuned for this profile.',
                duration: 8000,
                actions: [
                  {
                    label: 'Undo',
                    onClick: () => {
                      this.settings.clearProfileThreshold(userId, metric);
                      // Don't re-prompt the user this session — they
                      // explicitly walked it back.
                      dismissSuggestion(userId);
                      refreshView();
                    },
                  },
                ],
              });
            },
          },
          {
            label: 'Dismiss',
            onClick: () => dismissSuggestion(userId),
          },
        ],
      });
    } catch (e: unknown) {
      log.warn('Auto-tune suggestion check failed', {error: e});
    }
  }

  /**
   * Periodic-cadence auto-tune sweep. When the user has enabled the
   * scheduler, this checks all three metrics for the current profile and
   * — if the active period boundary has passed without a recorded
   * decision — collects the metrics whose proposed values would actually
   * change. If any candidates remain, shows a single prompt toast that
   * applies (or skips) all of them in one go.
   *
   * Returns true when a scheduler-driven prompt was shown OR the period
   * was silently marked as handled (no-op tuning), so the caller can skip
   * the saturation prompt to avoid double-toasting.
   */
  async maybeRunScheduledAutoTune(
    userId: string,
    refreshView: () => void,
  ): Promise<boolean> {
    try {
      const schedule = this.settings.getAutoTuneSchedule();
      if (!schedule.enabled) return false;
      // Shared session-dismiss memory with the saturation prompt — if the
      // user has X'd out either flavor of auto-tune toast this session,
      // we don't pile on with the other. Refresh restores both.
      if (wasDismissed(userId)) return false;

      const boundaryMs = mostRecentBoundary(
        new Date(),
        schedule.interval,
      ).getTime();
      const metrics: Metric[] = ['uploads', 'approvals', 'notes'];

      type Candidate = {
        metric: Metric;
        previous: Threshold4;
        proposed: Threshold4;
        hadOverride: boolean;
        changed: boolean;
      };
      const candidates: Candidate[] = [];

      for (const metric of metrics) {
        // Already decided this period for this metric.
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
        candidates.push({metric, previous, proposed, hadOverride, changed});
      }

      if (candidates.length === 0) return false;

      const changing = candidates.filter(c => c.changed);
      // If everything would be a no-op, mark the period as handled silently
      // so we don't re-check on every page load.
      if (changing.length === 0) {
        const now = Date.now();
        for (const c of candidates) {
          this.settings.setProfileTuneTime(userId, c.metric, now);
        }
        return true;
      }

      const labelMap: Record<Metric, string> = {
        uploads: 'Uploads',
        approvals: 'Approvals',
        notes: 'Notes',
      };
      const labelList = changing.map(c => labelMap[c.metric]).join(', ');

      showToast({
        type: 'info',
        message: `Scheduled auto-tune ready: ${labelList}. Apply for this profile?`,
        duration: 0,
        // X (close) = session-level dismiss. Distinct from [Dismiss]
        // which marks the period itself as handled (tuneTime = now);
        // X just silences the prompt until next refresh.
        onClose: () => dismissSuggestion(userId),
        actions: [
          {
            label: 'Apply',
            onClick: () =>
              this.applyScheduledTune(userId, changing, refreshView),
          },
          {
            label: 'Dismiss',
            onClick: () => {
              // Mark every candidate (including no-op ones) as decided
              // for this period so we don't re-prompt until the next
              // boundary passes.
              const now = Date.now();
              for (const c of candidates) {
                this.settings.setProfileTuneTime(userId, c.metric, now);
              }
            },
          },
        ],
      });
      return true;
    } catch (e: unknown) {
      log.warn('Scheduled auto-tune check failed', {error: e});
      return false;
    }
  }

  /** Applies a batch of scheduled tunings and shows a combined Undo toast. */
  private applyScheduledTune(
    userId: string,
    changing: Array<{
      metric: Metric;
      previous: Threshold4;
      proposed: Threshold4;
      hadOverride: boolean;
    }>,
    refreshView: () => void,
  ): void {
    const now = Date.now();
    for (const c of changing) {
      // Type narrowing: proposed is non-null in the changing list.
      this.settings.setProfileThresholds(userId, c.metric, c.proposed);
      this.settings.setProfileTuneTime(userId, c.metric, now);
    }
    refreshView();
    showToast({
      type: 'success',
      message: `Auto-tuned ${changing.length} metric${changing.length === 1 ? '' : 's'} for this profile.`,
      duration: 8000,
      actions: [
        {
          label: 'Undo',
          onClick: () => {
            for (const c of changing) {
              if (c.hadOverride) {
                this.settings.setProfileThresholds(
                  userId,
                  c.metric,
                  c.previous,
                );
              } else {
                this.settings.clearProfileThreshold(userId, c.metric);
              }
              // Tune time stays — period remains "handled" so we don't
              // immediately re-prompt the user who just walked it back.
            }
            dismissSuggestion(userId);
            refreshView();
          },
        },
      ],
    });
  }
}

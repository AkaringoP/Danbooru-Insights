import {CONFIG} from '../config';
import type {
  AutoTuneSchedule,
  DarkModePreference,
  Metric,
  SettingsData,
  Theme,
  Threshold4,
} from '../types';
import {createLogger} from './logger';

const log = createLogger('Settings');

/** Runtime guard against malformed threshold storage (length != 4 or
 *  non-array, e.g. user-edited localStorage). */
function isThreshold4(v: unknown): v is Threshold4 {
  return (
    Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number')
  );
}

/**
 * Manages user settings and persistence using localStorage.
 */
export class SettingsManager {
  key: string;
  defaults: SettingsData;
  settings: SettingsData;

  /**
   * Initializes the SettingsManager, loading existing settings or defaults.
   */
  constructor() {
    /**
     * The key used to store settings in localStorage.
     * @type {string}
     */
    this.key = CONFIG.STORAGE_PREFIX + 'settings';
    /**
     * Default settings values.
     * @type {Object}
     */
    this.defaults = {
      theme: 'light',
      thresholds: {
        uploads: [1, 10, 25, 50],
        approvals: [10, 50, 100, 150],
        notes: [1, 10, 20, 30],
      },
      rememberedModes: {}, // userId -> mode
    };
    /**
     * The currently loaded settings.
     * @type {Object}
     */
    this.settings = this.load();
  }

  /**
   * Loads settings from localStorage.
   * Includes migration for legacy settings keys and deep merges with defaults.
   * @return {!Object} The loaded settings object.
   * @private
   */
  load(): SettingsData {
    try {
      const s = localStorage.getItem(this.key);
      const saved = s ? JSON.parse(s) : {};

      // Migration: remembered_modes -> rememberedModes
      if (saved.remembered_modes && !saved.rememberedModes) {
        saved.rememberedModes = saved.remembered_modes;
        delete saved.remembered_modes;
      }

      // Deep merge defaults with saved
      return {
        ...this.defaults,
        ...saved,
        thresholds: {
          ...this.defaults.thresholds,
          ...(saved.thresholds || {}),
        },
        rememberedModes: {
          ...(saved.rememberedModes || {}),
        },
        perProfileThresholds: {
          ...(saved.perProfileThresholds ?? {}),
        },
        perProfileTuneTimes: {
          ...(saved.perProfileTuneTimes ?? {}),
        },
      };
    } catch (e) {
      log.error('Error loading settings, using defaults', {error: e});
      return this.defaults;
    }
  }

  /**
   * Saves new settings to localStorage.
   * @param {Object} newSettings Partial settings to update.
   */
  save(newSettings: Partial<SettingsData>): void {
    this.settings = {
      ...this.settings,
      ...newSettings,
    };
    localStorage.setItem(this.key, JSON.stringify(this.settings));
  }

  /**
   * Gets the current theme key, falling back to 'light' if invalid.
   * @return {string} The theme key.
   */
  getTheme(): string {
    const t =
      this.settings.theme === 'newspaper' ? 'dracula' : this.settings.theme;
    return CONFIG.THEMES[t] ? t : 'light';
  }

  /**
   * Gets thresholds for a specific metric. Falls through to the defaults
   * (and a hard-coded backstop) when stored data is missing or corrupted —
   * any non-array or wrong-length entry is treated as missing rather than
   * propagated to the renderer.
   */
  getThresholds(metric: Metric): Threshold4 {
    const stored = this.settings.thresholds[metric];
    if (isThreshold4(stored)) return stored;
    const fallback = this.defaults.thresholds[metric];
    if (isThreshold4(fallback)) return fallback;
    return [1, 5, 10, 20];
  }

  /**
   * Sets thresholds for a specific metric and saves them.
   */
  setThresholds(metric: Metric, values: Threshold4): void {
    const newThresholds = {
      ...this.settings.thresholds,
      [metric]: values,
    };
    this.save({
      thresholds: newThresholds,
    });
  }

  /**
   * Resolves thresholds for rendering a specific profile's grass.
   * `perProfileThresholds[userId][metric]` wins when present and well-formed
   * (Array of length 4); otherwise falls back to the global default. The
   * length check guards against hand-edited or otherwise malformed
   * localStorage entries leaking into the cell-paint code.
   */
  getThresholdsForView(userId: string, metric: Metric): Threshold4 {
    const stored = this.settings.perProfileThresholds?.[userId]?.[metric];
    if (isThreshold4(stored)) return stored;
    return this.getThresholds(metric);
  }

  /** True if a per-profile override exists for this userId and metric. */
  hasProfileThresholds(userId: string, metric?: Metric): boolean {
    const entry = this.settings.perProfileThresholds?.[userId];
    if (!entry) return false;
    if (!metric) return Object.keys(entry).length > 0;
    return entry[metric] !== undefined;
  }

  /**
   * Persists a per-profile threshold override for one metric. Other metrics
   * for the same profile remain untouched (fall through to the global
   * default until separately overridden).
   */
  setProfileThresholds(
    userId: string,
    metric: Metric,
    values: Threshold4,
  ): void {
    const all = {...(this.settings.perProfileThresholds ?? {})};
    all[userId] = {
      ...(all[userId] ?? {}),
      [metric]: values,
    };
    this.save({perProfileThresholds: all});
  }

  /** Default schedule when no user setting exists. */
  private static readonly DEFAULT_SCHEDULE: AutoTuneSchedule = {
    enabled: false,
    interval: 'semiannual',
  };

  /** Returns the auto-tune scheduler config (enabled flag + interval). */
  getAutoTuneSchedule(): AutoTuneSchedule {
    const stored = this.settings.autoTuneSchedule;
    if (stored && typeof stored.enabled === 'boolean' && stored.interval) {
      return stored;
    }
    return SettingsManager.DEFAULT_SCHEDULE;
  }

  /** Persists the scheduler config. */
  setAutoTuneSchedule(schedule: AutoTuneSchedule): void {
    this.save({autoTuneSchedule: schedule});
  }

  /**
   * Returns the last "decided this period" timestamp (epoch ms) for a
   * (profile, metric) pair, or 0 if never recorded. Used by the scheduler
   * to skip profiles already handled in the current period.
   */
  getProfileTuneTime(userId: string, metric: Metric): number {
    const ts = this.settings.perProfileTuneTimes?.[userId]?.[metric];
    return typeof ts === 'number' ? ts : 0;
  }

  /** Records a "decided this period" timestamp for a (profile, metric). */
  setProfileTuneTime(userId: string, metric: Metric, timestamp: number): void {
    const all = {...(this.settings.perProfileTuneTimes ?? {})};
    all[userId] = {
      ...(all[userId] ?? {}),
      [metric]: timestamp,
    };
    this.save({perProfileTuneTimes: all});
  }

  /**
   * Removes a per-profile override for one metric. If the entry has no
   * remaining metrics, the userId key is dropped entirely. Used by the
   * auto-tune Undo path to restore the "no override" state instead of
   * writing back stale values that would mask the global default.
   */
  clearProfileThreshold(userId: string, metric: Metric): void {
    const all = {...(this.settings.perProfileThresholds ?? {})};
    const entry = all[userId];
    if (!entry || entry[metric] === undefined) return;
    const updated = {...entry};
    delete updated[metric];
    if (Object.keys(updated).length === 0) {
      delete all[userId];
    } else {
      all[userId] = updated;
    }
    this.save({perProfileThresholds: all});
  }

  /**
   * Gets the grass color palette index (0-3) for a given theme.
   * Falls back to legacy single grassIndex for migration.
   */
  getGrassIndex(themeKey: string): number {
    const byTheme = this.settings.grassIndexByTheme;
    if (byTheme && typeof byTheme[themeKey] === 'number') {
      return Math.max(0, Math.min(3, byTheme[themeKey]));
    }
    // Legacy fallback: single grassIndex (pre-v8.2.0)
    const legacy = (this.settings as SettingsData & {grassIndex?: number})
      .grassIndex;
    return typeof legacy === 'number' && legacy >= 0 && legacy <= 3
      ? legacy
      : 0;
  }

  /**
   * Sets the grass color palette index for a specific theme and saves.
   */
  setGrassIndex(themeKey: string, index: number): void {
    const byTheme = {...(this.settings.grassIndexByTheme || {})};
    byTheme[themeKey] = Math.max(0, Math.min(3, index));
    // Remove legacy field if present
    const patch: Partial<SettingsData> = {grassIndexByTheme: byTheme};
    const legacySettings = this.settings as SettingsData & {
      grassIndex?: number;
    };
    if (legacySettings.grassIndex !== undefined) {
      delete legacySettings.grassIndex;
    }
    this.save(patch);
  }

  /**
   * Resolves the active levels array for a theme, considering grassOptions and per-theme grassIndex.
   */
  resolveLevels(themeKey: string, theme: Theme): string[] {
    const defaultLevels = [
      '#ebedf0',
      '#9be9a8',
      '#40c463',
      '#30a14e',
      '#216e39',
    ];
    if (theme.grassOptions && theme.grassOptions.length > 0) {
      const idx = this.getGrassIndex(themeKey);
      const option = theme.grassOptions[idx] || theme.grassOptions[0];
      return option.levels;
    }
    return theme.levels || defaultLevels;
  }

  /**
   * Applies the selected theme to CSS variables on the document root.
   * Updates background, text colors, and contribution graph levels.
   * @param {string} themeKey The key of the theme to apply (e.g., 'midnight').
   */
  applyTheme(themeKey: string): void {
    const theme = CONFIG.THEMES[themeKey] || CONFIG.THEMES.light;
    const root = document.querySelector(':root') as HTMLElement | null;
    if (root) {
      root.style.setProperty('--grass-bg', theme.bg);
      root.style.setProperty('--grass-empty-cell', theme.empty);
      root.style.setProperty('--grass-text', theme.text);
      root.style.setProperty(
        '--grass-scrollbar-thumb',
        theme.scrollbar || '#d0d7de',
      );
      // Apply Level Colors using grassOptions
      const levels = this.resolveLevels(themeKey, theme);
      levels.forEach((color, i) => {
        root.style.setProperty(`--grass-level-${i}`, color);
      });
    }
    this.save({
      theme: themeKey,
    });

    // Notify listeners (e.g. graph-renderer) to re-render with new colors
    window.dispatchEvent(
      new CustomEvent('DanbooruInsights:ThemeChanged', {
        detail: {themeKey},
      }),
    );
  }

  /**
   * Gets the last used mode for a specific user.
   * @param {string} userId The ID of the user.
   * @return {string|null} The mode ('uploads', 'approvals', 'notes') or null if not found.
   */
  getLastMode(userId: string): string | null {
    return this.settings.rememberedModes[userId] || null;
  }

  /**
   * Sets the last used mode for a specific user and saves it.
   * @param {string} userId The ID of the user.
   * @param {string} mode The mode ('uploads', 'approvals', 'notes').
   */
  setLastMode(userId: string, mode: string): void {
    const newModes = {
      ...this.settings.rememberedModes,
      [userId]: mode,
    };
    this.save({
      rememberedModes: newModes,
    });
  }

  /**
   * Gets the sync threshold (max diff allowed to skip sync).
   * @return {number} Threshold (default 5).
   */
  getSyncThreshold(): number {
    return typeof this.settings.syncThreshold === 'number'
      ? this.settings.syncThreshold
      : 5;
  }

  /**
   * Sets the sync threshold.
   * @param {number} val
   */
  setSyncThreshold(val: number): void {
    this.save({
      syncThreshold: parseInt(String(val), 10),
    });
  }

  /** Gets dark mode preference (default: 'auto'). */
  getDarkMode(): DarkModePreference {
    return this.settings.darkMode ?? 'auto';
  }

  /** Sets dark mode preference and persists it. */
  setDarkMode(pref: DarkModePreference): void {
    this.save({darkMode: pref});
  }

  /** Gets snap-to-edge preference (default: true). */
  getSnapToEdge(): boolean {
    return this.settings.snapToEdge !== false;
  }

  /** Sets snap-to-edge preference and persists it. */
  setSnapToEdge(enabled: boolean): void {
    this.save({snapToEdge: enabled});
  }
}

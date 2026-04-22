import {CONFIG} from './config';
import {injectGlobalStyles} from './styles';
import {Database} from './core/database';
import {SettingsManager} from './core/settings';
import type {DarkModePreference} from './types';
import {RateLimitedFetch} from './core/rate-limiter';
import {TabCoordinator} from './core/tab-coordinator';
import {ProfileContext} from './core/profile-context';
import {GrassApp} from './apps/grass-app';
import {UserAnalyticsApp} from './apps/user-analytics-app';
import {TagAnalyticsApp} from './apps/tag-analytics-app';
import {shouldRunDiagnostic, showDiagnostic} from './dev/diagnostic';

// Reserved path segments that are not tag show pages
const WIKI_RESERVED = new Set(['search', 'show_or_new', 'new']);

/* --- Helper: Tag Detection --- */
/**
 * Detects the current tag name from the page URL.
 * Supports Wiki pages and Artist pages.
 * @return {string|null} The tag name, or null if not on a tag page.
 */
export function detectCurrentTag(): string | null {
  const path = window.location.pathname;

  // 1. Wiki Page: /wiki_pages/TAG_NAME (show page only)
  if (path.startsWith('/wiki_pages/')) {
    const segments = path.split('/').filter(s => s !== '');
    // Only /wiki_pages/TAG_NAME is valid (exactly 2 segments)
    if (segments.length !== 2) return null;
    const rawName = segments[1];
    // Exclude reserved action names
    if (WIKI_RESERVED.has(rawName)) return null;
    return decodeURIComponent(rawName);
  }

  // 2. Artist Page: /artists/NUMERIC_ID (show page only)
  if (path.startsWith('/artists/')) {
    const segments = path.split('/').filter(s => s !== '');
    // Only /artists/NUMERIC_ID is valid (exactly 2 segments, numeric ID)
    if (segments.length !== 2 || !/^\d+$/.test(segments[1])) return null;

    // 2a. Data Attribute (Primary)
    if (document.body.dataset.artistName) {
      return document.body.dataset.artistName;
    }

    // 2b. "View posts" Link (Fallback)
    const postLink = document.querySelector('a[href^="/posts?tags="]');
    if (postLink) {
      const urlParams = new URLSearchParams(
        (postLink as HTMLAnchorElement).search,
      );
      return urlParams.get('tags');
    }
  }

  return null;
}

/* --- Dashboard Theme Helpers --- */

/** All top-level container IDs that receive the dashboard theme attribute. */
const DASHBOARD_CONTAINERS = [
  'danbooru-grass-modal-overlay',
  'tag-analytics-modal',
  'scatter-popover-ui',
  'danbooru-grass-sync-settings',
  'tag-analytics-settings-popover',
  'di-post-hover-card',
];

/**
 * Resolves the effective dashboard theme from the user preference
 * and Danbooru's current page theme (for 'auto' mode).
 */
export function resolveEffectiveDashboardTheme(
  pref: DarkModePreference,
): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  return document.body.getAttribute('data-current-user-theme') === 'dark'
    ? 'dark'
    : 'light';
}

/**
 * Sets or removes `data-di-theme="dark"` on all existing dashboard containers.
 * Called when the dashboard theme setting changes or on Danbooru theme change (auto).
 */
export function applyDashboardTheme(settings: SettingsManager): void {
  const effective = resolveEffectiveDashboardTheme(settings.getDarkMode());
  for (const id of DASHBOARD_CONTAINERS) {
    const el = document.getElementById(id);
    if (el) {
      if (effective === 'dark') {
        el.setAttribute('data-di-theme', 'dark');
      } else {
        el.removeAttribute('data-di-theme');
      }
    }
  }
}

/**
 * Watches for Danbooru page theme changes (auto mode only).
 * Updates dashboard containers when Danbooru's theme toggles.
 */
function observeDanbooruTheme(settings: SettingsManager): void {
  const observer = new MutationObserver(() => {
    if (settings.getDarkMode() !== 'auto') return;
    applyDashboardTheme(settings);
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-current-user-theme'],
  });
}

/**
 * Syncs dashboard theme across tabs. When another tab changes the theme
 * preference in localStorage, the `storage` event fires here (not in the
 * originating tab), and we re-read settings + re-apply the theme.
 */
function observeCrossTabSettings(settings: SettingsManager): void {
  const settingsKey = `${CONFIG.STORAGE_PREFIX}settings`;
  window.addEventListener('storage', e => {
    if (e.key !== settingsKey) return;
    // Reload settings from localStorage and re-apply theme
    settings.settings = settings.load();
    applyDashboardTheme(settings);
  });
}

/**
 * Main entry point for the script.
 * Initializes context, database, settings, and applications.
 */
async function main(): Promise<void> {
  // Diagnostic panel — defer opening until the first app sync + render
  // completes, so the panel's DB reads reflect post-sync state rather
  // than a stale pre-sync snapshot. GrassApp dispatches
  // `di:sync-complete` on successful initial render; a timeout fallback
  // covers pages where GrassApp doesn't run (tag pages, error pages)
  // and unusually slow syncs.
  if (shouldRunDiagnostic()) {
    let fired = false;
    const openDiag = () => {
      if (fired) return;
      fired = true;
      void showDiagnostic();
    };
    window.addEventListener('di:sync-complete', openDiag, {once: true});
    setTimeout(openDiag, 6000);
  }

  // Guard: skip non-Danbooru pages (nginx/CDN error pages like 429, 502, etc.)
  // Real Danbooru pages always have body classes (e.g., "c-users a-show").
  // Error pages served by nginx have a bare <body> with no classes.
  if (document.body.classList.length === 0) return;

  // Inject styles only on valid Danbooru pages
  injectGlobalStyles();

  // Shared Singletons
  const db = new Database();
  const settings = new SettingsManager();

  // Dashboard theme: observe Danbooru's theme for 'auto' mode
  observeDanbooruTheme(settings);
  observeCrossTabSettings(settings);

  // Shared rate limiter — one per tab, coordinated across tabs
  const rl = CONFIG.RATE_LIMITER;
  const rateLimiter = new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);

  // Cross-tab coordination
  const coordinator = new TabCoordinator();
  coordinator.onTabCountChange = count => {
    const rps = Math.max(1, Math.floor(rl.rps / count));
    const conc = Math.max(1, Math.floor(rl.concurrency / count));
    rateLimiter.updateLimits(rps, conc);
  };
  coordinator.onBackoffReceived = until => {
    rateLimiter.setBackoff(until);
  };
  rateLimiter.onBackoff = until => {
    coordinator.broadcastBackoff(until);
  };
  coordinator.start();

  // Routing
  const targetTagName = detectCurrentTag();

  if (targetTagName) {
    // Tag Analytics Mode (Wiki or Artist)
    const tagAnalytics = new TagAnalyticsApp(
      db,
      settings,
      targetTagName,
      rateLimiter,
    );
    // Fire-and-forget: top-level app entry; errors logged inside.
    void tagAnalytics.run();
  } else {
    // Profile Mode
    const context = new ProfileContext();
    if (!context.isValidProfile()) {
      return;
    }

    const grass = new GrassApp(db, settings, context, rateLimiter);
    const userAnalytics = new UserAnalyticsApp(
      db,
      settings,
      context,
      rateLimiter,
    );

    // Execution — fire-and-forget: top-level app entries.
    void grass.run();
    void userAnalytics.run();
  }
}

// Run
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void main());
} else {
  void main();
}

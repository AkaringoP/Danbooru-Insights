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

/* --- Dark Mode Helpers --- */

/**
 * Resolves the effective theme ('light' | 'dark') from the user preference
 * and Danbooru's current theme attribute.
 */
function resolveEffectiveTheme(pref: DarkModePreference): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  // auto: follow Danbooru's theme attribute
  return document.body.getAttribute('data-current-user-theme') === 'dark'
    ? 'dark'
    : 'light';
}

/**
 * Applies dark mode by setting `data-current-user-theme` on `<body>` if it
 * isn't already set (e.g., on pages where Danbooru doesn't inject it).
 * Our CSS variables use `body[data-current-user-theme="dark"]` selector,
 * so we ensure the attribute exists.
 */
function applyDarkMode(pref: DarkModePreference): void {
  const effective = resolveEffectiveTheme(pref);
  const current = document.body.getAttribute('data-current-user-theme');
  if (pref !== 'auto' && current !== effective) {
    // User forced a mode — override Danbooru's attribute
    document.body.setAttribute('data-current-user-theme', effective);
  }
  // When auto, Danbooru has already set the attribute; our CSS reacts to it.
}

/**
 * Watches for Danbooru theme changes (user toggling dark mode in Danbooru
 * settings). Re-renders scatter plots and other canvas-based widgets.
 */
function observeDanbooruTheme(settings: SettingsManager): void {
  const observer = new MutationObserver(() => {
    if (settings.getDarkMode() !== 'auto') return;
    // Danbooru changed its theme and we're in auto mode — notify widgets
    window.dispatchEvent(
      new CustomEvent('DanbooruInsights:ThemeChanged', {
        detail: {source: 'danbooru'},
      }),
    );
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-current-user-theme'],
  });
}

/**
 * Main entry point for the script.
 * Initializes context, database, settings, and applications.
 */
async function main(): Promise<void> {
  // Guard: skip non-Danbooru pages (nginx/CDN error pages like 429, 502, etc.)
  // Real Danbooru pages always have body classes (e.g., "c-users a-show").
  // Error pages served by nginx have a bare <body> with no classes.
  if (document.body.classList.length === 0) return;

  // Inject styles only on valid Danbooru pages
  injectGlobalStyles();

  // Shared Singletons
  const db = new Database();
  const settings = new SettingsManager();

  // Dark mode: apply early so CSS variables are set before any UI renders
  applyDarkMode(settings.getDarkMode());
  observeDanbooruTheme(settings);

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

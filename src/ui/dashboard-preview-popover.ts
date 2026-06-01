/**
 * Dashboard preview popover (ui primitive).
 *
 * Renders the popover anchored under the analytics icon. Two sections:
 * - **A — recent uploads**: a grid of the user's newest posts (thumbnail +
 *   score/tag label + status border).
 * - **B — activity distribution** (optional): a colour-coded strip of the
 *   user's most-recent 100 activities across feed types, plus a legend.
 *   Loaded in the background so it never blocks section A's render.
 *
 * Data is injected via `fetchPosts` / `fetchActivity` (apps wires them to the
 * data manager) so this module stays free of network/DB concerns.
 *
 * Two open modes (see {@link DashboardPreviewPopover.show}):
 * - **transient** (hover): auto-hides on mouseleave via the icon↔popover
 *   bridge (the caller schedules the hide on the anchor side).
 * - **pinned** (click): stays open until a click-outside or Escape.
 *
 * Each open reuses a result cached for {@link CACHE_TTL_MS} (avoids a
 * skeleton flash on rapid re-hover); otherwise it fetches fresh, reusing any
 * in-flight fetch. A single generation counter, bumped once per open and on
 * hide, voids stale renders for both sections if the popover re-opens or
 * closes before a fetch resolves.
 *
 * The pure DOM builders/renderers live at module scope (taking elements as
 * arguments); the factory closure owns only mutable state + lifecycle.
 */
import type {ActivityDistribution, ActivityType, PostPreview} from '../types';
import {
  ACTIVITY_COLORS,
  ACTIVITY_TYPES,
  STATUS_BORDER_COLORS,
  balancedChunks,
  isSuspiciousUpload,
} from '../core/dashboard-preview';
import {
  applyPopoverChrome,
  calcPopoverPositionBelow,
  createClickOutsideHandler,
} from './popover-utils';
import {
  TapTracker,
  createTwoStepTap,
  isTouchDevice,
  type TwoStepTapController,
} from './two-step-tap';
import {resolveEffectiveDashboardTheme} from './theme-palette';
import {
  SettingsManager,
  getNsfwEnabled,
  setNsfwEnabled,
} from '../core/settings';

const POPOVER_WIDTH = 440; // 5 cols × ~80px cells (was 355 → ~63px, too dense)
// Transient dismiss is two-phase: linger fully visible for HIDE_GRACE_MS after
// the cursor leaves (a deliberate grace, not the old 200ms icon→popover bridge),
// then fade out over FADE_MS before display:none. FADE_MS must match the
// `.di-preview-popover` opacity transition in styles.ts.
const HIDE_GRACE_MS = 1000;
const FADE_MS = 350;
const CACHE_TTL_MS = 60_000; // re-hover within this window reuses the result

/** Section A recent uploads: 5 columns × 2 rows. Drives skeleton + slice. */
export const RECENT_POSTS_LIMIT = 10;
/**
 * Section B: activity segments fetched per type and merged for the strip.
 * 200 aligns with the `/posts.json` limit cap that the commentary
 * upload-coupling lookup uses — so even an all-commentary window resolves its
 * post ids in one request, never truncating the filter.
 */
export const ACTIVITY_SEGMENT_LIMIT = 200;

/**
 * Target activity segments per strip row. The strip splits its segments into
 * balanced rows of at most this many ({@link balancedChunks}) and stretches
 * each cell to fill the row, so every row reaches the right edge (no ragged
 * tail). ~80 keeps cells ~4–5px at {@link POPOVER_WIDTH} (200 → 3 full rows).
 */
const ACTIVITY_PER_ROW = 80;

/** Human-readable legend labels per activity type. */
const ACTIVITY_LABELS: Record<ActivityType, string> = {
  upload: 'Uploads',
  edit: 'Tag edits',
  note: 'Notes',
  wiki: 'Wiki',
  artist: 'Artist',
  commentary: 'Commentary',
  pool: 'Pools',
  forum: 'Forum',
  approval: 'Approvals',
  comment: 'Comments',
  appeal: 'Appeals',
  suspicious: 'Suspicious',
};

/** Element refs the factory needs to read/update after construction. */
interface PopoverRefs {
  el: HTMLElement;
  caret: HTMLElement;
  grid: HTMLElement;
  /** Section A's NSFW checkbox — re-synced on each open (shared flag, R-11). */
  nsfwToggle: HTMLInputElement;
  /** Section B strip/legend — null when no `fetchActivity` was provided. */
  strip: HTMLElement | null;
  legend: HTMLElement | null;
  /** Touch legend two-step controller (document listeners) — for disposal. */
  legendTap: TwoStepTapController<string> | null;
}

/** Relative "Xm/h/d ago" label for an activity segment's tooltip. */
function relativeTime(ts: number): string {
  const sec = Math.max(0, (Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Small uppercase header that names a popover section. */
function makeSectionLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'di-preview-section-label';
  el.textContent = text;
  return el;
}

/** Section A: one grid cell linking to the post, status border on the thumb. */
function makeCell(post: PostPreview): HTMLElement {
  const cell = document.createElement('a');
  cell.className = 'di-preview-cell';
  cell.href = `${location.origin}/posts/${post.id}`;
  cell.target = '_blank';
  cell.rel = 'noopener';

  // Title: status (if not active) + the suspicious-upload reason (if flagged).
  const flagged = isSuspiciousUpload(post);
  const titleParts: string[] = [];
  if (post.status !== 'active') titleParts.push(post.status);
  if (flagged) titleParts.push('low score / few tags');
  if (titleParts.length) cell.title = titleParts.join(' · ');

  // Status border wraps only the thumbnail, not the label below it.
  let thumb: HTMLElement;
  if (post.thumbUrl) {
    const img = document.createElement('img');
    img.className = 'di-preview-thumb';
    img.src = post.thumbUrl;
    img.loading = 'lazy';
    img.alt = `post ${post.id}`;
    thumb = img;
  } else {
    thumb = document.createElement('div');
    thumb.className = 'di-preview-thumb--empty';
  }
  thumb.style.borderColor = STATUS_BORDER_COLORS[post.status];
  thumb.dataset.rating = post.rating; // drives the NSFW blur pass (q/e)
  cell.appendChild(thumb);

  const label = document.createElement('div');
  label.className = 'di-preview-label';
  if (flagged) label.classList.add('di-preview-label--flag');
  // rating may be '' and generalTags undefined (API omitted the field) — guard
  // both so the cell renders cleanly instead of 'UNDEFINED'/'◫undefined'.
  const ratingPart = post.rating ? `${post.rating.toUpperCase()} ` : '';
  label.textContent = `${ratingPart}▲${post.score} ◫${post.generalTags ?? '?'}`;
  cell.appendChild(label);
  return cell;
}

function renderSkeleton(grid: HTMLElement): void {
  grid.textContent = '';
  for (let i = 0; i < RECENT_POSTS_LIMIT; i++) {
    const cell = document.createElement('div');
    cell.className = 'di-preview-cell di-preview-skeleton';
    grid.appendChild(cell);
  }
}

function renderMessage(grid: HTMLElement, text: string): void {
  grid.textContent = '';
  const msg = document.createElement('div');
  msg.className = 'di-preview-msg';
  msg.textContent = text;
  grid.appendChild(msg);
}

/** A single spinner spanning the grid — section A's stale/loading placeholder. */
function renderGridSpinner(grid: HTMLElement): void {
  grid.textContent = '';
  const spinner = document.createElement('div');
  spinner.className = 'di-preview-loading';
  grid.appendChild(spinner);
}

/** Section B loading placeholder: clear + pulse the strip while its fetch runs. */
function showActivityLoading(strip: HTMLElement, legend: HTMLElement): void {
  strip.textContent = '';
  strip.classList.add('di-activity-loading');
  legend.textContent = '';
}

function renderGrid(grid: HTMLElement, posts: PostPreview[]): void {
  if (!posts.length) {
    renderMessage(grid, 'No recent uploads.');
    return;
  }
  grid.textContent = '';
  // Defensive cap so the 5-col grid stays 2 rows even if more are returned.
  for (const post of posts.slice(0, RECENT_POSTS_LIMIT)) {
    grid.appendChild(makeCell(post));
  }
  applyNsfwBlur(grid);
}

/**
 * Blurs q/e thumbnails when the unified NSFW preference is off (the default).
 * Reads {@link getNsfwEnabled} live, so it reflects the current setting on
 * every render and on every toggle. Only the thumbnail blurs — the label stays
 * readable.
 */
function applyNsfwBlur(grid: HTMLElement): void {
  const blur = !getNsfwEnabled();
  grid.querySelectorAll<HTMLElement>('[data-rating]').forEach(thumb => {
    const r = thumb.dataset.rating;
    thumb.classList.toggle(
      'di-preview-thumb--nsfw',
      blur && (r === 'q' || r === 'e'),
    );
  });
}

/**
 * The "NSFW" checkbox for section A's header. Checked ⇔ NSFW shown ⇔ the
 * unified NSFW flag is *on* — the same "Enable NSFW" polarity used by
 * UserAnalyticsApp / TagAnalyticsApp, so it's the familiar behaviour. Unchecked
 * (the default) blurs q/e. Toggling re-runs the blur pass over `grid` and
 * persists the shared flag.
 */
function makeNsfwToggle(grid: HTMLElement): {
  label: HTMLElement;
  checkbox: HTMLInputElement;
} {
  const label = document.createElement('label');
  label.className = 'di-preview-nsfw-toggle';
  label.title = 'Show NSFW thumbnails (rating Q/E)';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = getNsfwEnabled();
  cb.addEventListener('change', () => {
    setNsfwEnabled(cb.checked);
    applyNsfwBlur(grid);
  });
  label.appendChild(cb);
  label.appendChild(document.createTextNode('NSFW'));
  return {label, checkbox: cb};
}

/** Section B: a single muted/pulsing message row (empty or error state). */
function renderActivityMessage(
  strip: HTMLElement,
  legend: HTMLElement,
  text: string,
): void {
  strip.classList.remove('di-activity-loading');
  strip.textContent = '';
  legend.textContent = '';
  const msg = document.createElement('div');
  msg.className = 'di-activity-empty';
  msg.textContent = text;
  legend.appendChild(msg);
}

/** Section B: the colour-coded strip (newest→left) plus the per-type legend. */
function renderActivity(
  strip: HTMLElement,
  legend: HTMLElement,
  dist: ActivityDistribution,
  activityHref?: (
    type: ActivityType,
    dist: ActivityDistribution,
  ) => string | undefined,
): void {
  if (!dist.recent.length) {
    renderActivityMessage(strip, legend, 'No recent activity.');
    return;
  }
  strip.classList.remove('di-activity-loading');
  strip.textContent = '';
  legend.textContent = '';
  // recent is most-recent-first; split into balanced rows whose cells stretch
  // to fill the width, so every row reaches the right edge (newest top-left).
  for (const row of balancedChunks(dist.recent, ACTIVITY_PER_ROW)) {
    const rowEl = document.createElement('div');
    rowEl.className = 'di-activity-row';
    for (const seg of row) {
      const cell = document.createElement('div');
      cell.className = 'di-activity-seg';
      if (seg.type === 'suspicious') {
        cell.classList.add('di-activity-seg--flag');
      }
      cell.dataset.type = seg.type; // peer-highlight key (see attachStripHover)
      cell.style.background = ACTIVITY_COLORS[seg.type];
      cell.title = `${ACTIVITY_LABELS[seg.type]} · ${relativeTime(seg.ts)}`;
      rowEl.appendChild(cell);
    }
    strip.appendChild(rowEl);
  }
  for (const type of ACTIVITY_TYPES) {
    const count = dist.counts[type];
    if (!count) continue; // legend lists only types that appear
    const item = document.createElement('span');
    item.className = 'di-activity-legend-item';
    item.dataset.type = type; // peer-highlight key (legend ↔ strip)
    const swatch = document.createElement('span');
    swatch.className = 'di-activity-swatch';
    if (type === 'suspicious') swatch.classList.add('di-activity-seg--flag');
    swatch.style.background = ACTIVITY_COLORS[type];
    item.appendChild(swatch);
    // Text wrapped so the row can reserve its bold width (data-text ghost in
    // CSS) — the peer-highlight bold then never reflows the legend.
    const labelText = `${ACTIVITY_LABELS[type]} ${count}`;
    const text = document.createElement('span');
    text.className = 'di-activity-legend-item__text';
    text.dataset.text = labelText;
    const inner = document.createElement('span');
    inner.textContent = labelText;
    text.appendChild(inner);
    item.appendChild(text);
    // Opens the full Danbooru list for this type (new tab). Desktop: direct
    // click. Touch: the second tap of the legend two-step (attachLegendTwoStep)
    // reads this data-href — so a single tap can't navigate by accident.
    const href = activityHref?.(type, dist);
    if (href) {
      item.classList.add('di-activity-legend-item--link');
      item.title = `Open ${ACTIVITY_LABELS[type]} list`;
      item.dataset.href = href;
      if (!isTouchDevice()) {
        item.addEventListener('click', () =>
          window.open(href, '_blank', 'noopener'),
        );
      }
    }
    legend.appendChild(item);
  }
}

/** Section A: render a settled posts fetch — the grid, or a load-error row. */
function renderPostsResult(
  grid: HTMLElement,
  result: PromiseSettledResult<PostPreview[]>,
): void {
  if (result.status === 'fulfilled') renderGrid(grid, result.value);
  else renderMessage(grid, 'Failed to load recent posts.');
}

/** Section B: render a settled activity fetch — the strip, or an error row. */
function renderActivityResult(
  strip: HTMLElement,
  legend: HTMLElement,
  result: PromiseSettledResult<ActivityDistribution | null>,
  activityHref?: (
    type: ActivityType,
    dist: ActivityDistribution,
  ) => string | undefined,
): void {
  if (result.status === 'fulfilled' && result.value) {
    renderActivity(strip, legend, result.value, activityHref);
  } else {
    renderActivityMessage(strip, legend, 'Activity unavailable.');
  }
}

/**
 * Dims every strip segment whose type differs from `type` (null clears all)
 * and bolds the matching legend label, so the focused activity type's cells
 * and its legend entry highlight together.
 */
function applyPeerHighlight(
  strip: HTMLElement,
  legend: HTMLElement,
  type: string | null,
): void {
  strip.querySelectorAll<HTMLElement>('.di-activity-seg').forEach(s => {
    s.classList.toggle(
      'di-activity-seg--mute',
      type !== null && s.dataset.type !== type,
    );
  });
  legend
    .querySelectorAll<HTMLElement>('.di-activity-legend-item')
    .forEach(i => {
      i.classList.toggle(
        'di-activity-legend-item--active',
        type !== null && i.dataset.type === type,
      );
    });
}

/**
 * Wires the "peer highlight" hover interaction: hovering a strip segment *or* a
 * legend item dims every segment of a different type, so all cells of that
 * activity type light up together. Delegated on the persistent strip/legend
 * elements (survives re-renders); attached once.
 *
 * Pointer events, not mouse events: touch is filtered out by `pointerType` so
 * this can be wired on every device (touch reports `'ontouchstart' in window`
 * even on a mouse machine) without fighting the touch two-step. Mouse/pen get
 * hover + leave-clear; touch goes through {@link attachLegendTwoStep}.
 *
 * `onClear` runs alongside the leave-clear. On a hybrid device (touch + mouse)
 * a mouse pointerleave must also reset the touch two-step controller, else its
 * `active` datum survives the visual clear and the next tap reads as the
 * "second tap" and navigates unexpectedly (R-09).
 */
function attachPeerHighlight(
  strip: HTMLElement,
  legend: HTMLElement,
  onClear?: () => void,
): void {
  // Strip is tiled with ~1px gaps, so it only *sets* on a segment (clearing on
  // those gaps would flicker the dim during a sweep) — pointerleave clears it.
  strip.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const seg = (e.target as HTMLElement).closest<HTMLElement>(
      '.di-activity-seg',
    );
    if (seg && strip.contains(seg)) {
      applyPeerHighlight(strip, legend, seg.dataset.type ?? null);
    }
  });
  // Legend has wide gaps and wraps to multiple rows, so resting between labels
  // is common: pointerover onto a gap reports the bare container → clear, so
  // the bold tracks the native `:hover` underline instead of sticking.
  legend.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const item = (e.target as HTMLElement).closest<HTMLElement>(
      '.di-activity-legend-item',
    );
    const type =
      item && legend.contains(item) ? (item.dataset.type ?? null) : null;
    applyPeerHighlight(strip, legend, type);
  });
  const clear = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    applyPeerHighlight(strip, legend, null);
    onClear?.(); // reset the touch two-step too (hybrid devices — R-09)
  };
  strip.addEventListener('pointerleave', clear);
  legend.addEventListener('pointerleave', clear);
}

/**
 * Touch counterpart to {@link attachPeerHighlight}: a two-step tap on the
 * legend. First tap on a label highlights its type (same dim/bold as hover);
 * a second tap on the same label opens its Danbooru list (the `data-href` the
 * legend stores). Tapping a different label switches; tapping outside resets.
 * Returns the controller so the popover can dispose its document listeners.
 */
function attachLegendTwoStep(
  strip: HTMLElement,
  legend: HTMLElement,
): TwoStepTapController<string> {
  const controller = createTwoStepTap<string>({
    insideElements: () => [legend, strip],
    onFirstTap: type => applyPeerHighlight(strip, legend, type),
    onSecondTap: type => {
      const item = legend.querySelector<HTMLElement>(
        `.di-activity-legend-item[data-type="${type}"]`,
      );
      const href = item?.dataset.href;
      if (href) window.open(href, '_blank', 'noopener');
    },
    onReset: () => applyPeerHighlight(strip, legend, null),
    resetOnScroll: true,
  });
  const tracker = new TapTracker();
  legend.addEventListener('touchstart', e => tracker.onTouchStart(e), {
    passive: true,
  });
  legend.addEventListener('touchmove', e => tracker.onTouchMove(e), {
    passive: true,
  });
  legend.addEventListener(
    'touchend',
    e => {
      if (!tracker.onTouchEnd(e)) return; // a scroll/swipe, not a tap
      const item = (e.target as HTMLElement).closest<HTMLElement>(
        '.di-activity-legend-item',
      );
      const type = item?.dataset.type;
      if (type) controller.tap(type);
    },
    {passive: true},
  );
  return controller;
}

/**
 * Mirrors the dashboard's effective theme onto the popover element. It's
 * appended to `document.body` — outside the dashboard containers that carry
 * `data-di-theme` — so without this it would fall back to light vars on a dark
 * theme. Re-evaluated on every open so a mid-session theme switch is picked up.
 */
function syncPopoverTheme(el: HTMLElement): void {
  const dark =
    resolveEffectiveDashboardTheme(new SettingsManager().getDarkMode()) ===
    'dark';
  if (dark) el.setAttribute('data-di-theme', 'dark');
  else el.removeAttribute('data-di-theme');
}

/** Builds the popover DOM (appended to `document.body`) and returns its refs. */
function buildPopoverDom(opts: {
  hasActivity: boolean;
  onEnter: () => void;
  onLeave: () => void;
}): PopoverRefs {
  const el = document.createElement('div');
  el.className = 'di-preview-popover';
  applyPopoverChrome(el, {width: `${POPOVER_WIDTH}px`, zIndex: '10001'});
  el.style.padding = '0'; // the inner body owns padding so the caret straddles
  el.style.display = 'none';

  const caret = document.createElement('div');
  caret.className = 'di-preview-caret';
  el.appendChild(caret);

  const body = document.createElement('div');
  body.className = 'di-preview-body';
  const grid = document.createElement('div');
  grid.className = 'di-preview-grid';
  // Section A header: "Recent uploads" + the NSFW blur toggle (top-right).
  const headA = document.createElement('div');
  headA.className = 'di-preview-section-head';
  headA.appendChild(makeSectionLabel('Recent uploads'));
  const nsfw = makeNsfwToggle(grid);
  headA.appendChild(nsfw.label);
  body.appendChild(headA);
  body.appendChild(grid);

  let strip: HTMLElement | null = null;
  let legend: HTMLElement | null = null;
  let legendTap: TwoStepTapController<string> | null = null;
  if (opts.hasActivity) {
    const section = document.createElement('div');
    section.className = 'di-activity-section';
    section.appendChild(makeSectionLabel('Activity'));
    strip = document.createElement('div');
    strip.className = 'di-activity-strip';
    legend = document.createElement('div');
    legend.className = 'di-activity-legend';
    // Highlight interaction, delegated so it survives re-renders. Mouse/pen
    // hover is always wired (pointer events ignore touch by type); touch
    // additionally gets the two-step tap. Both coexist on hybrid devices, so a
    // mouse leave-clear also resets the two-step controller (R-09); legendTap
    // is captured by closure since it's assigned just below.
    attachPeerHighlight(strip, legend, () => legendTap?.reset());
    if (isTouchDevice()) {
      legendTap = attachLegendTwoStep(strip, legend);
    }
    section.appendChild(strip);
    section.appendChild(legend);
    body.appendChild(section);
  }
  el.appendChild(body);

  // Icon↔popover bridge: keep open while the cursor is over the popover.
  el.addEventListener('mouseenter', opts.onEnter);
  el.addEventListener('mouseleave', opts.onLeave);

  document.body.appendChild(el);
  return {el, caret, grid, nsfwToggle: nsfw.checkbox, strip, legend, legendTap};
}

export interface DashboardPreviewPopoverOptions {
  /** The icon element the popover anchors under. */
  anchor: HTMLElement;
  /** Fetches the recent-post previews, newest first. */
  fetchPosts: () => Promise<PostPreview[]>;
  /**
   * Optional: fetches the activity distribution for section B. Omit to render
   * section A only (the strip/legend are not built).
   */
  fetchActivity?: () => Promise<ActivityDistribution>;
  /**
   * Optional: relative Danbooru URL to open when a legend item is clicked
   * (the "see the full list" target for that activity type). Receives the
   * resolved distribution so `suspicious` can link to the exact flagged posts
   * (`dist.suspiciousPostIds`). Returning undefined makes that item
   * non-clickable.
   */
  activityHref?: (
    type: ActivityType,
    dist: ActivityDistribution,
  ) => string | undefined;
}

export interface DashboardPreviewPopover {
  /** Open the popover. `pinned` (click) stays open; otherwise transient. */
  show(opts?: {pinned?: boolean}): void;
  /** Close immediately. */
  hide(): void;
  /** Close after a short grace delay; no-op while pinned. */
  scheduleHide(): void;
  /**
   * Cancel a pending hide/fade and un-dim. Called when the cursor returns to
   * the *anchor* (the popover element wires this itself) so a re-hover during
   * the grace/fade window keeps the open popover alive instead of letting it
   * close and re-load (R-04).
   */
  keepOpen(): void;
  /** Remove the popover element and detach all listeners. */
  destroy(): void;
}

/** A TTL-cached, in-flight-deduped wrapper around one fetch function. */
interface CachedFetcher<T> {
  /** The cached value if still fresh, else null (for a sync, skeleton-free render). */
  peekFresh(): T | null;
  /** Resolve from a fresh cache or a deduped in-flight fetch; refreshes the cache. */
  get(): Promise<T>;
}

/**
 * Wraps `fetchFn` with a single-slot {@link ttlMs} cache and in-flight dedup —
 * the shared engine behind sections A and B so the popover's load paths don't
 * each re-implement the bookkeeping.
 *
 * `isCacheable` gates what gets stored (default: everything). Both fetch
 * methods swallow network errors into an *empty* result (`[]` / an empty
 * distribution) rather than rejecting, so without this an offline blip would
 * pin a false-empty for the full TTL — re-hover after the API recovers would
 * still show nothing (R-05). Passing `v => v.length > 0` (or the distribution
 * equivalent) means an empty result is never cached: the next open re-fetches
 * and recovers. A genuinely-empty user just re-fetches each open — cheap.
 */
function createCachedFetcher<T>(
  fetchFn: () => Promise<T>,
  ttlMs: number,
  isCacheable: (value: T) => boolean = () => true,
): CachedFetcher<T> {
  let cached: T | null = null;
  let cachedTs = 0;
  let inflight: Promise<T> | null = null;
  const isFresh = () => cached !== null && Date.now() - cachedTs < ttlMs;
  return {
    peekFresh: () => (isFresh() ? cached : null),
    get() {
      if (isFresh()) return Promise.resolve(cached as T);
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
      return pending.then(value => {
        if (isCacheable(value)) {
          cached = value;
          cachedTs = Date.now();
        }
        return value;
      });
    },
  };
}

export function createDashboardPreviewPopover(
  options: DashboardPreviewPopoverOptions,
): DashboardPreviewPopover {
  const {anchor, fetchPosts, fetchActivity, activityHref} = options;

  let refs: PopoverRefs | null = null;
  let pinned = false;
  let visible = false;
  let generation = 0;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  // Don't cache an empty result (an error degrades to one) — see
  // createCachedFetcher. A real empty just re-fetches cheaply on the next open.
  const postsFetcher = createCachedFetcher(
    fetchPosts,
    CACHE_TTL_MS,
    posts => posts.length > 0,
  );
  const activityFetcher = fetchActivity
    ? createCachedFetcher(
        fetchActivity,
        CACHE_TTL_MS,
        dist => dist.recent.length > 0,
      )
    : null;
  let clickOutside: ((e: MouseEvent) => void) | null = null;
  let onKeydown: ((e: KeyboardEvent) => void) | null = null;

  function cancelHideTimer(): void {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function teardownDismiss(): void {
    if (clickOutside) {
      document.removeEventListener('click', clickOutside);
      clickOutside = null;
    }
    if (onKeydown) {
      document.removeEventListener('keydown', onKeydown);
      onKeydown = null;
    }
  }

  function hide(): void {
    cancelHideTimer();
    teardownDismiss();
    visible = false;
    pinned = false;
    generation++; // void any pending render
    if (refs) {
      refs.el.style.display = 'none';
      refs.el.classList.remove('di-preview-popover--fading'); // reset for re-show
    }
  }

  /** Cursor returned to the popover: abort a pending hide/fade and un-dim. */
  function keepOpen(): void {
    cancelHideTimer();
    if (refs) refs.el.classList.remove('di-preview-popover--fading');
  }

  /** Grace elapsed: start the opacity fade, then display:none once it ends. */
  function startFadeOut(): void {
    hideTimer = null;
    if (pinned || !refs || !visible) return;
    refs.el.classList.add('di-preview-popover--fading');
    hideTimer = setTimeout(hide, FADE_MS);
  }

  function scheduleHide(): void {
    if (pinned) return;
    cancelHideTimer();
    hideTimer = setTimeout(startFadeOut, HIDE_GRACE_MS);
  }

  function setupDismiss(): void {
    teardownDismiss();
    if (!pinned || !refs) return;
    const handler = createClickOutsideHandler(refs.el, hide, {ignore: anchor});
    clickOutside = handler;
    // Defer attach so the opening click doesn't immediately close it.
    setTimeout(() => {
      if (clickOutside === handler) document.addEventListener('click', handler);
    }, 0);
    onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKeydown);
  }

  function reposition(): void {
    if (!refs) return;
    const pos = calcPopoverPositionBelow(anchor, POPOVER_WIDTH);
    refs.el.style.top = `${pos.top}px`;
    refs.el.style.left = `${pos.left}px`;
    refs.caret.style.left = `${pos.caretLeft}px`;
  }

  function loadPosts(gen: number): void {
    if (!refs) return;
    const grid = refs.grid;
    // Serve a fresh cache synchronously — avoids a skeleton flash on rapid
    // re-hover. The popover only ever shows one user, so a single slot.
    const fresh = postsFetcher.peekFresh();
    if (fresh) {
      renderGrid(grid, fresh);
      return;
    }
    renderSkeleton(grid);
    void postsFetcher.get().then(
      posts => {
        if (gen === generation && visible) renderGrid(grid, posts);
      },
      () => {
        if (gen === generation && visible) {
          renderMessage(grid, 'Failed to load recent posts.');
        }
      },
    );
  }

  function loadActivity(gen: number): void {
    if (!activityFetcher || !refs || !refs.strip || !refs.legend) return;
    const {strip, legend} = refs;
    const fresh = activityFetcher.peekFresh();
    if (fresh) {
      renderActivity(strip, legend, fresh, activityHref);
      return;
    }
    showActivityLoading(strip, legend);
    void activityFetcher.get().then(
      dist => {
        if (gen === generation && visible) {
          renderActivity(strip, legend, dist, activityHref);
        }
      },
      () => {
        if (gen === generation && visible) {
          renderActivityMessage(strip, legend, 'Activity unavailable.');
        }
      },
    );
  }

  // Touch + pinned (the mobile mini-report): each section renders the instant
  // its own data is fresh; only a stale section shows a spinner. A fresh grid
  // no longer blanks behind a unified spinner just because activity is still
  // loading (R-10). When both are stale this is still effectively one spinner.
  async function loadUnified(gen: number): Promise<void> {
    if (!refs) return;
    const {grid, strip, legend} = refs;
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
      activityFetcher ? activityFetcher.get() : Promise.resolve(null),
    ]);
    if (gen !== generation || !visible) return;
    // Only the sections that *weren't* served fresh above get their settled
    // result rendered now (strip/legend are non-null iff activity was wired).
    if (!freshPosts) renderPostsResult(grid, postsR);
    if (strip && legend && !freshAct) {
      renderActivityResult(strip, legend, actR, activityHref);
    }
  }

  function show(opts?: {pinned?: boolean}): void {
    pinned = opts?.pinned ?? false;
    if (!refs) {
      refs = buildPopoverDom({
        hasActivity: !!fetchActivity,
        onEnter: keepOpen,
        onLeave: scheduleHide,
      });
    }
    refs.el.classList.remove('di-preview-popover--fading'); // crisp re-show
    syncPopoverTheme(refs.el);
    // The NSFW flag is shared, so another component may have flipped it since
    // this popover was built. The blur itself is already live (applyNsfwBlur
    // reads the flag per render), but the checkbox could be stale (R-11).
    refs.nsfwToggle.checked = getNsfwEnabled();
    refs.el.style.display = 'block';
    visible = true;
    cancelHideTimer();
    // One generation per open guards stale renders for both sections.
    const gen = ++generation;
    reposition();
    setupDismiss();
    // Touch + pinned (the mobile mini-report): one spinner → render both
    // sections at once. Desktop keeps the progressive A-first / B-background.
    if (isTouchDevice() && pinned) {
      void loadUnified(gen);
    } else {
      loadPosts(gen);
      loadActivity(gen);
    }
  }

  function destroy(): void {
    hide();
    if (refs) {
      refs.legendTap?.destroy(); // drop the touch controller's document listeners
      refs.el.remove();
      refs = null;
    }
  }

  return {show, hide, scheduleHide, keepOpen, destroy};
}

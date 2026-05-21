/**
 * Sub-tag breakdown tooltip for the Copy / Fav_Copy / Char pie chart
 * legend (v9.6.0+).
 *
 * Single-instance, body-attached tooltip. Two interaction modes:
 *  - **Desktop (mouse)**: caller wires `mouseover` → `showSubtagTooltip`,
 *    `mouseout` → `hideSubtagTooltip` on the legend item. The tooltip
 *    itself catches `mouseenter` to cancel a pending hide so users can
 *    move the cursor into it to click a row.
 *  - **Mobile (touch)**: caller invokes `showSubtagTooltip` on the first
 *    tap of a legend item. The tooltip installs a document-level
 *    pointerdown handler that closes it on any tap outside its bounds.
 *    Items are rendered as `<a target="_blank">` so the second tap
 *    navigates in a new tab.
 *
 * Items are clickable (anchors) unless `isOther === true` (rendered as
 * a non-interactive span — the "Others" bucket has no canonical search).
 *
 * Position via `calcPopoverPosition` (existing popover-utils contract).
 * Rendering uses `textContent` for all user-provided strings so tag
 * names are XSS-safe even though they're sourced from the Danbooru API.
 */
import {
  calcPopoverPosition,
  createBodyTooltip,
  createClickOutsideHandler,
} from './popover-utils';
const TOOLTIP_CLASS = 'di-subtag-tooltip';
const HIDE_GRACE_MS = 120; // window for cursor → tooltip transition

/** Item shape consumed by `showSubtagTooltip`. */
export interface SubtagTooltipItem {
  /** Underscored tag name (canonical Danbooru form). */
  tagName: string;
  /** Display name (underscores converted to spaces). */
  displayName: string;
  /** Absolute user count for this sub. */
  count: number;
  /** 0..1 — share of the parent's sub-tag user-count sum. */
  share: number;
  /** Search URL the item links to. Empty string for `isOther`. */
  href: string;
  /** True for the trailing "Others" bucket — rendered non-clickable. */
  isOther: boolean;
}

export interface SubtagTooltipOptions {
  parentDisplayName: string;
  items: SubtagTooltipItem[];
  /**
   * Element used for `calcPopoverPosition` — the tooltip sits at its
   * right edge. Pick the tag-name span/anchor (not the whole legend row)
   * so the tooltip lands next to the tag label instead of past the
   * trailing percentage.
   */
  anchor: HTMLElement;
  /**
   * Optional wider element treated as "inside" for click-outside
   * dismissal. Defaults to `anchor`. Pass the parent row when `anchor`
   * is a child of it — otherwise a mobile tap on the row's swatch /
   * percentage would be classified as outside and close the tooltip.
   */
  outsideIgnore?: HTMLElement;
  /**
   * Lifecycle hook fired the moment the tooltip becomes visible. Used by
   * the legend wire-up to enter pie sub-chart mode in sync with the
   * tooltip appearing.
   */
  onShow?: () => void;
  /**
   * Lifecycle hook fired when the tooltip is hidden (mouseleave grace
   * expired, click-outside, or explicit hide). Pair with onShow to
   * mirror state — e.g. exit pie sub-chart mode. Called at most once
   * per show.
   */
  onHide?: () => void;
  /**
   * Fires when the cursor enters the tooltip body. Used by the legend
   * wire-up to keep the chart-mode "alive" while the cursor is over the
   * tooltip (so a row→tooltip cursor transit doesn't trigger the legend
   * container's chart-exit grace timer).
   */
  onPointerEnter?: () => void;
  /**
   * Fires when the cursor leaves the tooltip body. Mirrors onPointerEnter
   * — the legend wire-up uses it to re-arm the chart-exit grace timer.
   */
  onPointerLeave?: () => void;
}

interface TooltipState {
  el: HTMLDivElement;
  cleanupClickOutside?: () => void;
  hideTimer?: ReturnType<typeof setTimeout>;
  /** Caller-supplied hook fired once on hide. Cleared after invocation. */
  onHide?: () => void;
}

let state: TooltipState | null = null;

/** Show or replace the tooltip with the given items, positioned near anchor. */
export function showSubtagTooltip(opts: SubtagTooltipOptions): void {
  if (opts.items.length === 0) return;

  hideSubtagTooltip(); // cancel pending hides, clear previous

  const el = createBodyTooltip(TOOLTIP_CLASS);
  renderTooltipDom(el, opts.parentDisplayName, opts.items);

  const {top, left} = calcPopoverPosition(opts.anchor);
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.opacity = '1';
  el.style.pointerEvents = 'auto';

  // Vertical viewport clamp: if the rendered tooltip would spill past
  // the bottom edge, shift it up by the overflow amount (but never above
  // the top margin). max-height + overflow-y handle the absolute worst
  // case; this just keeps the tooltip in view when there's headroom
  // above the anchor (long sub lists on bottom-half copyright rows).
  const rect = el.getBoundingClientRect();
  const margin = 8;
  const overflowBottom = rect.bottom + margin - window.innerHeight;
  if (overflowBottom > 0) {
    const minTopDoc = window.scrollY + margin;
    el.style.top = `${Math.max(minTopDoc, top - overflowBottom)}px`;
  }

  // Mouse-leaving the tooltip schedules a hide. Mouse-entering cancels it.
  // Both also forward to caller-supplied pointer hooks so the legend
  // wire-up can sync chart-mode lifecycle with tooltip body hover (so a
  // cursor moving from legend row → tooltip body doesn't trip the legend
  // container's chart-exit grace timer).
  el.onmouseenter = () => {
    if (state?.hideTimer) {
      clearTimeout(state.hideTimer);
      state.hideTimer = undefined;
    }
    if (opts.onPointerEnter) opts.onPointerEnter();
  };
  el.onmouseleave = () => {
    // Schedule (not immediate) so the user has a 120ms window to move
    // the cursor back into the tooltip or onto the owning legend row.
    scheduleSubtagTooltipHide();
    if (opts.onPointerLeave) opts.onPointerLeave();
  };

  // Outside-tap dismissal (mobile primarily). Deferred via setTimeout so
  // the initial show-triggering click doesn't immediately close it.
  const handler = createClickOutsideHandler(el, () => hideSubtagTooltip(), {
    ignore: opts.outsideIgnore ?? opts.anchor,
  });
  const attachTimer = setTimeout(() => {
    document.addEventListener('click', handler);
  }, 0);
  const cleanup = () => {
    clearTimeout(attachTimer);
    document.removeEventListener('click', handler);
  };

  state = {el, cleanupClickOutside: cleanup, onHide: opts.onHide};
  // Fire onShow last — caller may immediately rebind chart state, so we
  // want the tooltip already mounted (positioning measured) before it runs.
  if (opts.onShow) opts.onShow();
}

/** Hide and clean up. Idempotent. */
export function hideSubtagTooltip(): void {
  if (!state) return;
  if (state.hideTimer) {
    clearTimeout(state.hideTimer);
    state.hideTimer = undefined;
  }
  if (state.cleanupClickOutside) state.cleanupClickOutside();
  state.el.style.opacity = '0';
  state.el.style.pointerEvents = 'none';
  state.el.onmouseenter = null;
  state.el.onmouseleave = null;
  // Snapshot the hook before clearing state, then fire — the hook may
  // call back into the tooltip module (re-show is unlikely but defensive).
  const onHide = state.onHide;
  state = null;
  if (onHide) onHide();
}

/**
 * Schedule a hide that runs unless `cancelSubtagTooltipHide` is called
 * (e.g. cursor moved back into the legend row) within ~120ms. Used by the
 * tooltip body's own `el.onmouseleave` to give the user a small window to
 * reverse course before the tooltip vanishes. No longer exported — the
 * v9.8 wire-up routes the legend container's exit through `hideSubtagTooltip`
 * directly (its own scheduleExit timer drives the grace period).
 */
function scheduleSubtagTooltipHide(): void {
  if (!state) return;
  if (state.hideTimer) clearTimeout(state.hideTimer);
  state.hideTimer = setTimeout(() => hideSubtagTooltip(), HIDE_GRACE_MS);
}

/** Cancel a pending scheduled hide (e.g. cursor re-entered legend item). */
export function cancelSubtagTooltipHide(): void {
  if (!state?.hideTimer) return;
  clearTimeout(state.hideTimer);
  state.hideTimer = undefined;
}

/** True when the tooltip is currently visible. Exposed for tests. */
export function isSubtagTooltipVisible(): boolean {
  return state !== null;
}

function renderTooltipDom(
  el: HTMLDivElement,
  parentDisplayName: string,
  items: SubtagTooltipItem[],
): void {
  // Reset content
  el.textContent = '';
  el.classList.add(TOOLTIP_CLASS);

  const heading = document.createElement('div');
  heading.className = 'di-subtag-tooltip-heading';
  heading.textContent = parentDisplayName;
  el.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'di-subtag-tooltip-list';
  el.appendChild(list);

  for (const item of items) {
    // Anchor when an href is present (regular sub-tag or the Others row
    // pointing at `<parent> chartags:1` / `copytags:1`). Fall back to
    // span only when href is empty (defensive — legacy callers).
    const useAnchor = item.href !== '';
    const row = useAnchor
      ? document.createElement('a')
      : document.createElement('span');
    row.className =
      'di-subtag-tooltip-item' +
      (item.isOther ? ' di-subtag-tooltip-item--other' : '');
    // Native browser tooltip — surfaces the full tag name when the
    // displayName is truncated with an ellipsis (e.g. long subs like
    // `antonio salieri (second ascension)`). Matches the legend row's
    // `title=` pattern in renderPieLegend.
    row.title = item.displayName;

    if (useAnchor && row instanceof HTMLAnchorElement) {
      row.href = item.href;
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
    }

    const name = document.createElement('span');
    name.className = 'di-subtag-tooltip-item-name';
    name.textContent = item.displayName;

    const share = document.createElement('span');
    share.className = 'di-subtag-tooltip-item-share';
    share.textContent = `${(item.share * 100).toFixed(1)}%`;

    const count = document.createElement('span');
    count.className = 'di-subtag-tooltip-item-count';
    count.textContent = item.count.toLocaleString();

    row.appendChild(name);
    row.appendChild(share);
    row.appendChild(count);
    list.appendChild(row);
  }
}

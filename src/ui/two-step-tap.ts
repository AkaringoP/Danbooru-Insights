/**
 * Shared two-step tap utility for mobile touch interactions.
 *
 * Pattern: first tap → preview (tooltip/highlight), second tap → navigate.
 * Used by tag cloud, pie chart, and CalHeatmap widgets.
 */

/** Detect touch-capable device. Shared across all widgets. */
export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Detects an intentional "tap" (touchstart + touchend on roughly the same
 * spot, within a short time) — distinct from a scroll/swipe.
 *
 * Why we can't just use the synthetic `click` event for tap detection:
 * after a tap the browser dispatches `mouseover`/`mousedown`/`mouseup`/
 * `click` at the touch endpoint. If the widget showed a tooltip on
 * `touchstart` under the finger, the synthetic `click` lands on the
 * tooltip immediately and would trigger any tooltip click handler — the
 * user perceives "one tap, two actions". TapTracker forces both the
 * preview gesture and the navigation gesture to require a complete,
 * unmoved tap on each respective element.
 *
 * Thresholds: 10 px move budget, 600 ms time budget — typical iOS/Android
 * tap detection values, generous enough for shaky thumbs without
 * swallowing real swipes.
 */
export class TapTracker {
  // 15 px is forgiving enough for natural finger drift on touch (Material
  // Design uses ~12 dp ≈ 18 px on retina, Apple ~10 pt ≈ 20 px). 10 px was
  // too tight and silently rejected legitimate taps.
  private static readonly MOVE_THRESHOLD_PX = 15;
  private static readonly TIME_THRESHOLD_MS = 600;
  private start: {x: number; y: number; time: number} | null = null;

  /** Record the touch start. Resets any previous in-flight tap. */
  onTouchStart(event: TouchEvent): void {
    const t = event.touches[0];
    this.start = t ? {x: t.clientX, y: t.clientY, time: Date.now()} : null;
  }

  /** Cancel the in-flight tap if the finger has moved past the threshold. */
  onTouchMove(event: TouchEvent): void {
    if (!this.start) return;
    const t = event.touches[0];
    if (!t) return;
    if (
      Math.abs(t.clientX - this.start.x) > TapTracker.MOVE_THRESHOLD_PX ||
      Math.abs(t.clientY - this.start.y) > TapTracker.MOVE_THRESHOLD_PX
    ) {
      this.start = null;
    }
  }

  /**
   * Returns true iff this touch sequence qualifies as a tap (start was
   * recorded, end is within both thresholds). Always clears the in-flight
   * state.
   */
  onTouchEnd(event: TouchEvent): boolean {
    const start = this.start;
    this.start = null;
    if (!start) return false;
    const t = event.changedTouches[0];
    if (!t) return false;
    const dx = Math.abs(t.clientX - start.x);
    const dy = Math.abs(t.clientY - start.y);
    const dt = Date.now() - start.time;
    return (
      dx <= TapTracker.MOVE_THRESHOLD_PX &&
      dy <= TapTracker.MOVE_THRESHOLD_PX &&
      dt <= TapTracker.TIME_THRESHOLD_MS
    );
  }

  /** True if a touch sequence is currently in flight. */
  get isTracking(): boolean {
    return this.start !== null;
  }
}

export interface TwoStepTapOptions<T> {
  /**
   * Elements that constitute "inside" — taps outside all of these reset state.
   * Evaluated lazily (function) because elements may not exist at creation time.
   */
  insideElements: () => (Element | null)[];
  /** Called on first tap (or switch to different datum). Show tooltip/highlight. */
  onFirstTap: (datum: T) => void;
  /** Called on second tap (same datum) or navigateActive(). Navigate. */
  onSecondTap: (datum: T) => void;
  /** Called when state resets (outside tap, scroll). Hide tooltip/highlight. */
  onReset: () => void;
  /** Also reset on window scroll. Default: false. */
  resetOnScroll?: boolean;
  /** Custom equality check. Default: strict reference equality (===). */
  isEqual?: (a: T, b: T) => boolean;
  /**
   * If false, a second tap on the same datum is a no-op (preview persists)
   * — navigation must come exclusively from `navigateActive()` (typically a
   * tooltip click). Default: true (existing two-step behavior).
   *
   * Used by widgets that want "tap element → preview, tap tooltip →
   * navigate" semantics with no double-tap-to-navigate fallback on the
   * element itself.
   */
  navigateOnSameTap?: boolean;
}

export interface TwoStepTapController<T> {
  /**
   * Report a tap on a datum.
   * - If datum equals the active datum → fires onSecondTap, returns true.
   * - Otherwise → sets as active, fires onFirstTap, returns false.
   *
   * When switching from one datum to another, only onFirstTap is called
   * (no intermediate onReset) — the widget's onFirstTap handler is
   * responsible for resetting previous visual state if needed.
   */
  tap(datum: T): boolean;
  /**
   * Trigger navigation using the currently active datum.
   * Used by tooltip-click patterns (pie chart, CalHeatmap).
   * Returns false if no active datum.
   */
  navigateActive(): boolean;
  /** The currently active datum, or null. */
  readonly active: T | null;
  /** Reset state. Fires onReset if there was an active datum. */
  reset(): void;
  /** Remove all event listeners. */
  destroy(): void;
}

/**
 * Creates a two-step tap controller for mobile touch interactions.
 *
 * The controller manages active-datum state and outside-tap detection.
 * The widget is responsible for attaching its own event handlers and
 * calling `tap()` / `navigateActive()` at the appropriate times.
 */
export function createTwoStepTap<T>(
  options: TwoStepTapOptions<T>,
): TwoStepTapController<T> {
  let activeDatum: T | null = null;
  const eq = options.isEqual ?? ((a: T, b: T) => a === b);

  const reset = () => {
    if (activeDatum !== null) {
      activeDatum = null;
      options.onReset();
    }
  };

  const outsideTapHandler = (e: Event) => {
    if (activeDatum === null) return;
    const inside = options.insideElements();
    const target = e.target as Node;
    if (inside.some(el => el?.contains(target))) return;
    reset();
  };

  // Register outside-tap detection on document.
  // Both touchstart (responsive on mobile) and click (fallback for non-touch).
  // Reset is idempotent so double-fire is harmless.
  document.addEventListener('touchstart', outsideTapHandler, {passive: true});
  document.addEventListener('click', outsideTapHandler);

  let scrollHandler: (() => void) | null = null;
  if (options.resetOnScroll) {
    scrollHandler = () => reset();
    window.addEventListener('scroll', scrollHandler, {passive: true});
  }

  return {
    tap(datum: T): boolean {
      if (activeDatum !== null && eq(activeDatum, datum)) {
        if (options.navigateOnSameTap === false) {
          // Same datum re-tap is a no-op; preview persists. Navigation
          // must come from navigateActive() (typically a tooltip click).
          return false;
        }
        // Second tap on same element → navigate
        const d = activeDatum;
        activeDatum = null;
        options.onSecondTap(d);
        return true;
      }
      // First tap or switch to different element
      activeDatum = datum;
      options.onFirstTap(datum);
      return false;
    },

    navigateActive(): boolean {
      if (activeDatum === null) return false;
      const d = activeDatum;
      activeDatum = null;
      options.onSecondTap(d);
      return true;
    },

    get active() {
      return activeDatum;
    },

    reset,

    destroy() {
      document.removeEventListener('touchstart', outsideTapHandler);
      document.removeEventListener('click', outsideTapHandler);
      if (scrollHandler) {
        window.removeEventListener('scroll', scrollHandler);
      }
      activeDatum = null;
    },
  };
}

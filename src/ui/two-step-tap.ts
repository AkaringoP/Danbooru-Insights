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

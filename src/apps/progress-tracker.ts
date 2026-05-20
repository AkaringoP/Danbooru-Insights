/**
 * Loading-spinner progress reporting types and helpers.
 *
 * Used by both `UserAnalyticsApp` and `TagAnalyticsApp` to surface what
 * the data layer is currently doing while the dashboard loads. Without
 * this, the spinner shows a static "Analyzing contributions and trends"
 * message — fine when loads were ~1-2 s, surprisingly long after v9.6's
 * count-cache TTL added 5-15 s stale-refresh paths.
 *
 * Design:
 *   - The orchestration layer (`user-analytics-data.ts`,
 *     `tag-analytics-app.ts`) wraps each known phase with a
 *     `PhaseTracker`, which formats the high-level label as
 *     `"<phase> · <done>/<total>"`.
 *   - Each tracker also exposes a `subStatus` callback compatible with
 *     the existing `reportSubStatus: (msg: string) => void` signature
 *     that every distribution method already accepts. No signature
 *     changes in the data layer.
 *   - The spinner consumes a flat `ProgressState` of `{label, detail?}`
 *     — last-wins. Phases that emit concurrently flicker the label
 *     between counters; that's intentional, it tells the user multiple
 *     things are in flight.
 */

/** Snapshot of the loading spinner UI state. */
export interface ProgressState {
  /** High-level phase label, e.g. `"Distributions · 5/9"`. */
  label: string;
  /**
   * Optional low-level detail emitted by the data layer's
   * `reportSubStatus` calls, e.g. `"Fetching Count: identity_v"`.
   */
  detail?: string;
}

/** Callback shape every loading flow expects. */
export type ReportProgress = (state: ProgressState) => void;

/** A handle to one phase's progress tracking. */
export interface PhaseTracker {
  /**
   * Pass to a data-layer method that takes `reportSubStatus`. Emits
   * detail-line updates without changing the phase counter.
   */
  readonly subStatus: (msg: string) => void;
  /** Increments the completed counter by one and re-emits the label. */
  step(): void;
  /** Marks the phase fully complete (sets `done = total`). */
  finish(): void;
}

/**
 * Builds a `PhaseTracker` for a named phase with a known total step
 * count. Emits the initial `"<label> · 0/<total>"` so the spinner shows
 * the phase immediately, then updates as steps complete.
 */
export function createPhaseTracker(
  label: string,
  total: number,
  report: ReportProgress,
): PhaseTracker {
  let done = 0;
  const fmt = () => `${label} · ${done}/${total}`;
  // Initial emit so the phase appears the moment the tracker exists.
  report({label: fmt()});
  return {
    subStatus: (msg: string) => report({label: fmt(), detail: msg}),
    step: () => {
      done++;
      report({label: fmt()});
    },
    finish: () => {
      done = total;
      report({label: fmt()});
    },
  };
}

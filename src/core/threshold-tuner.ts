/**
 * Threshold auto-tuning logic for the contribution graph.
 *
 * Given a user's recent activity, computes percentile-based thresholds
 * (L1 fixed at 1, L2/L3/L4 from P40/P70/P90 of active-day counts) and
 * decides whether auto-tuning would meaningfully change the heatmap
 * distribution.
 *
 * All compute functions are pure; the only impure surface is
 * `fetchActiveDayCounts` (Dexie read) and the in-memory dismiss set.
 */

import type {Database} from './database';
import type {Metric, ScheduleInterval, Threshold4} from '../types';

/** Window for activity sampling (days back from today). */
const WINDOW_DAYS = 180;

/** Minimum active-day samples required to compute thresholds. */
export const MIN_ACTIVE_DAYS = 14;

/** Saturate detection threshold — fraction of active days at L1 or L4. */
const SATURATION_RATIO = 0.9;

/** Simulation guard — minimum drop in max-bucket concentration. */
const MIN_IMPROVEMENT = 0.2;

/**
 * Computes auto-tuned thresholds from active-day counts.
 *
 * Returns null when sample size is below `minSamples` — caller should
 * keep the existing thresholds in that case.
 */
export function computeAutoThresholds(
  samples: number[],
  minSamples: number = MIN_ACTIVE_DAYS,
): Threshold4 | null {
  if (samples.length < minSamples) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const vals: Threshold4 = [
    1,
    nearestRank(sorted, 40),
    nearestRank(sorted, 70),
    nearestRank(sorted, 90),
  ];

  for (let i = 1; i < vals.length; i++) {
    if (vals[i] <= vals[i - 1]) vals[i] = vals[i - 1] + 1;
  }
  return vals;
}

function nearestRank(sorted: number[], percentile: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const idx = Math.max(0, Math.ceil((percentile / 100) * n) - 1);
  return sorted[idx];
}

/**
 * Reads the user's active-day counts from IndexedDB for the last N days.
 * Returns only counts where `count > 0`.
 */
export async function fetchActiveDayCounts(
  db: Database,
  userId: string,
  metric: Metric,
  days: number = WINDOW_DAYS,
): Promise<number[]> {
  const cutoff = isoDateDaysAgo(days);
  const rows = await db[metric]
    .where('userId')
    .equals(userId)
    .and(r => r.date >= cutoff && r.count > 0)
    .toArray();
  return rows.map(r => r.count);
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Distribution of counts across heatmap buckets. */
export interface LevelDistribution {
  empty: number;
  l1: number;
  l2: number;
  l3: number;
  l4: number;
}

/**
 * Distributes counts across the 5 heatmap buckets using the same mapping
 * as graph-renderer.ts:2118 — `count < t[0]` → empty, `t[0] <= c < t[1]`
 * → L1, etc.
 */
export function simulateDistribution(
  counts: number[],
  thresholds: Threshold4,
): LevelDistribution {
  const dist: LevelDistribution = {empty: 0, l1: 0, l2: 0, l3: 0, l4: 0};
  const [t1, t2, t3, t4] = thresholds;
  for (const c of counts) {
    if (c < t1) dist.empty++;
    else if (c < t2) dist.l1++;
    else if (c < t3) dist.l2++;
    else if (c < t4) dist.l3++;
    else dist.l4++;
  }
  return dist;
}

function maxBucketRatio(dist: LevelDistribution): number {
  const buckets = [dist.empty, dist.l1, dist.l2, dist.l3, dist.l4];
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return Math.max(...buckets) / total;
}

/**
 * True if applying `proposed` would reduce max-bucket concentration by
 * at least `minImprovement` compared to `current`. Catches the "would
 * tuning even change anything?" question — a flat-activity user gets
 * the same saturated visual after any tuning, so we shouldn't prompt.
 */
export function wouldTuningImprove(
  counts: number[],
  current: Threshold4,
  proposed: Threshold4,
  minImprovement: number = MIN_IMPROVEMENT,
): boolean {
  const before = maxBucketRatio(simulateDistribution(counts, current));
  const after = maxBucketRatio(simulateDistribution(counts, proposed));
  return before - after >= minImprovement;
}

/** Saturation kind detected on the heatmap. */
export type SaturationKind = 'high' | 'low' | null;

/**
 * Detects whether active days cluster at L4 (high) or L1 (low) above
 * the given ratio. Returns null when distribution is reasonable.
 */
export function detectSaturation(
  counts: number[],
  thresholds: Threshold4,
  ratio: number = SATURATION_RATIO,
): SaturationKind {
  const total = counts.length;
  if (total === 0) return null;
  let hi = 0;
  let lo = 0;
  for (const c of counts) {
    if (c >= thresholds[3]) hi++;
    else if (c >= thresholds[0] && c < thresholds[1]) lo++;
  }
  if (hi / total >= ratio) return 'high';
  if (lo / total >= ratio) return 'low';
  return null;
}

/**
 * Returns the most recent period-boundary date (00:00 local time, on the
 * 1st of the relevant period) at or before `now`. The scheduler treats
 * a profile as "handled this period" if its last tune timestamp is at or
 * after this boundary.
 *
 *   monthly    → 1st of the current month
 *   quarterly  → 1st of the current quarter (Jan / Apr / Jul / Oct)
 *   semiannual → 1st of Jan or Jul, whichever was most recent
 *   yearly     → 1st of Jan of the current year
 */
export function mostRecentBoundary(
  now: Date,
  interval: ScheduleInterval,
): Date {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed
  let boundaryMonth = 0;
  switch (interval) {
    case 'monthly':
      boundaryMonth = m;
      break;
    case 'quarterly':
      boundaryMonth = Math.floor(m / 3) * 3;
      break;
    case 'semiannual':
      boundaryMonth = m < 6 ? 0 : 6;
      break;
    case 'yearly':
      boundaryMonth = 0;
      break;
  }
  return new Date(y, boundaryMonth, 1, 0, 0, 0, 0);
}

const dismissedThisSession = new Set<string>();

/** Marks a profile as dismissed for the current page session. */
export function dismissSuggestion(userId: string): void {
  dismissedThisSession.add(userId);
}

/** True if the user already dismissed the suggestion this session. */
export function wasDismissed(userId: string): boolean {
  return dismissedThisSession.has(userId);
}

/** Test-only: clear the in-memory dismiss set. */
export function _resetDismissedForTests(): void {
  dismissedThisSession.clear();
}

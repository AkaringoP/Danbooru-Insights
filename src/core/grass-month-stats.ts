/**
 * Pure per-month statistics for the grass month-label hover popover.
 *
 * All functions here are DOM- and network-free: they operate on a single
 * year's `daily` map (the same `Record<YYYY-MM-DD, count>` the heatmap was
 * painted from) so the popover can render synchronously with zero extra
 * API/DB calls. See PLAN.md §4 for the stat definitions.
 */

import {Metric, MonthStats} from '../types';

/** Full month names, index 0 = January. */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Human-readable header label for a metric. */
export function metricLabel(metric: Metric): string {
  switch (metric) {
    case 'uploads':
      return 'Uploads';
    case 'approvals':
      return 'Approvals';
    case 'notes':
      return 'Notes';
    default:
      return metric;
  }
}

/** Full month name for a 0-indexed month (out-of-range → ''). */
export function monthLongName(month: number): string {
  return MONTH_NAMES[month] ?? '';
}

/** Zero-padded `YYYY-MM-` prefix for a year + 0-indexed month. */
function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-`;
}

/** Sum of the daily counts whose date key starts with `prefix`. */
function sumMonth(daily: Record<string, number>, prefix: string): number {
  let total = 0;
  for (const [date, count] of Object.entries(daily)) {
    if (date.startsWith(prefix)) total += count;
  }
  return total;
}

/**
 * Calendar-day denominator for the ratio/average:
 * - future month  → 0 (no data yet)
 * - in-progress   → days elapsed (today's date-of-month)
 * - past month    → full days in the month
 */
function denominatorDaysFor(year: number, month: number, today: Date): number {
  const todayY = today.getFullYear();
  const todayM = today.getMonth();
  if (year > todayY || (year === todayY && month > todayM)) return 0;
  // `new Date(year, month + 1, 0).getDate()` = last day of the month.
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (year === todayY && month === todayM) {
    // Clamp defensively; today's date is always ≤ daysInMonth.
    return Math.min(today.getDate(), daysInMonth);
  }
  return daysInMonth;
}

/**
 * Per-day counts for the popover's sparkline, index 0 = the 1st.
 *
 * Sized to the days that have actually happened: a future month draws
 * nothing, and the in-progress month stops at the elapsed day rather than
 * trailing a run of zeroes that only mean "hasn't happened yet". It extends
 * past that day when a bucket carries activity beyond it — the daily keys
 * lean UTC, so a user behind it can already have tomorrow's bucket, the same
 * skew `denominatorDays` clamps for.
 *
 * @param daily The year's date→count map.
 * @param year Full year of the month.
 * @param month 0-indexed month.
 * @param today Reference "now".
 * @param denominatorDays The (already clamped) elapsed-day count.
 */
function buildSeries(
  daily: Record<string, number>,
  year: number,
  month: number,
  today: Date,
  denominatorDays: number,
): number[] {
  if (denominatorDaysFor(year, month, today) === 0) return [];

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prefix = monthPrefix(year, month);
  const dayCounts = new Array<number>(daysInMonth).fill(0);
  let lastDayWithData = 0;

  for (const [date, count] of Object.entries(daily)) {
    if (!date.startsWith(prefix)) continue;
    const day = parseInt(date.slice(8, 10), 10);
    if (!(day >= 1 && day <= daysInMonth)) continue;
    dayCounts[day - 1] = count;
    if (count > 0) lastDayWithData = Math.max(lastDayWithData, day);
  }

  const days = Math.min(
    daysInMonth,
    Math.max(denominatorDays, lastDayWithData),
  );
  return dayCounts.slice(0, days);
}

/**
 * Per-month totals across the year, index 0 = January.
 *
 * Sized the same way {@link buildSeries} sizes its days: a finished year gets
 * all twelve, the current one stops at the month in progress rather than
 * trailing months that have not arrived. It extends past that when a later
 * month carries activity, so a future-dated bucket is never silently dropped.
 *
 * @param daily The year's date→count map.
 * @param year Full year being summarised.
 * @param today Reference "now".
 */
function buildYearSeries(
  daily: Record<string, number>,
  year: number,
  today: Date,
): number[] {
  if (year > today.getFullYear()) return [];

  const totals = new Array<number>(12).fill(0);
  let lastMonthWithData = -1;

  for (const [date, count] of Object.entries(daily)) {
    if (!date.startsWith(`${year}-`)) continue;
    const index = parseInt(date.slice(5, 7), 10) - 1;
    if (!(index >= 0 && index <= 11)) continue;
    totals[index] += count;
    if (count > 0) lastMonthWithData = Math.max(lastMonthWithData, index);
  }

  const elapsed = year === today.getFullYear() ? today.getMonth() + 1 : 12;
  const months = Math.min(12, Math.max(elapsed, lastMonthWithData + 1));
  return totals.slice(0, months);
}

/**
 * Computes the month summary shown in the grass month popover.
 * @param daily A single year's date→count map (the popover's whole data source).
 * @param year Full year of the hovered label.
 * @param month 0-indexed month of the hovered label.
 * @param opts.today Reference "now" (injected for deterministic tests).
 * @param opts.metric The metric the heatmap is currently showing.
 */
export function computeMonthStats(
  daily: Record<string, number>,
  year: number,
  month: number,
  opts: {today: Date; metric: Metric},
): MonthStats {
  const {today, metric} = opts;
  const prefix = monthPrefix(year, month);
  let denominatorDays = denominatorDaysFor(year, month, today);

  let total = 0;
  let activeDays = 0;
  let busiest: {date: string; count: number} | null = null;

  for (const [date, count] of Object.entries(daily)) {
    if (!date.startsWith(prefix)) continue;
    total += count;
    if (count > 0) {
      activeDays += 1;
      // Ties break toward the earliest date: only replace on a strict max,
      // and prefer the earlier key when counts are equal.
      if (
        busiest === null ||
        count > busiest.count ||
        (count === busiest.count && date < busiest.date)
      ) {
        busiest = {date, count};
      }
    }
  }

  // The denominator is local-`today`-based while the daily keys come from the
  // data pipeline (UTC-leaning). A user ahead of UTC can already have a
  // "tomorrow" key in the in-progress month, so activeDays could exceed the
  // elapsed-day count — clamp so the ratio never reads e.g. "16 / 15 days".
  denominatorDays = Math.max(denominatorDays, activeDays);

  const series = buildSeries(daily, year, month, today, denominatorDays);
  const yearSeries = buildYearSeries(daily, year, today);

  const activeRatio = denominatorDays > 0 ? activeDays / denominatorDays : 0;
  const average =
    denominatorDays > 0 ? Math.round((total / denominatorDays) * 10) / 10 : 0;

  // Month-over-month vs the previous month — only when the previous month is
  // in the same (in-memory) year. January's previous month is last December,
  // which is not loaded, so it stays null (D-JAN: shown as total only).
  let momPct: number | null = null;
  let momIsNew = false;
  if (month > 0) {
    const prevTotal = sumMonth(daily, monthPrefix(year, month - 1));
    if (prevTotal > 0) {
      momPct = Math.round(((total - prevTotal) / prevTotal) * 100);
    } else if (total > 0) {
      momIsNew = true; // 0 → something: avoid divide-by-zero, badge "new".
    }
  }

  return {
    year,
    month,
    metric,
    total,
    activeDays,
    denominatorDays,
    activeRatio,
    busiest,
    average,
    momPct,
    momIsNew,
    empty: total === 0,
    series,
    yearSeries,
  };
}

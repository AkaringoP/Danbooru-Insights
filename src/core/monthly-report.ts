/**
 * Pure helpers for a tag's monthly post history from Danbooru's reports
 * (`/reports/posts.json` with `search[period]=month`): one request for the
 * whole history instead of one count per month (TASK.md T-301, PLAN.md 4.2).
 *
 * What the server does (danbooru/danbooru `production`,
 * `ReportsController#show` and `Aggregatable#timeseries`):
 * - The reply is an array of rows `{date: "YYYY-MM-DD", posts: n}`, newest
 *   month first. Every month between `from` and `to` has a row: months
 *   without posts come back as 0 (`generate_series` + `COALESCE`).
 * - Months are UTC calendar months (`date_trunc('month', created_at)`).
 * - `from` and `to` are cut to dates and compared with `BETWEEN`, so `to`
 *   counts only up to 00:00 of that day. That is why the default `to` is a
 *   couple of days ahead: today's posts must fall inside it. The month the
 *   margin reaches into can come back as a future bucket, which
 *   {@link trimMonthlyCounts} drops.
 * - A range split in two meets at one instant (the shared date's 00:00), so
 *   the month containing the split is reported partly by each half; adding
 *   the halves ({@link mergeMonthlyCounts}) gives the month back.
 *
 * No network here: the data service (T-302) sends the request through the
 * shared rate limiter, where `/reports/` has its own lane.
 */
import type {HistoryEntry} from '../types';

/** Posts per UTC month, keyed `YYYY-MM`. */
export type MonthlyCounts = Map<string, number>;

/** Earliest `from` worth asking for: Danbooru's first posts are from 2005. */
export const MONTHLY_REPORT_FROM = '2005-01-01';

/** Days past today (UTC) that the default `to` reaches; see the module doc. */
const MONTHLY_REPORT_TO_MARGIN_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A reply that is not the list of month rows we asked for. */
export class MonthlyReportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonthlyReportFormatError';
  }
}

/** `YYYY-MM-DD` of `date` in UTC. */
export function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM` of `date` in UTC. */
function utcMonthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * The default `to`: today (UTC) plus {@link MONTHLY_REPORT_TO_MARGIN_DAYS},
 * so that today's posts fall inside the range.
 */
export function defaultReportTo(now: Date = new Date()): string {
  return utcDateString(
    new Date(now.getTime() + MONTHLY_REPORT_TO_MARGIN_DAYS * DAY_MS),
  );
}

/**
 * The reports URL for `tagName`'s monthly history. `status:any` so deleted
 * posts count, as on the tag's own post count; it is a free metatag, so the
 * search stays at one term for any viewer.
 *
 * @param range `from` / `to` as `YYYY-MM-DD`; default from
 *     {@link MONTHLY_REPORT_FROM} to today (UTC) plus
 *     {@link MONTHLY_REPORT_TO_MARGIN_DAYS}.
 */
export function buildMonthlyReportUrl(
  tagName: string,
  range: {from?: string; to?: string} = {},
  now: Date = new Date(),
): string {
  const params = new URLSearchParams({
    'search[tags]': `${tagName} status:any`,
    'search[period]': 'month',
    'search[from]': range.from ?? MONTHLY_REPORT_FROM,
    'search[to]': range.to ?? defaultReportTo(now),
  });
  return `/reports/posts.json?${params.toString()}`;
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])(?:-|$)/;

/**
 * Reads a monthly report reply into posts per month.
 *
 * Throws {@link MonthlyReportFormatError} on anything but an array of rows
 * with a dated `date` and a whole, non-negative `posts`. One bad row fails
 * the whole reply rather than leaving its month out: a missing month would
 * later read as a month without posts, a wrong 0 (decision G-4).
 */
export function parseMonthlyReport(body: unknown): MonthlyCounts {
  if (!Array.isArray(body)) {
    throw new MonthlyReportFormatError('Monthly report is not a list');
  }
  const counts: MonthlyCounts = new Map();
  for (const row of body as unknown[]) {
    const {date, posts} = (row ?? {}) as {date?: unknown; posts?: unknown};
    const month = typeof date === 'string' ? MONTH_KEY.exec(date) : null;
    if (!month) {
      throw new MonthlyReportFormatError(
        `Monthly report row without a date: ${JSON.stringify(row)}`,
      );
    }
    if (typeof posts !== 'number' || !Number.isInteger(posts) || posts < 0) {
      throw new MonthlyReportFormatError(
        `Monthly report row without a post count: ${JSON.stringify(row)}`,
      );
    }
    const key = `${month[1]}-${month[2]}`;
    counts.set(key, (counts.get(key) ?? 0) + posts);
  }
  return counts;
}

/**
 * Adds up the replies for parts of one range (layer 2 of T-302, which halves
 * a range the server could not finish). The month a split falls in is
 * reported partly by each part, so the same month is summed, never replaced
 * (PLAN.md N-02).
 */
export function mergeMonthlyCounts(parts: MonthlyCounts[]): MonthlyCounts {
  const merged: MonthlyCounts = new Map();
  for (const part of parts) {
    for (const [month, posts] of part) {
      merged.set(month, (merged.get(month) ?? 0) + posts);
    }
  }
  return merged;
}

/** The `YYYY-MM` after `month`. */
function nextMonthKey(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12
    ? `${year + 1}-01`
    : `${year}-${String(m + 1).padStart(2, '0')}`;
}

/** Months since year 0 for a `YYYY-MM…` string, to count and step months. */
function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

/** `YYYY-MM-01` of a {@link monthIndex}. */
function monthStart(index: number): string {
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * `YYYY-MM-01` of the UTC month an instant falls in (the history bar a
 * post belongs to), or null when `timestamp` cannot be read.
 */
export function utcMonthStartOf(timestamp: string): string | null {
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return null;
  return `${new Date(t).toISOString().slice(0, 7)}-01`;
}

/**
 * The post search a history bar opens: `tagName`'s posts in the UTC month
 * starting `month` (`YYYY-MM-01`). The bounds are explicit UTC instants:
 * a bare date would be read in the viewer's Danbooru time zone
 * (`Time.zone.parse`) and open a different month than the bar counts.
 * `a...b` excludes `b`. Built from the string alone, so the browser's time
 * zone cannot shift it either.
 */
export function monthPostsQuery(tagName: string, month: string): string {
  const start = `${month.slice(0, 7)}-01`;
  const next = monthStart(monthIndex(month) + 1);
  return `${tagName} date:${start}T00:00:00Z...${next}T00:00:00Z`;
}

/** Every `YYYY-MM` from `from` to `to`, both included (empty if reversed). */
export function monthKeysBetween(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = nextMonthKey(m)) {
    keys.push(m);
  }
  return keys;
}

/**
 * Where to halve a report range the server could not finish in time
 * (layer 2 of T-302): the first day of the month in the middle, or null
 * when either half would cover fewer than `minMonths` months — the
 * smallest piece worth asking for on its own.
 *
 * The halves are `[from, mid]` and `[mid, to]`: they meet at 00:00 of
 * `mid`, and {@link mergeMonthlyCounts} adds up the month that falls in.
 */
export function splitReportRange(
  from: string,
  to: string,
  minMonths: number,
): string | null {
  const first = monthIndex(from);
  const months = monthIndex(to) - first + 1;
  const half = Math.floor(months / 2);
  if (half < minMonths || months - half < minMonths) return null;
  return monthStart(first + half);
}

/**
 * The history the chart shows: one entry per month, in order, from the
 * tag's first month with posts to the last month asked for (at most the
 * current UTC month), with a running total.
 *
 * - Months before the first one with posts are dropped (the request starts
 *   in 2005 for every tag).
 * - Months after the current UTC month are dropped (the `to` margin).
 * - Months without posts in between, and up to the last month asked for,
 *   stay as 0. The server sends them as 0; one missing in between is
 *   filled with 0 too, so the chart always gets consecutive months.
 *
 * A tag without posts gives an empty history.
 */
export function trimMonthlyCounts(
  counts: MonthlyCounts,
  now: Date = new Date(),
): HistoryEntry[] {
  const current = utcMonthKey(now);
  const months = [...counts.keys()].filter(m => m <= current).sort();
  const first = months.find(m => (counts.get(m) ?? 0) > 0);
  if (first === undefined) return [];
  const last = months[months.length - 1];

  const history: HistoryEntry[] = [];
  let cumulative = 0;
  for (let month = first; month <= last; month = nextMonthKey(month)) {
    const count = counts.get(month) ?? 0;
    cumulative += count;
    history.push({date: `${month}-01`, count, cumulative});
  }
  return history;
}

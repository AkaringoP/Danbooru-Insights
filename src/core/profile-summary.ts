/**
 * Pure builder for the dashboard's "At a glance" pane.
 *
 * The pane only says things the profile page and the neighbouring dashboard
 * cards do not already show as a single number: the recent uploads' health
 * graded against the user's own record, and how recent activity differs from
 * their usual (pace, focus, reception). No DOM, network or DB access — apps/
 * assembles a {@link ProfileSummaryInput} and ui/ renders the parts.
 */
import type {
  DanbooruPost,
  ProfileSummary,
  ProfileSummaryInput,
  ScatterDataPoint,
  SummaryFlag,
  SummaryPart,
  SummaryScope,
  SummarySeverity,
  SummaryTagCategory,
  TagShare,
  WindowPoint,
} from '../types';
import {
  ABANDONED_GAP_MS,
  MINTAG_MAX,
  SUSPICIOUS_SCORE_MAX,
} from './dashboard-preview';

const DAY = 86_400_000;

/** How many recent uploads the pane analyses. */
export const WINDOW_SIZE = 200;

// --- Health thresholds -------------------------------------------------------
/** Deletion share where a mid-level uploader (~25 slots) stops gaining slots. */
const DELETION_WARN = 0.1;
/** Deletion share where even a new uploader (≤15 slots) loses slots. */
const DELETION_BAD = 0.23;
/** Danbooru's moderation period: deletions inside it hold 5 upload slots. */
const EARLY_DELETE_MS = 3 * DAY;
/** General-tag count at/below which an upload is essentially untagged. */
const UNTAGGED_MAX = 3;
const UNTAGGED_BAD = 0.05;
const UNDERTAGGED_WARN = 0.2;
const UNDERTAGGED_BAD = 0.5;
/** Recent average general tags at/below this fraction of the usual → drift. */
const TAG_DRIFT = 0.7;
const DOWNVOTED_WARN = 0.1;
/** Smallest recent sample a health ratio is computed from. */
const MIN_HEALTH_SAMPLE = 10;

// --- Trend thresholds --------------------------------------------------------
/** Uploads younger than this are left out of score comparisons (unsettled). */
const SCORE_SETTLE_MS = 7 * DAY;
const SCORE_BELOW = 0.5;
const SCORE_ABOVE = 2;
const MIN_RECENT_SAMPLE = 20;
const MIN_EARLIER_SAMPLE = 50;
const DORMANT_MS = 180 * DAY;
const PACE_UP = 2;
const PACE_DOWN = 0.5;
/** Account must be this old before a 30-day vs 12-month pace is meaningful. */
const PACE_MIN_AGE_MS = 90 * DAY;
const STREAK_MIN = 7;
/** Burst = this many top days carry at least half of the last 90 days. */
const BURST_DAYS = 5;
const BURST_MIN_ACTIVE_DAYS = 8;
const FOCUS_SPREAD = 0.15;
const RECENT_SHIFT = 0.3;
const NEW_SERIES_MIN = 0.1;
const CHAR_SHIFT = 0.3;
const NSFW_DRIFT = 0.2;

const SEVERITY_RANK: Record<SummarySeverity, number> = {
  bad: 0,
  warn: 1,
  info: 2,
  good: 3,
};

// --- Small helpers -----------------------------------------------------------

/** "0.4%" under 1%, otherwise a whole percent. */
export function formatPct(ratio: number): string {
  const p = ratio * 100;
  if (p === 0) return '0%';
  return p < 1 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

/** UTC "YYYY-MM" — matches the USER HISTORY card's UTC dates. */
export function formatYearMonth(date: Date): string {
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${m}`;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Browser-local calendar day — "today" is the viewer's today. */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function displayTag(tag: string): string {
  return tag.replace(/_/g, ' ');
}

/** `/posts?tags=user:<name> <query>` search link. */
export function userSearchUrl(userName: string, query: string): string {
  const tags = query ? `user:${userName} ${query}` : `user:${userName}`;
  return `/posts?tags=${encodeURIComponent(tags)}`;
}

/** Fields the live recent-uploads fetch asks for. */
const RECENT_WINDOW_FIELDS =
  'id,created_at,score,tag_count_general,rating,is_pending,is_flagged,' +
  'is_deleted,is_banned,tag_string_copyright,tag_string_character';

/**
 * The live window request. No `status:` metatag — Danbooru's default post
 * search already includes deleted posts (verified 2026-10-18).
 */
export function buildRecentWindowUrl(userName: string, limit: number): string {
  return (
    `/posts.json?tags=${encodeURIComponent(`user:${userName}`)}` +
    `&limit=${limit}&only=${RECENT_WINDOW_FIELDS}`
  );
}

function splitTags(s: string | undefined): string[] | undefined {
  if (s === undefined) return undefined;
  return s.split(' ').filter(Boolean);
}

/** Live API post → window point. */
export function danbooruPostToWindowPoint(p: DanbooruPost): WindowPoint {
  return {
    id: p.id,
    ts: new Date(p.created_at).getTime(),
    del: p.is_deleted,
    ban: p.is_banned,
    pending: p.is_pending,
    flagged: p.is_flagged,
    score: p.score,
    gentags: p.tag_count_general ?? 0,
    rating: p.rating ?? '',
    copyrights: splitTags(p.tag_string_copyright),
    characters: splitTags(p.tag_string_character),
  };
}

/** Local scatter point → window point (live-only fields stay unknown). */
export function scatterPointToWindowPoint(p: ScatterDataPoint): WindowPoint {
  return {
    id: p.id,
    ts: p.d,
    del: p.del,
    ban: p.ban,
    score: p.s,
    gentags: p.t,
    rating: p.r,
  };
}

/** Newest `size` points by id (ids are monotonic in upload order). */
export function newestPoints(points: WindowPoint[], size: number) {
  return [...points].sort((a, b) => b.id - a.id).slice(0, size);
}

/** Token frequency over the points that carry the list (each post once). */
function tokenTally(
  points: WindowPoint[],
  pick: (p: WindowPoint) => string[] | undefined,
): {counts: Map<string, number>; n: number} {
  const counts = new Map<string, number>();
  let n = 0;
  for (const p of points) {
    const list = pick(p);
    if (!list) continue;
    n++;
    for (const t of new Set(list)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return {counts, n};
}

function ranked<K>(counts: Map<K, number>): Array<[K, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// --- Metrics -----------------------------------------------------------------

interface HealthMetrics {
  size: number;
  deletedRecent: number | null;
  deletedLife: number | null;
  earlyDeleted: number;
  tagSample: number;
  untagged: number;
  undertagged: number;
  tagAvgRecent: number | null;
  tagAvgEarlier: number | null;
  downvoted: number | null;
  banned: number;
  flagged: number | null;
  pending: number | null;
  /** Upload count the line talks about ("Last 200" / "Across all 46,734"). */
  label: number;
  /** Deleted uploads (remote count for lifetime, window count for recent). */
  deletedCount: number | null;
  /** Mean general tags over the tag population. */
  tagAvg: number | null;
  scope: SummaryScope;
}

/** Mean general tags, or null below `min` samples. */
function meanGentags(points: WindowPoint[], min: number): number | null {
  return points.length >= min ? mean(points.map(p => p.gentags)) : null;
}

/** Remote lifetime count when known, else counted from the known rows. */
function deletedCountOf(
  input: ProfileSummaryInput,
  known: WindowPoint[],
  lifetime: boolean,
  localDeleted: number | null,
): number | null {
  if (lifetime && input.lifetimeDeleted !== null) return input.lifetimeDeleted;
  return localDeleted === null ? null : known.filter(p => p.del).length;
}

/**
 * Banned / flagged / pending counts: the remote status counts when given
 * (lifetime view), else counted from the points — null when the points do
 * not carry the field (local fallback rows).
 */
function statusCounts(
  w: WindowPoint[],
  remote: ProfileSummaryInput['lifetimeStatus'],
): Pick<HealthMetrics, 'banned' | 'flagged' | 'pending'> {
  if (remote) return {...remote};
  const count = (f: (p: WindowPoint) => boolean | undefined) =>
    w.length > 0 && w.every(p => f(p) !== undefined)
      ? w.filter(p => f(p)).length
      : null;
  return {
    banned: w.filter(p => p.ban).length,
    flagged: count(p => p.flagged),
    pending: count(p => p.pending),
  };
}

/**
 * Health of the recent window (`recent`) or of every synced upload
 * (`lifetime`). Ratios use only rows where the field is known
 * (local points from before the metadata backfill lack `del`), and come back
 * null when unknown rows are the majority or the sample is too small.
 */
function deriveHealth(
  input: ProfileSummaryInput,
  earlier: WindowPoint[],
  now: number,
  scope: SummaryScope,
): HealthMetrics {
  const lifetime = scope === 'lifetime';
  // Lifetime health judges every synced upload; recent health the window.
  const w = lifetime ? input.lifetimePoints : input.window;
  const known = w.filter(p => p.del !== undefined);
  const localDeleted =
    known.length >= MIN_HEALTH_SAMPLE && known.length * 2 >= w.length
      ? known.filter(p => p.del).length / known.length
      : null;
  const deletedLife =
    input.lifetimeDeleted !== null && input.total > 0
      ? input.lifetimeDeleted / input.total
      : null;
  // Tag population: live (non-deleted) uploads past the tagging grace period.
  const isTagPop = (p: WindowPoint) => !p.del && now - p.ts >= ABANDONED_GAP_MS;
  const tagPop = w.filter(isTagPop);
  // Tag drift always compares the newest uploads with the earlier ones.
  const driftPop = input.window.filter(isTagPop);
  const earlierLive = earlier.filter(p => !p.del);
  const status = input.lifetimeStatus;
  const scored = w.filter(p => p.score !== undefined);
  const countIf = (pred: (p: WindowPoint) => boolean) => w.filter(pred).length;
  return {
    size: w.length,
    // Lifetime: the remote status count is authoritative (and the line has
    // nothing broader to compare it with, so deletedLife is dropped).
    deletedRecent: lifetime ? (deletedLife ?? localDeleted) : localDeleted,
    deletedLife: lifetime ? null : deletedLife,
    deletedCount: deletedCountOf(input, known, lifetime, localDeleted),
    tagAvg: meanGentags(tagPop, MIN_HEALTH_SAMPLE),
    earlyDeleted: countIf(p => !!p.del && now - p.ts < EARLY_DELETE_MS),
    tagSample: tagPop.length,
    untagged: tagPop.filter(p => p.gentags <= UNTAGGED_MAX).length,
    undertagged: tagPop.filter(p => p.gentags < MINTAG_MAX).length,
    tagAvgRecent: meanGentags(driftPop, MIN_RECENT_SAMPLE),
    tagAvgEarlier: meanGentags(earlierLive, MIN_EARLIER_SAMPLE),
    downvoted:
      scored.length >= MIN_HEALTH_SAMPLE
        ? scored.filter(p => (p.score ?? 0) <= SUSPICIOUS_SCORE_MAX).length /
          scored.length
        : null,
    ...statusCounts(w, lifetime ? status : null),
    label: lifetime ? Math.max(input.total, w.length) : w.length,
    scope,
  };
}

interface ActivityMetrics {
  lastUpload: number | null;
  pace30: number | null;
  count30: number;
  count365: number;
  streakNow: number;
  burstDays: number | null;
  /** Busiest calendar year, when there are at least two years of uploads. */
  peak: {year: number; count: number} | null;
}

function peakYear(times: number[]): {year: number; count: number} | null {
  const perYear = new Map<number, number>();
  for (const ts of times) {
    const y = new Date(ts).getFullYear();
    perYear.set(y, (perYear.get(y) ?? 0) + 1);
  }
  if (perYear.size < 2) return null;
  const [year, count] = ranked(perYear)[0];
  return count >= MIN_EARLIER_SAMPLE ? {year, count} : null;
}

/** Upload times from both sources — the local sync may lag the live window. */
function activityTimes(input: ProfileSummaryInput): number[] {
  const byId = new Map<number, number>();
  for (const p of input.lifetimePoints) byId.set(p.id, p.ts);
  for (const p of input.window) byId.set(p.id, p.ts);
  return [...byId.values()];
}

function currentStreak(days: Set<string>, now: number): number {
  let cursor = days.has(dayKey(now)) ? now : now - DAY;
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor -= DAY;
  }
  return streak;
}

/** Fewest days carrying half of the last 90 days' uploads, if bursty. */
function burstDayCount(times: number[], now: number): number | null {
  const perDay = new Map<string, number>();
  let total = 0;
  for (const ts of times) {
    if (now - ts > 90 * DAY) continue;
    perDay.set(dayKey(ts), (perDay.get(dayKey(ts)) ?? 0) + 1);
    total++;
  }
  if (total < MIN_RECENT_SAMPLE || perDay.size < BURST_MIN_ACTIVE_DAYS) {
    return null;
  }
  const sorted = [...perDay.values()].sort((a, b) => b - a);
  let acc = 0;
  for (let k = 0; k < sorted.length; k++) {
    acc += sorted[k];
    if (acc * 2 >= total) return k + 1 <= BURST_DAYS ? k + 1 : null;
  }
  return null;
}

/** Pace, streak and burstiness from upload timestamps. */
export function deriveActivity(
  input: ProfileSummaryInput,
  now: number,
): ActivityMetrics {
  const times = activityTimes(input);
  if (!times.length) {
    return {
      lastUpload: null,
      pace30: null,
      count30: 0,
      count365: 0,
      streakNow: 0,
      burstDays: null,
      peak: null,
    };
  }
  const first = input.firstUploadDate?.getTime() ?? Math.min(...times);
  const age = now - first;
  const count30 = times.filter(t => now - t <= 30 * DAY).length;
  const count365 = times.filter(t => now - t <= 365 * DAY).length;
  const span365 = Math.min(365, age / DAY);
  const pace30 =
    age >= PACE_MIN_AGE_MS && count365 >= MIN_RECENT_SAMPLE
      ? count30 / 30 / (count365 / span365)
      : null;
  return {
    lastUpload: Math.max(...times),
    pace30,
    count30,
    count365,
    streakNow: currentStreak(new Set(times.map(dayKey)), now),
    burstDays: burstDayCount(times, now),
    peak: peakYear(times),
  };
}

interface TrendMetrics {
  focusTop: string | null;
  focusShare: number;
  focusDistinct: number;
  newSeries: string[];
  charTop: string | null;
  charShare: number;
  medianRecent: number | null;
  medianEarlier: number | null;
  nsfwRecent: number | null;
  nsfwEarlier: number | null;
}

function scoreMedians(
  window: WindowPoint[],
  earlier: WindowPoint[],
  now: number,
): {recent: number | null; earlier: number | null} {
  const settled = (p: WindowPoint) =>
    !p.del && p.score !== undefined && now - p.ts >= SCORE_SETTLE_MS;
  const r = window.filter(settled).map(p => p.score ?? 0);
  const e = earlier.filter(settled).map(p => p.score ?? 0);
  return {
    recent: r.length >= MIN_RECENT_SAMPLE ? median(r) : null,
    earlier: e.length >= MIN_EARLIER_SAMPLE ? median(e) : null,
  };
}

function nsfwShare(points: WindowPoint[], min: number): number | null {
  const rated = points.filter(p => p.rating);
  if (rated.length < min) return null;
  return (
    rated.filter(p => p.rating === 'q' || p.rating === 'e').length /
    rated.length
  );
}

/** Recent focus, reception and rating vs the user's earlier uploads. */
function deriveTrend(
  input: ProfileSummaryInput,
  earlier: WindowPoint[],
  now: number,
): TrendMetrics {
  const copy = tokenTally(input.window, p => p.copyrights);
  const chars = tokenTally(input.window, p => p.characters);
  const copyRank = copy.n >= MIN_RECENT_SAMPLE ? ranked(copy.counts) : [];
  const charRank = chars.n >= MIN_RECENT_SAMPLE ? ranked(chars.counts) : [];
  const lifetimeTop = new Set(input.copyrightTop);
  const newSeries = copyRank
    .slice(0, 3)
    .filter(([tag, c]) => !lifetimeTop.has(tag) && c / copy.n >= NEW_SERIES_MIN)
    .map(([tag]) => tag);
  const medians = scoreMedians(input.window, earlier, now);
  return {
    focusTop: copyRank[0]?.[0] ?? null,
    focusShare: copyRank.length ? copyRank[0][1] / copy.n : 0,
    focusDistinct: copyRank.length,
    newSeries,
    charTop: charRank[0]?.[0] ?? null,
    charShare: charRank.length ? charRank[0][1] / chars.n : 0,
    medianRecent: medians.recent,
    medianEarlier: medians.earlier,
    nsfwRecent: nsfwShare(input.window, MIN_RECENT_SAMPLE),
    nsfwEarlier: nsfwShare(earlier, MIN_EARLIER_SAMPLE),
  };
}

// --- Health line -------------------------------------------------------------

function relationWord(recent: number, life: number): string {
  if (Math.abs(recent - life) <= Math.max(0.005, life * 0.25)) return 'around';
  return recent < life ? 'below' : 'above';
}

/** "above their lifetime 0.2%" for the recent view, else ''. */
function lifetimeCompare(h: HealthMetrics): string {
  if (h.deletedRecent === null || h.deletedLife === null) return '';
  const rel = relationWord(h.deletedRecent, h.deletedLife);
  return `${rel} their lifetime ${formatPct(h.deletedLife)}`;
}

function flag(
  id: string,
  severity: SummarySeverity,
  weight: number,
  part: SummaryPart,
): SummaryFlag {
  return {id, severity, weight, part: {...part, severity}};
}

function deletionFlags(h: HealthMetrics, name: string): SummaryFlag[] {
  const out: SummaryFlag[] = [];
  if (h.deletedRecent !== null && h.deletedRecent >= DELETION_WARN) {
    const bad = h.deletedRecent >= DELETION_BAD;
    out.push(
      flag('deleted-recent', bad ? 'bad' : 'warn', h.deletedRecent, {
        text: countWithPct(
          h.deletedCount ?? 0,
          'deleted',
          h.label,
          lifetimeCompare(h),
        ),
        href: userSearchUrl(name, 'status:deleted'),
        title: bad
          ? 'At this deletion rate even a new uploader loses upload slots'
          : 'At this deletion rate a mid-level uploader stops gaining upload slots',
      }),
    );
  }
  if (h.earlyDeleted > 0) {
    out.push(
      flag('early-deleted', 'warn', h.earlyDeleted / h.size, {
        text: `${h.earlyDeleted} deleted within 3 days of upload`,
        href: userSearchUrl(name, 'status:deleted age:<3d'),
        title: 'Each early deletion holds 5 upload slots for 3 days',
      }),
    );
  }
  return out;
}

function taggingFlags(h: HealthMetrics, name: string): SummaryFlag[] {
  const out: SummaryFlag[] = [];
  if (h.tagSample >= MIN_HEALTH_SAMPLE) {
    const un = h.untagged / h.tagSample;
    const under = h.undertagged / h.tagSample;
    if (un >= UNTAGGED_BAD) {
      out.push(
        flag('untagged-recent', 'bad', un, {
          text: `${h.untagged} still essentially untagged`,
          href: userSearchUrl(name, `gentags:<=${UNTAGGED_MAX}`),
          title: `≤${UNTAGGED_MAX} general tags, more than 15 minutes after upload`,
        }),
      );
    }
    if (under >= UNDERTAGGED_WARN) {
      out.push(
        flag(
          'undertagged-recent',
          under >= UNDERTAGGED_BAD ? 'bad' : 'warn',
          under,
          {
            text: `${formatPct(under)} still under-tagged`,
            href: userSearchUrl(name, `gentags:<${MINTAG_MAX}`),
            title: `Fewer than ${MINTAG_MAX} general tags`,
          },
        ),
      );
    }
  }
  const {tagAvgRecent: r, tagAvgEarlier: e} = h;
  if (r !== null && e !== null && e > 0 && r <= e * TAG_DRIFT) {
    out.push(
      flag('tag-drift', 'warn', 1 - r / e, {
        text: `tagging thinner than before (${e.toFixed(0)} → ${r.toFixed(0)} general tags per upload)`,
        href: userSearchUrl(name, `gentags:<${MINTAG_MAX}`),
      }),
    );
  }
  return out;
}

function statusFlags(h: HealthMetrics, name: string): SummaryFlag[] {
  const out: SummaryFlag[] = [];
  if (h.downvoted !== null && h.downvoted >= DOWNVOTED_WARN) {
    out.push(
      flag('downvoted-recent', 'warn', h.downvoted, {
        text: `${formatPct(h.downvoted)} heavily downvoted`,
        href: userSearchUrl(name, `score:<=${SUSPICIOUS_SCORE_MAX}`),
        title: `Score ${SUSPICIOUS_SCORE_MAX} or lower`,
      }),
    );
  }
  const counted: Array<
    [string, SummarySeverity, number | null, string, string]
  > = [
    ['banned-recent', 'bad', h.banned, 'banned', 'status:banned'],
    [
      'flagged-recent',
      'warn',
      h.flagged,
      'currently flagged',
      'status:flagged',
    ],
    [
      'pending-recent',
      'info',
      h.pending,
      'awaiting approval',
      'status:pending',
    ],
  ];
  for (const [id, severity, n, label, query] of counted) {
    if (!n) continue;
    out.push(
      flag(id, severity, n / h.size, {
        text: `${n} ${label}`,
        href: userSearchUrl(name, query),
      }),
    );
  }
  return out;
}

/** All recent-window flags, most severe (then most widespread) first. */
function buildFlags(h: HealthMetrics, name: string): SummaryFlag[] {
  return [
    ...deletionFlags(h, name),
    ...taggingFlags(h, name),
    ...statusFlags(h, name),
  ].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.weight - a.weight,
  );
}

/** Flags already spelled out by the always-on status breakdown. */
const STATUS_FLAG_IDS = new Set([
  'deleted-recent',
  'banned-recent',
  'pending-recent',
]);

/**
 * "285 banned (0.6%)" — count first, share of `of` (plus an optional note)
 * in one bracket; zero reads "none banned".
 */
function countWithPct(n: number, label: string, of: number, note = ''): string {
  if (n === 0) return note ? `none ${label} (${note})` : `none ${label}`;
  const bits = [of > 0 ? formatPct(n / of) : '', note].filter(Boolean);
  const bracket = bits.length ? ` (${bits.join(', ')})` : '';
  return `${n.toLocaleString('en-US')} ${label}${bracket}`;
}

/**
 * Always-on breakdown: deleted / banned / pending as "N (x%)" of the uploads
 * the line talks about, each linking to its search. Deleted takes its tone
 * from the deletion grade; banned is bad and pending info when non-zero.
 */
function statusBreakdown(
  h: HealthMetrics,
  flags: SummaryFlag[],
  name: string,
): SummaryPart[] {
  const tone = (id: string) => flags.find(f => f.id === id)?.severity;
  const out: SummaryPart[] = [];
  if (h.deletedCount !== null) {
    const text = countWithPct(
      h.deletedCount,
      'deleted',
      h.label,
      lifetimeCompare(h),
    );
    out.push(
      h.deletedCount
        ? {
            text,
            href: userSearchUrl(name, 'status:deleted'),
            severity: tone('deleted-recent'),
            title: flags.find(f => f.id === 'deleted-recent')?.part.title,
          }
        : {text},
    );
  }
  out.push(
    h.banned
      ? {
          text: countWithPct(h.banned, 'banned', h.label),
          href: userSearchUrl(name, 'status:banned'),
          severity: 'bad',
        }
      : {text: countWithPct(0, 'banned', h.label)},
  );
  if (h.pending !== null) {
    out.push(
      h.pending
        ? {
            text: countWithPct(h.pending, 'pending', h.label),
            href: userSearchUrl(name, 'status:pending'),
            severity: 'info',
          }
        : {text: countWithPct(0, 'pending', h.label)},
    );
  }
  return joinParts(out, ', ');
}

/** Tag state when no tagging flag fired: "all tagged" / "N thinly tagged". */
function tagNote(h: HealthMetrics): string | null {
  if (h.tagSample < MIN_HEALTH_SAMPLE) return null;
  const avg =
    h.tagAvg === null ? '' : ` (avg ${Math.round(h.tagAvg)} general tags)`;
  return h.undertagged
    ? `${countWithPct(h.undertagged, 'thinly tagged', h.tagSample)}${avg}`
    : `all tagged${avg}`;
}

function joinParts(parts: SummaryPart[], sep: string): SummaryPart[] {
  return parts.flatMap((p, i) => (i ? [{text: sep}, p] : [p]));
}

/**
 * Line-1 health: a head ("Last 200 uploads are clean —" in green, or
 * "Across all N uploads:"), the status breakdown, then either the tag note
 * or up to two other concerns (+N more in a title).
 */
function healthParts(
  h: HealthMetrics,
  flags: SummaryFlag[],
  name: string,
): {parts: SummaryPart[]; overflow: SummaryFlag[]} {
  if (h.size === 0) return {parts: [], overflow: []};
  const n = h.label.toLocaleString('en-US');
  const clean = !flags.some(f => f.severity !== 'info');
  const head: SummaryPart[] = clean
    ? [
        {
          text:
            h.scope === 'lifetime'
              ? `All ${n} uploads are clean`
              : `Last ${n} uploads are clean`,
          severity: 'good',
        },
        {text: ' — '},
      ]
    : [
        {
          text:
            h.scope === 'lifetime'
              ? `Across all ${n} uploads: `
              : `In the last ${n} uploads: `,
        },
      ];
  // Same axis: when "untagged" is shown, "under-tagged" only adds noise.
  const hasUntagged = flags.some(f => f.id === 'untagged-recent');
  const others = flags.filter(
    f =>
      f.severity !== 'info' &&
      !STATUS_FLAG_IDS.has(f.id) &&
      !(hasUntagged && f.id === 'undertagged-recent'),
  );
  const inline = others.slice(0, 2);
  const overflow = flags.filter(
    f => !inline.includes(f) && !STATUS_FLAG_IDS.has(f.id),
  );
  const tagging = flags.some(f => f.id.includes('tagged'));
  const note = tagging ? null : tagNote(h);
  const parts: SummaryPart[] = [...head, ...statusBreakdown(h, flags, name)];
  if (note) parts.push({text: `, ${note}`});
  if (inline.length) {
    parts.push(
      {text: '; '},
      ...joinParts(
        inline.map(f => f.part),
        '; ',
      ),
    );
  }
  if (overflow.length) {
    parts.push({
      text: ` (+${overflow.length} more)`,
      title: overflow.map(f => f.part.text).join('; '),
    });
  }
  parts.push({text: '.'});
  return {parts, overflow};
}

// --- Trend line --------------------------------------------------------------

function paceSuffix(a: ActivityMetrics): SummaryPart | null {
  if (a.streakNow >= STREAK_MIN) {
    return {text: `on a ${a.streakNow}-day streak`, severity: 'good'};
  }
  if (a.burstDays !== null) {
    return {
      text: `uploading in bursts (${a.burstDays} days carried half of the last 90 days)`,
    };
  }
  return null;
}

function paceHead(a: ActivityMetrics, suffix: boolean): SummaryPart | null {
  if (a.pace30 !== null && a.pace30 >= PACE_UP) {
    return {
      text: `uploading at about ${a.pace30.toFixed(1)}× their 12-month pace over the last 30 days`,
      severity: 'good',
    };
  }
  if (a.pace30 !== null && a.pace30 <= PACE_DOWN) {
    const text =
      a.count30 === 0
        ? 'no uploads in the last 30 days'
        : `slowed to about ${formatPct(a.pace30)} of their 12-month pace over the last 30 days`;
    return {text, severity: 'warn'};
  }
  return suffix && a.pace30 !== null ? {text: 'steady pace'} : null;
}

function paceClause(a: ActivityMetrics, now: number): SummaryPart[] | null {
  if (a.lastUpload !== null && now - a.lastUpload >= DORMANT_MS) {
    const since = formatYearMonth(new Date(a.lastUpload));
    return [{text: `no uploads since ${since}`, severity: 'warn'}];
  }
  const suffix = paceSuffix(a);
  const head = paceHead(a, suffix !== null);
  if (head && suffix) return [head, {text: ', '}, suffix];
  const only = head ?? suffix;
  return only ? [only] : null;
}

/**
 * Lifetime focus from the pie counts: "mainly A (31%) and B (12%), above all
 * C (14%)", or "spread across many series (top: A 8%)". Shares are of all
 * uploads (both counts include deleted posts).
 */
function lifetimeFocusParts(input: ProfileSummaryInput): SummaryPart[] {
  const focus = input.lifetimeFocus;
  if (!focus || input.total <= 0 || !focus.copyright.length) return [];
  const name = input.userName;
  const share = (s: TagShare) => formatPct(s.count / input.total);
  const [a, b] = focus.copyright;
  if (a.count / input.total < FOCUS_SPREAD) {
    return [
      {text: 'spread across many series (top: '},
      focusLink(name, a.tag),
      {text: ` ${share(a)})`},
    ];
  }
  const parts: SummaryPart[] = [
    {text: 'mainly '},
    focusLink(name, a.tag),
    {text: ` (${share(a)})`},
  ];
  if (b && b.count / input.total >= NEW_SERIES_MIN) {
    parts.push({text: ' and '}, focusLink(name, b.tag), {
      text: ` (${share(b)})`,
    });
  }
  const c = focus.character[0];
  if (c && c.count / input.total >= NEW_SERIES_MIN) {
    parts.push({text: ', above all '}, focusLink(name, c.tag, 'character'), {
      text: ` (${share(c)})`,
    });
  }
  return parts;
}

/** "Uploading since YYYY-MM" (+ the lifetime focus on the dashboard). */
function anchorParts(
  input: ProfileSummaryInput,
  scope: SummaryScope,
): SummaryPart[] {
  const focus = scope === 'lifetime' ? lifetimeFocusParts(input) : [];
  if (!input.firstUploadDate) {
    return focus.length ? [...capitalize(focus), {text: '.'}] : [];
  }
  const since = `Uploading since ${formatYearMonth(input.firstUploadDate)}`;
  return focus.length
    ? [{text: `${since}, `}, ...focus, {text: '.'}]
    : [{text: `${since}.`}];
}

/** Lifetime arc: the last 12 months against the busiest calendar year. */
function peakClause(a: ActivityMetrics): SummaryPart | null {
  if (!a.peak) return null;
  const {year, count} = a.peak;
  if (a.count365 >= count) {
    return {
      text: `the last 12 months are their busiest yet (${a.count365.toLocaleString('en-US')} uploads)`,
      severity: 'good',
    };
  }
  return {
    text: `busiest in ${year} (${count.toLocaleString('en-US')} uploads); the last 12 months reached ${formatPct(a.count365 / count)} of that`,
  };
}

function focusLink(
  name: string,
  tag: string,
  category: SummaryTagCategory = 'copyright',
): SummaryPart {
  return {text: displayTag(tag), href: userSearchUrl(name, tag), category};
}

function focusHead(
  t: TrendMetrics,
  lifeTop: string | undefined,
  name: string,
): SummaryPart[] | null {
  if (!t.focusTop) return null;
  if (t.focusShare < FOCUS_SPREAD) {
    return [{text: `spread across ${t.focusDistinct} series lately`}];
  }
  if (t.focusTop === lifeTop) {
    return [{text: 'still centred on '}, focusLink(name, t.focusTop)];
  }
  if (t.focusShare < RECENT_SHIFT) return null;
  const share = {text: ` (${formatPct(t.focusShare)} of recent uploads)`};
  if (!lifeTop)
    return [{text: 'lately focused on '}, focusLink(name, t.focusTop), share];
  return [
    {text: 'lately shifted from '},
    focusLink(name, lifeTop),
    {text: ' to '},
    focusLink(name, t.focusTop),
    share,
  ];
}

function focusClause(
  t: TrendMetrics,
  input: ProfileSummaryInput,
): SummaryPart[] | null {
  const name = input.userName;
  const head = focusHead(t, input.copyrightTop[0], name);
  const branch = t.newSeries.filter(s => s !== t.focusTop).slice(0, 2);
  const parts: SummaryPart[] = head ? [...head] : [];
  if (
    head &&
    t.charTop &&
    t.charShare >= CHAR_SHIFT &&
    t.charTop !== input.characterTop[0]
  ) {
    parts.push(
      {text: ' (mostly '},
      focusLink(input.userName, t.charTop, 'character'),
      {text: ')'},
    );
  }
  if (branch.length) {
    parts.push({text: head ? ', branching into ' : 'branching into '});
    parts.push(
      ...joinParts(
        branch.map(s => focusLink(name, s)),
        ' and ',
      ),
    );
  }
  return parts.length ? parts : null;
}

function reactionClause(
  t: TrendMetrics,
  scope: SummaryScope,
): SummaryPart | null {
  // On the lifetime card the subject must be named; the recent view is
  // already about recent uploads.
  const who = scope === 'lifetime' ? 'recent uploads ' : '';
  const {medianRecent: r, medianEarlier: e} = t;
  if (r !== null && e !== null && e > 0) {
    const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const median = `(median ${fmt(r)} vs ${fmt(e)})`;
    if (r <= e * SCORE_BELOW) {
      return {
        text: `${who}scoring below their usual ${median}`,
        severity: 'warn',
      };
    }
    if (r >= e * SCORE_ABOVE) {
      return {
        text: `${who}scoring above their usual ${median}`,
        severity: 'good',
      };
    }
  }
  // Rating drift is a description, not a judgement — left untoned.
  if (t.nsfwRecent !== null && t.nsfwEarlier !== null) {
    const d = t.nsfwRecent - t.nsfwEarlier;
    if (d >= NSFW_DRIFT) return {text: `${who}more explicit lately`};
    if (d <= -NSFW_DRIFT) return {text: `${who}tamer lately`};
  }
  return null;
}

function capitalize(parts: SummaryPart[]): SummaryPart[] {
  if (!parts.length) return parts;
  const [first, ...rest] = parts;
  const text = first.text.charAt(0).toUpperCase() + first.text.slice(1);
  return [{...first, text}, ...rest];
}

function trendParts(
  input: ProfileSummaryInput,
  a: ActivityMetrics,
  t: TrendMetrics,
  now: number,
  scope: SummaryScope,
): SummaryPart[] {
  const clauses: SummaryPart[][] = [];
  const pace = paceClause(a, now);
  if (pace) clauses.push(pace);
  // Lifetime: the yearly arc. Recent: what the newest uploads focus on
  // (the lifetime focus is already in the copyright pie).
  if (scope === 'lifetime') {
    const peak = peakClause(a);
    if (peak) clauses.push([peak]);
  } else {
    const focus = focusClause(t, input);
    if (focus) clauses.push(focus);
  }
  const reaction = reactionClause(t, scope);
  if (reaction) clauses.push([reaction]);
  if (!clauses.length) return [];
  const joined = clauses.flatMap((c, i) => (i ? [{text: '; '}, ...c] : c));
  return [...capitalize(joined), {text: '.'}];
}

// --- Entry point -------------------------------------------------------------

/**
 * Builds the pane: line 1 = "Uploading since YYYY-MM." + recent health,
 * line 2 = recent-vs-usual trend. Empty lines are dropped.
 */
export function buildProfileSummary(
  input: ProfileSummaryInput,
  now: number,
  scope: SummaryScope = 'recent',
): ProfileSummary {
  const windowIds = new Set(input.window.map(p => p.id));
  const earlier = input.lifetimePoints.filter(p => !windowIds.has(p.id));
  const health = deriveHealth(input, earlier, now, scope);
  const {parts, overflow} = healthParts(
    health,
    buildFlags(health, input.userName),
    input.userName,
  );
  const anchor = anchorParts(input, scope);
  const line1 = [
    ...anchor,
    ...(anchor.length && parts.length ? [{text: ' '}] : []),
    ...parts,
  ];
  const line2 = trendParts(
    input,
    deriveActivity(input, now),
    deriveTrend(input, earlier, now),
    now,
    scope,
  );
  return {lines: [line1, line2].filter(l => l.length > 0), overflow};
}

/**
 * Hover/tap popover that summarises one month of grass activity, anchored to
 * a CalHeatmap month label (`.ch-domain-text`). Content is precomputed by
 * `computeMonthStats` (core, pure); this module owns only the DOM, the
 * linger/fade dismissal, positioning, and theme bridging.
 *
 * Single body-appended instance (recreated on demand). Follows the grass
 * approvals popover for theming (`applyPopoverPalette`) and the dashboard
 * preview / subtag tooltip for the grace-timer dismissal model.
 */

import {MonthStats} from '../types';
import {metricLabel, monthLongName} from '../core/grass-month-stats';
import {calcPopoverPositionBelow, applyPopoverChrome} from './popover-utils';
import {applyPopoverPalette} from './settings-popover';

const POPOVER_ID = 'danbooru-grass-month-popover';
/** Wide enough to seat the sparkline beside the headline (31 bars ≈ 96px). */
const WIDTH = 272;
/** Sparkline box, in SVG user units (rendered 1:1 via width/height attrs). */
const SPARK_W = 96;
const SPARK_H = 30;
/** A bar plus its gap; 31 days × 3 = 93 ≤ SPARK_W. */
const BAR_STEP = 3;
const BAR_W = 2;
/** Floor so a non-zero day is never invisible against the baseline. */
const MIN_BAR_H = 1.5;
/**
 * Year-trend chart: same footprint as the daily strip, drawn as a line.
 * `TREND_PAD` keeps the stroke and the emphasised marker off the edges.
 */
const TREND_PAD = 4;
const TREND_DOT_R = 1.2;
/** The solid you-are-here dot. Its predecessor was a hollow ring — r=3 with a
 *  2px stroke, so an 8px visual diameter; solid and ~10% smaller lands at 7.2. */
const TREND_NOW_R = 3.6;
/** Linger before the popover starts fading (cursor may return to it). */
const HIDE_GRACE_MS = 400;
/** Fade-out duration — must match the CSS opacity transition. */
const FADE_MS = 200;

let el: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (fadeTimer !== null) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
}

function ensureEl(): HTMLDivElement {
  if (el && document.body.contains(el)) return el;
  const node = document.createElement('div');
  node.id = POPOVER_ID;
  node.className = 'di-grass-month-popover';
  node.style.opacity = '0';
  node.addEventListener('mouseenter', keepGrassMonthPopoverOpen);
  node.addEventListener('mouseleave', scheduleHideGrassMonthPopover);
  document.body.appendChild(node);
  el = node;
  return node;
}

/**
 * Which tint the hovered month's bar takes in the year trend: the same
 * up/down/flat split the "▲ 23% vs June" text uses, so the chart and the
 * sentence beside it never disagree. Falls back to a neutral emphasis when
 * there is no comparison — January before its December lookup lands, or a
 * month whose predecessor was empty.
 */
function trendCurrentClass(stats: MonthStats): string {
  if (stats.momIsNew) return 'di-gmp-trend-up';
  if (stats.momPct === null) return 'di-gmp-trend-current';
  if (stats.momPct > 0) return 'di-gmp-trend-up';
  if (stats.momPct < 0) return 'di-gmp-trend-down';
  return 'di-gmp-trend-current';
}

/**
 * Inline SVG line chart of every month in the year, sitting above the daily
 * sparkline and answering the question that one cannot: where this month
 * sits among its siblings.
 *
 * A line rather than bars: this chart is read for direction — where the year
 * rose and fell — while the strip below it measures one month's days. The
 * different shape also keeps the two from being mistaken for each other.
 *
 * Only the hovered month is emphasised, with a solid dot a step larger than
 * the vertices — tinting all twelve by their own deltas would put six reds
 * and six greens on a 96px strip and say nothing. The dot's colour is the
 * same one the percentage text carries.
 *
 * Returns '' when the year has no activity at all, so the header keeps its
 * original single-line layout.
 *
 * Exported for tests.
 */
export function yearTrendSvg(stats: MonthStats): string {
  const {yearSeries} = stats;
  const peak = yearSeries.reduce((max, v) => (v > max ? v : max), 0);
  if (yearSeries.length === 0 || peak <= 0) return '';

  const innerW = SPARK_W - TREND_PAD * 2;
  const innerH = SPARK_H - TREND_PAD * 2;
  // A lone month has no span to spread across, so it sits centred.
  const stepX = yearSeries.length > 1 ? innerW / (yearSeries.length - 1) : 0;
  const xAt = (i: number) =>
    yearSeries.length > 1 ? TREND_PAD + i * stepX : SPARK_W / 2;
  const yAt = (v: number) => TREND_PAD + innerH - (v / peak) * innerH;

  const points = yearSeries
    .map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
    .join(' ');
  // Vertices are drawn so twelve discrete months stay legible as months
  // rather than reading like one continuous curve.
  const dots = yearSeries
    .map(
      (v, i) =>
        `<circle class="di-gmp-trend-dot" cx="${xAt(i).toFixed(1)}" cy="${yAt(
          v,
        ).toFixed(1)}" r="${TREND_DOT_R}"></circle>`,
    )
    .join('');
  // Marker last so it sits above the line it marks.
  const now =
    stats.month < yearSeries.length
      ? `<circle class="di-gmp-trend-now ${trendCurrentClass(
          stats,
        )}" cx="${xAt(stats.month).toFixed(1)}" cy="${yAt(
          yearSeries[stats.month],
        ).toFixed(1)}" r="${TREND_NOW_R}"></circle>`
      : '';

  return `<svg class="di-gmp-spark di-gmp-trend" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" aria-hidden="true"><polyline class="di-gmp-trend-line" points="${points}"></polyline>${dots}${now}</svg>`;
}

/**
 * The "▲ 23% vs June" / "new" fragment, or '' when there is nothing to show.
 *
 * Exported for tests.
 */
export function momFragment(stats: MonthStats): string {
  if (stats.momIsNew) {
    return '<span class="di-gmp-mom di-gmp-mom--new">new</span>';
  }
  if (stats.momPct === null) return '';
  // Wrap so January names December rather than reaching index -1 (which read
  // as an empty name, printing a bare "vs ").
  const prev = monthLongName((stats.month + 11) % 12);
  const up = stats.momPct > 0;
  const down = stats.momPct < 0;
  const arrow = up ? '▲' : down ? '▼' : '±';
  const mod = up ? 'up' : down ? 'down' : 'flat';
  return `<span class="di-gmp-mom di-gmp-mom--${mod}">${arrow} ${Math.abs(
    stats.momPct,
  )}% vs ${prev}</span>`;
}

/**
 * Inline SVG bar chart of the month's daily counts, sized to sit beside the
 * headline total. Heights are normalised to the month's own peak, so the
 * shape reads as "how this month was distributed" rather than an absolute
 * scale — the numbers underneath carry the magnitude.
 *
 * The busiest day is tinted a step darker so the eye lands on the same day
 * the "Busiest" row names. Both colours bridge to the active grass palette,
 * so the sparkline follows Sakura/Ember/etc. like the ratio bar does.
 *
 * Returns '' when there is nothing to draw (future month, or a month whose
 * days are all zero) so the headline simply keeps its old layout.
 *
 * Exported for tests.
 */
export function sparklineSvg(stats: MonthStats): string {
  const {series} = stats;
  const peak = series.reduce((max, v) => (v > max ? v : max), 0);
  if (series.length === 0 || peak <= 0) return '';

  // Centre the row when a short month leaves slack (e.g. an in-progress
  // month with only a few elapsed days).
  const used = series.length * BAR_STEP - (BAR_STEP - BAR_W);
  const offsetX = Math.max(0, (SPARK_W - used) / 2);
  const peakDay = stats.busiest
    ? parseInt(stats.busiest.date.slice(8, 10), 10)
    : -1;

  const bars = series
    .map((count, i) => {
      if (count <= 0) return '';
      const h = Math.max(MIN_BAR_H, (count / peak) * SPARK_H);
      const x = offsetX + i * BAR_STEP;
      const cls = i + 1 === peakDay ? ' class="di-gmp-spark-peak"' : '';
      return `<rect${cls} x="${x.toFixed(1)}" y="${(SPARK_H - h).toFixed(
        1,
      )}" width="${BAR_W}" height="${h.toFixed(1)}" rx="1"></rect>`;
    })
    .join('');

  return `<svg class="di-gmp-spark" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" aria-hidden="true">${bars}</svg>`;
}

/** "July 12 — 34" for the busiest day, or '—' when the month is empty. */
function busiestText(stats: MonthStats): string {
  if (!stats.busiest) return '—';
  const day = parseInt(stats.busiest.date.slice(8, 10), 10);
  return `${monthLongName(stats.month)} ${day} — ${stats.busiest.count.toLocaleString()}`;
}

function renderContent(stats: MonthStats, caretLeft: number): string {
  const header = `${monthLongName(stats.month)} ${stats.year} · ${metricLabel(
    stats.metric,
  )}`;
  const caret = `<div class="di-gmp-caret" style="left:${caretLeft}px"></div>`;

  if (stats.empty) {
    return `${caret}
      <div class="di-gmp-header">${header}</div>
      <div class="di-gmp-empty">No activity in ${monthLongName(stats.month)}</div>`;
  }

  const ratioPct = Math.round(
    Math.min(1, Math.max(0, stats.activeRatio)) * 100,
  );
  return `${caret}
    <div class="di-gmp-header">
      <span>${header}</span>
      ${yearTrendSvg(stats)}
    </div>
    <div class="di-gmp-headline">
      <div class="di-gmp-headline-main">
        <span class="di-gmp-total">${stats.total.toLocaleString()}</span>
        ${momFragment(stats)}
      </div>
      ${sparklineSvg(stats)}
    </div>
    <div class="di-gmp-rows">
      <div class="di-gmp-row">
        <span class="di-gmp-k">Active</span>
        <span class="di-gmp-v">${stats.activeDays} / ${stats.denominatorDays} days</span>
      </div>
      <div class="di-gmp-bar"><div class="di-gmp-bar-fill" style="width:${ratioPct}%"></div></div>
      <div class="di-gmp-row">
        <span class="di-gmp-k">Busiest</span>
        <span class="di-gmp-v">${busiestText(stats)}</span>
      </div>
      <div class="di-gmp-row">
        <span class="di-gmp-k">Average</span>
        <span class="di-gmp-v">${stats.average} / day</span>
      </div>
    </div>`;
}

/** Show (or re-target) the popover below `anchor` with `stats`. */
export function showGrassMonthPopover(opts: {
  anchor: Element;
  stats: MonthStats;
  themeKey: string;
}): void {
  clearTimers();
  const node = ensureEl();
  node.classList.remove('di-grass-month-popover--fading');
  applyPopoverChrome(node, {width: `${WIDTH}px`, zIndex: '10002'});
  node.style.transition = `opacity ${FADE_MS}ms ease`;

  const {top, left, caretLeft} = calcPopoverPositionBelow(opts.anchor, WIDTH);
  node.innerHTML = renderContent(opts.stats, caretLeft);
  node.style.top = `${top}px`;
  node.style.left = `${left}px`;
  applyPopoverPalette([node], opts.themeKey);

  requestAnimationFrame(() => {
    if (el) el.style.opacity = '1';
  });
}

/** Start the linger→fade dismissal (cancelled if the cursor returns). */
export function scheduleHideGrassMonthPopover(): void {
  clearTimers();
  hideTimer = setTimeout(() => {
    if (el) {
      el.classList.add('di-grass-month-popover--fading');
      el.style.opacity = '0';
    }
    fadeTimer = setTimeout(hideGrassMonthPopover, FADE_MS);
  }, HIDE_GRACE_MS);
}

/** Cancel any pending hide/fade and keep the popover fully visible. */
export function keepGrassMonthPopoverOpen(): void {
  clearTimers();
  if (el) {
    el.classList.remove('di-grass-month-popover--fading');
    el.style.opacity = '1';
  }
}

/** Remove the popover immediately. */
export function hideGrassMonthPopover(): void {
  clearTimers();
  if (el && el.parentNode) el.parentNode.removeChild(el);
  el = null;
}

/** True when the popover is currently in the DOM (for tap-toggle logic). */
export function isGrassMonthPopoverVisible(): boolean {
  return el !== null && document.body.contains(el);
}

/**
 * True while a dismissal is already scheduled — the linger before the fade, or
 * the fade itself. Still "visible" in both windows, so a caller that only
 * checks {@link isGrassMonthPopoverVisible} cannot tell the popover is on its
 * way out.
 *
 * Matters for anything that shows the popover *late*, after the interaction
 * that opened it: `showGrassMonthPopover` starts with `clearTimers()`, so a
 * re-show landing mid-dismissal cancels the pending hide and strands the
 * popover on screen — the mouseout that scheduled it has long since fired and
 * will not fire again. Such callers should drop their update instead.
 */
export function isGrassMonthPopoverHidePending(): boolean {
  return hideTimer !== null || fadeTimer !== null;
}

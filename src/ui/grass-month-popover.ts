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
const WIDTH = 240;
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

/** The "▲ 23% vs June" / "new" fragment, or '' when there is nothing to show. */
function momFragment(stats: MonthStats): string {
  if (stats.momIsNew) {
    return '<span class="di-gmp-mom di-gmp-mom--new">new</span>';
  }
  if (stats.momPct === null) return '';
  const prev = monthLongName(stats.month - 1);
  const up = stats.momPct > 0;
  const down = stats.momPct < 0;
  const arrow = up ? '▲' : down ? '▼' : '±';
  const mod = up ? 'up' : down ? 'down' : 'flat';
  return `<span class="di-gmp-mom di-gmp-mom--${mod}">${arrow} ${Math.abs(
    stats.momPct,
  )}% vs ${prev}</span>`;
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
    <div class="di-gmp-header">${header}</div>
    <div class="di-gmp-headline">
      <span class="di-gmp-total">${stats.total.toLocaleString()}</span>
      ${momFragment(stats)}
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

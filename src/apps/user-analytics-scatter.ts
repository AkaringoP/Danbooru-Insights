import type {ScatterDataPoint, DanbooruPost} from '../types';
import type {ChartContext} from './user-analytics-charts';
import type {LevelChangeEvent} from '../core/analytics-data-manager';
import {attachPostHoverCard, hidePostHoverCard} from '../ui/post-hover-card';
import {createTwoStepTap, isTouchDevice} from '../ui/two-step-tap';
import type {TwoStepTapController} from '../ui/two-step-tap';
import {getPalette} from '../ui/theme-palette';
import {createLogger} from '../core/logger';

const log = createLogger('Scatter');

// ============================================================
// SCATTER PLOT WIDGET
// ============================================================

/** Optional extras for the scatter plot widget (Tag Count Y=10 / downvote filter). */
export interface ScatterPlotOptions {
  /** User-level aggregate counts (gentags<10, tagcount<10) shown in Y=10 tooltip. */
  userStats?: {gentags_lt_10: number; tagcount_lt_10: number} | null;
  /** True if some posts are missing the down_score field. */
  needsBackfill?: boolean;
  /** Async backfill runner; called once if needsBackfill is true. */
  runBackfill?: (
    onProgress: (current: number, total: number) => void,
  ) => Promise<void>;
  /** Refresh callback to re-fetch scatter data (called after backfill completes). */
  refreshScatterData?: () => Promise<ScatterDataPoint[]>;
  /** Fetcher used by the hover preview card on popover list items. */
  fetchPostDetails?: (postId: number) => Promise<DanbooruPost | null>;
}

// ============================================================
// Internal types (Task 5 — renderScatterPlot decomposition)
// ============================================================

export type ScatterMode = 'score' | 'tags';
type ScatterRating = 'g' | 's' | 'q' | 'e';

/**
 * Derived rendering scale for one render pass. Filled by `renderScatterCanvas`
 * and read by interaction handlers (drag select, year zoom) to translate
 * pixel coordinates back into data coordinates without re-running the layout.
 *
 * `stepY` is included so `drawScatterGrid` knows whether to skip the "10"
 * label (handled separately in red bold by `drawY10Emphasis` for tag mode).
 */
export interface ScatterScale {
  minDate: number;
  maxDate: number;
  maxVal: number;
  timeRange: number;
  padL: number;
  padT: number;
  drawW: number;
  drawH: number;
  mode: ScatterMode;
  stepY: number;
}

/**
 * Mutable scatter widget state. All closure-captured variables from the
 * original monolithic `renderScatterPlot` live here so helpers can be
 * extracted as top-level functions that take an explicit state argument.
 *
 * Mutation pattern: helpers receive the same `ScatterState` reference and
 * mutate it in place. This preserves the original closure-capture semantics
 * exactly — the only thing that changes is *where* the variables live, not
 * *how* they are read/written. A functional/immutable approach was
 * considered and rejected (would force defensive copying everywhere and
 * make accidental behavior drift more likely).
 */
interface ScatterState {
  // Mode + filters
  mode: ScatterMode;
  selectedYear: number | null;
  activeDownvoteFilter: number | null;
  activeRatingFilters: Record<ScatterRating, boolean>;
  /** True while the Y=10 hit area is hovered (Tag Count mode). */
  y10Highlight: boolean;
  /**
   * Currently selected Y-grid threshold value (Score or Tag Count mode).
   * When non-null, points with `yVal >= activeYThreshold` are highlighted
   * and a dashed line is drawn at that y. Mutually exclusive with
   * `y10Highlight` — when both could apply, threshold wins.
   */
  activeYThreshold: number | null;

  // Backfill UI status (mirrored from options.needsBackfill on init)
  backfillInProgress: boolean;
  backfillFailed: boolean;

  // Drag interaction
  dragStart: {x: number; y: number} | null;
  lastDragEndTime: number;
  ignoreNextClick: boolean;

  // Derived (filled by renderScatterCanvas on each pass; mutated in place
  // so handlers' captured `state.scale` reference stays valid).
  scale: ScatterScale;
}

/**
 * Bundle of all DOM elements created by `buildScatterDom`. Helpers receive
 * this struct so signatures stay stable as the decomposition evolves.
 */
interface ScatterDom {
  // Top-level containers
  wrapper: HTMLElement;
  scatterDiv: HTMLElement;
  canvasContainer: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  overlayDiv: HTMLElement;

  // Top-bar controls
  toggleContainer: HTMLElement;
  toggleButtons: HTMLButtonElement[];
  downvoteContainer: HTMLElement;
  downvoteButtons: HTMLButtonElement[];
  filterContainer: HTMLElement;
  countLabel: HTMLElement;
  ratingButtons: Array<{
    key: ScatterRating;
    root: HTMLElement;
    circle: HTMLElement;
    color: string;
  }>;

  // Bottom-left controls
  resetBtn: HTMLButtonElement;
  yearLabel: HTMLElement;

  // Y=10 affordance
  y10Hit: HTMLElement;
  y10Tooltip: HTMLElement;

  // Per-render Y-grid hit areas (regenerated each render pass)
  gridHitsContainer: HTMLElement;

  // Drag selection
  selectionDiv: HTMLElement;
  rangeLabel: HTMLElement;

  // Popover (appended to document.body)
  popover: HTMLElement;
}

// ============================================================
// State init
// ============================================================

function createInitialScatterState(options: ScatterPlotOptions): ScatterState {
  return {
    mode: 'score',
    selectedYear: null,
    activeDownvoteFilter: null,
    activeRatingFilters: {g: true, s: true, q: true, e: true},
    y10Highlight: false,
    activeYThreshold: null,

    backfillInProgress: options.needsBackfill === true,
    backfillFailed: false,

    dragStart: null,
    lastDragEndTime: 0,
    ignoreNextClick: false,

    scale: {
      minDate: 0,
      maxDate: 0,
      maxVal: 0,
      timeRange: 0,
      padL: 0,
      padT: 0,
      drawW: 0,
      drawH: 0,
      mode: 'score',
      stepY: 0,
    },
  };
}

// ============================================================
// DOM construction (event handlers attached separately by wire* helpers)
// ============================================================

function buildScatterDom(): ScatterDom {
  // Wrapper for Header + Widget
  const wrapper = document.createElement('div');
  wrapper.style.marginTop = '24px';
  wrapper.style.marginBottom = '20px';

  // Header Container
  const headerContainer = document.createElement('div');
  headerContainer.style.display = 'flex';
  headerContainer.style.alignItems = 'center';
  headerContainer.style.borderBottom = '1px solid var(--di-border-light, #eee)';
  headerContainer.style.paddingBottom = '10px';
  headerContainer.style.marginBottom = '15px';

  const headerEl = document.createElement('h3');
  headerEl.textContent = '📊 Post Performance';
  headerEl.style.color = 'var(--di-text, #333)';
  headerEl.style.margin = '0';
  headerContainer.appendChild(headerEl);

  wrapper.appendChild(headerContainer);

  // Widget Box
  const scatterDiv = document.createElement('div');
  scatterDiv.className = 'dashboard-widget';
  scatterDiv.style.background = 'var(--di-chart-bg, #fff)';
  scatterDiv.style.border = '1px solid #e1e4e8';
  scatterDiv.style.borderRadius = '6px';
  scatterDiv.style.padding = '15px';
  scatterDiv.style.position = 'relative';

  wrapper.appendChild(scatterDiv);

  // Metric Toggle (Top Left inside Widget)
  const toggleContainer = document.createElement('div');
  toggleContainer.className = 'di-scatter-toggle';
  toggleContainer.style.position = 'absolute';
  toggleContainer.style.top = '15px';
  toggleContainer.style.left = '15px';
  toggleContainer.style.zIndex = '5';
  toggleContainer.style.display = 'flex';
  toggleContainer.style.gap = '10px';
  toggleContainer.style.fontSize = '0.9em';

  const toggleSpecs: Array<{id: ScatterMode; label: string; tooltip?: string}> =
    [
      {id: 'score', label: 'Score'},
      {id: 'tags', label: 'Tag Count', tooltip: 'General Tags Only'},
    ];
  const toggleButtons: HTMLButtonElement[] = [];
  toggleSpecs.forEach((spec, i) => {
    const btn = document.createElement('button');
    btn.style.border = '1px solid #d0d7de';
    btn.style.borderRadius = '20px';
    btn.style.padding = '2px 10px';
    const isActive = i === 0;
    btn.style.background = isActive
      ? 'var(--di-link, #007bff)'
      : 'var(--di-bg, #fff)';
    btn.style.color = isActive
      ? 'var(--di-btn-active-text, #fff)'
      : 'var(--di-text, #333)';
    btn.style.cursor = 'pointer';
    btn.style.transition = 'all 0.2s';
    btn.style.fontSize = '12px';
    btn.dataset.mode = spec.id;
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '5px';

    const span = document.createElement('span');
    span.textContent = spec.label;
    btn.appendChild(span);

    if (spec.tooltip) {
      const help = document.createElement('span');
      help.textContent = '❔';
      help.style.cursor = 'help';
      help.title = spec.tooltip;
      help.style.fontSize = '0.9em';
      help.style.opacity = '0.8';
      btn.appendChild(help);
    }

    toggleContainer.appendChild(btn);
    toggleButtons.push(btn);
  });

  scatterDiv.appendChild(toggleContainer);

  // Downvote filter (Score mode only) — mutually exclusive single selection
  const downvoteThresholds = [0, 2, 5, 10] as const;

  const downvoteContainer = document.createElement('div');
  downvoteContainer.className = 'di-scatter-downvote';
  downvoteContainer.style.position = 'absolute';
  downvoteContainer.style.top = '45px';
  downvoteContainer.style.right = '15px';
  downvoteContainer.style.zIndex = '5';
  downvoteContainer.style.display = 'flex';
  downvoteContainer.style.alignItems = 'center';
  downvoteContainer.style.gap = '5px';
  downvoteContainer.style.background =
    'var(--di-bg-glass, rgba(255, 255, 255, 0.9))';
  downvoteContainer.style.padding = '2px 8px';
  downvoteContainer.style.borderRadius = '12px';
  downvoteContainer.style.border = '1px solid var(--di-border-light, #eee)';

  const downvoteLabel = document.createElement('span');
  downvoteLabel.textContent = '👎';
  downvoteLabel.style.fontSize = '11px';
  downvoteLabel.style.marginRight = '3px';
  downvoteLabel.title = 'Downvote filter';
  downvoteContainer.appendChild(downvoteLabel);

  const downvoteButtons: HTMLButtonElement[] = [];
  downvoteThresholds.forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = `>${t}`;
    btn.dataset.threshold = String(t);
    btn.style.border = '1px solid var(--di-border-input, #ddd)';
    btn.style.borderRadius = '12px';
    btn.style.padding = '1px 8px';
    btn.style.background = 'var(--di-bg, #fff)';
    btn.style.color = 'var(--di-text, #333)';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '11px';
    btn.style.transition = 'all 0.2s';

    downvoteContainer.appendChild(btn);
    downvoteButtons.push(btn);
  });

  scatterDiv.appendChild(downvoteContainer);

  // Reset Scale Button (year drill-down)
  const resetBtn = document.createElement('button');
  resetBtn.textContent = '<';
  resetBtn.style.position = 'absolute';
  resetBtn.style.bottom = '10px';
  resetBtn.style.left = '15px';
  resetBtn.style.zIndex = '5';
  resetBtn.style.border = '1px solid var(--di-border-input, #ddd)';
  resetBtn.style.background = 'var(--di-bg, #fff)';
  resetBtn.style.color = 'var(--di-text, #333)';
  resetBtn.style.borderRadius = '4px';
  resetBtn.style.padding = '2px 8px';
  resetBtn.style.cursor = 'pointer';
  resetBtn.style.fontSize = '11px';
  resetBtn.style.display = 'none';
  scatterDiv.appendChild(resetBtn);

  // Year Indicator
  const yearLabel = document.createElement('div');
  yearLabel.style.position = 'absolute';
  yearLabel.style.bottom = '40px';
  yearLabel.style.left = '15px';
  yearLabel.style.zIndex = '4';
  yearLabel.style.fontSize = '16px';
  yearLabel.style.fontWeight = 'bold';
  yearLabel.style.color = 'var(--di-text, #333)';
  yearLabel.style.pointerEvents = 'none';
  yearLabel.style.display = 'none';
  scatterDiv.appendChild(yearLabel);

  // Filters UI (Top Right)
  const filterContainer = document.createElement('div');
  filterContainer.className = 'di-scatter-filter';
  filterContainer.style.position = 'absolute';
  filterContainer.style.top = '15px';
  filterContainer.style.right = '15px';
  filterContainer.style.zIndex = '5';
  filterContainer.style.background =
    'var(--di-bg-glass, rgba(255, 255, 255, 0.9))';
  filterContainer.style.padding = '2px 8px';
  filterContainer.style.borderRadius = '12px';
  filterContainer.style.border = '1px solid var(--di-border-light, #eee)';
  filterContainer.style.display = 'flex';
  filterContainer.style.alignItems = 'center';
  filterContainer.style.gap = '15px';

  const countLabel = document.createElement('span');
  countLabel.textContent = '...';
  countLabel.style.fontSize = '12px';
  countLabel.style.fontWeight = 'bold';
  countLabel.style.color = 'var(--di-text, #333)';
  countLabel.style.marginRight = '5px';
  filterContainer.appendChild(countLabel);

  const ratingSpecs: Array<{key: ScatterRating; label: string; color: string}> =
    [
      {key: 'g', label: 'G', color: '#4caf50'},
      {key: 's', label: 'S', color: '#ffb74d'},
      {key: 'q', label: 'Q', color: '#ab47bc'},
      {key: 'e', label: 'E', color: '#f44336'},
    ];
  const ratingButtons: ScatterDom['ratingButtons'] = [];
  ratingSpecs.forEach(({key, label, color}) => {
    const root = document.createElement('div');
    root.style.display = 'flex';
    root.style.alignItems = 'center';
    root.style.cursor = 'pointer';
    root.style.userSelect = 'none';
    root.style.gap = '4px';

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.fontWeight = 'normal';
    labelEl.style.color = 'var(--di-text, #333)';
    labelEl.style.fontSize = '12px';

    const circle = document.createElement('div');
    circle.style.width = '16px';
    circle.style.height = '16px';
    circle.style.borderRadius = '50%';
    circle.style.background = color;
    circle.style.boxShadow = '0 1px 3px var(--di-shadow, rgba(0,0,0,0.2))';
    circle.style.transition = 'background 0.3s, transform 0.3s';

    root.appendChild(labelEl);
    root.appendChild(circle);

    filterContainer.appendChild(root);
    ratingButtons.push({key, root, circle, color});
  });

  // Canvas Container
  const canvasContainer = document.createElement('div');
  canvasContainer.style.width = '100%';
  canvasContainer.style.height = '300px';
  canvasContainer.style.position = 'relative';
  scatterDiv.appendChild(canvasContainer);

  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvasContainer.appendChild(canvas);
  scatterDiv.appendChild(filterContainer);

  const ctx = canvas.getContext('2d', {alpha: false});

  // Overlay Container for Lines
  const overlayDiv = document.createElement('div');
  overlayDiv.style.position = 'absolute';
  overlayDiv.style.top = '0';
  overlayDiv.style.left = '0';
  overlayDiv.style.width = '100%';
  overlayDiv.style.height = '100%';
  overlayDiv.style.pointerEvents = 'none';
  canvasContainer.appendChild(overlayDiv);

  // Y=10 click hit-area (Tag Count mode only)
  const y10Hit = document.createElement('div');
  y10Hit.style.cssText =
    'position:absolute;left:0;width:36px;height:18px;cursor:pointer;display:none;z-index:6;';
  y10Hit.setAttribute('aria-label', 'Show posts with less than 10 tags');
  canvasContainer.appendChild(y10Hit);

  // Y-grid threshold hit areas (regenerated each render). The container is
  // pointer-events:none so it doesn't block underlying canvas events; each
  // child div re-enables pointer-events for its own bbox. Same z-index tier
  // as y10Hit but never overlaps (Y=10 is excluded in tag mode hits).
  const gridHitsContainer = document.createElement('div');
  gridHitsContainer.style.cssText =
    'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:6;';
  canvasContainer.appendChild(gridHitsContainer);

  // Y=10 tooltip
  const y10Tooltip = document.createElement('div');
  y10Tooltip.style.cssText =
    'position:absolute;background:rgba(30,30,30,0.95);color:#fff;padding:10px 14px;border-radius:6px;font-size:12px;z-index:10001;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.2);min-width:200px;';
  document.body.appendChild(y10Tooltip);

  // Drag Selection UI
  const selectionDiv = document.createElement('div');
  selectionDiv.style.position = 'absolute';
  selectionDiv.style.border = '1px dashed #007bff';
  selectionDiv.style.backgroundColor = 'rgba(0, 123, 255, 0.2)';
  selectionDiv.style.display = 'none';
  selectionDiv.style.pointerEvents = 'none';
  canvasContainer.appendChild(selectionDiv);

  // Range label shown during drag
  const rangeLabel = document.createElement('div');
  rangeLabel.style.cssText =
    'position:absolute;top:-38px;left:0;right:0;text-align:center;font-size:11px;color:#fff;background:rgba(0,0,0,0.75);padding:3px 10px;border-radius:4px;pointer-events:none;white-space:nowrap;display:none;width:fit-content;margin:0 auto;line-height:1.5;';
  selectionDiv.appendChild(rangeLabel);

  // Popover UI (appended to document.body so it can escape overflow:hidden parents)
  const popover = document.createElement('div');
  popover.id = 'scatter-popover-ui';
  popover.style.cssText =
    'position: fixed; z-index: 10000; background: var(--di-bg, #fff); border: 1px solid var(--di-border, #e1e4e8); border-radius: 4px; box-shadow: 0 4px 12px var(--di-shadow, rgba(0,0,0,0.2)); display: none; max-height: 300px; width: 320px; flex-direction: column; font-family: sans-serif; color: var(--di-text, #333);';
  document.body.appendChild(popover);

  return {
    wrapper,
    scatterDiv,
    canvasContainer,
    canvas,
    ctx,
    overlayDiv,
    toggleContainer,
    toggleButtons,
    downvoteContainer,
    downvoteButtons,
    filterContainer,
    countLabel,
    ratingButtons,
    resetBtn,
    yearLabel,
    y10Hit,
    y10Tooltip,
    gridHitsContainer,
    selectionDiv,
    rangeLabel,
    popover,
  };
}

// ============================================================
// Pure compute helpers — independently testable, no DOM
// ============================================================

/**
 * Computes the rendering scale (axis ranges, padding, step) for one render
 * pass. Pure function: takes the current state + data + canvas dimensions
 * and returns a fresh scale object.
 */
function computeScatterScale(
  state: ScatterState,
  scatterData: ScatterDataPoint[],
  w: number,
  h: number,
): ScatterScale {
  const padL = 40;
  const padR = 20;
  const padT = 60;
  const padB = 50;
  const drawW = w - padL - padR;
  const drawH = h - padT - padB;

  let minX = Infinity;
  let maxX = -Infinity;
  let maxVal = 0;

  if (state.selectedYear) {
    minX = new Date(state.selectedYear, 0, 1).getTime();
    maxX = new Date(state.selectedYear, 11, 31, 23, 59, 59).getTime();
  } else {
    for (const d of scatterData) {
      if (d.d < minX) minX = d.d;
      if (d.d > maxX) maxX = d.d;
    }
    if (minX === Infinity) {
      minX = Date.now();
      maxX = minX + 86400000;
    } else {
      const startY = new Date(minX).getFullYear();
      minX = new Date(startY, 0, 1).getTime();
    }
  }

  const xRange = maxX - minX || 1;

  for (const d of scatterData) {
    if (d.d >= minX && d.d <= maxX) {
      const val = state.mode === 'tags' ? d.t || 0 : d.s;
      if (val > maxVal) maxVal = val;
    }
  }
  if (maxVal === 0) maxVal = 100;

  // Y-axis step
  let stepY = 100;
  if (state.mode === 'tags') {
    if (maxVal < 50) stepY = 10;
    else if (maxVal < 200) stepY = 25;
    else stepY = 50;
  } else {
    if (maxVal < 200) stepY = 50;
    else if (maxVal < 1000) stepY = 100;
    else stepY = 500;
  }

  maxVal = Math.ceil(maxVal / stepY) * stepY;
  if (maxVal < stepY) maxVal = stepY;

  return {
    minDate: minX,
    maxDate: maxX,
    maxVal,
    timeRange: xRange,
    padL,
    padT,
    drawW,
    drawH,
    mode: state.mode,
    stepY,
  };
}

/**
 * Filters scatter data to the points currently visible given the active
 * rating filters, the date range from the scale, and the downvote filter
 * (Score mode only). Pure function.
 */
function filterVisiblePoints(
  state: ScatterState,
  scatterData: ScatterDataPoint[],
  scale: ScatterScale,
): ScatterDataPoint[] {
  const dvFilter = state.mode === 'score' ? state.activeDownvoteFilter : null;
  return scatterData.filter(d => {
    if (!state.activeRatingFilters[d.r as ScatterRating]) return false;
    if (d.d < scale.minDate || d.d > scale.maxDate) return false;
    if (dvFilter !== null) {
      // down_score is stored as a non-positive integer; "downvotes:>X" means
      // there are more than X downvotes, i.e. -down_score > X.
      if (d.dn === undefined) return false;
      if (-d.dn <= dvFilter) return false;
    }
    return true;
  });
}

// ============================================================
// Pure helpers for Y-grid threshold interaction (testable, no DOM)
// ============================================================

/**
 * Returns the Y-grid values that are eligible for the threshold interaction.
 * Excludes 0 (matches everything), the topmost grid value (no points above
 * by construction), and Y=10 in tag mode (reserved for the existing `<10`
 * affordance).
 *
 * @internal exported for tests
 */
export function getEligibleYThresholds(scale: ScatterScale): number[] {
  const out: number[] = [];
  if (scale.stepY <= 0 || scale.maxVal <= 0) return out;
  for (let val = scale.stepY; val < scale.maxVal; val += scale.stepY) {
    if (scale.mode === 'tags' && val === 10) continue;
    out.push(val);
  }
  return out;
}

/**
 * Builds the Danbooru posts search URL for the `>= value` filter using the
 * appropriate field for the active mode (`score` or `gentags`).
 *
 * @internal exported for tests
 */
export function buildPostsUrlForThreshold(
  userName: string,
  mode: ScatterMode,
  value: number,
): string {
  const field = mode === 'score' ? 'score' : 'gentags';
  return `/posts?tags=${encodeURIComponent(`user:${userName} ${field}:>=${value}`)}`;
}

// ============================================================
// Drawing helpers (canvas + overlay div)
// ============================================================

const PAD_R = 20;

function drawScatterGrid(
  ctx: CanvasRenderingContext2D,
  scale: ScatterScale,
  w: number,
  canvas: HTMLCanvasElement,
): {y10Pos: number | null} {
  const pal = getPalette(canvas);
  ctx.beginPath();
  ctx.strokeStyle = pal.chartGrid;
  ctx.lineWidth = 1;

  let y10Pos: number | null = null;
  const y10Overlaps =
    scale.mode === 'tags' && scale.maxVal >= 10 && 10 % scale.stepY === 0;

  for (let val = 0; val <= scale.maxVal; val += scale.stepY) {
    const y = scale.padT + scale.drawH - (val / scale.maxVal) * scale.drawH;
    ctx.moveTo(scale.padL, y);
    ctx.lineTo(w - PAD_R, y);

    // Skip the "10" label here in tag count mode — drawn separately in red bold below.
    if (!(y10Overlaps && val === 10)) {
      ctx.fillStyle = pal.textMuted;
      ctx.font = '10px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(String(val), scale.padL - 5, y + 3);
    }

    if (val === 10) y10Pos = y;
  }
  ctx.stroke();

  return {y10Pos};
}

/**
 * Draws the Y=10 emphasis line + bold red "10" label for Tag Count mode.
 * Returns the Y position so the caller can position the clickable hit area.
 */
function drawY10Emphasis(
  ctx: CanvasRenderingContext2D,
  scale: ScatterScale,
  w: number,
  y10Pos: number | null,
): number | null {
  if (scale.mode !== 'tags' || scale.maxVal < 10) return y10Pos;

  let actualY10 = y10Pos;
  if (actualY10 === null) {
    actualY10 = scale.padT + scale.drawH - (10 / scale.maxVal) * scale.drawH;
  }

  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(150, 150, 150, 0.5)';
  ctx.moveTo(scale.padL, actualY10);
  ctx.lineTo(w - PAD_R, actualY10);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#d73a49';
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'right';
  ctx.fillText('10', scale.padL - 5, actualY10 + 3);

  return actualY10;
}

/**
 * Draws a dashed horizontal line at the active threshold value. Color is
 * deliberately distinct from the Y=10 affordance (gray dashes + red label)
 * so the two are visually unambiguous when both could plausibly apply.
 */
function drawYThresholdLine(
  ctx: CanvasRenderingContext2D,
  scale: ScatterScale,
  w: number,
  value: number,
): void {
  if (scale.maxVal <= 0) return;
  const y = scale.padT + scale.drawH - (value / scale.maxVal) * scale.drawH;

  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(91, 173, 232, 0.85)';
  ctx.lineWidth = 1;
  ctx.moveTo(scale.padL, y);
  ctx.lineTo(w - PAD_R, y);
  ctx.stroke();
  ctx.restore();
}

function drawScatterAxis(
  ctx: CanvasRenderingContext2D,
  state: ScatterState,
  scale: ScatterScale,
  w: number,
  canvas: HTMLCanvasElement,
): void {
  const pal = getPalette(canvas);
  // Bottom axis line
  ctx.beginPath();
  ctx.strokeStyle = pal.border;
  ctx.moveTo(scale.padL, scale.padT + scale.drawH);
  ctx.lineTo(w - PAD_R, scale.padT + scale.drawH);
  ctx.stroke();

  ctx.fillStyle = pal.chartAxisSecondary;
  ctx.textAlign = 'center';

  if (state.selectedYear) {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    months.forEach((m, i) => {
      const stepW = scale.drawW / 12;
      const x = scale.padL + stepW * i + stepW / 2;
      ctx.fillText(m, x, scale.padT + scale.drawH + 15);

      if (i > 0) {
        const tickX = scale.padL + stepW * i;
        ctx.beginPath();
        ctx.moveTo(tickX, scale.padT + scale.drawH);
        ctx.lineTo(tickX, scale.padT + scale.drawH + 5);
        ctx.stroke();
      }
    });
  } else {
    const startYear = new Date(scale.minDate).getFullYear();
    const endYear = new Date(scale.maxDate).getFullYear();
    // 4-digit year labels collide on long activity spans (e.g. 2009-2026)
    // when the canvas is narrow. Below ~32px/year, fall back to 2-digit
    // (e.g. "09", "14", "25").
    const yearCount = endYear - startYear + 1;
    const useShortYear = yearCount > 0 && scale.drawW / yearCount < 32;

    for (let y = startYear; y <= endYear; y++) {
      const d = new Date(y, 0, 1).getTime();
      const x =
        scale.padL + ((d - scale.minDate) / scale.timeRange) * scale.drawW;

      if (x >= scale.padL - 5 && x <= w - PAD_R + 5) {
        const nextD = new Date(y + 1, 0, 1).getTime();
        const xNext =
          scale.padL +
          ((nextD - scale.minDate) / scale.timeRange) * scale.drawW;
        const xCenter = (x + xNext) / 2;

        if (xCenter > scale.padL - 10 && xCenter < w - PAD_R + 10) {
          const label = useShortYear
            ? String(y % 100).padStart(2, '0')
            : String(y);
          ctx.fillText(label, xCenter, scale.padT + scale.drawH + 15);
        }

        ctx.beginPath();
        ctx.moveTo(x, scale.padT + scale.drawH);
        ctx.lineTo(x, scale.padT + scale.drawH + 5);
        ctx.stroke();
      }
    }
  }
}

function drawScatterPoints(
  ctx: CanvasRenderingContext2D,
  points: ScatterDataPoint[],
  state: ScatterState,
  scale: ScatterScale,
): void {
  // Y-grid threshold takes precedence over Y=10 highlight when both could
  // apply (e.g. user hovers a grid label while Tag Count mode is active).
  const thresholdActive = state.activeYThreshold !== null;
  const y10Active =
    !thresholdActive && state.y10Highlight && state.mode === 'tags';
  const threshold = state.activeYThreshold ?? 0;
  // Two-pass render when y10Active: dim background first, then bold red on top.
  const highlightedPoints: Array<[number, number]> = [];

  points.forEach(pt => {
    const xVal = pt.d;
    const yVal = state.mode === 'tags' ? pt.t || 0 : pt.s;

    if (xVal < scale.minDate || xVal > scale.maxDate) return;

    const x =
      scale.padL + ((xVal - scale.minDate) / scale.timeRange) * scale.drawW;
    const y = scale.padT + scale.drawH - (yVal / scale.maxVal) * scale.drawH;

    if (y10Active && (pt.t || 0) < 10) {
      highlightedPoints.push([x, y]);
      return;
    }

    let color = '#ccc';
    if (pt.r === 'g') color = '#4caf50';
    else if (pt.r === 's') color = '#ffb74d';
    else if (pt.r === 'q') color = '#ab47bc';
    else if (pt.r === 'e') color = '#f44336';

    if (y10Active) {
      ctx.globalAlpha = 0.2;
    } else if (thresholdActive) {
      ctx.globalAlpha = yVal >= threshold ? 1 : 0.2;
    }
    ctx.fillStyle = color;
    ctx.fillRect(x - 1, y - 1, 2, 2);
  });

  ctx.globalAlpha = 1;

  if (y10Active) {
    // Bold red — visible on both light and dark backgrounds. Shares color
    // with rating:e points, but acceptable because other ratings dim out
    // while the gentags<10 highlight is active.
    ctx.fillStyle = '#e0115f';
    highlightedPoints.forEach(([x, y]) => {
      ctx.fillRect(x - 2, y - 2, 4, 4);
    });
  }
}

function drawScatterOverlays(
  overlayDiv: HTMLElement,
  scale: ScatterScale,
  context: ChartContext,
  levelChanges: LevelChangeEvent[],
): void {
  const addOverlayLine = (
    dateObjOrStr: Date | string,
    color: string,
    title: string,
    isDashed: boolean,
    thickness: string = '2px',
  ) => {
    const d = new Date(dateObjOrStr).getTime();
    if (d < scale.minDate || d > scale.maxDate) return;

    const x =
      scale.padL + ((d - scale.minDate) / scale.timeRange) * scale.drawW;

    const line = document.createElement('div');
    line.style.position = 'absolute';
    line.style.left = x + 'px';
    line.style.top = scale.padT + 'px';
    line.style.height = scale.drawH + 'px';
    line.style.borderLeft = `${thickness} ${isDashed ? 'dashed' : 'solid'} ${color}`;
    line.style.width = '4px';
    line.style.cursor = 'help';
    line.style.pointerEvents = 'auto';
    line.title = title;

    overlayDiv.appendChild(line);
  };

  if (context.targetUser && context.targetUser.joinDate) {
    const jd = new Date(context.targetUser.joinDate);
    addOverlayLine(
      jd,
      '#00E676',
      `${jd.toLocaleDateString()}: Joined Danbooru`,
      true,
      '2px',
    );
  }

  if (levelChanges) {
    levelChanges.forEach((lc: LevelChangeEvent) => {
      addOverlayLine(
        lc.date,
        '#ff5722',
        `${lc.date.toLocaleDateString()}: ${lc.fromLevel} → ${lc.toLevel}`,
        true,
      );
    });
  }

  if (scale.mode === 'score') {
    addOverlayLine(
      '2021-11-24',
      '#bbb',
      'All users could vote since this day.',
      true,
      '1px',
    );
  }
}

// ============================================================
// Y-grid hit area regeneration (called every render)
// ============================================================

/**
 * Rebuilds the per-tick clickable hit areas in the Y-axis label gutter.
 *
 * Called from `renderScatterCanvas` because eligible thresholds depend on the
 * current `stepY` / `maxVal`, which change with mode toggles and year zoom.
 * Each child div re-enables `pointer-events:auto` (the parent container is
 * `pointer-events:none` so it doesn't block underlying canvas events).
 */
function regenerateYGridHits(
  state: ScatterState,
  dom: ScatterDom,
  scale: ScatterScale,
  userName: string,
  twoStepTap: TwoStepTapController<number>,
  rerender: () => void,
): void {
  dom.gridHitsContainer.innerHTML = '';

  const eligible = getEligibleYThresholds(scale);
  if (eligible.length === 0) return;

  const isTouch = isTouchDevice();
  const fieldLabel = scale.mode === 'score' ? 'score' : 'tag count';

  for (const val of eligible) {
    const pixelY =
      scale.padT + scale.drawH - (val / scale.maxVal) * scale.drawH;

    const hit = document.createElement('div');
    hit.style.cssText = `position:absolute;left:0;width:${scale.padL}px;top:${pixelY - 9}px;height:18px;pointer-events:auto;cursor:pointer;`;
    hit.setAttribute('aria-label', `Filter posts with ${fieldLabel} >= ${val}`);
    hit.dataset.threshold = String(val);

    if (!isTouch) {
      hit.addEventListener('mouseenter', () => {
        if (state.activeYThreshold === val) return;
        state.activeYThreshold = val;
        rerender();
      });
      hit.addEventListener('mouseleave', () => {
        if (state.activeYThreshold !== val) return;
        state.activeYThreshold = null;
        rerender();
      });
      hit.addEventListener('click', e => {
        e.stopPropagation();
        const url = buildPostsUrlForThreshold(userName, state.mode, val);
        window.open(url, '_blank');
      });
    } else {
      hit.addEventListener('click', e => {
        e.stopPropagation();
        twoStepTap.tap(val);
      });
    }

    dom.gridHitsContainer.appendChild(hit);
  }
}

// ============================================================
// Render canvas orchestrator
// ============================================================

function renderScatterCanvas(
  state: ScatterState,
  dom: ScatterDom,
  scatterData: ScatterDataPoint[],
  context: ChartContext,
  levelChanges: LevelChangeEvent[],
  options: ScatterPlotOptions,
  userName: string,
  twoStepTap: TwoStepTapController<number>,
  rerender: () => void,
): void {
  const {ctx, canvas, canvasContainer, scatterDiv, overlayDiv} = dom;
  if (!scatterDiv.isConnected || !ctx) return;

  // Any re-render invalidates the previous drag selection coordinates —
  // hide the box and close any open popover so stale UI isn't left behind.
  if (!state.dragStart) {
    dom.selectionDiv.style.display = 'none';
    dom.popover.style.display = 'none';
    hidePostHoverCard();
  }

  const rect = canvasContainer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  if (
    canvas.width !== rect.width * dpr ||
    canvas.height !== rect.height * dpr
  ) {
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
  }
  const w = rect.width;
  const h = rect.height;

  ctx.fillStyle = getPalette(canvas).chartBg;
  ctx.fillRect(0, 0, w, h);

  overlayDiv.innerHTML = '';

  // Compute scale + mutate state.scale in place (handlers hold the reference)
  const newScale = computeScatterScale(state, scatterData, w, h);
  Object.assign(state.scale, newScale);

  // Reset/year label visibility (mirrors pre-decomposition behavior)
  if (state.selectedYear) {
    dom.resetBtn.style.display = 'block';
    dom.yearLabel.textContent = String(state.selectedYear);
    dom.yearLabel.style.display = 'block';
  } else {
    dom.resetBtn.style.display = 'none';
    dom.yearLabel.style.display = 'none';
  }

  const visiblePoints = filterVisiblePoints(state, scatterData, state.scale);

  // Count label: when a Y-grid threshold is active, show only the matching
  // count (e.g. "123 items") so the badge reflects the highlighted subset.
  if (state.activeYThreshold !== null) {
    const t = state.activeYThreshold;
    const matched = visiblePoints.reduce((acc, d) => {
      const yVal = state.mode === 'tags' ? d.t || 0 : d.s;
      return yVal >= t ? acc + 1 : acc;
    }, 0);
    dom.countLabel.textContent = `${matched} items`;
  } else {
    dom.countLabel.textContent = `${visiblePoints.length} items`;
  }

  // Draw grid + Y=10 emphasis (tag mode only)
  const {y10Pos} = drawScatterGrid(ctx, state.scale, w, canvas);
  const finalY10 = drawY10Emphasis(ctx, state.scale, w, y10Pos);

  // Position the clickable Y=10 overlay (formerly updateY10Overlay closure)
  if (state.scale.mode !== 'tags' || finalY10 === null || !options.userStats) {
    dom.y10Hit.style.display = 'none';
  } else {
    dom.y10Hit.style.display = 'block';
    dom.y10Hit.style.top = `${finalY10 - 9}px`;
  }

  // Threshold line (only while a grid label is hovered/tapped)
  if (state.activeYThreshold !== null) {
    drawYThresholdLine(ctx, state.scale, w, state.activeYThreshold);
  }

  // Regenerate per-tick Y-grid hit areas (positions depend on stepY/maxVal)
  regenerateYGridHits(state, dom, state.scale, userName, twoStepTap, rerender);

  // Draw axis (months when zoomed into a year, years otherwise)
  drawScatterAxis(ctx, state, state.scale, w, canvas);

  // Draw points (with optional Y=10 or Y-threshold highlight pass)
  drawScatterPoints(ctx, visiblePoints, state, state.scale);

  // Draw overlay lines (join date, level changes, score era marker)
  drawScatterOverlays(overlayDiv, state.scale, context, levelChanges);
}

// ============================================================
// UI state helpers (downvote panel)
// ============================================================

function updateDownvoteButtonStyles(
  state: ScatterState,
  dom: ScatterDom,
): void {
  dom.downvoteButtons.forEach(btn => {
    const t = parseInt(btn.dataset.threshold ?? '0');
    const isActive = state.activeDownvoteFilter === t;
    const isDisabled = state.backfillInProgress || state.backfillFailed;
    btn.disabled = isDisabled;
    btn.style.opacity = isDisabled ? '0.5' : '1';
    btn.style.cursor = isDisabled ? 'not-allowed' : 'pointer';
    btn.style.background = isActive ? '#d73a49' : 'var(--di-bg, #fff)';
    btn.style.color = isActive ? '#fff' : 'var(--di-text, #333)';
    btn.style.borderColor = isActive
      ? '#d73a49'
      : 'var(--di-border-input, #ddd)';
    btn.title = isDisabled
      ? state.backfillFailed
        ? 'Downvote data unavailable (fetch failed)'
        : 'Backfilling downvote data...'
      : `Show only posts with more than ${t} downvotes`;
  });
}

function updateDownvoteVisibility(state: ScatterState, dom: ScatterDom): void {
  dom.downvoteContainer.style.display =
    state.mode === 'score' ? 'flex' : 'none';
}

// ============================================================
// Event wire helpers (one per concern, mutate state and call rerender)
// ============================================================

function wireModeToggle(
  state: ScatterState,
  dom: ScatterDom,
  rerender: () => void,
  clearYThreshold: () => void,
): void {
  dom.toggleButtons.forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.mode as ScatterMode;
      if (state.mode === id) return;
      state.mode = id;
      Array.from(dom.toggleContainer.children).forEach(b => {
        const bEl = b as HTMLElement;
        bEl.style.background =
          bEl.dataset.mode === id
            ? 'var(--di-link, #007bff)'
            : 'var(--di-bg, #fff)';
        bEl.style.color =
          bEl.dataset.mode === id
            ? 'var(--di-btn-active-text, #fff)'
            : 'var(--di-text, #333)';
      });
      // Reset downvote filter when leaving Score mode
      if (id !== 'score' && state.activeDownvoteFilter !== null) {
        state.activeDownvoteFilter = null;
        updateDownvoteButtonStyles(state, dom);
      }
      updateDownvoteVisibility(state, dom);
      // Y-grid threshold's stepY/maxVal differ between modes — drop it.
      clearYThreshold();
      rerender();
    };
  });
}

function wireDownvoteFilter(
  state: ScatterState,
  dom: ScatterDom,
  rerender: () => void,
): void {
  dom.downvoteButtons.forEach(btn => {
    btn.onclick = () => {
      if (btn.disabled) return;
      const t = parseInt(btn.dataset.threshold ?? '0');
      // Toggle: same → off, different → switch
      if (state.activeDownvoteFilter === t) {
        state.activeDownvoteFilter = null;
      } else {
        state.activeDownvoteFilter = t;
      }
      updateDownvoteButtonStyles(state, dom);
      rerender();
    };
  });
  // Initial style application (mirrors the pre-decomposition call right
  // after the forEach setup).
  updateDownvoteButtonStyles(state, dom);
}

function wireRatingFilter(
  state: ScatterState,
  dom: ScatterDom,
  rerender: () => void,
): void {
  dom.ratingButtons.forEach(({key, root, circle, color}) => {
    root.onclick = () => {
      state.activeRatingFilters[key] = !state.activeRatingFilters[key];
      if (state.activeRatingFilters[key]) {
        circle.style.background = color;
        circle.style.opacity = '1';
      } else {
        circle.style.background = '#e0e0e0';
        circle.style.opacity = '0.7';
      }
      rerender();
    };
  });
}

function wireYearReset(
  state: ScatterState,
  dom: ScatterDom,
  rerender: () => void,
  clearYThreshold: () => void,
): void {
  dom.resetBtn.onclick = () => {
    state.selectedYear = null;
    dom.resetBtn.style.display = 'none';
    dom.yearLabel.style.display = 'none';
    clearYThreshold();
    rerender();
  };
}

function wireY10Tooltip(
  state: ScatterState,
  dom: ScatterDom,
  options: ScatterPlotOptions,
  context: ChartContext,
  rerender: () => void,
): void {
  const closeY10Tooltip = () => {
    dom.y10Tooltip.style.display = 'none';
    state.y10Highlight = false;
    rerender();
  };

  document.addEventListener('click', e => {
    if (dom.y10Tooltip.style.display === 'none') return;
    if (e.target === dom.y10Hit || dom.y10Tooltip.contains(e.target as Node))
      return;
    closeY10Tooltip();
  });

  // Hover: highlight points with < 10 tags in black (only while tooltip is hidden).
  dom.y10Hit.addEventListener('mouseenter', () => {
    if (dom.y10Tooltip.style.display !== 'none') return;
    state.y10Highlight = true;
    rerender();
  });
  dom.y10Hit.addEventListener('mouseleave', () => {
    if (dom.y10Tooltip.style.display !== 'none') return;
    state.y10Highlight = false;
    rerender();
  });

  dom.y10Hit.onclick = e => {
    e.stopPropagation();
    if (!options.userStats) return;
    // Activate highlight mode while tooltip is visible
    state.y10Highlight = true;
    rerender();
    const {gentags_lt_10, tagcount_lt_10} = options.userStats;
    const userName = context.targetUser?.normalizedName ?? '';
    const gentagsUrl = `/posts?tags=${encodeURIComponent(`user:${userName} gentags:<10`)}`;
    const tagcountUrl = `/posts?tags=${encodeURIComponent(`user:${userName} tagcount:<10`)}`;
    dom.y10Tooltip.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:4px;">Posts with &lt; 10 tags</div>
      <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:4px;">
        <span style="color:#ccc;">General &lt; 10:</span>
        <a href="${gentagsUrl}" target="_blank" style="color:#5dade2;font-weight:bold;text-decoration:none;">${gentags_lt_10.toLocaleString()} →</a>
      </div>
      <div style="display:flex;justify-content:space-between;gap:12px;">
        <span style="color:#ccc;">Total &lt; 10:</span>
        <a href="${tagcountUrl}" target="_blank" style="color:#5dade2;font-weight:bold;text-decoration:none;">${tagcount_lt_10.toLocaleString()} →</a>
      </div>
    `;
    const rect = dom.y10Hit.getBoundingClientRect();
    dom.y10Tooltip.style.display = 'block';
    // Position to the right of the hit area, vertically centered
    dom.y10Tooltip.style.left = `${rect.right + window.scrollX + 8}px`;
    dom.y10Tooltip.style.top = `${rect.top + window.scrollY + rect.height / 2 - dom.y10Tooltip.offsetHeight / 2}px`;
    // Viewport clamp
    const tt = dom.y10Tooltip.getBoundingClientRect();
    if (tt.right > window.innerWidth - 8) {
      dom.y10Tooltip.style.left = `${rect.left + window.scrollX - tt.width - 8}px`;
    }
    if (tt.top < 8) dom.y10Tooltip.style.top = `${window.scrollY + 8}px`;
  };
}

function wireBackfillUi(
  state: ScatterState,
  dom: ScatterDom,
  options: ScatterPlotOptions,
  scatterData: ScatterDataPoint[],
  rerender: () => void,
): void {
  if (!options.needsBackfill || !options.runBackfill) return;

  const progressLabel = document.createElement('span');
  progressLabel.style.cssText =
    'font-size:10px;color:var(--di-text-secondary, #666);margin-left:6px;';
  progressLabel.textContent = 'updating…';
  dom.downvoteContainer.appendChild(progressLabel);

  options
    .runBackfill((cur, total) => {
      if (total > 0) {
        const pct = Math.round((cur / total) * 100);
        progressLabel.textContent = `${pct}%`;
      }
    })
    .then(async () => {
      state.backfillInProgress = false;
      progressLabel.remove();
      updateDownvoteButtonStyles(state, dom);
      // Refresh scatter data so the new dn fields are visible
      if (options.refreshScatterData) {
        try {
          const fresh = await options.refreshScatterData();
          scatterData.length = 0;
          scatterData.push(...fresh);
          rerender();
        } catch (e) {
          log.warn('Refresh after backfill failed', {error: e});
        }
      }
    })
    .catch(e => {
      log.warn('Backfill failed', {error: e});
      state.backfillInProgress = false;
      state.backfillFailed = true;
      progressLabel.textContent = 'failed';
      updateDownvoteButtonStyles(state, dom);
    });
}

function wireYearZoom(
  state: ScatterState,
  dom: ScatterDom,
  rerender: () => void,
  clearYThreshold: () => void,
): void {
  // Click Listener for Year Zoom
  dom.canvas.addEventListener('click', e => {
    if (Date.now() - state.lastDragEndTime < 100) return;

    const rect = dom.canvasContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const axisY = state.scale.padT + state.scale.drawH;
    if (y > axisY && y < axisY + 40 && !state.selectedYear) {
      const t =
        ((x - state.scale.padL) / state.scale.drawW) * state.scale.timeRange +
        state.scale.minDate;
      const clickedDate = new Date(t);
      const clickedYear = clickedDate.getFullYear();

      if (
        clickedYear >= new Date(state.scale.minDate).getFullYear() &&
        clickedYear <= new Date(state.scale.maxDate).getFullYear()
      ) {
        clearYThreshold();
        state.selectedYear = clickedYear;
        rerender();
      }
    }
  });

  // Hover Effect for Year Labels
  dom.canvas.addEventListener('mousemove', e => {
    if (state.dragStart) return;

    const rect = dom.canvasContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let isHand = false;
    const axisY = state.scale.padT + state.scale.drawH;
    if (y > axisY && y < axisY + 40 && !state.selectedYear) {
      const t =
        ((x - state.scale.padL) / state.scale.drawW) * state.scale.timeRange +
        state.scale.minDate;
      const hoveredYear = new Date(t).getFullYear();
      if (
        hoveredYear >= new Date(state.scale.minDate).getFullYear() &&
        hoveredYear <= new Date(state.scale.maxDate).getFullYear()
      ) {
        isHand = true;
      }
    }

    dom.canvas.style.cursor = isHand ? 'pointer' : 'crosshair';
  });
}

function wireDragSelection(
  state: ScatterState,
  dom: ScatterDom,
  scatterData: ScatterDataPoint[],
  showPopover: ShowPopoverFn,
  clearYThreshold: () => void,
): void {
  const isTouch = isTouchDevice();

  // Crosshair cursor for canvas
  dom.canvas.style.cursor = isTouch ? 'default' : 'crosshair';

  if (isTouch) return;

  dom.canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    state.ignoreNextClick = false;

    const rect = dom.canvasContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (
      x < state.scale.padL ||
      x > state.scale.padL + state.scale.drawW ||
      y < state.scale.padT ||
      y > state.scale.padT + state.scale.drawH
    )
      return;

    state.dragStart = {x, y};
    dom.selectionDiv.style.left = x + 'px';
    dom.selectionDiv.style.top = y + 'px';
    dom.selectionDiv.style.width = '0px';
    dom.selectionDiv.style.height = '0px';
    dom.selectionDiv.style.display = 'block';
  });

  // Debounced range label updater
  let rangeLabelTimer: ReturnType<typeof setTimeout> | null = null;
  const updateRangeLabel = (x1: number, x2: number, y1: number, y2: number) => {
    if (rangeLabelTimer) clearTimeout(rangeLabelTimer);
    rangeLabelTimer = setTimeout(() => {
      const xMin =
        ((Math.min(x1, x2) - state.scale.padL) / state.scale.drawW) *
          state.scale.timeRange +
        state.scale.minDate;
      const xMax =
        ((Math.max(x1, x2) - state.scale.padL) / state.scale.drawW) *
          state.scale.timeRange +
        state.scale.minDate;
      const valMin =
        ((state.scale.padT + state.scale.drawH - Math.max(y1, y2)) /
          state.scale.drawH) *
        state.scale.maxVal;
      const valMax =
        ((state.scale.padT + state.scale.drawH - Math.min(y1, y2)) /
          state.scale.drawH) *
        state.scale.maxVal;

      // Count posts in selection (must respect the same filters as the rendered view)
      const dvSel =
        state.scale.mode === 'score' ? state.activeDownvoteFilter : null;
      const count = scatterData.filter(d => {
        if (!state.activeRatingFilters[d.r as ScatterRating]) return false;
        if (dvSel !== null) {
          if (d.dn === undefined) return false;
          if (-d.dn <= dvSel) return false;
        }
        const yVal = state.scale.mode === 'tags' ? d.t || 0 : d.s;
        return d.d >= xMin && d.d <= xMax && yVal >= valMin && yVal <= valMax;
      }).length;

      const d1 = new Date(xMin).toISOString().slice(0, 10);
      const d2 = new Date(xMax).toISOString().slice(0, 10);
      const valLabel = state.scale.mode === 'tags' ? 'Tags' : 'Score';
      dom.rangeLabel.innerHTML = `${d1} ~ ${d2}<br>${valLabel}: ${Math.round(valMin)} ~ ${Math.round(valMax)} · ${count.toLocaleString()} posts`;
      dom.rangeLabel.style.display = 'block';
    }, 50);
  };

  window.addEventListener('mousemove', e => {
    if (!state.dragStart) return;
    const rect = dom.canvasContainer.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const rL = state.scale.padL;
    const rT = state.scale.padT;
    const rW = state.scale.drawW;

    const currentX = Math.max(rL, Math.min(rL + rW, mx));
    const currentY = Math.max(rT, Math.min(rect.height, my));

    const x = Math.min(state.dragStart.x, currentX);
    const y = Math.min(state.dragStart.y, currentY);
    const w = Math.abs(currentX - state.dragStart.x);
    const h = Math.abs(currentY - state.dragStart.y);

    dom.selectionDiv.style.left = x + 'px';
    dom.selectionDiv.style.top = y + 'px';
    dom.selectionDiv.style.width = w + 'px';
    dom.selectionDiv.style.height = h + 'px';

    updateRangeLabel(state.dragStart.x, currentX, state.dragStart.y, currentY);
  });

  window.addEventListener('mouseup', e => {
    if (!state.dragStart) return;
    const ds = state.dragStart;
    state.dragStart = null;
    dom.rangeLabel.style.display = 'none';
    if (rangeLabelTimer) {
      clearTimeout(rangeLabelTimer);
      rangeLabelTimer = null;
    }

    const rect = dom.canvasContainer.getBoundingClientRect();
    const endX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const endY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    if (Math.abs(endX - ds.x) >= 5 || Math.abs(endY - ds.y) >= 5) {
      state.ignoreNextClick = true;
      state.lastDragEndTime = Date.now();
      clearYThreshold();
    }

    // A click (not a drag) → hide the selection box
    if (Math.abs(endX - ds.x) < 5 && Math.abs(endY - ds.y) < 5) {
      dom.selectionDiv.style.display = 'none';
      return;
    }

    const x1 = Math.min(ds.x, endX);
    const x2 = Math.max(ds.x, endX);
    const y1 = Math.min(ds.y, endY);
    const y2 = Math.max(ds.y, endY);

    const xMin =
      ((x1 - state.scale.padL) / state.scale.drawW) * state.scale.timeRange +
      state.scale.minDate;
    const xMax =
      ((x2 - state.scale.padL) / state.scale.drawW) * state.scale.timeRange +
      state.scale.minDate;

    const valMin =
      ((state.scale.padT + state.scale.drawH - y2) / state.scale.drawH) *
      state.scale.maxVal;
    const valMax =
      ((state.scale.padT + state.scale.drawH - y1) / state.scale.drawH) *
      state.scale.maxVal;

    const dvRes =
      state.scale.mode === 'score' ? state.activeDownvoteFilter : null;
    const result = scatterData.filter(d => {
      if (!state.activeRatingFilters[d.r as ScatterRating]) return false;
      if (dvRes !== null) {
        if (d.dn === undefined) return false;
        if (-d.dn <= dvRes) return false;
      }
      const yVal = state.scale.mode === 'tags' ? d.t || 0 : d.s;
      return d.d >= xMin && d.d <= xMax && yVal >= valMin && yVal <= valMax;
    });

    if (result.length === 0) {
      dom.selectionDiv.style.display = 'none';
      return;
    }

    const sortedList = result.sort((a, b) => {
      const vA = state.scale.mode === 'tags' ? a.t || 0 : a.s;
      const vB = state.scale.mode === 'tags' ? b.t || 0 : b.s;
      return vB - vA;
    });

    let aDMin = Infinity,
      aDMax = -Infinity;
    let aVMin = Infinity,
      aVMax = -Infinity;

    sortedList.forEach(d => {
      if (d.d < aDMin) aDMin = d.d;
      if (d.d > aDMax) aDMax = d.d;

      const v = state.scale.mode === 'tags' ? d.t || 0 : d.s;
      if (v < aVMin) aVMin = v;
      if (v > aVMax) aVMax = v;
    });

    showPopover(e.clientX, e.clientY, sortedList, aDMin, aDMax, aVMin, aVMax);
  });
}

// ============================================================
// Popover
// ============================================================

type ShowPopoverFn = (
  mx: number,
  my: number,
  items: ScatterDataPoint[],
  dMin: number,
  dMax: number,
  sMin: number,
  sMax: number,
) => void;

function createScatterPopover(
  state: ScatterState,
  dom: ScatterDom,
  options: ScatterPlotOptions,
): ShowPopoverFn {
  // Document-level mousedown handler to dismiss popover when clicking outside
  document.addEventListener('mousedown', e => {
    if (
      dom.popover.style.display !== 'none' &&
      !dom.popover.contains(e.target as Node)
    ) {
      dom.popover.style.display = 'none';
      dom.selectionDiv.style.display = 'none';
      hidePostHoverCard();
    }
  });

  return (mx, my, items, dMin, dMax, sMin, sMax) => {
    const xLabel = `${new Date(dMin).toLocaleDateString()} ~ ${new Date(dMax).toLocaleDateString()}`;
    const sm1 = Math.floor(sMin);
    const sm2 = Math.ceil(sMax);
    const totalCount = items.length;
    const isTags = state.scale.mode === 'tags';
    let visibleLimit = 50;

    const renderItems = (start: number, limit: number) => {
      let chunkHtml = '';
      const slice = items.slice(start, start + limit);

      slice.forEach((it: ScatterDataPoint) => {
        const itDate = new Date(it.d).toLocaleDateString();
        const val = isTags ? it.t || 0 : it.s;
        // Deleted or banned posts show a gray dot regardless of rating
        const isRemoved = it.del === true || it.ban === true;
        let color = '#ccc';
        if (isRemoved) {
          color = '#9ca3af';
        } else if (it.r === 'g') color = '#4caf50';
        else if (it.r === 's') color = '#ffb74d';
        else if (it.r === 'q') color = '#ab47bc';
        else if (it.r === 'e') color = '#f44336';

        const statusTitle =
          it.ban === true ? 'Banned' : it.del === true ? 'Deleted' : '';
        const titleAttr = statusTitle ? ` title="${statusTitle}"` : '';

        chunkHtml += `
         <div class="pop-item" data-id="${it.id}" style="padding: 8px 15px; border-bottom: 1px solid var(--di-table-border, #f0f0f0); display: flex; align-items: center; cursor: pointer; transition: bg 0.2s;">
           <div${titleAttr} style="width: 10px; height: 10px; border-radius: 50%; background: ${color}; margin-right: 10px;"></div>
           <span style="width: 60px; color: var(--di-link, #007bff); font-weight: 500; font-size: 13px; margin-right: 10px;">#${it.id}</span>
           <span style="flex: 1; color: var(--di-text-secondary, #666); font-size: 12px;">${itDate}</span>
           <span style="font-weight: bold; color: var(--di-text, #333); font-size: 13px;">${val}</span>
         </div>
       `;
      });
      return chunkHtml;
    };

    const headerHtml = `
     <div style="padding: 10px 15px; background: var(--di-bg-secondary, #f9f9f9); border-bottom: 1px solid var(--di-border-light, #eee); display: flex; justify-content: space-between; align-items: start;">
       <div style="display:flex; flex-direction:column;">
          <span style="font-weight: 600; font-size: 13px; color: var(--di-text, #333);">${xLabel}</span>
          <span style="font-size: 11px; color: var(--di-text-secondary, #666); margin-top:2px;">${isTags ? 'Tag Count' : 'Score'}: ${sm1} ~ ${sm2}</span>
       </div>
       <div style="display:flex; align-items:center; gap: 10px; margin-top:2px;">
         <span id="pop-count-label" style="font-size: 12px; color: var(--di-text-muted, #888);">${Math.min(visibleLimit, totalCount)} / ${totalCount} items</span>
         <button id="scatter-pop-close" style="background:none; border:none; color:var(--di-text-faint, #999); font-size:16px; cursor:pointer; line-height:1; padding:0;">&times;</button>
       </div>
     </div>
     <div id="pop-list-container" style="flex: 1; overflow-y: auto;">
       ${renderItems(0, visibleLimit)}
     </div>
     <div id="pop-load-more" style="display: ${totalCount > visibleLimit ? 'block' : 'none'}; padding: 10px; text-align: center; border-top: 1px solid var(--di-border-light, #eee); background: var(--di-bg, #fff);">
        <button id="btn-load-more" style="width: 100%; padding: 6px; background: var(--di-bg-tertiary, #f0f0f0); border: none; border-radius: 4px; color: var(--di-text-secondary, #666); cursor: pointer; font-size: 12px;">Load More (+50)</button>
     </div>
   `;

    dom.popover.innerHTML = headerHtml;

    const attachEvents = (parent: Element | null) => {
      if (!parent) return;
      parent.querySelectorAll('.pop-item').forEach(el => {
        const htmlEl = el as HTMLElement;
        htmlEl.onmouseover = () => (htmlEl.style.backgroundColor = '#f5f9ff');
        htmlEl.onmouseout = () =>
          (htmlEl.style.backgroundColor = 'transparent');
        htmlEl.onclick = () =>
          window.open(`/posts/${htmlEl.dataset.id}`, '_blank');
        // Hover preview card (debounced + cached, desktop only).
        // Position the card next to the popover, not the small list item,
        // so it doesn't overlap the list.
        if (options.fetchPostDetails) {
          const postId = parseInt(htmlEl.dataset.id ?? '0');
          if (postId)
            attachPostHoverCard(
              htmlEl,
              postId,
              options.fetchPostDetails,
              dom.popover,
            );
        }
      });
    };

    attachEvents(dom.popover.querySelector('#pop-list-container'));

    const closeBtn = dom.popover.querySelector(
      '#scatter-pop-close',
    ) as HTMLElement;
    if (closeBtn) {
      closeBtn.onclick = e => {
        e.stopPropagation();
        dom.popover.style.display = 'none';
        dom.selectionDiv.style.display = 'none';
        hidePostHoverCard();
      };
    }

    const loadMoreContainer = dom.popover.querySelector(
      '#pop-load-more',
    ) as HTMLElement;
    const loadMoreBtn = dom.popover.querySelector(
      '#btn-load-more',
    ) as HTMLElement;
    const listContainer = dom.popover.querySelector(
      '#pop-list-container',
    ) as HTMLElement;
    const popCountLabel = dom.popover.querySelector(
      '#pop-count-label',
    ) as HTMLElement;

    if (loadMoreBtn) {
      loadMoreBtn.onclick = () => {
        const start = visibleLimit;
        visibleLimit += 50;
        const newHtml = renderItems(start, 50);

        listContainer.insertAdjacentHTML('beforeend', newHtml);
        attachEvents(listContainer);

        popCountLabel.textContent = `${Math.min(visibleLimit, totalCount)} / ${totalCount} items`;

        if (visibleLimit >= totalCount) {
          loadMoreContainer.style.display = 'none';
        }
      };
    }

    // Sync dashboard theme from the scatter's ancestor container
    const themedAncestor = dom.wrapper.closest('[data-di-theme]');
    if (themedAncestor?.getAttribute('data-di-theme') === 'dark') {
      dom.popover.setAttribute('data-di-theme', 'dark');
    } else {
      dom.popover.removeAttribute('data-di-theme');
    }

    dom.popover.style.display = 'flex';
    const pH = dom.popover.offsetHeight || 300;

    let posX = mx + 15;
    let posY = my + 15;

    if (posX + 320 > window.innerWidth) posX = window.innerWidth - 320 - 10;
    if (posX < 10) posX = 10;

    if (posY + pH > window.innerHeight) posY = window.innerHeight - pH - 10;
    if (posY < 10) posY = 10;

    dom.popover.style.left = posX + 'px';
    dom.popover.style.top = posY + 'px';
  };
}

// ============================================================
// Main entry — orchestrator
// ============================================================

/**
 * Renders the scatter plot widget (canvas-based, with popover).
 *
 * Decomposed (Task 5) into:
 * - {@link buildScatterDom}: pure DOM construction (no event handlers)
 * - {@link createInitialScatterState}: state object init
 * - {@link renderScatterCanvas}: canvas rendering, orchestrates 7 sub-helpers
 *   ({@link computeScatterScale}, {@link filterVisiblePoints},
 *   {@link drawScatterGrid}, {@link drawY10Emphasis}, {@link drawScatterAxis},
 *   {@link drawScatterPoints}, {@link drawScatterOverlays})
 * - {@link createScatterPopover}: popover renderer factory
 * - 8 `wire*` controllers: event handler wire-up per concern
 *
 * @param container The dashboard div to append the widget into.
 * @param scatterData Pre-fetched scatter plot data points.
 * @param context The chart context providing user information.
 * @param levelChanges Pre-fetched level change events.
 * @param options Optional extras (user stats, backfill).
 */
export function renderScatterPlot(
  container: HTMLElement,
  scatterData: ScatterDataPoint[],
  context: ChartContext,
  levelChanges: LevelChangeEvent[],
  options: ScatterPlotOptions = {},
): void {
  const dom = buildScatterDom();
  const state = createInitialScatterState(options);
  const userName = context.targetUser?.normalizedName ?? '';

  // Two-step tap controller for Y-grid threshold on touch devices.
  // First tap on a value → highlight; second tap on the same value → navigate.
  // Outside tap auto-resets via the controller's document handler.
  const twoStepTap = createTwoStepTap<number>({
    insideElements: () => Array.from(dom.gridHitsContainer.children),
    onFirstTap: val => {
      state.activeYThreshold = val;
      rerender();
    },
    onSecondTap: val => {
      // Read state.mode live so a (hypothetical) mode switch between taps is
      // honored. Mode toggles also trigger clearYThreshold so this is academic.
      const url = buildPostsUrlForThreshold(userName, state.mode, val);
      // Clear highlight before navigating: the controller's internal
      // activeDatum is already null at this point, but the widget's own
      // activeYThreshold needs an explicit reset so the dim/line UI doesn't
      // persist when the user returns to the page.
      state.activeYThreshold = null;
      rerender();
      window.open(url, '_blank');
    },
    onReset: () => {
      state.activeYThreshold = null;
      rerender();
    },
  });

  // Centralized Y-threshold reset — invoked by handlers that change scale
  // (mode toggle, year zoom in/out, drag select) so the highlight doesn't
  // become stale or meaningless after the underlying scale changes.
  const clearYThreshold = () => {
    if (state.activeYThreshold !== null) {
      state.activeYThreshold = null;
      twoStepTap.reset();
    }
  };

  // Re-render trigger closure: captured by every wire* helper.
  const rerender = () =>
    renderScatterCanvas(
      state,
      dom,
      scatterData,
      context,
      levelChanges,
      options,
      userName,
      twoStepTap,
      rerender,
    );

  // Wire control panels (top-bar buttons + filters + reset)
  wireModeToggle(state, dom, rerender, clearYThreshold);
  wireDownvoteFilter(state, dom, rerender);
  wireRatingFilter(state, dom, rerender);
  wireYearReset(state, dom, rerender, clearYThreshold);

  // Wire the Y=10 hit affordance (Tag Count mode tooltip)
  wireY10Tooltip(state, dom, options, context, rerender);

  // Popover renderer (returns the showPopover function captured by drag wire)
  const showPopover = createScatterPopover(state, dom, options);

  // Wire interaction handlers (year zoom + drag-to-select)
  wireYearZoom(state, dom, rerender, clearYThreshold);
  wireDragSelection(state, dom, scatterData, showPopover, clearYThreshold);

  // Initial mode visibility for downvote container (mirrors pre-decomposition order)
  updateDownvoteVisibility(state, dom);

  // Mount + initial render + resize listener
  container.appendChild(dom.wrapper);

  // Backfill (if needed) is started after mount so the progress label is
  // visible immediately, matching pre-decomposition behavior.
  wireBackfillUi(state, dom, options, scatterData, rerender);

  requestAnimationFrame(rerender);
  window.addEventListener('resize', rerender);
}

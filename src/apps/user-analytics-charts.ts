import * as d3 from 'd3';
import {createLogger} from '../core/logger';
import {AnalyticsDataManager} from '../core/analytics-data-manager';
import {createBodyTooltip} from '../ui/popover-utils';
import {
  cancelSubtagTooltipHide,
  hideSubtagTooltip,
  isSubtagTooltipVisible,
  showSubtagTooltip,
  type SubtagTooltipItem,
} from '../ui/subtag-breakdown-tooltip';

const log = createLogger('UserAnalyticsCharts');
import type {
  LevelChangeEvent,
  MonthlyStatEntry,
} from '../core/analytics-data-manager';
import {escapeHtml, getBestThumbnailUrl} from '../utils';
import {
  buildSearchQuery,
  computePercentages,
  pickFittingPosition,
  safeColor,
  safeThumbUrl,
} from './user-analytics-pie-helpers';
import type {Database} from '../core/database';
import type {
  D3Any,
  TargetUser,
  DistributionItem,
  DanbooruPost,
  MilestoneEntry,
} from '../types';
import {
  isTouchDevice,
  createTwoStepTap,
  TapTracker,
  type TwoStepTapController,
} from '../ui/two-step-tap';
import type {PieDetails, PieSlice} from './user-analytics-data';

/** Context needed by chart widgets that access user data. */
export interface ChartContext {
  targetUser: TargetUser;
}

/**
 * Union type for pie chart tab data. The `status` and `rating` tabs return
 * different shapes from getStatusDistribution/getRatingDistribution —
 * those don't include `frequency`, `thumb`, or `isOther`. All other tabs
 * return full `DistributionItem`s.
 */
type PieTabItem =
  | DistributionItem
  | {
      name?: string;
      rating?: string;
      count: number;
      label?: string;
      isOther?: boolean;
      color?: string;
      frequency?: number;
      thumb?: string | null;
    };

/**
 * Real types returned by getTopPostsByType / getRecentPopularPosts / getRandomPosts.
 * These are indexed by rating key or sfw/nsfw — NOT a single DanbooruPost.
 */
type TopPostsByRating = {
  g: DanbooruPost | null;
  s: DanbooruPost | null;
  q: DanbooruPost | null;
  e: DanbooruPost | null;
};
type TopPostsBySfw = {sfw: DanbooruPost | null; nsfw: DanbooruPost | null};

// ============================================================
// PIE CHART WIDGET
// ============================================================

/**
 * SVG/wrapper size in px. Sized larger than the visible chart so arcHover
 * (1.2× outer radius) and the 3D rotateX(40deg) perspective have room to
 * extend without bleeding into the legend or the mobile sticky header.
 *
 * Visible chart diameter = PIE_RADIUS * 2 = 140 px (unchanged from before).
 * Hover headroom = PIE_SVG_SIZE / 2 - PIE_RADIUS * 1.2 = 110 - 84 = 26 px.
 */
const PIE_SVG_SIZE = 220;
const PIE_RADIUS = 70;

// ============================================================
// PIE WIDGET — MODULE-LEVEL CONSTANTS
// ============================================================

/** Slice colors for the rating tab. */
const RATING_COLORS: Record<string, string> = {
  g: '#28a745',
  s: '#fd7e14',
  q: '#6f42c1',
  e: '#dc3545',
};
/** Human-readable labels for the rating tab. */
const RATING_LABELS: Record<string, string> = {
  g: 'General',
  s: 'Sensitive',
  q: 'Questionable',
  e: 'Explicit',
};
/** Default 16-color palette used when the source data does not provide a
 *  custom color (hair_color does; status uses STATUS_COLORS instead). */
const PIE_PALETTE = [
  '#e91e63',
  '#9c27b0',
  '#673ab7',
  '#3f51b5',
  '#2196f3',
  '#03a9f4',
  '#00bcd4',
  '#009688',
  '#4caf50',
  '#8bc34a',
  '#cddc39',
  '#ffeb3b',
  '#ffc107',
  '#ff9800',
  '#ff5722',
  '#795548',
];
/** Override colors for the status tab; overlaid by fetchDistributionForTab
 *  before slices are processed. */
const STATUS_COLORS: Record<string, string> = {
  active: '#2da44e',
  deleted: '#d73a49',
  pending: '#0969da',
  flagged: '#cf222e',
  banned: '#6e7781',
  appealed: '#bf3989',
};
/** Per-tab legend header. Falls back to 'DIST.' for unknown tabs. */
const LEGEND_TITLES: Record<string, string> = {
  copyright: 'COPYRIGHTS',
  character: 'CHARACTERS',
  fav_copyright: 'FAVORITE COPYRIGHTS',
  status: 'STATUS',
  rating: 'RATINGS',
  hair_length: 'HAIR LENGTH',
  hair_color: 'HAIR COLOR',
  breasts: 'BREASTS',
  gender: 'GENDER',
  commentary: 'COMMENTARY',
  translation: 'TRANSLATION',
};
/** Custom categorical order for the hair_length tab (count-based sort would
 *  reorder buckets in non-intuitive ways). */
const HAIR_LENGTH_ORDER = [
  'Bald',
  'Very Short Hair',
  'Short Hair',
  'Medium Hair',
  'Long Hair',
  'Very Long Hair',
  'Absurdly Long Hair',
];

// ============================================================
// PIE WIDGET — FILE-PRIVATE HELPERS
// ============================================================

/**
 * Normalize a count-only distribution into the {frequency, value, label,
 * details} shape used by the four "ratio" tabs (breasts, gender,
 * commentary, translation). Pure — produces a new array.
 */
function preprocessFrequencyTab(data: PieTabItem[]): PieTabItem[] {
  const total = data.reduce((acc: number, c: PieTabItem) => acc + c.count, 0);
  return data.map((d: PieTabItem) => ({
    ...d,
    frequency: total > 0 ? d.count / total : 0,
    value: total > 0 ? d.count / total : 0,
    label: d.name,
    details: {...d, thumb: null},
  }));
}

/**
 * Map a per-tab PieTabItem[] to the unified PieSlice[] shape consumed by
 * D3 (value+label+color+details). Centralizes the per-tab branching:
 * rating/status get hardcoded color+label tables, hair_color respects the
 * upstream-supplied color, everything else falls back to PIE_PALETTE.
 * Pure.
 */
function processSlices(data: PieTabItem[], currentPieTab: string): PieSlice[] {
  // T-26 baseline: arrow complexity 22. Tab-specific normalization (status
  // colors, rating labels, hair_color passthrough, tag fallbacks). Pure
  // mapping; refactor would be splitting per tab — over-abstraction risk.
  // eslint-disable-next-line complexity
  return data.map((d: PieTabItem, i: number) => {
    // Widen to a single shape — the union members from PieTabItem all
    // expose these fields optionally, but the type system doesn't narrow
    // them per-tab here.
    const item = d as {
      name?: string;
      rating?: string;
      label?: string;
      tagName?: string;
      originalTag?: string;
      isOther?: boolean;
      color?: string;
      frequency?: number;
      thumb?: string | null;
      count: number;
    };

    const tagDetails = (): PieDetails => ({
      kind: 'tag',
      tagName: item.tagName,
      originalTag: item.originalTag,
      isOther: item.isOther,
      count: item.count,
      thumb: item.thumb,
      color: item.color,
      frequency: item.frequency,
      name: item.name,
      // Carry sub-tag breakdown when present (Copy / Fav_Copy / Char tabs).
      // PieTabItem is a union — DistributionItem carries subTags, plain
      // tab item does not. Cast through DistributionItem since both
      // optional fields resolve to the same type at runtime.
      subTags: (item as DistributionItem).subTags,
    });

    if (
      [
        'rating',
        'status',
        'breasts',
        'hair_length',
        'hair_color',
        'gender',
        'commentary',
        'translation',
      ].includes(currentPieTab)
    ) {
      let details: PieDetails;
      if (currentPieTab === 'rating') {
        details = {
          kind: 'rating',
          rating: (item.rating ?? '') as 'g' | 's' | 'q' | 'e' | '',
          count: item.count,
          label: item.label,
          thumb: item.thumb,
        };
      } else if (currentPieTab === 'status') {
        details = {
          kind: 'status',
          name: item.name ?? '',
          count: item.count,
          label: item.label,
          thumb: item.thumb,
        };
      } else {
        details = tagDetails();
      }
      return {
        value: item.count,
        label:
          currentPieTab === 'rating'
            ? RATING_LABELS[item.rating as keyof typeof RATING_LABELS] ||
              item.rating ||
              ''
            : item.label || item.name || '',
        color:
          currentPieTab === 'rating'
            ? RATING_COLORS[item.rating as keyof typeof RATING_COLORS] || '#999'
            : currentPieTab === 'hair_color' && item.color
              ? item.color
              : item.color ||
                (item.isOther
                  ? '#bdbdbd'
                  : PIE_PALETTE[i % PIE_PALETTE.length]),
        details,
      };
    } else {
      let sliceColor = item.isOther
        ? '#bdbdbd'
        : PIE_PALETTE[i % PIE_PALETTE.length];
      if (currentPieTab === 'hair_color' && item.color) {
        sliceColor = item.color;
      }
      return {
        value: item.frequency ?? 0,
        label: item.name ?? '',
        color: sliceColor,
        details: tagDetails(),
      };
    }
  });
}

/**
 * Toggle the chart wrapper's drop shadow. Used by sub-chart mode to hide
 * the dark disk while displaying a partial-coverage sub-breakdown (the
 * shadow bleeds through the gaps and around the edges of small slices,
 * making them read as black-tinted). No-op on Firefox builds where
 * `buildChartScaffolding` skips the shadow entirely.
 */
function setShadowVisibility(chartWrapper: HTMLElement, visible: boolean) {
  const shadow = chartWrapper.querySelector<HTMLElement>('.di-pie-shadow');
  if (shadow) shadow.style.opacity = visible ? '1' : '0';
}

/**
 * Build the slice list for the "sub-chart" view that replaces the pie
 * temporarily when a Copy/Fav_Copy/Char legend row is hovered. Pulls the
 * parent's pre-computed `subTags` (see attachSubTagBreakdowns) and
 * merges two Others sources into one row:
 *   1. applySubTagBreakdown's 95%-bucket Others (sub-sum tail)
 *   2. post-coverage Others = max(0, parent.count − Σ sub.count) — the
 *      "parent only" posts. Zero when overlap inflates the sub sum past
 *      the parent count (same post holds two sibling subs).
 *
 * When the parent has no sub data: `parentColor` provided → single
 * full-circle slice for the parent itself (lets any legend row drill in);
 * `parentColor` omitted → returns `[]`.
 */
export function buildSubChartSlices(
  parent: DistributionItem,
  parentColor?: string,
): PieSlice[] {
  const allSubs = parent.subTags ?? [];
  const displaySubs = allSubs.filter(s => !s.isOther);
  // Fallback to single-parent slice when there are no displayable subs
  // — covers both "no subTags at all" and "only the applySubTagBreakdown
  // Others bucket survives" (showing just an Others slice would be
  // meaningless, the parent itself is more useful).
  if (displaySubs.length === 0) {
    if (!parentColor) return [];
    const parentLabel = (parent.name || parent.tagName || '').replace(
      /_/g,
      ' ',
    );
    return [
      {
        value: Math.max(1, parent.count ?? 0),
        label: parentLabel,
        color: parentColor,
        details: {
          kind: 'tag',
          tagName: parent.tagName,
          name: parentLabel,
          count: parent.count ?? 0,
          isOther: false,
          thumb: null,
        },
      },
    ];
  }

  const applyOthers = allSubs.filter(s => s.isOther);
  const subSum = displaySubs.reduce((acc, s) => acc + s.count, 0);
  const applyOthersCount = applyOthers.reduce((acc, s) => acc + s.count, 0);
  const parentCount = parent.count ?? 0;
  const postCoverageOthers = Math.max(
    0,
    parentCount - subSum - applyOthersCount,
  );
  const totalOthers = applyOthersCount + postCoverageOthers;

  const slices: PieSlice[] = displaySubs.map((s, i) => ({
    value: s.count,
    label: s.tagName.replace(/_/g, ' '),
    color: PIE_PALETTE[i % PIE_PALETTE.length],
    details: {
      kind: 'tag',
      tagName: s.tagName,
      name: s.tagName.replace(/_/g, ' '),
      count: s.count,
      isOther: false,
      thumb: null,
    },
  }));

  if (totalOthers > 0) {
    slices.push({
      value: totalOthers,
      label: 'Others',
      color: '#bdbdbd',
      details: {
        kind: 'tag',
        name: 'Others',
        count: totalOthers,
        isOther: true,
        thumb: null,
      },
    });
  }

  return slices;
}

/**
 * Convert sub-chart PieSlices into the SubtagTooltipItem rows the
 * tooltip renders. Share is computed against the **parent's** count
 * (not the sub-sum) so the tooltip and chart agree on every percentage:
 * a parent like `ninjago` with one sub `dragons rising` (30 out of 212)
 * shows "14% / 30" in both places, plus an "Others 86% / 182" row that
 * matches the chart's grey slice.
 *
 * Falls back to sub-sum-base if parentCount is 0 — defensive only;
 * buildSubChartSlices already guards against that case by returning [].
 */
export function subSlicesToTooltipItems(
  slices: PieSlice[],
  parentCount: number,
  queryPrefix: string,
): SubtagTooltipItem[] {
  const base =
    parentCount > 0 ? parentCount : slices.reduce((acc, s) => acc + s.value, 0);
  // Others is non-clickable: the slice bundles both post-coverage Others
  // (parent only) and the applySubTagBreakdown long tail (subs trimmed
  // by the 95% threshold). No single Danbooru query covers both without
  // enumerating every displayed sub as `-` exclusions, which bloats the
  // URL past readability — so we ship no link rather than a partial one.
  return slices.map(s => {
    const details = s.details as {tagName?: string; isOther?: boolean};
    const isOther = !!details.isOther;
    const tagName = isOther ? 'Others' : (details.tagName ?? '');
    return {
      tagName,
      displayName: isOther ? 'Others' : tagName.replace(/_/g, ' '),
      count: s.value,
      share: base > 0 ? s.value / base : 0,
      href: isOther
        ? ''
        : `/posts?tags=${encodeURIComponent(`${queryPrefix} ${tagName}`)}`,
      isOther,
    };
  });
}

/**
 * Build the tooltip body HTML for a single pie slice (thumb + label +
 * count/freq lines). Shared by the desktop mouseover handler and the
 * mobile touch handler so they stay in sync byte-for-byte.
 */
function buildSliceTooltipHtml(args: {
  details: PieDetails;
  color: string;
  label: string;
  currentPieTab: string;
  percentage: string;
}): string {
  const {details, color, label, currentPieTab, percentage} = args;
  const safeThumb = safeThumbUrl(details.thumb);
  const thumbHtml = safeThumb
    ? `
        <div style="width: 80px; height: 80px; border-radius: 4px; overflow: hidden; background: #333; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
          <img src="${escapeHtml(safeThumb)}" style="width: 100%; height: 100%; object-fit: cover;">
        </div>`
    : '';
  const sliceColor = safeColor(color);
  const safeLabel = escapeHtml(label);
  const isOtherSlice = details.kind === 'tag' && !!details.isOther;

  if (currentPieTab === 'rating') {
    return `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div>
              <div style="font-weight: bold; color: ${sliceColor}; margin-bottom: 4px; font-size: 14px;">${safeLabel}</div>
              <div style="font-size: 11px; color: #ccc;">Count: <strong style="color:#fff;">${details.count.toLocaleString()}</strong></div>
              <div style="font-size: 11px; color: #ccc;">Ratio: <strong style="color:#fff;">${percentage}</strong></div>
            </div>
          </div>
        `;
  }
  return `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div style="max-width: 180px;">
              <div style="font-weight: bold; color: ${sliceColor}; margin-bottom: 4px; font-size: 14px; word-wrap: break-word;">${safeLabel}</div>
              <div style="font-size: 11px; color: #ccc;">Freq: <strong style="color:#fff;">${percentage}</strong></div>
              ${!isOtherSlice ? `<div style="font-size: 11px; color: #ccc;">Posts: <strong style="color:#fff;">${details.count ? details.count.toLocaleString() : '?'}</strong></div>` : ''}
            </div>
          </div>
        `;
}

/**
 * One-time creation of the chart wrapper (sized for arcHover headroom +
 * 3D rotateX perspective), inner SVG/g, the 3D shadow overlay, and the
 * scrollable legend container with inline scrollbar styling. Returns the
 * chart wrapper so the caller can grab the d3 selection from it.
 *
 * Firefox is special-cased — it breaks SVG pointer events under
 * transform-style:preserve-3d, so we fall back to a flat hover scale.
 */
function buildChartScaffolding(
  pieContent: HTMLElement,
  isFirefox: boolean,
): HTMLElement {
  pieContent.innerHTML = '';

  const chartWrapper = document.createElement('div');
  chartWrapper.className = 'pie-chart-wrapper';
  // Wrapper is sized larger than the visible chart (140px diameter at
  // radius 70) to give arcHover (1.2× scale) and the 3D rotateX(40deg)
  // perspective room to extend without bleeding into the legend or the
  // mobile sticky-header. See PIE_SVG_SIZE / PIE_RADIUS above.
  chartWrapper.style.width = `${PIE_SVG_SIZE}px`;
  chartWrapper.style.height = `${PIE_SVG_SIZE}px`;
  chartWrapper.style.cursor = 'pointer';

  if (!isFirefox) {
    // 3D tilt effect (Chrome/Safari/Edge only — Firefox breaks SVG pointer events)
    chartWrapper.style.transformStyle = 'preserve-3d';
    chartWrapper.style.transform = 'rotateX(40deg) rotateY(0deg)';
    chartWrapper.style.transition =
      'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';

    const shadow = document.createElement('div');
    // class hook for sub-mode hide (Fix I) — the shadow sits behind the
    // svg at translateZ(-10px) + blur(5px), so for sub-charts whose
    // slices don't cover the full disk (ninjago: 1 sub + Others; honkai:
    // 3 sub + tiny Others) the dark disk bleeds through the gaps and
    // around the edges, making the slice colors read as "black-ish". We
    // toggle it off during sub-chart mode and back on when exiting.
    shadow.className = 'di-pie-shadow';
    shadow.style.position = 'absolute';
    shadow.style.top = '50%';
    shadow.style.left = '50%';
    shadow.style.width = '140px';
    shadow.style.height = '140px';
    shadow.style.transform = 'translate(-50%, -50%) translateZ(-10px)';
    shadow.style.borderRadius = '50%';
    shadow.style.background = 'var(--di-shadow, rgba(0,0,0,0.2))';
    shadow.style.filter = 'blur(5px)';
    shadow.style.transition = 'opacity 0.15s ease-out';
    chartWrapper.appendChild(shadow);

    chartWrapper.addEventListener('mouseenter', () => {
      chartWrapper.style.transform = 'rotateX(0deg) scale(1.1)';
      shadow.style.transform =
        'translate(-50%, -50%) translateZ(-30px) scale(0.9)';
      shadow.style.opacity = '0.5';
    });
    chartWrapper.addEventListener('mouseleave', () => {
      chartWrapper.style.transform = 'rotateX(40deg)';
      shadow.style.transform = 'translate(-50%, -50%) translateZ(-10px)';
      shadow.style.opacity = '1';
    });
  } else {
    // Firefox: simple hover scale (no 3D)
    chartWrapper.style.transition = 'transform 0.3s ease';
    chartWrapper.addEventListener('mouseenter', () => {
      chartWrapper.style.transform = 'scale(1.05)';
    });
    chartWrapper.addEventListener('mouseleave', () => {
      chartWrapper.style.transform = 'none';
    });
  }

  pieContent.appendChild(chartWrapper);

  d3.select(chartWrapper)
    .append('svg')
    .attr('width', PIE_SVG_SIZE)
    .attr('height', PIE_SVG_SIZE)
    .style('overflow', 'visible')
    .append('g')
    .attr('transform', `translate(${PIE_SVG_SIZE / 2},${PIE_SVG_SIZE / 2})`);

  const legendDiv = document.createElement('div');
  legendDiv.className = 'danbooru-grass-legend-scroll';
  legendDiv.style.display = 'flex';
  legendDiv.style.flexDirection = 'column';
  legendDiv.style.marginLeft = '20px';
  legendDiv.style.maxHeight = `${PIE_SVG_SIZE}px`;
  legendDiv.style.overflowY = 'auto';
  legendDiv.style.paddingRight = '5px';

  const scrollbarStyle = document.createElement('style');
  scrollbarStyle.innerHTML = `
          .danbooru-grass-legend-scroll::-webkit-scrollbar { width: 6px; }
          .danbooru-grass-legend-scroll::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 3px; }
          .danbooru-grass-legend-scroll::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 3px; }
          .danbooru-grass-legend-scroll::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
       `;
  legendDiv.appendChild(scrollbarStyle);
  pieContent.appendChild(legendDiv);

  return chartWrapper;
}

/**
 * Bind the desktop D3 path join (enter/update with arc transition) and
 * the mouseover/mousemove/mouseout/click handlers driving the hover
 * tooltip. Touch devices are filtered out at the start of each handler
 * because browsers synthesize mouseover/move/out after a touchend and
 * those would clobber the touch-relative placement done by
 * bindTouchPieInteractions.
 */
function bindDesktopPieInteractions(args: {
  svg: D3Any;
  validData: PieSlice[];
  pie: D3Any;
  arc: D3Any;
  arcHover: D3Any;
  tooltip: D3Any;
  isTouch: boolean;
  currentPieTab: string;
  pctFor: (label: string) => string;
  handlePieClick: (d: d3.PieArcDatum<PieSlice>) => void;
}): void {
  const {
    svg,
    validData,
    pie,
    arc,
    arcHover,
    tooltip,
    isTouch,
    currentPieTab,
    pctFor,
    handlePieClick,
  } = args;
  svg
    .selectAll('path')
    .data(pie(validData), (d: D3Any) => d.data.label)
    .join(
      (enter: D3Any) =>
        enter
          .append('path')
          .attr('class', 'danbooru-grass-pie-path')
          .attr('d', arc)
          .attr('fill', (d: D3Any) => d.data.color)
          .style('opacity', '0.9')
          .style('cursor', 'pointer'),
      // No fill transition on update — a previous 500ms tween interpolated
      // through dark midpoints during sub-mode re-binds (e.g. blue → red
      // through near-black), making fast hover changes flash black.
      // opacity + filter are also reset because the shared 'Others' path
      // can carry stale inline values from an in-flight
      // subRowHighlight transition or a slice's own hover (whose
      // mouseout never clears `filter: drop-shadow(...)`) — without
      // resetting, the path renders dimmed or with a stale halo through
      // the fade-in of a main-pie return.
      (update: D3Any) =>
        update
          .attr('class', 'danbooru-grass-pie-path')
          .attr('d', arc)
          .attr('fill', (d: D3Any) => d.data.color)
          .style('opacity', '0.9')
          .style('filter', null),
      // Explicit exit (matches default but documents the contract):
      // sub-mode rebinds the entire slice set per hover, so any path
      // whose label isn't in the new data MUST go away — otherwise the
      // svg accumulates ghost paths visible as faint slices behind the
      // active ones.
      (exit: D3Any) => exit.remove(),
    )
    .attr('stroke', 'var(--di-chart-bg, #fff)')
    .style('stroke-width', '1px')
    .on(
      'mouseover',
      function (
        this: SVGPathElement,
        event: MouseEvent,
        d: d3.PieArcDatum<PieSlice>,
      ) {
        // Touch devices fire synthetic mouseover/mousemove/mouseout AFTER
        // touchend at the touch position. Without this guard, the synthetic
        // mouseover would overwrite handleSliceTouch's far-side tooltip
        // placement with a touch-relative one — re-introducing the right-edge
        // clipping the touch path was specifically built to avoid.
        if (isTouch) return;
        d3.select(this)
          .transition()
          .duration(200)
          .attr(
            'd',
            (td: unknown) => arcHover(td as d3.PieArcDatum<PieSlice>) ?? '',
          )
          .style('opacity', '1')
          .style('filter', 'drop-shadow(0px 0px 8px rgba(255,255,255,0.4))');

        const html = buildSliceTooltipHtml({
          details: d.data.details,
          color: d.data.color,
          label: d.data.label,
          currentPieTab,
          percentage: pctFor(d.data.label),
        });

        // Position before opacity — otherwise the tooltip flashes at the
        // previous tap's coordinates for one paint frame (offsetWidth read
        // by other code paths forces an intermediate render at the stale
        // position). Including the cursor position here also covers the
        // gap before the first mousemove event.
        tooltip
          .html(html)
          .style('left', event.pageX + 15 + 'px')
          .style('top', event.pageY + 15 + 'px')
          .style('opacity', 1);
      },
    )
    .on('mousemove', (event: MouseEvent) => {
      if (isTouch) return;
      tooltip
        .style('left', event.pageX + 15 + 'px')
        .style('top', event.pageY + 15 + 'px');
    })
    .on('mouseout', function (this: SVGPathElement) {
      if (isTouch) return;
      d3.select(this)
        .transition()
        .duration(200)
        .attr('d', (td: unknown) => arc(td as d3.PieArcDatum<PieSlice>) ?? '')
        .style('opacity', '0.9')
        .style('filter', 'none');
      tooltip.style('opacity', 0);
    })
    .on('click', (_event: MouseEvent, d: d3.PieArcDatum<PieSlice>) => {
      if (isTouch) return;
      handlePieClick(d);
    });
}

/**
 * Wire up the touch-only interaction model: tap slice → preview
 * (highlight + tooltip), tap tooltip → navigate. Uses createTwoStepTap +
 * TapTracker so synthetic click after touchend doesn't double-fire, and
 * captures the slice datum at touchstart (elementFromPoint is unreliable
 * on the 3D-rotated SVG and was silently no-op-ing many taps before
 * datum capture was added).
 */
function bindTouchPieInteractions(args: {
  container: HTMLElement;
  chartWrapper: HTMLElement;
  svg: D3Any;
  arc: D3Any;
  arcHover: D3Any;
  tooltip: D3Any;
  currentPieTab: string;
  pctFor: (label: string) => string;
  handlePieClick: (d: d3.PieArcDatum<PieSlice>) => void;
  hideTooltip: () => void;
}): void {
  const {
    container,
    chartWrapper,
    svg,
    arc,
    arcHover,
    tooltip,
    currentPieTab,
    pctFor,
    handlePieClick,
    hideTooltip,
  } = args;

  // Reset all slices to normal appearance
  const resetSlices = () => {
    svg
      .selectAll('path.danbooru-grass-pie-path')
      .transition()
      .duration(200)
      .attr('d', (td: unknown) => arc(td as d3.PieArcDatum<PieSlice>) ?? '')
      .style('opacity', '0.9')
      .style('filter', 'none');
  };

  // Mobile interaction model: tap slice → preview (highlight + tooltip),
  // tap tooltip → navigate. A second tap on the same slice is a no-op
  // (preview persists) — navigateOnSameTap:false suppresses the shared
  // util's default double-tap-to-navigate behavior, so the only path to
  // navigation is the tooltip click below.
  const pieTap: TwoStepTapController<d3.PieArcDatum<PieSlice>> =
    createTwoStepTap({
      insideElements: () => [
        tooltip.node() as Element | null,
        svg.node() as Element | null,
      ],
      onFirstTap: () => {
        // Visual updates handled in handleSliceTouch (needs touch coordinates)
      },
      onSecondTap: datum => {
        handlePieClick(datum);
        hideTooltip();
        // Same fix the tag-cloud widget needed: navigation opens the
        // post search in a new tab, so when the user comes back via
        // browser-back the SVG state is exactly what we left it as.
        // Without resetSlices() the highlighted slice stays in its
        // arcHover shape and the tap tracker has no datum, so no tap
        // will dismiss it — the chart appears frozen until a different
        // slice is touched.
        resetSlices();
      },
      onReset: () => {
        hideTooltip();
        resetSlices();
      },
      navigateOnSameTap: false,
    });

  // Helper to handle a completed tap on a slice. The caller passes the
  // datum captured at touchstart (the path d3 dispatched the event from)
  // — this avoids elementFromPoint, which is unreliable on 3D-rotated
  // SVG paths and was causing many taps to silently fail. The path
  // element is looked up via d3 filter on the same datum identity.
  const handleSliceTouch = (
    event: TouchEvent,
    datum: d3.PieArcDatum<PieSlice>,
  ) => {
    const touch = event.changedTouches[0] ?? event.touches[0];
    if (!touch || !datum.data) return;
    // Type args on selectAll are dropped because `svg` is typed as
    // `D3Any` here — TS2347 rejects type arguments on calls whose
    // callee is `any`. The .filter callback below carries the slice
    // datum type explicitly, so the chain stays type-checked.
    const target = svg
      .selectAll('path.danbooru-grass-pie-path')
      .filter((d: d3.PieArcDatum<PieSlice>) => d === datum)
      .node();
    if (!target) return;

    // Reset all slices, then enlarge touched slice
    resetSlices();
    pieTap.tap(datum);

    d3.select(target)
      .transition()
      .duration(200)
      .attr(
        'd',
        (td: unknown) => arcHover(td as d3.PieArcDatum<PieSlice>) ?? '',
      )
      .style('opacity', '1');

    // Show tooltip (same HTML building logic as mouseover)
    const html = buildSliceTooltipHtml({
      details: datum.data.details,
      color: datum.data.color,
      label: datum.data.label,
      currentPieTab,
      percentage: pctFor(datum.data.label),
    });

    // Update content but keep opacity at 0 — we'll flip to opacity 1
    // only after the new position is set. Without this guard, the
    // tooltip is briefly visible at the previous tap's coordinates
    // because offsetWidth/offsetHeight reads below force a render
    // before the new style.left / style.top take effect ("ghost flash").
    tooltip.html(html);

    // Pick the first candidate position that fits the tooltip's
    // natural size entirely inside (card-horizontal × wrapper-vertical
    // ∩ viewport). Tooltip width/height are NOT modified — the user
    // explicitly rejected size reduction. Edge slices on narrow cards
    // can't fit any of the four touch-relative quadrants, so we also
    // try anchoring to the card's FAR side (opposite the touch) — this
    // is the "flip across the chart" placement the user asked for. If
    // even those fail, fall back to a viewport-clamped origin;
    // horizontal page scroll is independently prevented by the body
    // scroll lock so this fallback is safe.
    const tooltipNode = tooltip.node() as HTMLElement | null;
    const tw = tooltipNode?.offsetWidth ?? 0;
    const th = tooltipNode?.offsetHeight ?? 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const cardRect = container.getBoundingClientRect();
    const wrapperRect = chartWrapper.getBoundingClientRect();
    const bounds = {
      minLeft: Math.max(
        cardRect.left + window.scrollX + margin,
        window.scrollX + margin,
      ),
      maxRight: Math.min(
        cardRect.right + window.scrollX - margin,
        window.scrollX + vw - margin,
      ),
      minTop: Math.max(
        wrapperRect.top + window.scrollY + margin,
        window.scrollY + margin,
      ),
      maxBottom: Math.min(
        wrapperRect.bottom + window.scrollY - margin,
        window.scrollY + vh - margin,
      ),
    };
    // Far side of the card relative to the touch — this is where the
    // tooltip goes when no touch-relative quadrant has room.
    const cardCenterDocX = cardRect.left + cardRect.width / 2 + window.scrollX;
    const farSideLeft =
      touch.pageX > cardCenterDocX ? bounds.minLeft : bounds.maxRight - tw;
    const candidates = [
      // Touch-relative quadrants (priority: away from modal edge).
      {left: touch.pageX - tw - 15, top: touch.pageY - th - 15},
      {left: touch.pageX + 15, top: touch.pageY - th - 15},
      {left: touch.pageX - tw - 15, top: touch.pageY + 15},
      {left: touch.pageX + 15, top: touch.pageY + 15},
      // Far-side anchors — used when an edge slice prevents any of the
      // four touch-relative candidates from fitting (typical: long
      // copyright/character label on a narrow phone). All four place
      // the tooltip at the card's opposite horizontal edge with
      // varying vertical positions, picking the one closest to the
      // touch.
      {left: farSideLeft, top: touch.pageY - th / 2},
      {left: farSideLeft, top: touch.pageY + 15},
      {left: farSideLeft, top: touch.pageY - th - 15},
      {left: farSideLeft, top: bounds.maxBottom - th},
      {left: farSideLeft, top: bounds.minTop},
    ];
    const chosen = pickFittingPosition(candidates, tw, th, bounds) ?? {
      // Last-resort fallback: align to far side horizontally, clamp
      // vertically near the touch. Shouldn't trigger in practice now
      // that far-side candidates explore the full vertical range.
      left: Math.max(
        bounds.minLeft,
        Math.min(bounds.maxRight - tw, farSideLeft),
      ),
      top: Math.max(
        bounds.minTop,
        Math.min(bounds.maxBottom - th, touch.pageY + 15),
      ),
    };
    tooltip
      .style('left', chosen.left + 'px')
      .style('top', chosen.top + 'px')
      .style('opacity', 1)
      .style('pointer-events', 'auto');
  };

  // Slice and tooltip both use TapTracker so the action only fires on
  // a completed tap (touchstart + touchend on roughly the same spot).
  // Why: showing the tooltip on `touchstart` would put it under the
  // user's finger, and the synthetic `click` browsers fire after a
  // tap would land on the tooltip and trigger navigation immediately
  // — perceived as "one tap, two actions". With end-of-tap gating and
  // no `tooltip.on('click')`, the synthetic click is harmless.
  const sliceTapTracker = new TapTracker();
  // Capture the slice datum at touchstart — we know exactly which path
  // d3 dispatched the event from. Re-querying via elementFromPoint at
  // touchend is unreliable on a 3D-rotated SVG (rotateX(40deg) moves
  // hit-test boundaries off the visible pixels and elementFromPoint
  // often returns the parent <svg> / <g> instead of the path), which
  // made a large fraction of taps silently no-op.
  let sliceTouchDatum: d3.PieArcDatum<PieSlice> | null = null;
  // Same reason as above: drop the selectAll<...> type args because
  // svg's static type is `D3Any`. The touchstart datum annotation
  // below keeps the per-event type checked.
  svg
    .selectAll('path.danbooru-grass-pie-path')
    .on('touchstart', (event: TouchEvent, datum: d3.PieArcDatum<PieSlice>) => {
      sliceTapTracker.onTouchStart(event);
      sliceTouchDatum = datum;
    })
    .on('touchmove', (event: TouchEvent) => {
      sliceTapTracker.onTouchMove(event);
    })
    .on('touchend', (event: TouchEvent) => {
      const isTap = sliceTapTracker.onTouchEnd(event);
      const datum = sliceTouchDatum;
      sliceTouchDatum = null;
      if (isTap && datum) {
        handleSliceTouch(event, datum);
      }
    });

  const tooltipTapTracker = new TapTracker();
  tooltip
    .on('touchstart', (event: TouchEvent) => {
      tooltipTapTracker.onTouchStart(event);
    })
    .on('touchmove', (event: TouchEvent) => {
      tooltipTapTracker.onTouchMove(event);
    })
    .on('touchend', (event: TouchEvent) => {
      if (tooltipTapTracker.onTouchEnd(event)) {
        pieTap.navigateActive();
      }
    });
}

/**
 * Render the scrollable legend list. Reads the legend container's
 * existing <style> tag (preserving the scrollbar styling buildChartScaffolding
 * injected) and replaces the rest of the inner HTML with a fresh title +
 * one row per slice. Pure on processedData / pctFor.
 */
function renderPieLegend(args: {
  legendDiv: Element;
  processedData: PieSlice[];
  currentPieTab: string;
  pctFor: (label: string) => string;
  normalizedName: string;
  /** Optional hooks for sub-chart mode (Copy/Fav_Copy/Char). v9.6+. */
  chartModeControl?: ChartModeControl;
}): void {
  const {
    legendDiv,
    processedData,
    currentPieTab,
    pctFor,
    normalizedName,
    chartModeControl,
  } = args;
  const legendTitle = LEGEND_TITLES[currentPieTab] ?? 'DIST.';
  const styleTag = legendDiv.querySelector('style')?.outerHTML ?? '';

  // Tabs that get the sub-tag breakdown tooltip (v9.6.0+). Other tabs
  // render legend without hover-tooltip wiring.
  const subtagTooltipEnabled =
    currentPieTab === 'copyright' ||
    currentPieTab === 'fav_copyright' ||
    currentPieTab === 'character';
  const queryPrefix =
    currentPieTab === 'fav_copyright'
      ? `ordfav:${normalizedName}`
      : `user:${normalizedName}`;

  const listHtml = processedData
    .map((d, idx) => {
      const pct = pctFor(d.label);
      const isOtherSlice = d.details.kind === 'tag' && !!d.details.isOther;
      let targetUrl = '#';

      if (!isOtherSlice) {
        const query = buildSearchQuery(
          d.details,
          d.label,
          normalizedName,
          currentPieTab,
        );
        if (query) {
          targetUrl = `/posts?tags=${encodeURIComponent(query)}`;
        }
      }

      const swatchColor = safeColor(d.color);
      const safeLabel = escapeHtml(d.label);
      const safeUrl = escapeHtml(targetUrl);
      const countTitle = d.details.count
        ? escapeHtml(d.details.count.toLocaleString())
        : '';
      // Mark every interactive (non-Others) Copy/Fav_Copy/Char legend
      // row for the post-render wire-up. Rows with subTags get the full
      // tooltip + chart-mode treatment; rows without (e.g. `gundam` for
      // a user with no franchise-specific sub-tagging) still trigger
      // chart-mode in single-slice fallback (v9.6+).
      const isInteractiveRow =
        subtagTooltipEnabled && d.details.kind === 'tag' && !d.details.isOther;
      const subtagAttr = isInteractiveRow ? ` data-di-subtag-idx="${idx}"` : '';
      return `
               <div${subtagAttr} style="display:flex; align-items:center; font-size:0.85em; margin-bottom:5px;">
                  <div style="width:12px; height:12px; background:${swatchColor}; border-radius:2px; margin-right:8px; border:1px solid var(--di-shadow-light, rgba(0,0,0,0.1)); flex-shrink:0;"></div>
                  ${
                    isOtherSlice
                      ? `<div style="color:var(--di-text-secondary, #666); width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${safeLabel}">${safeLabel}</div>`
                      : `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="di-hover-underline" style="color:var(--di-text-secondary, #666); width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:none;" title="${safeLabel}">${safeLabel}</a>`
                  }
                  <div style="font-weight:bold; color:var(--di-text, #333); margin-left:auto;" title="${countTitle}">${pct}</div>
               </div>`;
    })
    .join('');

  legendDiv.innerHTML =
    styleTag +
    `
           <div style="font-size:0.8em; color:var(--di-text-muted, #888); margin-bottom:8px; text-transform:uppercase; position:sticky; top:0; background:var(--di-chart-bg, #fff); padding-bottom:4px; border-bottom:1px solid var(--di-border-light, #eee);">${legendTitle}</div>
           ${listHtml}
      `;

  if (subtagTooltipEnabled) {
    wireSubtagTooltipHandlers(
      legendDiv,
      processedData,
      queryPrefix,
      chartModeControl,
    );
  }
}

/**
 * Tracks the container-level (mouseenter/mouseleave) listeners that
 * wireSubtagTooltipHandlers attaches to each legend div, so the next
 * call can remove them cleanly. Without this, tab switches (which reuse
 * the same legendDiv element and only swap innerHTML) leave stale
 * listeners from previous tabs attached — their `scheduleExit` timers
 * fire 150ms after a cursor crosses legend → tooltip and yank the fresh
 * tooltip the user was about to read. The tooltip module's own
 * el.onmouseenter/leave is property-assigned (one slot, always latest)
 * so the asymmetry is fully on legendDiv's side.
 */
interface LegendContainerListeners {
  enter: () => void;
  leave: () => void;
}
const legendContainerListenerRegistry = new WeakMap<
  HTMLElement,
  LegendContainerListeners
>();

/**
 * Attaches desktop hover + mobile tap handlers to legend items that carry
 * a sub-tag breakdown (data-di-subtag-idx). The tooltip itself is the
 * single-instance singleton from `src/ui/subtag-breakdown-tooltip.ts`.
 *
 * Desktop: mouseenter on the legend row shows the tooltip; mouseleave
 * schedules a hide with a 120ms grace period so users can move the
 * cursor into the tooltip body to click a sub-tag. The tooltip's own
 * mouseenter cancels that pending hide.
 *
 * Mobile: a touchend → click chain delivers a single click event after
 * the touch ends. We catch the FIRST click on a legend item that has a
 * breakdown — show the tooltip, preventDefault the anchor's navigation,
 * and let createClickOutsideHandler dismiss it. A second tap on a
 * tooltip row navigates (the row is an `<a target="_blank">`).
 */
function wireSubtagTooltipHandlers(
  legendDiv: Element,
  processedData: PieSlice[],
  queryPrefix: string,
  chartModeControl?: ChartModeControl,
): void {
  // Debounce gate (~120ms) shared across rows in this legend. Fast mouse
  // swipes across multiple legend rows otherwise rebind the pie 3-4
  // times in flight — visually choppy and leaves rendering artifacts
  // (faint ghost slices from partly-painted exit transitions). Only the
  // row the cursor finally rests on triggers an actual chart-mode enter.
  const ENTER_DEBOUNCE_MS = 120;
  // Grace window for the legend → tooltip cursor transit. Pending exits
  // are armed by legend-container or tooltip-body mouseleave and cancelled
  // by either's mouseenter. Without the grace, moving from a row onto the
  // (body-attached) tooltip would briefly leave both, firing exit.
  const EXIT_GRACE_MS = 150;
  let pendingEnter: ReturnType<typeof setTimeout> | null = null;
  let pendingExit: ReturnType<typeof setTimeout> | null = null;
  const cancelPendingEnter = () => {
    if (pendingEnter !== null) {
      clearTimeout(pendingEnter);
      pendingEnter = null;
    }
  };
  const cancelPendingExit = () => {
    if (pendingExit !== null) {
      clearTimeout(pendingExit);
      pendingExit = null;
    }
  };
  // Schedules the actual chart-mode + tooltip exit. Single source of truth
  // for "user is done with the legend's sub-chart hover" — fired either by
  // legend container mouseleave or by tooltip body mouseleave (via the
  // tooltip module's onPointerLeave hook). Sliding between legend rows or
  // moving cursor row → tooltip body cancels it before it fires.
  const scheduleExit = () => {
    cancelPendingExit();
    pendingExit = setTimeout(() => {
      pendingExit = null;
      hideSubtagTooltip();
      chartModeControl?.exit();
    }, EXIT_GRACE_MS);
  };

  // Container-scope listeners: the legend rectangle (not individual rows)
  // is the boundary for chart-mode. Cursor moving between rows or over
  // the gaps between them stays "inside" — chart sticks to whichever row
  // was last hovered. Only leaving the rectangle entirely schedules exit.
  // Old listeners are removed first via the registry (see registry JSDoc).
  const legendEl = legendDiv as HTMLElement;
  const prevListeners = legendContainerListenerRegistry.get(legendEl);
  if (prevListeners) {
    legendEl.removeEventListener('mouseenter', prevListeners.enter);
    legendEl.removeEventListener('mouseleave', prevListeners.leave);
  }
  const enterHandler = () => cancelPendingExit();
  const leaveHandler = () => {
    cancelPendingEnter();
    scheduleExit();
  };
  legendEl.addEventListener('mouseenter', enterHandler);
  legendEl.addEventListener('mouseleave', leaveHandler);
  legendContainerListenerRegistry.set(legendEl, {
    enter: enterHandler,
    leave: leaveHandler,
  });

  const rows = legendDiv.querySelectorAll<HTMLElement>('[data-di-subtag-idx]');
  rows.forEach(row => {
    const idx = parseInt(row.dataset['diSubtagIdx'] || '-1', 10);
    if (idx < 0 || idx >= processedData.length) return;
    const slice = processedData[idx];
    if (slice.details.kind !== 'tag' || slice.details.isOther) return;
    const parentName = slice.label;
    const parentColor = slice.color;

    // Anchor the tooltip to the legend row's right edge. (An earlier
    // pass anchored to the inner tag-name span so the tooltip sat closer
    // to the label, but that placement straddled the percentage column
    // visually — the user preferred the cleaner right-edge anchor.)

    // Recover the underlying DistributionItem the legend row was rendered
    // from. processedData[idx].details carries the same {tagName, count,
    // subTags} fields the sub-chart builder reads, plus the kind tag the
    // type system needs.
    const parentItem: DistributionItem = {
      name: parentName,
      tagName: slice.details.tagName ?? '',
      count: slice.details.count ?? 0,
      frequency: slice.details.frequency ?? 0,
      thumb: slice.details.thumb ?? null,
      isOther: false,
      subTags: slice.details.subTags,
    };

    // Build the slice list once — chart and tooltip render the same set
    // (v9.6+). Without this, the tooltip used applySubTagBreakdown's
    // sub-sum-based shares and a parent like `ninjago` (sub `dragons
    // rising` = 30 of parent 212) would read as "dragons rising 100%"
    // while the chart sat on a big grey Others slice. Now both use
    // buildSubChartSlices, base = parent.count.
    //
    // When parentItem has no subTags, buildSubChartSlices returns [] here
    // (we don't pass parentColor — the tooltip stays hidden for such
    // rows). The chart-mode enter call below DOES pass parentColor, so
    // the chart still updates to a single-slice view.
    const subSlices = buildSubChartSlices(parentItem);
    const items = subSlicesToTooltipItems(
      subSlices,
      parentItem.count,
      queryPrefix,
    );
    const hasBreakdown = items.length > 0;

    let touchUsed = false;

    const showTooltipAndChart = () => {
      if (hasBreakdown) {
        showSubtagTooltip({
          parentDisplayName: parentName,
          items,
          anchor: row,
          onShow: () => chartModeControl?.enter(parentItem, parentColor),
          // onHide no longer drives chart-mode exit — the legend container
          // (or tooltip body) mouseleave does, via scheduleExit. Replacing
          // tooltip A with tooltip B still fires A's onHide, so we'd
          // otherwise revert to the main pie between A and B. Keeping
          // chart-mode exit on the container handler means A → B is a
          // pure switch (no intermediate revert) and the row highlight
          // still resets cleanly when the old tooltip tears down.
          onHide: () => subRowHighlight.reset(),
          onPointerEnter: cancelPendingExit,
          onPointerLeave: scheduleExit,
        });
        // Wire T-51 row hover highlight after tooltip mounts (desktop only).
        // The tooltip DOM is built inside showSubtagTooltip synchronously,
        // so we can attach hover listeners on the same tick.
        if (chartModeControl && !chartModeControl.isTouch) {
          subRowHighlight.attach(items);
        }
      } else {
        // No sub breakdown — chart-only mode (single slice = parent
        // itself). Bypass the tooltip lifecycle; the legend container's
        // mouseleave handler drives the exit. Hide any tooltip the
        // previous breakdown row left visible — otherwise hovering
        // gundam (has subs) then identity_v (no subs) keeps gundam's
        // tooltip open beside identity_v's single-slice chart, which
        // reads as a stale label.
        hideSubtagTooltip();
        chartModeControl?.enter(parentItem, parentColor);
      }
    };

    // T-51: row hover highlight controller. Holds the most recently
    // highlighted slice path so we can restore it on the next row enter
    // or on tooltip hide. Desktop only — mobile skips the attach.
    const subRowHighlight = (() => {
      let highlightedTag: string | null = null;
      const reset = () => {
        if (!chartModeControl) return;
        const svg = chartModeControl.svg;
        const arc = chartModeControl.arc;
        svg
          .selectAll('path.danbooru-grass-pie-path')
          .transition()
          .duration(150)
          .attr('d', (td: unknown) => arc(td as d3.PieArcDatum<PieSlice>) ?? '')
          .style('opacity', '0.9');
        highlightedTag = null;
      };
      const highlight = (tagName: string) => {
        if (!chartModeControl) return;
        const target = chartModeControl.findSubSliceByTag(tagName);
        if (!target) return;
        const svg = chartModeControl.svg;
        const arc = chartModeControl.arc;
        const arcHover = chartModeControl.arcHover;
        // Dim every slice, then enlarge the matched one.
        svg
          .selectAll('path.danbooru-grass-pie-path')
          .transition()
          .duration(150)
          .attr('d', (td: unknown) => arc(td as d3.PieArcDatum<PieSlice>) ?? '')
          .style('opacity', '0.35');
        d3.select(target)
          .transition()
          .duration(150)
          .attr(
            'd',
            (td: unknown) => arcHover(td as d3.PieArcDatum<PieSlice>) ?? '',
          )
          .style('opacity', '1');
        highlightedTag = tagName;
      };
      const attach = (rowItems: SubtagTooltipItem[]) => {
        // Hover-only DOM scan: find the tooltip element, walk its row
        // anchors, wire them. Cheaper than weaving handlers into the
        // tooltip module — the tooltip DOM is short-lived and rebuilt
        // each show so there's nothing to leak.
        const tooltipEl =
          document.querySelector<HTMLElement>('.di-subtag-tooltip');
        if (!tooltipEl) return;
        const tooltipRows = tooltipEl.querySelectorAll<HTMLElement>(
          '.di-subtag-tooltip-item',
        );
        tooltipRows.forEach((rowEl, i) => {
          const item = rowItems[i];
          if (!item || item.isOther) return;
          rowEl.addEventListener('mouseenter', () => highlight(item.tagName));
        });
        tooltipEl.addEventListener('mouseleave', () => {
          if (highlightedTag) reset();
        });
      };
      return {attach, reset};
    })();

    row.addEventListener('mouseenter', () => {
      if (touchUsed) return;
      cancelPendingExit();
      cancelPendingEnter();
      if (hasBreakdown) cancelSubtagTooltipHide();
      pendingEnter = setTimeout(() => {
        pendingEnter = null;
        showTooltipAndChart();
      }, ENTER_DEBOUNCE_MS);
    });
    row.addEventListener('mouseleave', () => {
      if (touchUsed) return;
      // Per-row leave is a no-op for chart-mode and tooltip lifecycle —
      // the legend container's mouseleave + tooltip pointer-leave hooks
      // are the sole drivers of exit (so sliding between rows or across
      // the gaps stays "in" sub-mode). Just cancel any pending enter
      // from a debounce that hasn't fired yet.
      cancelPendingEnter();
    });

    // Mobile: first tap shows tooltip (suppressing anchor navigation),
    // second tap on a tooltip row navigates. Rows without a breakdown
    // skip this entirely — the anchor's default navigation runs as
    // normal on the first tap.
    if (hasBreakdown) {
      row.addEventListener(
        'touchstart',
        () => {
          touchUsed = true;
        },
        {passive: true},
      );

      const anchorEl = row.querySelector<HTMLAnchorElement>('a[href]');
      if (anchorEl) {
        anchorEl.addEventListener('click', e => {
          if (!touchUsed) return; // desktop click → let navigation happen
          if (isSubtagTooltipVisible()) return; // tooltip open → tap navigates
          e.preventDefault();
          showTooltipAndChart();
        });
      }
    }
  });
}

/**
 * Per-tab dispatcher that fetches the distribution for `tabName` from
 * AnalyticsDataManager and applies tab-specific post-processing (status
 * color overlay; count→frequency conversion for the four ratio tabs).
 */
async function fetchDistributionForTab(
  tabName: string,
  dataManager: AnalyticsDataManager,
  user: TargetUser,
  firstUploadDate: Date | null,
): Promise<PieTabItem[]> {
  if (tabName === 'rating') {
    return dataManager.getRatingDistribution(user, firstUploadDate);
  }
  if (tabName === 'status') {
    const data = await dataManager.getStatusDistribution(user, firstUploadDate);
    return data.map((d: PieTabItem) => ({
      ...d,
      color: STATUS_COLORS[d.name as keyof typeof STATUS_COLORS] || '#888',
    }));
  }
  if (tabName === 'character') {
    return dataManager.getCharacterDistribution(user);
  }
  if (tabName === 'copyright') {
    return dataManager.getCopyrightDistribution(user);
  }
  if (tabName === 'fav_copyright') {
    return dataManager.getFavCopyrightDistribution(user);
  }
  if (tabName === 'breasts') {
    return preprocessFrequencyTab(
      await dataManager.getBreastsDistribution(user),
    );
  }
  if (tabName === 'gender') {
    return preprocessFrequencyTab(
      await dataManager.getGenderDistribution(user),
    );
  }
  if (tabName === 'commentary') {
    return preprocessFrequencyTab(
      await dataManager.getCommentaryDistribution(user),
    );
  }
  if (tabName === 'translation') {
    return preprocessFrequencyTab(
      await dataManager.getTranslationDistribution(user),
    );
  }
  return [];
}

/**
 * Crossfade snapshot animation for tab switches. Clones the current
 * pieContent children into an absolutely-positioned overlay (so the
 * originals can re-render in place via the d3 join), then fades the
 * overlay out once loadTabFn resolves. Bails (drops the snapshot) if
 * the user has switched to a different tab while the fetch was in
 * flight.
 */
function runTabCrossfade(args: {
  pieContent: HTMLElement;
  mode: string;
  loadTab: (mode: string) => Promise<void>;
  getCurrentTab: () => string;
}): void {
  const {pieContent, mode, loadTab, getCurrentTab} = args;
  // Crossfade — same pattern the tag-cloud widget uses (350 ms opacity
  // transition between two overlapping wrappers). The current children
  // (chart wrapper + legend) are cloneNode'd into an absolutely
  // positioned snapshot that overlays the originals; the originals
  // re-render in place via d3 join behind it; once the new data is
  // ready, the snapshot fades to 0, revealing the freshly rendered
  // content underneath. Keeping d3 references on the live chart
  // wrapper means tooltip / hover bindings survive the transition.
  const TRANSITION_MS = 350;
  // Drop any in-flight snapshot from a previous rapid tab tap so we
  // don't pile up overlays.
  pieContent.querySelectorAll('.di-pie-snapshot').forEach(n => n.remove());
  const piStyles = window.getComputedStyle(pieContent);
  const snapshot = document.createElement('div');
  snapshot.className = 'di-pie-snapshot';
  // Fill the parent (pieContent) exactly — `position: absolute` +
  // 0/0/100%/100% relative to a positioned ancestor avoids any
  // bounding-rect math / containing-block ambiguity that broke
  // earlier alignment attempts. Innerlay snapshot in pieContent
  // (not the outer card) so it tracks pieContent's exact rect even
  // if the dashboard layout shifts. Trade-off: loadTab's uncached
  // path wipes pieContent.innerHTML, which removes the snapshot
  // and skips the transition for first-time tab visits — that's
  // fine because the user still sees a Loading message there.
  snapshot.style.position = 'absolute';
  snapshot.style.top = '0';
  snapshot.style.left = '0';
  snapshot.style.width = '100%';
  snapshot.style.height = '100%';
  snapshot.style.display = piStyles.display;
  snapshot.style.flexDirection = piStyles.flexDirection;
  snapshot.style.alignItems = piStyles.alignItems;
  snapshot.style.justifyContent = piStyles.justifyContent;
  // Preserve the parent's 3D context so the cloned chart wrapper
  // keeps its rotateX(40deg) tilt during the fade.
  snapshot.style.transformStyle = 'preserve-3d';
  snapshot.style.perspective = piStyles.perspective;
  snapshot.style.pointerEvents = 'none';
  snapshot.style.transition = `opacity ${TRANSITION_MS}ms ease`;
  snapshot.style.opacity = '1';
  for (const child of Array.from(pieContent.children) as HTMLElement[]) {
    snapshot.appendChild(child.cloneNode(true) as HTMLElement);
  }
  pieContent.style.position = 'relative';
  pieContent.appendChild(snapshot);
  // Force layout commit so the browser has a "before" frame
  // (opacity:1) to interpolate from. Without this, when loadTab
  // resolves synchronously (cached tab), the microtask + RAF can
  // batch the opacity 1→0 change with the initial style and skip
  // the transition entirely.
  void snapshot.getBoundingClientRect();

  void loadTab(mode).then(() => {
    if (getCurrentTab() !== mode) {
      // User switched again before this tab finished — drop the
      // stale snapshot immediately so it doesn't sit on top of the
      // newer transition's snapshot.
      snapshot.remove();
      return;
    }
    requestAnimationFrame(() => {
      snapshot.style.opacity = '0';
      setTimeout(() => snapshot.remove(), TRANSITION_MS);
    });
  });
}

/**
 * Renders one frame of the pie chart based on the current tab. Handles the
 * "no data / loading / empty" guards, the per-tab data shaping, the
 * one-time chart scaffolding, the desktop+touch event bindings, and the
 * legend. Called by `requestRender`, the tab-click handler, and the cache
 * hit branch of `loadTab` inside renderPieWidget.
 */
// T-26 baseline: 202 LOC after v9.6 sub-chart mode lifecycle (parentTag
// token + setSubChartActive callback). Helper extraction would split the
// chart-mode closures from `applyChartData`'s captured d3 refs — defer
// until the sub-chart mode has a wider use-case demanding a refactor.
// eslint-disable-next-line max-lines-per-function
function renderPieFrame(args: {
  container: HTMLElement;
  pieData: Record<string, PieTabItem[]>;
  currentPieTab: string;
  context: ChartContext;
  handlePieClick: (d: d3.PieArcDatum<PieSlice>) => void;
  /**
   * Callback the chart calls when it enters / exits sub-chart hover
   * mode. The outer renderPieWidget uses this to suppress the lazy
   * thumb-update event's requestRender during a hover — otherwise the
   * single-slice view snaps back to the full pie mid-interaction.
   */
  setSubChartActive?: (active: boolean) => void;
}): void {
  const {
    container,
    pieData,
    currentPieTab,
    context,
    handlePieClick,
    setSubChartActive,
  } = args;
  const isTouch = isTouchDevice();
  const contextUser = context.targetUser;
  const data = pieData[currentPieTab];
  const pieContent = container.querySelector('.pie-content') as HTMLElement;

  if (!data) {
    pieContent.innerHTML =
      '<div style="color:var(--di-text-muted, #888); padding:30px; text-align:center;">Loading...</div>';
    return;
  }

  if (data.length === 0) {
    pieContent.innerHTML =
      '<div style="color:var(--di-text-muted, #888); padding:30px; text-align:center;">No data available</div>';
    return;
  }

  if (!contextUser.normalizedName && contextUser.name) {
    contextUser.normalizedName = contextUser.name.replace(/ /g, '_');
  }

  // Hair length has a categorical sort order — count-based ordering
  // (the default for every other tab) would reorder hair-length
  // buckets in non-intuitive ways.
  if (currentPieTab === 'hair_length') {
    data.sort(
      (a: PieTabItem, b: PieTabItem) =>
        HAIR_LENGTH_ORDER.indexOf(a.name ?? '') -
        HAIR_LENGTH_ORDER.indexOf(b.name ?? ''),
    );
  }

  pieContent.style.display = 'flex';
  pieContent.style.flexDirection = 'row';
  pieContent.style.alignItems = 'center';
  pieContent.style.justifyContent = 'space-around';

  // Firefox: skip 3D perspective — breaks SVG pointer events
  const isFirefox = navigator.userAgent.includes('Firefox');
  if (!isFirefox) {
    pieContent.style.perspective = '1000px';
  }

  const processedData = processSlices(data, currentPieTab);
  const validData = processedData.filter(
    (d: PieSlice) => Number.isFinite(d.value) && d.value > 0,
  );
  const totalValue = validData.reduce(
    (acc: number, curr: PieSlice) => acc + curr.value,
    0,
  );

  if (validData.length === 0 || totalValue === 0) {
    pieContent.innerHTML =
      '<div style="color:var(--di-text-muted, #888); padding:30px; text-align:center;">No data available (Total count is 0)</div>';
    return;
  }

  // Largest-remainder percentages: ensures tooltip + legend agree and
  // their sum is exactly 100% (avoids 33+33+33=99 / 16.67×6=102 displays).
  // All tabs use 1 decimal for visual consistency between rating and others.
  const pctStrings = computePercentages(
    validData.map(s => s.value),
    1,
  );
  const pctByLabel = new Map<string, string>(
    validData.map((s, i) => [s.label, pctStrings[i]]),
  );
  const pctFor = (label: string) => pctByLabel.get(label) ?? '0.0%';

  let chartWrapper = pieContent.querySelector(
    '.pie-chart-wrapper',
  ) as HTMLElement | null;

  if (!chartWrapper) {
    chartWrapper = buildChartScaffolding(pieContent, isFirefox);
  }

  const svg = d3.select(chartWrapper).select('svg g');
  const pie = d3
    .pie<PieSlice>()
    .value(d => d.value)
    .sort(null);
  const arc = d3
    .arc<d3.PieArcDatum<PieSlice>>()
    .innerRadius(0)
    .outerRadius(PIE_RADIUS);
  const arcHover = d3
    .arc<d3.PieArcDatum<PieSlice>>()
    .innerRadius(0)
    .outerRadius(PIE_RADIUS * 1.2);

  // pointer-events is toggled in sync with opacity (auto when shown,
  // none when hidden) so a dismissed tooltip's stale rectangle never
  // intercepts a slice tap from underneath.
  const tooltip = d3
    .select(createBodyTooltip('danbooru-grass-pie-tooltip'))
    .style('background', 'rgba(30, 30, 30, 0.95)')
    .style('color', '#fff')
    .style('padding', '8px 12px')
    .style('border-radius', '6px')
    .style('font-size', '12px')
    .style('cursor', isTouch ? 'pointer' : 'default');

  const hideTooltip = () => {
    tooltip.style('opacity', 0).style('pointer-events', 'none');
  };

  // Apply a slice array (default = the tab's own data, override = sub-chart
  // breakdown of one parent) to the SVG. Re-runs the d3 join + handler
  // bindings — .on() replaces existing handlers so nothing accumulates.
  // Called once for the initial render and again on sub-mode enter/exit.
  const applyChartData = (
    slicesToShow: PieSlice[],
    localPctFor: (label: string) => string,
  ) => {
    // Kill in-flight path transitions (e.g. subRowHighlight.reset()'s
    // 150ms `d`/opacity tween fired by an old tooltip's onHide) so they
    // don't overwrite our just-set attrs mid-frame.
    svg.selectAll('path').interrupt();
    bindDesktopPieInteractions({
      svg,
      validData: slicesToShow,
      pie,
      arc,
      arcHover,
      tooltip,
      isTouch,
      currentPieTab,
      pctFor: localPctFor,
      handlePieClick,
    });
    if (isTouch) {
      bindTouchPieInteractions({
        container,
        chartWrapper: chartWrapper as HTMLElement,
        svg,
        arc,
        arcHover,
        tooltip,
        currentPieTab,
        pctFor: localPctFor,
        handlePieClick,
        hideTooltip,
      });
    }
  };

  applyChartData(validData, pctFor);

  // Sequential fade for sub-chart enter/exit. Fade chartWrapper out, swap
  // data while invisible, fade back in. The single-frame blank at the
  // midpoint (opacity ≈ 0) is imperceptible. We extend buildChartScaffolding's
  // `transform 0.5s …` transition with opacity for the duration of the
  // fade, and restore the baseline on completion so a subsequent hover-tilt
  // isn't slowed by a lingering opacity ease.
  const SUB_CHART_TRANSITION_MS = 350;
  const FADE_HALF_MS = SUB_CHART_TRANSITION_MS / 2;
  const baselineChartTransition = (chartWrapper as HTMLElement).style
    .transition;
  // Generation token: only the most-recent fade's cleanup restores the
  // baseline transition, and intermediate setTimeouts bail to avoid
  // applying stale data after a newer fade has taken over.
  let crossfadeGen = 0;
  const crossfadeChartTransition = (apply: () => void): void => {
    const cw = chartWrapper as HTMLElement;
    const myGen = ++crossfadeGen;
    const extendedTransition = baselineChartTransition
      ? `${baselineChartTransition}, opacity ${FADE_HALF_MS}ms ease`
      : `opacity ${FADE_HALF_MS}ms ease`;
    cw.style.transition = extendedTransition;
    cw.style.opacity = '0';
    setTimeout(() => {
      if (myGen !== crossfadeGen) return; // newer fade took over
      apply();
      // Defer the fade-in opacity flip to the next frame so apply()'s
      // d3 join (~15 path appends + forced layout) doesn't contend with
      // the transition's first-frame setup — without the rAF the browser
      // sometimes drops the first 1–2 frames of easing.
      requestAnimationFrame(() => {
        if (myGen !== crossfadeGen) return;
        void cw.getBoundingClientRect(); // force commit before opacity flip
        cw.style.opacity = '1';
      });
      setTimeout(() => {
        if (myGen === crossfadeGen) {
          cw.style.transition = baselineChartTransition;
        }
      }, FADE_HALF_MS);
    }, FADE_HALF_MS);
  };

  // Sub-chart mode (v9.6+): legend hover on Copy/Fav_Copy/Char swaps the
  // pie with the parent's sub-tag breakdown for as long as the subtag
  // tooltip is open. Re-entered with a different parent simply re-applies
  // — d3 join handles the diff. Returns slice mapping so T-51 (row hover
  // highlight) can target the right path element by sub tagName.
  // `parentTag` is the token the exit path uses to confirm it's reverting
  // its OWN mode. Without it, a fast mouse glide (gundam → identity_v)
  // would let the previous tooltip's late onHide call clobber the new
  // mode after the timer fires — gundam.onHide.exit() would run AFTER
  // identity_v has already taken over the chart, snapping back to the
  // top-level pie. Exit calls now pass their owning parent's tag; if it
  // no longer matches the active mode, the call is a no-op.
  let subChartActive: {
    tagToLabel: Map<string, string>;
    parentTag: string | undefined;
  } | null = null;
  const enterSubChartMode = (
    parent: DistributionItem,
    parentColor?: string,
  ): void => {
    // parentColor lets buildSubChartSlices fall back to a single-slice
    // view of the parent when its sub breakdown is empty — so any legend
    // row triggers chart-mode, not just rows with subTags.
    const subSlices = buildSubChartSlices(parent, parentColor);
    if (subSlices.length === 0) return;
    const subPctStrings = computePercentages(
      subSlices.map(s => s.value),
      1,
    );
    const subPctByLabel = new Map<string, string>(
      subSlices.map((s, i) => [s.label, subPctStrings[i]]),
    );
    const subPctFor = (label: string) => subPctByLabel.get(label) ?? '0.0%';
    subChartActive = {
      tagToLabel: new Map(
        subSlices
          .filter(s => s.details.kind === 'tag' && !s.details.isOther)
          .map(s => [
            (s.details as {tagName?: string}).tagName ?? s.label,
            s.label,
          ]),
      ),
      parentTag: parent.tagName,
    };
    setSubChartActive?.(true);
    crossfadeChartTransition(() => {
      // Hide the chart's drop shadow while a sub-chart is showing — it
      // bleeds through the gaps when slices don't fully cover the disk
      // and washes the slice colors out to near-black.
      setShadowVisibility(chartWrapper as HTMLElement, false);
      applyChartData(subSlices, subPctFor);
    });
  };
  const exitSubChartMode = (forParentTag?: string): void => {
    if (!subChartActive) return;
    // Guard against late callers: if a different parent now owns the
    // chart mode, this exit was queued by an earlier hover and would
    // otherwise revert the user-visible mode the new hover just set.
    if (forParentTag && subChartActive.parentTag !== forParentTag) return;
    subChartActive = null;
    setSubChartActive?.(false);
    crossfadeChartTransition(() => {
      setShadowVisibility(chartWrapper as HTMLElement, true);
      applyChartData(validData, pctFor);
    });
  };
  // Slice path lookup by sub tagName — drives T-51 row hover highlight.
  const findSubSliceByTag = (tagName: string): SVGPathElement | null => {
    const label = subChartActive?.tagToLabel.get(tagName);
    if (!label) return null;
    return (
      (svg
        .selectAll('path.danbooru-grass-pie-path')
        .filter(
          (d: unknown) => (d as d3.PieArcDatum<PieSlice>).data.label === label,
        )
        .node() as SVGPathElement | null) ?? null
    );
  };

  const legendDiv = pieContent.querySelector('.danbooru-grass-legend-scroll');
  if (legendDiv) {
    renderPieLegend({
      legendDiv,
      processedData,
      currentPieTab,
      pctFor,
      normalizedName: contextUser.normalizedName ?? '',
      chartModeControl: {
        enter: enterSubChartMode,
        exit: exitSubChartMode,
        findSubSliceByTag,
        isTouch,
        svg,
        arc,
        arcHover,
      },
    });
  }
}

/**
 * Hooks the legend wire-up uses to drive the v9.6 sub-chart mode + row
 * hover highlight. Only the Copy / Fav_Copy / Char tabs supply this; the
 * other tabs pass undefined and `wireSubtagTooltipHandlers` is never
 * called for them.
 */
interface ChartModeControl {
  enter: (parent: DistributionItem, parentColor?: string) => void;
  /**
   * `forParentTag`: if supplied, the exit is ignored unless the active
   * sub-chart was entered for the same parent. Lets stale onHide
   * callbacks fire safely after a quick hover takeover.
   */
  exit: (forParentTag?: string) => void;
  /** Returns the SVG <path> for a sub tagName, or null. T-51 highlight. */
  findSubSliceByTag: (tagName: string) => SVGPathElement | null;
  isTouch: boolean;
  svg: D3Any;
  arc: D3Any;
  arcHover: D3Any;
}

// ============================================================
// PIE WIDGET — MAIN
// ============================================================

/**
 * Renders the pie chart widget with tabs (status, rating, character, copyright, etc.).
 * @param container The element to render into.
 * @param distributions Pre-fetched distribution data keyed by tab name.
 * @param initialNsfwEnabled Whether NSFW content is currently enabled.
 * @param dataManager The AnalyticsDataManager to fetch additional tab data.
 * @param context The chart context providing user information.
 * @param firstUploadDate The user's first upload date (needed for some distributions).
 * @returns Cleanup/update callbacks for NSFW toggle integration.
 */
// T-26 baseline: 203 LOC (3 over budget after T-23). Body is mostly tab
// table + orchestration; further split would invent helpers without real
// payoff. Borderline — revisit if it grows.
// eslint-disable-next-line max-lines-per-function
export function renderPieWidget(
  container: HTMLElement,
  distributions: Record<string, PieTabItem[]>,
  initialNsfwEnabled: boolean,
  dataManager: AnalyticsDataManager,
  context: ChartContext,
  firstUploadDate: Date | null,
): {onNsfwChange: (enabled: boolean) => void} {
  // Local state (closure variables)
  const pieData: Record<string, PieTabItem[]> = {...distributions};
  let currentPieTab = 'copyright';
  let renderPending = false;
  let isNsfwEnabled = initialNsfwEnabled;

  // Pre-process special distributions (count-based → frequency/value).
  // Same normalization that fetchDistributionForTab applies on the lazy
  // path — kept here for tabs whose data was passed in upfront.
  for (const key of ['breasts', 'gender', 'commentary', 'translation']) {
    if (pieData[key]) {
      pieData[key] = preprocessFrequencyTab(pieData[key]);
    }
  }

  // Tracked by renderPieFrame via the setSubChartActive callback. Used
  // to suppress `requestRender` while the user is hovering a sub-chart
  // breakdown — otherwise a lazy thumbnail update event would re-run
  // renderPieFrame, rebuild the chart from the tab's full data, and
  // visibly snap the single-slice / sub-breakdown view back to the
  // top-level pie mid-hover.
  let subChartIsActive = false;

  const requestRender = () => {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPieContent();
      renderPending = false;
    });
  };

  // Listen for lazy-loaded thumbnail updates
  const onPieDataUpdate = (e: Event) => {
    if (!document.body.contains(container)) {
      window.removeEventListener(
        'DanbooruInsights:DataUpdated',
        onPieDataUpdate,
      );
      return;
    }
    const {contentType, data} = (e as CustomEvent).detail;
    const keyMap: Record<string, string> = {
      character_dist: 'character',
      copyright_dist: 'copyright',
      fav_copyright_dist: 'fav_copyright',
      breasts_dist: 'breasts',
      hair_length_dist: 'hair_length',
      hair_color_dist: 'hair_color',
      rating_dist: 'rating',
    };
    const key = keyMap[contentType as string];

    if (key && pieData[key]) {
      const incomingMap = new Map(
        (data as PieTabItem[]).map((d: PieTabItem) => [d.name, d]),
      );
      const currentData = pieData[key];

      currentData.forEach((item: PieTabItem) => {
        const update = incomingMap.get(item.name);
        if (update && update.thumb && item.thumb !== update.thumb) {
          item.thumb = update.thumb;
          const withDetails = item as PieTabItem & {
            details?: {thumb: string | null};
          };
          if (withDetails.details) withDetails.details.thumb = update.thumb;
        }
      });

      if (currentPieTab === key) {
        // Mutation above already lands on `pieData` (and the slices'
        // details.thumb), so the next non-hover render will pick it up.
        // Skip the render itself while the user is exploring a sub-chart
        // so we don't snap the view back to the top-level pie mid-hover.
        if (subChartIsActive) return;
        requestRender();
      }
    }
  };
  window.addEventListener('DanbooruInsights:DataUpdated', onPieDataUpdate);

  /**
   * Handles click events on pie chart slices. Delegates the per-tab
   * URL branching to `buildSearchQuery` so the legend (which links to
   * the same target) and this handler stay in sync.
   */
  const handlePieClick = (d: d3.PieArcDatum<PieSlice>) => {
    const targetName =
      context.targetUser.normalizedName ||
      context.targetUser.name.replace(/ /g, '_') ||
      '';
    const query = buildSearchQuery(
      d.data.details,
      d.data.label,
      targetName,
      currentPieTab,
    );
    if (!query) return;
    window.open(
      `/posts?tags=${encodeURIComponent(query)}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  // Thin shim around the module-level renderPieFrame helper; binds the
  // closure state (pieData / currentPieTab / context / handlePieClick) so
  // callers (requestRender, loadTab, the tab-click handler) can keep
  // calling renderPieContent() with no arguments and pick up the latest
  // tab value at call time.
  const renderPieContent = () => {
    renderPieFrame({
      container,
      pieData,
      currentPieTab,
      context,
      handlePieClick,
      setSubChartActive: active => {
        subChartIsActive = active;
      },
    });
  };

  const updatePieTabs = () => {
    const btns = container.querySelectorAll('.di-pie-tab');
    btns.forEach(btn => {
      const el = btn as HTMLElement;
      const mode = el.getAttribute('data-mode');
      if (mode === currentPieTab) {
        el.style.background = 'var(--di-text-secondary, #666)';
        el.style.color = 'var(--di-bg, #fff)';
        el.style.boxShadow =
          '0 1px 3px var(--di-shadow-light, rgba(0,0,0,0.1))';
      } else {
        el.style.background = 'var(--di-bg-tertiary, #f0f0f0)';
        el.style.color = 'var(--di-text-secondary, #666)';
        el.style.boxShadow = 'none';
      }
    });
  };

  // Render initial HTML structure
  container.innerHTML = `
     <div style="width:100%; display:flex; flex-direction:column;">
         <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; width:100%;">
             <div style="display:flex; flex-direction:column; gap:4px; max-width:100%;">
                 <div style="display:flex; flex-wrap:wrap; gap:4px;">
                     <button class="di-pie-tab" data-mode="copyright" title="Copyright">Copy</button>
                     <button class="di-pie-tab" data-mode="character" title="Character">Char</button>
                     <button class="di-pie-tab" data-mode="fav_copyright" title="Favorite Copyright">Fav_Copy</button>
                     <button class="di-pie-tab" data-mode="status" title="Post Status">Status</button>
                     <button class="di-pie-tab" data-mode="rating" title="Content Rating">Rate</button>
                     <button class="di-pie-tab" data-mode="commentary" title="Commentary">Cmnt</button>
                     <button class="di-pie-tab" data-mode="translation" title="Translation">Tran</button>
                 </div>
                 <div style="display:flex; flex-wrap:wrap; gap:4px;">
                     <button class="di-pie-tab" data-mode="gender" title="Gender Distribution">Gender</button>
                     <button class="di-pie-tab" data-mode="breasts" style="display:${isNsfwEnabled ? 'block' : 'none'};" title="Breast Size">Boobs</button>
                     <button class="di-pie-tab" data-mode="hair_length" title="Hair Length">Hair_L</button>
                     <button class="di-pie-tab" data-mode="hair_color" title="Hair Color">Hair_C</button>
                 </div>
             </div>
         </div>
         <div class="pie-content" style="flex:1; display:flex; justify-content:center; align-items:center; min-height:160px;">
             Loading...
         </div>
     </div>
  `;

  const loadTab = async (tabName: string) => {
    if (pieData[tabName]) {
      renderPieContent();
      return;
    }

    const pieContent = container.querySelector('.pie-content');
    if (pieContent)
      pieContent.innerHTML =
        '<div style="color:var(--di-chart-axis-secondary, #666);">Loading...</div>';

    try {
      const data = await fetchDistributionForTab(
        tabName,
        dataManager,
        context.targetUser,
        firstUploadDate,
      );
      pieData[tabName] = data;

      if (currentPieTab === tabName) {
        renderPieContent();
        updatePieTabs();
      }
    } catch (e) {
      log.error('Failed to load pie chart data', {error: e});
      const pieContent = container.querySelector('.pie-content');
      if (pieContent) pieContent.innerHTML = 'Error loading data.';
    }
  };

  container.addEventListener('click', e => {
    if ((e.target as HTMLElement).classList.contains('di-pie-tab')) {
      const mode = (e.target as HTMLElement).getAttribute('data-mode') ?? '';
      if (mode && currentPieTab !== mode) {
        currentPieTab = mode;
        updatePieTabs();

        const pieContent = container.querySelector(
          '.pie-content',
        ) as HTMLElement | null;
        if (!pieContent) {
          void loadTab(mode);
          return;
        }

        runTabCrossfade({
          pieContent,
          mode,
          loadTab,
          getCurrentTab: () => currentPieTab,
        });
      }
    }
  });

  updatePieTabs();
  void loadTab(currentPieTab);

  return {
    onNsfwChange: (enabled: boolean) => {
      isNsfwEnabled = enabled;
      const boobsBtn = container.querySelector(
        '.di-pie-tab[data-mode="breasts"]',
      ) as HTMLElement;
      if (boobsBtn) {
        boobsBtn.style.display = isNsfwEnabled ? 'block' : 'none';
      }
      if (!isNsfwEnabled && currentPieTab === 'breasts') {
        currentPieTab = 'copyright';
        updatePieTabs();
        void loadTab('copyright');
      }
    },
  };
}

// ============================================================
// TOP POSTS WIDGET
// ============================================================

/**
 * Renders the top posts widget with Most Popular / Recent / Random tabs.
 * @param container The element to render into.
 * @param topPosts Pre-fetched most popular posts grouped by rating.
 * @param recentPopularPosts Pre-fetched recent popular posts.
 * @param randomPosts Pre-fetched random posts.
 * @param initialNsfwEnabled Whether NSFW content is currently enabled.
 * @param db The database instance (for refresh).
 * @param context The chart context providing user information.
 * @returns NSFW update callbacks.
 */
// T-26 baseline: 265 LOC. Recent / most / sfw / nsfw tab matrix + post
// fetch + rotation + NSFW gating. Decomposition candidate; parallel to
// the other large user-analytics widgets but not in Phase 5c scope.
// eslint-disable-next-line max-lines-per-function
export function renderTopPostsWidget(
  container: HTMLElement,
  topPosts: TopPostsByRating | null,
  recentPopularPosts: TopPostsBySfw | null,
  randomPosts: TopPostsBySfw | Promise<TopPostsBySfw | null> | null,
  initialNsfwEnabled: boolean,
  db: Database,
  context: ChartContext,
): {onNsfwChange: (enabled: boolean) => void} {
  let isNsfwEnabled = initialNsfwEnabled;

  // randomPosts is accepted as either a resolved value or a pending Promise.
  // When a Promise is passed, the widget renders without blocking on it; the
  // Random tab shows a "loading..." placeholder until it resolves, then
  // swaps in the real content. This keeps the dashboard's first paint from
  // being dominated by the random-post fetch (~1.3s per measurement).
  const topPostGroups: Record<string, TopPostsByRating | TopPostsBySfw | null> =
    {
      most: topPosts,
      recent: recentPopularPosts,
      random:
        randomPosts && !(randomPosts instanceof Promise) ? randomPosts : null,
    };

  if (randomPosts instanceof Promise) {
    void randomPosts.then(resolved => {
      topPostGroups.random = resolved;
      // Re-render only if the user is currently viewing the Random tab.
      if (currentWidgetMode === 'random') renderTopPostContent();
    });
  }

  let currentWidgetMode = 'recent';
  let currentMostTab = 'g';
  let currentSfwTab = 'sfw';

  // T-26 baseline: arrow complexity 16. Mode × tab × data-state matrix.
  // eslint-disable-next-line complexity
  const renderTopPostContent = () => {
    const group = topPostGroups[currentWidgetMode];
    const tabKey =
      currentWidgetMode === 'most' ? currentMostTab : currentSfwTab;
    const data = group
      ? (group as Record<string, DanbooruPost | null>)[tabKey]
      : null;
    const contentDiv = container.querySelector(
      '.top-post-content',
    ) as HTMLElement | null;
    if (!contentDiv) return;

    if (!data) {
      contentDiv.innerHTML =
        '<div style="color:var(--di-text-muted, #888); padding:20px 0;">No posts found or loading...</div>';
      return;
    }

    const thumbUrl = getBestThumbnailUrl(data);
    const dateStr = data.created_at
      ? new Date(data.created_at).toISOString().split('T')[0]
      : 'N/A';
    const link = `/posts/${data.id}`;
    const ratingMap: Record<string, string> = {
      g: 'General',
      s: 'Sensitive',
      q: 'Questionable',
      e: 'Explicit',
    };
    const ratingLabel = ratingMap[data.rating] || data.rating;

    const refreshBtn = container.querySelector(
      '#analytics-random-refresh',
    ) as HTMLElement;
    if (refreshBtn) {
      refreshBtn.style.display =
        currentWidgetMode === 'random' ? 'inline-block' : 'none';
    }

    const searchLinkBtn = container.querySelector(
      '#analytics-more-post-link',
    ) as HTMLElement;
    if (searchLinkBtn) {
      searchLinkBtn.style.display =
        currentWidgetMode === 'recent' ? 'inline-block' : 'none';

      const normalizedName = context.targetUser.normalizedName;
      const ratingTag = currentSfwTab === 'sfw' ? 'is:sfw' : 'is:nsfw';
      const searchQuery = `user:${normalizedName} order:score age:<1w ${ratingTag}`;

      searchLinkBtn.onclick = () => {
        window.open(`/posts?tags=${encodeURIComponent(searchQuery)}`, '_blank');
      };
    }

    const createTagLine = (label: string, icon: string, tags: string) => {
      if (!tags) return '';
      const tagList = tags.replace(/_/g, ' ');
      const displayTags =
        label === 'Char' && tags.split(' ').length > 5
          ? tagList.split(' ').slice(0, 5).join(', ') + '...'
          : tagList;
      return `<div>${icon} <strong>${label}:</strong> ${displayTags}</div>`;
    };

    const artistLine = createTagLine(
      'Artist',
      '🎨',
      data.tag_string_artist ?? '',
    );
    const copyrightLine = createTagLine(
      'Copy',
      '©️',
      data.tag_string_copyright ?? '',
    );
    const charLine = createTagLine(
      'Char',
      '👤',
      data.tag_string_character ?? '',
    );

    contentDiv.innerHTML = `
      <div class="di-top-post-layout" style="display:flex; gap:15px; align-items:flex-start;">
          <a class="di-top-post-thumb" href="${link}" target="_blank" style="display:block; width:150px; height:150px; flex-shrink:0; background:var(--di-bg-tertiary, #f0f0f0); border-radius:4px; overflow:hidden; position:relative;">
              <img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;" alt="#${data.id}">
          </a>
          <div style="flex:1;">
              <div style="font-weight:bold; font-size:1.1em; color:var(--di-link, #007bff); margin-bottom:4px;">
                  <a href="${link}" target="_blank" style="text-decoration:none; color:inherit;">Post #${data.id}</a>
              </div>
              <div style="font-size:0.9em; color:var(--di-text-secondary, #666); line-height:1.5;">
                  📅 ${dateStr}<br>
                  ❤️ Score: <strong>${data.score}</strong><br>
                  ⭐ Favs: <strong>${data.fav_count || '?'}</strong><br>
                  🤔 Rating: <strong>${ratingLabel}</strong>

                  <div style="margin-top:8px; border-top:1px solid var(--di-border-light, #eee); padding-top:6px;">
                      ${artistLine}
                      ${copyrightLine}
                      ${charLine}
                  </div>
              </div>
          </div>
      </div>
   `;
  };

  const updateTabs = () => {
    const setStyle = (btn: HTMLElement | null, isActive: boolean) => {
      if (!btn) return;
      btn.style.background = isActive
        ? 'var(--di-link, #007bff)'
        : 'var(--di-bg-tertiary, #f0f0f0)';
      btn.style.color = isActive
        ? 'var(--di-bg, #fff)'
        : 'var(--di-text, #333)';
    };

    const gsqeGroup = container.querySelector(
      '#top-post-tabs-gsqe',
    ) as HTMLElement | null;
    const sfwnsfwGroup = container.querySelector(
      '#top-post-tabs-sfwnsfw',
    ) as HTMLElement | null;

    if (currentWidgetMode === 'most') {
      if (gsqeGroup) gsqeGroup.style.display = 'flex';
      if (sfwnsfwGroup) sfwnsfwGroup.style.display = 'none';
      for (const mode of ['g', 's', 'q', 'e']) {
        const btn = container.querySelector(
          `button[data-mode="${mode}"]`,
        ) as HTMLElement | null;
        setStyle(btn, currentMostTab === mode);
      }
    } else {
      if (gsqeGroup) gsqeGroup.style.display = 'none';
      if (sfwnsfwGroup) sfwnsfwGroup.style.display = 'flex';
      for (const mode of ['sfw', 'nsfw']) {
        const btn = container.querySelector(
          `button[data-mode="${mode}"]`,
        ) as HTMLElement | null;
        setStyle(btn, currentSfwTab === mode);
      }
    }
  };

  container.style.padding = '15px';
  container.innerHTML = `
     <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div style="font-size:0.85em; color:var(--di-chart-axis-secondary, #666); letter-spacing:0.5px; display:flex; align-items:center; gap:5px;">
           <select id="analytics-top-post-select" style="border:none; background:transparent; font-weight:bold; color:var(--di-chart-axis-secondary, #666); cursor:pointer; text-transform:uppercase; font-size:1em; outline:none;">
              <option value="recent">🔥 Recent Popular Post</option>
              <option value="most">🏆 Most Popular Post</option>
              <option value="random">🎲 Random Post</option>
           </select>
            <button id="analytics-random-refresh" style="display:none; border:none; background:transparent; cursor:pointer; font-size:1.2em; padding:0 4px; margin-left:5px; filter: grayscale(100%); opacity: 0.6;" title="Load New Random Post">
                 🔄
             </button>
            <button id="analytics-more-post-link" style="border:none; background:transparent; cursor:pointer; font-size:1.1em; padding:0 4px; margin-left:2px; filter: grayscale(100%); opacity: 0.6;" title="See more posts">
                 ↗️
             </button>
         </div>
        <div id="top-post-tabs-sfwnsfw" style="display:flex; gap:0px; border:1px solid var(--di-border-input, #ddd); border-radius:6px; overflow:hidden;">
           <button class="top-post-tab" data-mode="sfw" style="border:none; background:var(--di-link, #007bff); color:var(--di-bg, #fff); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">SFW</button>
           <button class="top-post-tab" id="analytics-top-nsfw-btn" data-mode="nsfw" style="border:none; border-left:1px solid var(--di-border-input, #ddd); background:var(--di-bg-tertiary, #f0f0f0); color:var(--di-text, #333); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s; display: ${isNsfwEnabled ? 'inline-block' : 'none'};">NSFW</button>
        </div>
        <div id="top-post-tabs-gsqe" style="display:none; gap:0px; border:1px solid var(--di-border-input, #ddd); border-radius:6px; overflow:hidden;">
           <button class="top-post-tab" data-mode="g" style="border:none; background:var(--di-bg-tertiary, #f0f0f0); color:var(--di-text, #333); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">G</button>
           <button class="top-post-tab" data-mode="s" style="border:none; border-left:1px solid var(--di-border-input, #ddd); background:var(--di-bg-tertiary, #f0f0f0); color:var(--di-text, #333); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">S</button>
           <button class="top-post-tab" id="analytics-top-q-btn" data-mode="q" style="border:none; border-left:1px solid var(--di-border-input, #ddd); background:var(--di-bg-tertiary, #f0f0f0); color:var(--di-text, #333); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s; display: ${isNsfwEnabled ? 'inline-block' : 'none'};">Q</button>
           <button class="top-post-tab" id="analytics-top-e-btn" data-mode="e" style="border:none; border-left:1px solid var(--di-border-input, #ddd); background:var(--di-bg-tertiary, #f0f0f0); color:var(--di-text, #333); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s; display: ${isNsfwEnabled ? 'inline-block' : 'none'};">E</button>
        </div>
     </div>
     <div class="top-post-content">
         <div style="color:var(--di-chart-axis-secondary, #666); font-size:0.9em;">Loading stats...</div>
     </div>
  `;

  const modeSelect = container.querySelector(
    '#analytics-top-post-select',
  ) as HTMLSelectElement;
  if (modeSelect) {
    modeSelect.addEventListener('change', e => {
      currentWidgetMode = (e.target as HTMLSelectElement).value;
      updateTabs();
      renderTopPostContent();
    });
  }

  const refreshBtn = container.querySelector(
    '#analytics-random-refresh',
  ) as HTMLElement;
  if (refreshBtn) {
    refreshBtn.onclick = async e => {
      e.stopPropagation();
      refreshBtn.style.transform = 'rotate(360deg)';
      setTimeout(() => (refreshBtn.style.transform = 'rotate(0deg)'), 400);

      const contentDiv = container.querySelector(
        '.top-post-content',
      ) as HTMLElement;
      contentDiv.style.opacity = '0.5';

      try {
        const newRandoms = await new AnalyticsDataManager(db).getRandomPosts(
          context.targetUser,
        );
        topPostGroups['random'] = newRandoms;
        renderTopPostContent();
      } catch (err) {
        log.error('Failed to refresh random post', {error: err});
      } finally {
        contentDiv.style.opacity = '1';
      }
    };
  }

  container.addEventListener('click', e => {
    if ((e.target as HTMLElement).classList.contains('top-post-tab')) {
      const mode = (e.target as HTMLElement).getAttribute('data-mode') ?? '';
      if (currentWidgetMode === 'most') {
        currentMostTab = mode || 'g';
      } else {
        currentSfwTab = mode || 'sfw';
      }
      updateTabs();
      renderTopPostContent();
    }
  });

  updateTabs();
  renderTopPostContent();

  return {
    onNsfwChange: (enabled: boolean) => {
      isNsfwEnabled = enabled;

      for (const id of [
        'analytics-top-q-btn',
        'analytics-top-e-btn',
        'analytics-top-nsfw-btn',
      ]) {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = isNsfwEnabled ? 'inline-block' : 'none';
      }

      if (
        !isNsfwEnabled &&
        (currentMostTab === 'q' || currentMostTab === 'e')
      ) {
        currentMostTab = 'g';
        updateTabs();
        if (currentWidgetMode === 'most') renderTopPostContent();
      }

      if (!isNsfwEnabled && currentSfwTab === 'nsfw') {
        currentSfwTab = 'sfw';
        updateTabs();
        if (currentWidgetMode !== 'most') renderTopPostContent();
      }
    },
  };
}

// ============================================================
// MILESTONES WIDGET
// ============================================================

/**
 * Renders the milestones widget with step selector.
 * @param container The element to render into.
 * @param db The database instance.
 * @param context The chart context providing user information.
 * @param initialNsfwEnabled Whether NSFW content is currently enabled.
 * @returns NSFW update callback (re-renders milestones on change).
 */
export async function renderMilestonesWidget(
  container: HTMLElement,
  db: Database,
  context: ChartContext,
  initialNsfwEnabled: boolean,
): Promise<{onNsfwChange: (enabled: boolean) => Promise<void>}> {
  let isNsfwEnabled = initialNsfwEnabled;
  let currentMilestoneStep: 'auto' | 'repdigit' | number = 'auto';
  let isMilestoneExpanded = false;

  // T-26 baseline: arrow complexity 26. Step modes (auto/repdigit/N) ×
  // expand state × per-milestone post hydration × NSFW gating.
  // eslint-disable-next-line complexity
  const renderMilestones = async () => {
    const dm = new AnalyticsDataManager(db);
    const milestones = await dm.getMilestones(
      context.targetUser,
      isNsfwEnabled,
      currentMilestoneStep,
    );
    // Local DB count — same source `getMilestones` uses internally to build
    // its target sequence. Avoids an extra API call.
    const uploaderId = parseInt(context.targetUser?.id ?? '0');
    const totalPosts = uploaderId
      ? await db.posts.where('uploader_id').equals(uploaderId).count()
      : 0;
    const nextTarget = dm.getNextMilestone(totalPosts, currentMilestoneStep);

    let msHtml =
      '<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--di-border-light, #eee); padding-bottom:8px; margin-bottom:10px;">';
    msHtml +=
      '<h3 style="color:var(--di-text, #333); margin:0;">🏆 Milestones</h3>';
    msHtml += '<div style="display:flex; align-items:center; gap:10px;">';

    msHtml += `<select id="analytics-milestone-step" style="border:1px solid var(--di-border-input, #ddd); border-radius:4px; padding:2px 4px; font-size:0.85em; color:var(--di-text-secondary, #666); background-color:var(--di-bg-tertiary, #f0f0f0);">
      <option value="auto" ${currentMilestoneStep === 'auto' ? 'selected' : ''}>Auto</option>
      <option value="1000" ${currentMilestoneStep === 1000 || String(currentMilestoneStep) === '1000' ? 'selected' : ''}>Every 1k</option>
      <option value="2500" ${currentMilestoneStep === 2500 || String(currentMilestoneStep) === '2500' ? 'selected' : ''}>Every 2.5k</option>
      <option value="5000" ${currentMilestoneStep === 5000 || String(currentMilestoneStep) === '5000' ? 'selected' : ''}>Every 5k</option>
      <option value="10000" ${currentMilestoneStep === 10000 || String(currentMilestoneStep) === '10000' ? 'selected' : ''}>Every 10k</option>
      <option value="repdigit" ${currentMilestoneStep === 'repdigit' ? 'selected' : ''}>Repdigit</option>
    </select>`;

    msHtml +=
      '<button id="analytics-milestone-toggle" style="background:none; border:none; color:var(--di-link, #007bff); cursor:pointer; font-size:0.9em; display:none;">Show More</button>';
    msHtml += '</div>';
    msHtml += '</div>';

    if (milestones.length === 0) {
      container.innerHTML =
        msHtml +
        '<div style="color:var(--di-text-muted, #888); font-size:0.9em;">No milestones found.</div>';
      const sel = container.querySelector(
        '#analytics-milestone-step',
      ) as HTMLSelectElement;
      if (sel) {
        sel.onchange = e => {
          const v = (e.target as HTMLSelectElement).value;
          currentMilestoneStep =
            v === 'auto' ? 'auto' : v === 'repdigit' ? 'repdigit' : parseInt(v);
          void renderMilestones();
        };
      }
      return;
    }

    const containerId = 'analytics-milestone-container';
    msHtml += `<div id="${containerId}" class="di-milestone-collapsed" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap:10px; max-height:110px; overflow:hidden; transition: max-height 0.3s ease;">`;

    milestones.forEach((m: MilestoneEntry) => {
      const p = m.post;
      const isSafe = p.rating === 's' || p.rating === 'g';
      const thumbUrl = getBestThumbnailUrl(p);
      const showThumb = isNsfwEnabled || isSafe;

      msHtml += `
      <a href="/posts/${p.id}" target="_blank" class="di-hover-scale" style="
         display:flex; justify-content:space-between; align-items:center; text-decoration:none; color:inherit;
         background:var(--di-chart-bg, #fff); border:1px solid var(--di-border-light, #eee); border-radius:6px; padding:10px;
      ">
         <div>
             <div style="font-size:0.8em; color:var(--di-text-muted, #888); letter-spacing:0.5px;">#${p.id}</div>
             <div style="font-size:1.1em; font-weight:bold; color:var(--di-link, #007bff); margin-top:4px;">${m.type}</div>
             <div style="font-size:0.8em; color:var(--di-text-secondary, #666); margin-top:2px;">${new Date(p.created_at).toLocaleDateString()}</div>
             <div style="font-size:0.75em; color:var(--di-text-faint, #999); margin-top:4px;">Score: ${p.score}</div>
         </div>
         ${showThumb && thumbUrl ? `<div style="width:60px; height:60px; margin-left:10px; flex-shrink:0; background:var(--di-bg-tertiary, #f0f0f0); border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center;"><img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;"></div>` : ''}
      </a>
    `;
    });

    // Append the "next milestone" placeholder card (always last in the grid).
    //
    // Progress calculation uses **option A**: prev = the last reached
    // milestone's index from the actually fetched `milestones` array. This
    // is the simplest and works for every realistic case (verified for
    // total=720 across all modes).
    //
    // **Option C** (alternative, not used): compute prev as "the milestone
    // immediately before next in the theoretical sequence" via a pure
    // helper like `getPrevMilestone(total, mode)`. The two options produce
    // identical results in practice — they only diverge in pathological
    // cases where a milestone post failed to fetch from the DB. Switch to
    // option C only if we ever decouple the progress card from the fetched
    // post list (e.g. show the placeholder before milestones load).
    if (nextTarget !== null && nextTarget > totalPosts) {
      const remaining = nextTarget - totalPosts;
      const prevTarget =
        milestones.length > 0 ? milestones[milestones.length - 1].milestone : 0;
      const span = nextTarget - prevTarget;
      const progressPct =
        span > 0
          ? Math.max(0, Math.min(100, ((totalPosts - prevTarget) / span) * 100))
          : 0;
      const nextLabel =
        nextTarget === 1
          ? 'First'
          : nextTarget >= 1000 && nextTarget % 1000 === 0
            ? `${nextTarget / 1000} k`
            : nextTarget.toLocaleString();

      msHtml += `
      <div class="di-next-milestone-card" style="
         display:flex; flex-direction:column; justify-content:space-between;
         background:var(--di-bg-tertiary, #f0f0f0); border:1px dashed var(--di-border-input, #ddd); border-radius:6px; padding:10px;
         color:var(--di-text-secondary, #666);
      ">
         <div>
             <div style="font-size:0.7em; color:var(--di-text-muted, #888); letter-spacing:0.5px; text-transform:uppercase;">Next</div>
             <div style="font-size:1.1em; font-weight:bold; color:var(--di-text-secondary, #666); margin-top:4px;">${nextLabel}</div>
             <div style="font-size:0.8em; color:var(--di-chart-axis-secondary, #666); margin-top:6px;">${remaining.toLocaleString()} remaining</div>
         </div>
         <div style="margin-top:8px;">
             <div style="height:6px; background:var(--di-border-light, #eee); border-radius:3px; overflow:hidden;">
                 <div style="width:${progressPct.toFixed(1)}%; height:100%; background:var(--di-link, #007bff);"></div>
             </div>
             <div style="font-size:0.7em; color:var(--di-text-muted, #888); margin-top:3px; text-align:right;">${progressPct.toFixed(0)}%</div>
         </div>
      </div>
    `;
    }
    msHtml += '</div>';
    container.innerHTML = msHtml;

    const stepSelect = container.querySelector(
      '#analytics-milestone-step',
    ) as HTMLSelectElement;
    if (stepSelect) {
      stepSelect.onchange = e => {
        const v = (e.target as HTMLSelectElement).value;
        currentMilestoneStep =
          v === 'auto' ? 'auto' : v === 'repdigit' ? 'repdigit' : parseInt(v);
        void renderMilestones();
      };
    }

    if (milestones.length > 6) {
      const btn = container.querySelector(
        '#analytics-milestone-toggle',
      ) as HTMLElement;
      const milestoneContainer = container.querySelector(
        `#${containerId}`,
      ) as HTMLElement;
      btn.style.display = 'block';

      if (isMilestoneExpanded) {
        milestoneContainer.classList.remove('di-milestone-collapsed');
        milestoneContainer.style.maxHeight =
          milestoneContainer.scrollHeight + 'px';
        btn.textContent = 'Show Less';
      }

      btn.onclick = () => {
        isMilestoneExpanded = !isMilestoneExpanded;
        if (isMilestoneExpanded) {
          milestoneContainer.classList.remove('di-milestone-collapsed');
          milestoneContainer.style.maxHeight =
            milestoneContainer.scrollHeight + 'px';
          btn.textContent = 'Show Less';
        } else {
          milestoneContainer.classList.add('di-milestone-collapsed');
          milestoneContainer.style.maxHeight = '110px';
          btn.textContent = 'Show More';
        }
      };
    }
  };

  await renderMilestones();

  return {
    onNsfwChange: async (enabled: boolean) => {
      isNsfwEnabled = enabled;
      await renderMilestones();
    },
  };
}

// ============================================================
// MONTHLY HISTORY CHART
// ============================================================

/**
 * Renders the monthly history chart (SVG bar chart with level change overlays).
 * @param container The dashboard div to append the chart into.
 * @param db The database instance.
 * @param context The chart context providing user information.
 * @param milestones1k Pre-fetched 1k milestone posts.
 * @param levelChanges Pre-fetched level change events.
 */
export async function renderHistoryChart(
  container: HTMLElement,
  db: Database,
  context: ChartContext,
  milestones1k: MilestoneEntry[],
  levelChanges: LevelChangeEvent[],
): Promise<void> {
  let minDate = null;
  if (levelChanges.length > 0) {
    minDate = levelChanges[0].date;
  }

  const isTouch2 = isTouchDevice();

  const monthly = await new AnalyticsDataManager(db).getMonthlyStats(
    context.targetUser,
    minDate,
  );
  if (monthly.length === 0) return;

  const chartDiv = document.createElement('div');
  chartDiv.style.marginTop = '24px';
  const chartHtml =
    '<h3 style="color:var(--di-chart-axis, #333); border-bottom:1px solid var(--di-border-light, #eee); padding-bottom:10px; margin-bottom:15px;">📅 Monthly Activity</h3>';

  const minBarWidth = 25;
  const padLeftScroll = 10;
  const padRight = 20;
  const padBottom = 25;
  const padTop = 20;
  const yAxisWidth = 45;

  const maxCount = Math.max(...monthly.map(m => m.count));
  const requiredWidth = padLeftScroll + padRight + monthly.length * minBarWidth;
  const vWidth = Math.max(800, requiredWidth);
  const vHeight = 200;

  const mainWrapper = document.createElement('div');
  mainWrapper.className = 'chart-flex-wrapper';
  mainWrapper.style.display = 'flex';
  mainWrapper.style.width = '100%';
  mainWrapper.style.position = 'relative';
  mainWrapper.style.border = '1px solid var(--di-border-light, #eee)';
  mainWrapper.style.borderRadius = '8px';
  mainWrapper.style.backgroundColor = 'var(--di-chart-bg, #fff)';
  mainWrapper.style.overflow = 'hidden';

  const yAxisWrapper = document.createElement('div');
  yAxisWrapper.style.width = `${yAxisWidth}px`;
  yAxisWrapper.style.flexShrink = '0';
  yAxisWrapper.style.borderRight = '1px solid var(--di-bg-tertiary, #f0f0f0)';
  yAxisWrapper.style.zIndex = '5';
  yAxisWrapper.style.backgroundColor = 'var(--di-chart-bg, #fff)';
  mainWrapper.appendChild(yAxisWrapper);

  const chartWrapper = document.createElement('div');
  chartWrapper.className = 'scroll-wrapper';
  chartWrapper.style.flex = '1';
  chartWrapper.style.overflowX = 'auto';
  chartWrapper.style.overflowY = 'hidden';
  mainWrapper.appendChild(chartWrapper);

  let tickMax = Math.ceil(maxCount / 500) * 500;
  if (tickMax < 500) tickMax = 500;

  let tickStep = 500;
  if (tickMax <= 2000) {
    tickStep = tickMax / 4;
  }

  const numTicks = Math.round(tickMax / tickStep);

  let ySvg = `<svg width="${yAxisWidth}" height="${vHeight}">`;
  for (let i = 0; i <= numTicks; i++) {
    const val = i * tickStep;
    const y =
      vHeight - padBottom - (val / tickMax) * (vHeight - padBottom - padTop);
    ySvg += `<text x="${yAxisWidth - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--di-chart-axis-secondary, #666)">${val}</text>`;
  }
  ySvg += '</svg>';
  yAxisWrapper.innerHTML = ySvg;

  let svg = `<svg width="${vWidth}" height="${vHeight}">`;

  for (let i = 1; i <= numTicks; i++) {
    const val = i * tickStep;
    const y =
      vHeight - padBottom - (val / tickMax) * (vHeight - padBottom - padTop);
    svg += `<line x1="0" y1="${y}" x2="${vWidth}" y2="${y}" stroke="var(--di-chart-grid, #eee)" stroke-width="1" />`;
  }
  svg += `<line x1="0" y1="${vHeight - padBottom}" x2="${vWidth}" y2="${vHeight - padBottom}" stroke="var(--di-border, #e1e4e8)" />`;

  const barAreaWidth = vWidth - padLeftScroll - padRight;
  const step = barAreaWidth / monthly.length;
  const barWidth = step * 0.75;

  monthly.forEach((m: MonthlyStatEntry, idx: number) => {
    const x = padLeftScroll + step * idx + (step - barWidth) / 2;
    const barH = (m.count / tickMax) * (vHeight - padBottom - padTop);
    const y = vHeight - padBottom - barH;

    const colX = padLeftScroll + step * idx;
    const colWidth = step;

    const nextDate = idx < monthly.length - 1 ? monthly[idx + 1].date : null;
    let dateFilter = `date:${m.date}-01`;
    if (nextDate) {
      dateFilter = `date:${m.date}-01...${nextDate}-01`;
    } else {
      const [yy, mm] = m.date.split('-').map(Number);
      const nextMonth = new Date(yy, mm, 1);
      const nextY = nextMonth.getFullYear();
      const nextM = String(nextMonth.getMonth() + 1).padStart(2, '0');
      dateFilter = `date:${m.date}-01...${nextY}-${nextM}-01`;
    }
    const searchUrl = `/posts?tags=user:${encodeURIComponent(context.targetUser.normalizedName)}+${dateFilter}`;

    svg += `
      <g class="month-column" style="cursor: pointer;" onclick="window.open('${searchUrl}', '_blank')">
        <rect class="column-overlay" x="${colX}" y="0" width="${colWidth}" height="${vHeight - padBottom}" fill="transparent" />
        <rect class="monthly-bar" x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="#40c463" rx="2" style="pointer-events: none;" />
        <title>${m.label}: ${m.count} posts</title>
      </g>
    `;

    const [year, month] = m.date.split('-');
    const isJan = month === '01';

    if (isJan || idx === 0) {
      const tx = x + barWidth / 2;
      const ty = vHeight - 5;
      const text = isJan ? year : `${year}-${month}`;

      svg += `<text x="${tx}" y="${ty}" text-anchor="middle" font-size="10" fill="var(--di-chart-axis-secondary, #666)">${text}</text>`;
      svg += `<line x1="${tx}" y1="${vHeight - padBottom}" x2="${tx}" y2="${vHeight - padBottom + 3}" stroke="var(--di-border, #e1e4e8)" />`;
    }
  });

  if (levelChanges && levelChanges.length > 0) {
    const [sY, sM] = monthly[0].date.split('-').map(Number);
    levelChanges.forEach((lc: LevelChangeEvent) => {
      const pY = lc.date.getFullYear();
      const pM = lc.date.getMonth() + 1;
      const pD = lc.date.getDate();
      const monthDiff = (pY - sY) * 12 + (pM - sM);
      const daysInMonth = new Date(pY, pM, 0).getDate();
      const frac = (pD - 1) / daysInMonth;
      const idx = monthDiff + frac;

      if (idx < 0 || idx > monthly.length) return;
      const x = padLeftScroll + step * idx;

      svg += `
        <g class="promotion-marker">
           <line x1="${x}" y1="${padTop}" x2="${x}" y2="${vHeight - padBottom}" stroke="#ff5722" stroke-width="2" stroke-dasharray="4 2"></line>
           <rect x="${x - 4}" y="${padTop}" width="8" height="${vHeight - padBottom - padTop}" fill="transparent">
               <title>${lc.date.toLocaleDateString()}: ${lc.fromLevel} → ${lc.toLevel}</title>
           </rect>
        </g>
     `;
    });
  }

  monthly.forEach((mo: MonthlyStatEntry, idx: number) => {
    const mKey = mo.date;
    const stars = milestones1k.filter((m: MilestoneEntry) => {
      const pDate = new Date(m.post.created_at);
      const k = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}`;
      return k === mKey;
    });

    if (stars.length > 0) {
      const x = padLeftScroll + step * idx + step / 2;

      stars.forEach((m: MilestoneEntry, si: number) => {
        const y = 14 + si * 18;

        let fill = '#ffd700';
        let stroke = '#b8860b';
        const style = 'filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.3));';
        let animClass = '';

        if (m.milestone === 1) {
          fill = '#00e676';
          stroke = '#00a050';
        } else if (m.milestone % 10000 === 0) {
          fill = '#ffb300';
          animClass = 'star-shiny';
        }

        if (isTouch2) {
          svg += `
               <text class="${animClass}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${fill}" stroke="${stroke}" stroke-width="0.5" style="${style}; pointer-events: none;">
                   ★
                   <title>Milestone #${m.milestone} (${new Date(m.post.created_at).toLocaleDateString()})</title>
               </text>
             `;
        } else {
          svg += `
               <a href="/posts/${m.post.id}" target="_blank" style="cursor: pointer; pointer-events: all;" onclick="event.stopPropagation()">
                  <text class="${animClass}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${fill}" stroke="${stroke}" stroke-width="0.5" style="${style}">
                     ★
                     <title>Milestone #${m.milestone} (${new Date(m.post.created_at).toLocaleDateString()})</title>
                  </text>
               </a>
             `;
        }
      });
    }
  });

  svg += '</svg>';

  chartDiv.innerHTML = chartHtml;
  chartWrapper.innerHTML = svg;
  chartDiv.appendChild(mainWrapper);

  container.appendChild(chartDiv);

  setTimeout(() => {
    if (chartWrapper) chartWrapper.scrollLeft = chartWrapper.scrollWidth;
  }, 100);

  requestAnimationFrame(() => {
    chartWrapper.scrollLeft = chartWrapper.scrollWidth;
  });
}

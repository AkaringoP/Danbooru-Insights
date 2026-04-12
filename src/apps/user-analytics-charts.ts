import * as d3 from 'd3';
import {AnalyticsDataManager} from '../core/analytics-data-manager';
import type {
  LevelChangeEvent,
  MonthlyStatEntry,
} from '../core/analytics-data-manager';
import {getBestThumbnailUrl} from '../utils';
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
  type TwoStepTapController,
} from '../ui/two-step-tap';
import type {PieSlice} from './user-analytics-data';

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
 * Renders the pie chart widget with tabs (status, rating, character, copyright, etc.).
 * @param container The element to render into.
 * @param distributions Pre-fetched distribution data keyed by tab name.
 * @param initialNsfwEnabled Whether NSFW content is currently enabled.
 * @param dataManager The AnalyticsDataManager to fetch additional tab data.
 * @param context The chart context providing user information.
 * @param firstUploadDate The user's first upload date (needed for some distributions).
 * @returns Cleanup/update callbacks for NSFW toggle integration.
 */
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

  // Pre-process special distributions (count-based → frequency/value)
  for (const key of ['breasts', 'gender', 'commentary', 'translation']) {
    if (pieData[key]) {
      const data = pieData[key];
      const total = data.reduce(
        (acc: number, c: PieTabItem) => acc + c.count,
        0,
      );
      pieData[key] = data.map((d: PieTabItem) => ({
        ...d,
        frequency: total > 0 ? d.count / total : 0,
        value: total > 0 ? d.count / total : 0,
        label: d.name,
        details: {...d, thumb: null},
      }));
    }
  }

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
        requestRender();
      }
    }
  };
  window.addEventListener('DanbooruInsights:DataUpdated', onPieDataUpdate);

  /**
   * Handles click events on pie chart slices.
   */
  const handlePieClick = (d: d3.PieArcDatum<PieSlice>) => {
    const targetName =
      context.targetUser.normalizedName ||
      context.targetUser.name.replace(/ /g, '_') ||
      '';
    if (!targetName) return;
    let query = '';
    const details = d.data.details;

    if (currentPieTab === 'rating') {
      if (details && details.rating) query = `rating:${details.rating}`;
    } else if (currentPieTab === 'fav_copyright') {
      query = `ordfav:${context.targetUser.normalizedName} ${details.tagName || d.data.label}`;
      window.open(`/posts?tags=${encodeURIComponent(query)}`, '_blank');
      return;
    } else if (currentPieTab === 'status') {
      query = `status:${details.name}`;
    } else if (
      [
        'breasts',
        'hair_length',
        'hair_color',
        'gender',
        'commentary',
        'translation',
      ].includes(currentPieTab)
    ) {
      if (details.originalTag) query = details.originalTag;
      else if (details.tagName === 'untagged_commentary')
        query = 'has:commentary -commentary -commentary_request';
      else if (details.tagName === 'untagged_translation')
        query = '*_text -english_text -translation_request -translated';
      else if (details.tagName) query = details.tagName;
      else query = d.data.label.toLowerCase().replace(/ /g, '_');
    } else {
      query = details.tagName || d.data.label;
    }

    if (query) {
      const urlPrefix = `user:${targetName}`;
      window.open(
        `/posts?tags=${encodeURIComponent(`${urlPrefix} ${query}`)}`,
        '_blank',
      );
    }
  };

  /**
   * Renders the Pie Chart content based on the current tab.
   */
  const renderPieContent = () => {
    const isTouch = isTouchDevice();
    const contextUser = context.targetUser;
    const data = pieData[currentPieTab];
    const pieContent = container.querySelector('.pie-content') as HTMLElement;

    if (!data) {
      pieContent.innerHTML =
        '<div style="color:var(--di-text-muted); padding:30px; text-align:center;">Loading...</div>';
      return;
    }

    if (data.length === 0) {
      pieContent.innerHTML =
        '<div style="color:var(--di-text-muted); padding:30px; text-align:center;">No data available</div>';
      return;
    }

    if (!contextUser.normalizedName && contextUser.name) {
      contextUser.normalizedName = contextUser.name.replace(/ /g, '_');
    }

    // Sort: Hair Length has a specific order (custom sort)
    if (currentPieTab === 'hair_length') {
      const order = [
        'Bald',
        'Very Short Hair',
        'Short Hair',
        'Medium Hair',
        'Long Hair',
        'Very Long Hair',
        'Absurdly Long Hair',
      ];
      data.sort(
        (a: PieTabItem, b: PieTabItem) =>
          order.indexOf(a.name ?? '') - order.indexOf(b.name ?? ''),
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

    const ratingColors: Record<string, string> = {
      g: '#28a745',
      s: '#fd7e14',
      q: '#6f42c1',
      e: '#dc3545',
    };
    const ratingLabels: Record<string, string> = {
      g: 'General',
      s: 'Sensitive',
      q: 'Questionable',
      e: 'Explicit',
    };

    const palette = [
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

    const processedData: PieSlice[] = data.map((d: PieTabItem, i: number) => {
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
        {
          // d may be {rating, label} (status/rating tabs) or DistributionItem
          const dFlexible = d as {rating?: string; label?: string};
          return {
            value: d.count,
            label:
              currentPieTab === 'rating'
                ? ratingLabels[dFlexible.rating as keyof typeof ratingLabels] ||
                  dFlexible.rating ||
                  ''
                : dFlexible.label || d.name || '',
            color:
              currentPieTab === 'rating'
                ? ratingColors[dFlexible.rating as keyof typeof ratingColors] ||
                  '#999'
                : currentPieTab === 'hair_color' && d.color
                  ? d.color
                  : d.color ||
                    (d.isOther ? '#bdbdbd' : palette[i % palette.length]),
            details: d,
          };
        }
      } else {
        let sliceColor = d.isOther ? '#bdbdbd' : palette[i % palette.length];
        if (currentPieTab === 'hair_color' && d.color) {
          sliceColor = d.color;
        }
        return {
          value: d.frequency ?? 0,
          label: d.name ?? '',
          color: sliceColor,
          details: d,
        };
      }
    });

    const validData = processedData.filter(
      (d: PieSlice) => Number.isFinite(d.value) && d.value > 0,
    );
    const totalValue = validData.reduce(
      (acc: number, curr: PieSlice) => acc + curr.value,
      0,
    );

    if (validData.length === 0 || totalValue === 0) {
      pieContent.innerHTML =
        '<div style="color:var(--di-text-muted); padding:30px; text-align:center;">No data available (Total count is 0)</div>';
      return;
    }

    // D3 Chart (Join Pattern)
    let chartWrapper = pieContent.querySelector(
      '.pie-chart-wrapper',
    ) as HTMLElement;

    if (!chartWrapper) {
      pieContent.innerHTML = '';

      chartWrapper = document.createElement('div');
      chartWrapper.className = 'pie-chart-wrapper';
      chartWrapper.style.width = '180px';
      chartWrapper.style.height = '180px';
      chartWrapper.style.cursor = 'pointer';

      if (!isFirefox) {
        // 3D tilt effect (Chrome/Safari/Edge only — Firefox breaks SVG pointer events)
        chartWrapper.style.transformStyle = 'preserve-3d';
        chartWrapper.style.transform = 'rotateX(40deg) rotateY(0deg)';
        chartWrapper.style.transition =
          'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';

        const shadow = document.createElement('div');
        shadow.style.position = 'absolute';
        shadow.style.top = '50%';
        shadow.style.left = '50%';
        shadow.style.width = '140px';
        shadow.style.height = '140px';
        shadow.style.transform = 'translate(-50%, -50%) translateZ(-10px)';
        shadow.style.borderRadius = '50%';
        shadow.style.background = 'var(--di-shadow)';
        shadow.style.filter = 'blur(5px)';
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
        .attr('width', 180)
        .attr('height', 180)
        .style('overflow', 'visible')
        .append('g')
        .attr('transform', 'translate(90,90)');

      const legendDiv = document.createElement('div');
      legendDiv.className = 'danbooru-grass-legend-scroll';
      legendDiv.style.display = 'flex';
      legendDiv.style.flexDirection = 'column';
      legendDiv.style.marginLeft = '20px';
      legendDiv.style.maxHeight = '180px';
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
    }

    const width = 180;
    const height = 180;
    const radius = Math.min(width, height) / 2 - 20;

    const svg = d3.select(chartWrapper).select('svg g');
    const pie = d3
      .pie<PieSlice>()
      .value(d => d.value)
      .sort(null);
    const arc = d3
      .arc<d3.PieArcDatum<PieSlice>>()
      .innerRadius(0)
      .outerRadius(radius);
    const arcHover = d3
      .arc<d3.PieArcDatum<PieSlice>>()
      .innerRadius(0)
      .outerRadius(radius * 1.2);

    const tooltip = d3
      .select('body')
      .selectAll('.danbooru-grass-pie-tooltip')
      .data([0])
      .join('div')
      .attr('class', 'danbooru-grass-pie-tooltip')
      .style('position', 'absolute')
      .style('background', 'rgba(30, 30, 30, 0.95)')
      .style('color', '#fff')
      .style('padding', '8px 12px')
      .style('border-radius', '6px')
      .style('font-size', '12px')
      .style('pointer-events', isTouch ? 'auto' : 'none')
      .style('cursor', isTouch ? 'pointer' : 'default')
      .style('z-index', '2147483647')
      .style('opacity', '0');

    svg
      .selectAll('path')
      .data(pie(validData), (d: D3Any) => d.data.label)
      .join(
        enter =>
          enter
            .append('path')
            .attr('class', 'danbooru-grass-pie-path')
            .attr('d', arc)
            .attr('fill', d => d.data.color)
            .style('opacity', '0.9')
            .style('cursor', 'pointer'),
        update =>
          update
            .attr('class', 'danbooru-grass-pie-path')
            .attr('d', arc)
            .call(update =>
              update
                .transition()
                .duration(500)
                .attr('fill', d => d.data.color),
            ),
      )
      .attr('stroke', 'var(--di-chart-bg)')
      .style('stroke-width', '1px')
      .on('mouseover', function (_event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr(
            'd',
            (td: unknown) => arcHover(td as d3.PieArcDatum<PieSlice>) ?? '',
          )
          .style('opacity', '1')
          .style('filter', 'drop-shadow(0px 0px 8px rgba(255,255,255,0.4))');

        let html = '';
        const details = d.data.details;
        const thumbUrl = details.thumb;
        const thumbHtml = thumbUrl
          ? `
        <div style="width: 80px; height: 80px; border-radius: 4px; overflow: hidden; background: #333; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
          <img src="${thumbUrl}" style="width: 100%; height: 100%; object-fit: cover;">
        </div>`
          : '';

        if (currentPieTab === 'rating') {
          html = `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div>
              <div style="font-weight: bold; color: ${d.data.color}; margin-bottom: 4px; font-size: 14px;">${d.data.label}</div>
              <div style="font-size: 11px; color: #ccc;">Count: <strong style="color:#fff;">${details.count.toLocaleString()}</strong></div>
              <div style="font-size: 11px; color: #ccc;">Ratio: <strong style="color:#fff;">${Math.round((d.data.value / totalValue) * 100)}%</strong></div>
            </div>
          </div>
        `;
        } else {
          const percentage =
            ((d.data.value / totalValue) * 100).toFixed(1) + '%';
          html = `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div style="max-width: 180px;">
              <div style="font-weight: bold; color: ${d.data.color}; margin-bottom: 4px; font-size: 14px; word-wrap: break-word;">${d.data.label}</div>
              <div style="font-size: 11px; color: #ccc;">Freq: <strong style="color:#fff;">${percentage}</strong></div>
              ${!details.isOther ? `<div style="font-size: 11px; color: #ccc;">Posts: <strong style="color:#fff;">${details.count ? details.count.toLocaleString() : '?'}</strong></div>` : ''}
            </div>
          </div>
        `;
        }

        tooltip.html(html).style('opacity', 1);
      })
      .on('mousemove', event => {
        tooltip
          .style('left', event.pageX + 15 + 'px')
          .style('top', event.pageY + 15 + 'px');
      })
      .on('mouseout', function () {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('d', (td: unknown) => arc(td as d3.PieArcDatum<PieSlice>) ?? '')
          .style('opacity', '0.9')
          .style('filter', 'none');
        tooltip.style('opacity', 0);
      })
      .on('click', (_event, d) => {
        if (isTouch) return;
        handlePieClick(d);
      });

    if (isTouch) {
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

      // Two-step tap: touch slice → show tooltip, tap tooltip → navigate
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
            tooltip.style('opacity', 0);
          },
          onReset: () => {
            tooltip.style('opacity', 0);
            resetSlices();
          },
        });

      // Helper to handle touch on a slice
      const handleSliceTouch = (event: TouchEvent) => {
        const touch = event.touches[0];
        const target = document.elementFromPoint(
          touch.clientX,
          touch.clientY,
        ) as Element;
        if (!target) return;
        const datum = d3.select(target).datum() as d3.PieArcDatum<PieSlice>;
        if (!datum || !datum.data) return;

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
          .style('opacity', '1')
          .style('filter', 'drop-shadow(0px 0px 8px rgba(255,255,255,0.4))');

        // Show tooltip (same HTML building logic as mouseover)
        let html = '';
        const details = datum.data.details;
        const thumbUrl = details.thumb;
        const thumbHtml = thumbUrl
          ? `
        <div style="width: 80px; height: 80px; border-radius: 4px; overflow: hidden; background: #333; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
          <img src="${thumbUrl}" style="width: 100%; height: 100%; object-fit: cover;">
        </div>`
          : '';

        if (currentPieTab === 'rating') {
          html = `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div>
              <div style="font-weight: bold; color: ${datum.data.color}; margin-bottom: 4px; font-size: 14px;">${datum.data.label}</div>
              <div style="font-size: 11px; color: #ccc;">Count: <strong style="color:#fff;">${details.count.toLocaleString()}</strong></div>
              <div style="font-size: 11px; color: #ccc;">Ratio: <strong style="color:#fff;">${Math.round((datum.data.value / totalValue) * 100)}%</strong></div>
            </div>
          </div>`;
        } else {
          const percentage =
            ((datum.data.value / totalValue) * 100).toFixed(1) + '%';
          html = `
          <div style="display: flex; gap: 12px; align-items: start;">
            ${thumbHtml}
            <div style="max-width: 180px;">
              <div style="font-weight: bold; color: ${datum.data.color}; margin-bottom: 4px; font-size: 14px; word-wrap: break-word;">${datum.data.label}</div>
              <div style="font-size: 11px; color: #ccc;">Freq: <strong style="color:#fff;">${percentage}</strong></div>
              ${!details.isOther ? `<div style="font-size: 11px; color: #ccc;">Posts: <strong style="color:#fff;">${details.count ? details.count.toLocaleString() : '?'}</strong></div>` : ''}
            </div>
          </div>`;
        }

        tooltip.html(html).style('opacity', 1);

        // Clamp tooltip within viewport
        const tooltipNode = tooltip.node() as HTMLElement | null;
        const tw = tooltipNode?.offsetWidth ?? 0;
        const th = tooltipNode?.offsetHeight ?? 0;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 8;
        let left = touch.pageX + 15;
        let top = touch.pageY + 15;
        if (left + tw > window.scrollX + vw - margin) {
          left = touch.pageX - tw - 15;
        }
        if (left < window.scrollX + margin) {
          left = window.scrollX + margin;
        }
        if (top + th > window.scrollY + vh - margin) {
          top = touch.pageY - th - 15;
        }
        if (top < window.scrollY + margin) {
          top = window.scrollY + margin;
        }
        tooltip.style('left', left + 'px').style('top', top + 'px');
      };

      svg
        .selectAll('path.danbooru-grass-pie-path')
        .on('touchstart', event => {
          handleSliceTouch(event as TouchEvent);
        })
        .on('touchmove', event => {
          handleSliceTouch(event as TouchEvent);
        });

      // Tooltip tap → navigate via controller
      tooltip.on('click', () => {
        pieTap.navigateActive();
      });
    }

    const legendDiv = pieContent.querySelector('.danbooru-grass-legend-scroll');
    if (legendDiv) {
      let legendTitle = 'DIST.';
      if (currentPieTab === 'copyright') legendTitle = 'COPYRIGHTS';
      else if (currentPieTab === 'character') legendTitle = 'CHARACTERS';
      else if (currentPieTab === 'fav_copyright')
        legendTitle = 'FAVORITE COPYRIGHTS';
      else if (currentPieTab === 'status') legendTitle = 'STATUS';
      else if (currentPieTab === 'rating') legendTitle = 'RATINGS';
      else if (currentPieTab === 'hair_length') legendTitle = 'HAIR LENGTH';
      else if (currentPieTab === 'hair_color') legendTitle = 'HAIR COLOR';
      else if (currentPieTab === 'breasts') legendTitle = 'BREASTS';
      else if (currentPieTab === 'gender') legendTitle = 'GENDER';
      else if (currentPieTab === 'commentary') legendTitle = 'COMMENTARY';
      else if (currentPieTab === 'translation') legendTitle = 'TRANSLATION';

      const styleTag = legendDiv.querySelector('style')?.outerHTML ?? '';

      const listHtml = processedData
        .map(d => {
          const val = (d.value / totalValue) * 100;
          const pct = val.toFixed(1) + '%';
          let targetUrl = '#';
          let query = '';

          if (!d.details.isOther) {
            if (currentPieTab === 'rating') {
              query = `rating:${d.details.rating}`;
              targetUrl = `/posts?tags=${encodeURIComponent(`user:${contextUser.normalizedName} ${query}`)}`;
            } else if (currentPieTab === 'breasts') {
              const tag = d.label.toLowerCase().replace(/ /g, '_');
              targetUrl = `/posts?tags=${encodeURIComponent(`user:${contextUser.normalizedName} ${tag}`)}`;
            } else if (currentPieTab === 'fav_copyright') {
              query = `ordfav:${contextUser.normalizedName} ${d.details.tagName || d.label}`;
              targetUrl = `/posts?tags=${encodeURIComponent(query)}`;
            } else if (currentPieTab === 'status') {
              query = `status:${d.details.name}`;
              targetUrl = `/posts?tags=${encodeURIComponent(`user:${contextUser.normalizedName} ${query}`)}`;
            } else {
              // Mirror handlePieClick's logic so the legend link matches the pie-slice click target.
              // Critical for categories where the count query is multi-tag (gender, untagged_commentary,
              // untagged_translation): originalTag preserves the OR/exclusion query so navigation
              // points to the same post set the count represents.
              if (d.details.originalTag) {
                query = d.details.originalTag;
              } else if (d.details.tagName === 'untagged_commentary') {
                query = 'has:commentary -commentary -commentary_request';
              } else if (d.details.tagName === 'untagged_translation') {
                query = '*_text -english_text -translation_request -translated';
              } else {
                query = d.details.tagName || d.label;
              }
              targetUrl = `/posts?tags=${encodeURIComponent(`user:${contextUser.normalizedName} ${query}`)}`;
            }
          }

          return `
               <div style="display:flex; align-items:center; font-size:0.85em; margin-bottom:5px;">
                  <div style="width:12px; height:12px; background:${d.color}; border-radius:2px; margin-right:8px; border:1px solid var(--di-shadow-light); flex-shrink:0;"></div>
                  ${
                    d.details.isOther
                      ? `<div style="color:var(--di-text-secondary); width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${d.label}">${d.label}</div>`
                      : `<a href="${targetUrl}" target="_blank" class="di-hover-underline" style="color:var(--di-text-secondary); width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:none;" title="${d.label}">${d.label}</a>`
                  }
                  <div style="font-weight:bold; color:var(--di-text); margin-left:auto;" title="${d.details.count ? d.details.count.toLocaleString() : ''}">${pct}</div>
               </div>`;
        })
        .join('');

      legendDiv.innerHTML =
        styleTag +
        `
           <div style="font-size:0.8em; color:var(--di-text-muted); margin-bottom:8px; text-transform:uppercase; position:sticky; top:0; background:var(--di-chart-bg); padding-bottom:4px; border-bottom:1px solid var(--di-border-light);">${legendTitle}</div>
           ${listHtml}
      `;
    }
  };

  const updatePieTabs = () => {
    const btns = container.querySelectorAll('.di-pie-tab');
    btns.forEach(btn => {
      const el = btn as HTMLElement;
      const mode = el.getAttribute('data-mode');
      if (mode === currentPieTab) {
        el.style.background = 'var(--di-text-secondary)';
        el.style.color = 'var(--di-bg)';
        el.style.boxShadow = '0 1px 3px var(--di-shadow-light)';
      } else {
        el.style.background = 'var(--di-bg-tertiary)';
        el.style.color = 'var(--di-text-secondary)';
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
        '<div style="color:var(--di-chart-axis-secondary);">Loading...</div>';

    try {
      let data: PieTabItem[] = [];
      const user = context.targetUser;
      if (tabName === 'rating') {
        data = await dataManager.getRatingDistribution(user, firstUploadDate);
      } else if (tabName === 'status') {
        data = await dataManager.getStatusDistribution(user, firstUploadDate);
        const statusColors: Record<string, string> = {
          active: '#2da44e',
          deleted: '#d73a49',
          pending: '#0969da',
          flagged: '#cf222e',
          banned: '#6e7781',
          appealed: '#bf3989',
        };
        data = data.map((d: PieTabItem) => ({
          ...d,
          color: statusColors[d.name as keyof typeof statusColors] || '#888',
        }));
      } else if (tabName === 'character') {
        data = await dataManager.getCharacterDistribution(user);
      } else if (tabName === 'copyright') {
        data = await dataManager.getCopyrightDistribution(user);
      } else if (tabName === 'fav_copyright') {
        data = await dataManager.getFavCopyrightDistribution(user);
      } else if (tabName === 'breasts') {
        data = await dataManager.getBreastsDistribution(user);
        const total = data.reduce(
          (acc: number, c: PieTabItem) => acc + c.count,
          0,
        );
        data = data.map((d: PieTabItem) => ({
          ...d,
          frequency: total > 0 ? d.count / total : 0,
          value: total > 0 ? d.count / total : 0,
          label: d.name,
          details: {...d, thumb: null},
        }));
      } else if (tabName === 'gender') {
        data = await dataManager.getGenderDistribution(user);
        const total = data.reduce(
          (acc: number, c: PieTabItem) => acc + c.count,
          0,
        );
        data = data.map((d: PieTabItem) => ({
          ...d,
          frequency: total > 0 ? d.count / total : 0,
          value: total > 0 ? d.count / total : 0,
          label: d.name,
          details: {...d, thumb: null},
        }));
      } else if (tabName === 'commentary') {
        data = await dataManager.getCommentaryDistribution(user);
        const total = data.reduce(
          (acc: number, c: PieTabItem) => acc + c.count,
          0,
        );
        data = data.map((d: PieTabItem) => ({
          ...d,
          frequency: total > 0 ? d.count / total : 0,
          value: total > 0 ? d.count / total : 0,
          label: d.name,
          details: {...d, thumb: null},
        }));
      } else if (tabName === 'translation') {
        data = await dataManager.getTranslationDistribution(user);
        const total = data.reduce(
          (acc: number, c: PieTabItem) => acc + c.count,
          0,
        );
        data = data.map((d: PieTabItem) => ({
          ...d,
          frequency: total > 0 ? d.count / total : 0,
          value: total > 0 ? d.count / total : 0,
          label: d.name,
          details: {...d, thumb: null},
        }));
      }

      pieData[tabName] = data;

      if (currentPieTab === tabName) {
        renderPieContent();
        updatePieTabs();
      }
    } catch (e) {
      console.error(e);
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
        void loadTab(mode);
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
export function renderTopPostsWidget(
  container: HTMLElement,
  topPosts: TopPostsByRating | null,
  recentPopularPosts: TopPostsBySfw | null,
  randomPosts: TopPostsBySfw | null,
  initialNsfwEnabled: boolean,
  db: Database,
  context: ChartContext,
): {onNsfwChange: (enabled: boolean) => void} {
  let isNsfwEnabled = initialNsfwEnabled;

  const topPostGroups: Record<string, TopPostsByRating | TopPostsBySfw | null> =
    {
      most: topPosts,
      recent: recentPopularPosts,
      random: randomPosts,
    };

  let currentWidgetMode = 'recent';
  let currentMostTab = 'g';
  let currentSfwTab = 'sfw';

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
        '<div style="color:var(--di-text-muted); padding:20px 0;">No posts found or loading...</div>';
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
          <a class="di-top-post-thumb" href="${link}" target="_blank" style="display:block; width:150px; height:150px; flex-shrink:0; background:var(--di-bg-tertiary); border-radius:4px; overflow:hidden; position:relative;">
              <img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;" alt="#${data.id}">
          </a>
          <div style="flex:1;">
              <div style="font-weight:bold; font-size:1.1em; color:var(--di-link); margin-bottom:4px;">
                  <a href="${link}" target="_blank" style="text-decoration:none; color:inherit;">Post #${data.id}</a>
              </div>
              <div style="font-size:0.9em; color:var(--di-text-secondary); line-height:1.5;">
                  📅 ${dateStr}<br>
                  ❤️ Score: <strong>${data.score}</strong><br>
                  ⭐ Favs: <strong>${data.fav_count || '?'}</strong><br>
                  🤔 Rating: <strong>${ratingLabel}</strong>

                  <div style="margin-top:8px; border-top:1px solid var(--di-border-light); padding-top:6px;">
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
        ? 'var(--di-link)'
        : 'var(--di-bg-tertiary)';
      btn.style.color = isActive ? 'var(--di-bg)' : 'var(--di-text)';
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
        <div style="font-size:0.85em; color:var(--di-chart-axis-secondary); letter-spacing:0.5px; display:flex; align-items:center; gap:5px;">
           <select id="analytics-top-post-select" style="border:none; background:transparent; font-weight:bold; color:var(--di-chart-axis-secondary); cursor:pointer; text-transform:uppercase; font-size:1em; outline:none;">
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
        <div id="top-post-tabs-sfwnsfw" style="display:flex; gap:0px; border:1px solid var(--di-border-input); border-radius:6px; overflow:hidden;">
           <button class="top-post-tab" data-mode="sfw" style="border:none; background:var(--di-link); color:var(--di-bg); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">SFW</button>
           <button class="top-post-tab" id="analytics-top-nsfw-btn" data-mode="nsfw" style="border:none; border-left:1px solid var(--di-border-input); background:var(--di-bg-tertiary); color:var(--di-text); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s; display: ${isNsfwEnabled ? 'inline-block' : 'none'};">NSFW</button>
        </div>
        <div id="top-post-tabs-gsqe" style="display:none; gap:0px; border:1px solid var(--di-border-input); border-radius:6px; overflow:hidden;">
           <button class="top-post-tab" data-mode="g" style="border:none; background:var(--di-bg-tertiary); color:var(--di-text); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">G</button>
           <button class="top-post-tab" data-mode="s" style="border:none; border-left:1px solid var(--di-border-input); background:var(--di-bg-tertiary); color:var(--di-text); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">S</button>
           <button class="top-post-tab" id="analytics-top-q-btn" data-mode="q" style="border:none; border-left:1px solid var(--di-border-input); background:var(--di-bg-tertiary); color:var(--di-text); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s; display: ${isNsfwEnabled ? 'inline-block' : 'none'};">Q</button>
           <button class="top-post-tab" id="analytics-top-e-btn" data-mode="e" style="border:none; border-left:1px solid var(--di-border-input); background:var(--di-bg-tertiary); color:var(--di-text); padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s; display: ${isNsfwEnabled ? 'inline-block' : 'none'};">E</button>
        </div>
     </div>
     <div class="top-post-content">
         <div style="color:var(--di-chart-axis-secondary); font-size:0.9em;">Loading stats...</div>
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
        console.error('Failed to refresh random post:', err);
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
      '<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--di-border-light); padding-bottom:8px; margin-bottom:10px;">';
    msHtml += '<h3 style="color:var(--di-text); margin:0;">🏆 Milestones</h3>';
    msHtml += '<div style="display:flex; align-items:center; gap:10px;">';

    msHtml += `<select id="analytics-milestone-step" style="border:1px solid var(--di-border-input); border-radius:4px; padding:2px 4px; font-size:0.85em; color:var(--di-text-secondary); background-color:var(--di-bg-tertiary);">
      <option value="auto" ${currentMilestoneStep === 'auto' ? 'selected' : ''}>Auto</option>
      <option value="1000" ${currentMilestoneStep === 1000 || String(currentMilestoneStep) === '1000' ? 'selected' : ''}>Every 1k</option>
      <option value="2500" ${currentMilestoneStep === 2500 || String(currentMilestoneStep) === '2500' ? 'selected' : ''}>Every 2.5k</option>
      <option value="5000" ${currentMilestoneStep === 5000 || String(currentMilestoneStep) === '5000' ? 'selected' : ''}>Every 5k</option>
      <option value="10000" ${currentMilestoneStep === 10000 || String(currentMilestoneStep) === '10000' ? 'selected' : ''}>Every 10k</option>
      <option value="repdigit" ${currentMilestoneStep === 'repdigit' ? 'selected' : ''}>Repdigit</option>
    </select>`;

    msHtml +=
      '<button id="analytics-milestone-toggle" style="background:none; border:none; color:var(--di-link); cursor:pointer; font-size:0.9em; display:none;">Show More</button>';
    msHtml += '</div>';
    msHtml += '</div>';

    if (milestones.length === 0) {
      container.innerHTML =
        msHtml +
        '<div style="color:var(--di-text-muted); font-size:0.9em;">No milestones found.</div>';
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
    msHtml += `<div id="${containerId}" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap:10px; max-height:110px; overflow:hidden; transition: max-height 0.3s ease;">`;

    milestones.forEach((m: MilestoneEntry) => {
      const p = m.post;
      const isSafe = p.rating === 's' || p.rating === 'g';
      const thumbUrl = getBestThumbnailUrl(p);
      const showThumb = isNsfwEnabled || isSafe;

      msHtml += `
      <a href="/posts/${p.id}" target="_blank" class="di-hover-scale" style="
         display:flex; justify-content:space-between; align-items:center; text-decoration:none; color:inherit;
         background:var(--di-chart-bg); border:1px solid var(--di-border-light); border-radius:6px; padding:10px;
      ">
         <div>
             <div style="font-size:0.8em; color:var(--di-text-muted); letter-spacing:0.5px;">#${p.id}</div>
             <div style="font-size:1.1em; font-weight:bold; color:var(--di-link); margin-top:4px;">${m.type}</div>
             <div style="font-size:0.8em; color:var(--di-text-secondary); margin-top:2px;">${new Date(p.created_at).toLocaleDateString()}</div>
             <div style="font-size:0.75em; color:var(--di-text-faint); margin-top:4px;">Score: ${p.score}</div>
         </div>
         ${showThumb && thumbUrl ? `<div style="width:60px; height:60px; margin-left:10px; flex-shrink:0; background:var(--di-bg-tertiary); border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center;"><img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;"></div>` : ''}
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
         background:var(--di-bg-tertiary); border:1px dashed var(--di-border-input); border-radius:6px; padding:10px;
         color:var(--di-text-secondary);
      ">
         <div>
             <div style="font-size:0.7em; color:var(--di-text-muted); letter-spacing:0.5px; text-transform:uppercase;">Next</div>
             <div style="font-size:1.1em; font-weight:bold; color:var(--di-text-secondary); margin-top:4px;">${nextLabel}</div>
             <div style="font-size:0.8em; color:var(--di-chart-axis-secondary); margin-top:6px;">${remaining.toLocaleString()} remaining</div>
         </div>
         <div style="margin-top:8px;">
             <div style="height:6px; background:var(--di-border-light); border-radius:3px; overflow:hidden;">
                 <div style="width:${progressPct.toFixed(1)}%; height:100%; background:var(--di-link);"></div>
             </div>
             <div style="font-size:0.7em; color:var(--di-text-muted); margin-top:3px; text-align:right;">${progressPct.toFixed(0)}%</div>
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
        milestoneContainer.style.maxHeight = '2000px';
        btn.textContent = 'Show Less';
      }

      btn.onclick = () => {
        isMilestoneExpanded = !isMilestoneExpanded;
        if (isMilestoneExpanded) {
          milestoneContainer.style.maxHeight = '2000px';
          btn.textContent = 'Show Less';
        } else {
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
    '<h3 style="color:var(--di-chart-axis); border-bottom:1px solid var(--di-border-light); padding-bottom:10px; margin-bottom:15px;">📅 Monthly Activity</h3>';

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
  mainWrapper.style.border = '1px solid var(--di-border-light)';
  mainWrapper.style.borderRadius = '8px';
  mainWrapper.style.backgroundColor = 'var(--di-chart-bg)';
  mainWrapper.style.overflow = 'hidden';

  const yAxisWrapper = document.createElement('div');
  yAxisWrapper.style.width = `${yAxisWidth}px`;
  yAxisWrapper.style.flexShrink = '0';
  yAxisWrapper.style.borderRight = '1px solid var(--di-bg-tertiary)';
  yAxisWrapper.style.zIndex = '5';
  yAxisWrapper.style.backgroundColor = 'var(--di-chart-bg)';
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
    ySvg += `<text x="${yAxisWidth - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--di-chart-axis-secondary)">${val}</text>`;
  }
  ySvg += '</svg>';
  yAxisWrapper.innerHTML = ySvg;

  let svg = `<svg width="${vWidth}" height="${vHeight}">`;

  for (let i = 1; i <= numTicks; i++) {
    const val = i * tickStep;
    const y =
      vHeight - padBottom - (val / tickMax) * (vHeight - padBottom - padTop);
    svg += `<line x1="0" y1="${y}" x2="${vWidth}" y2="${y}" stroke="var(--di-chart-grid)" stroke-width="1" />`;
  }
  svg += `<line x1="0" y1="${vHeight - padBottom}" x2="${vWidth}" y2="${vHeight - padBottom}" stroke="var(--di-border)" />`;

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

      svg += `<text x="${tx}" y="${ty}" text-anchor="middle" font-size="10" fill="var(--di-chart-axis-secondary)">${text}</text>`;
      svg += `<line x1="${tx}" y1="${vHeight - padBottom}" x2="${tx}" y2="${vHeight - padBottom + 3}" stroke="var(--di-border)" />`;
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

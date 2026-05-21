/**
 * Unit tests for buildSubChartSlices (v9.7) — the pure helper that
 * converts a parent DistributionItem (with attached subTags) into the
 * PieSlice[] used by the sub-chart mode of the Copy/Fav_Copy/Char pie.
 *
 * Covers:
 *  - empty / missing subTags → []
 *  - Others slice computed from parentCount − Σ sub.count when positive
 *  - Others omitted when parentCount ≤ Σ sub.count (no negative slice)
 *  - subTags' own isOther bucket filtered out (the 95% cumulative bucket
 *    from applySubTagBreakdown — a different definition of "Others" than
 *    the post-coverage one this helper computes)
 *  - PieSlice details carry tagName/count/isOther for downstream click
 *    handlers + T-51 row highlight lookup
 */
import {describe, it, expect} from 'vitest';
import {
  buildSubChartSlices,
  subSlicesToTooltipItems,
} from '../src/apps/user-analytics-charts';
import type {DistributionItem} from '../src/types';

function parentWith(
  count: number,
  subs: Array<{tagName: string; count: number; isOther?: boolean}>,
): DistributionItem {
  return {
    name: 'fate (series)',
    tagName: 'fate_(series)',
    count,
    frequency: 0.169,
    thumb: null,
    isOther: false,
    subTags: subs.map(s => ({
      tagName: s.tagName,
      count: s.count,
      share: 0,
      isOther: s.isOther ?? false,
    })),
  };
}

describe('buildSubChartSlices', () => {
  it('returns [] when subTags is missing AND no parentColor', () => {
    const parent: DistributionItem = {
      name: 'x',
      tagName: 'x',
      count: 100,
      frequency: 0.1,
      thumb: null,
      isOther: false,
    };
    expect(buildSubChartSlices(parent)).toEqual([]);
  });

  it('returns [] when subTags is empty AND no parentColor', () => {
    expect(buildSubChartSlices(parentWith(100, []))).toEqual([]);
  });

  it('returns [] when only applySubTagBreakdown Others remains AND no parentColor', () => {
    // The 95%-cumulative Others from applySubTagBreakdown is filtered
    // out, so a subTags array containing only that bucket reduces to no
    // displayable subs.
    const parent = parentWith(100, [
      {tagName: 'Others', count: 100, isOther: true},
    ]);
    expect(buildSubChartSlices(parent)).toEqual([]);
  });

  it('returns a single parent slice when subTags is empty AND parentColor given (v9.7+)', () => {
    // Empty-sub case: lets the chart still drill into the parent on
    // hover (single slice = parent itself). UX: any legend row hover
    // updates the chart, not just rows with implied sub-tags.
    const parent: DistributionItem = {
      name: 'gundam',
      tagName: 'gundam',
      count: 250,
      frequency: 0.11,
      thumb: null,
      isOther: false,
    };
    const slices = buildSubChartSlices(parent, '#e91e63');
    expect(slices).toHaveLength(1);
    expect(slices[0].value).toBe(250);
    expect(slices[0].label).toBe('gundam');
    expect(slices[0].color).toBe('#e91e63');
    expect((slices[0].details as {tagName?: string}).tagName).toBe('gundam');
    expect((slices[0].details as {isOther?: boolean}).isOther).toBe(false);
  });

  it('uses count=1 minimum so d3 still draws a slice even if parent.count is 0', () => {
    const parent: DistributionItem = {
      name: 'x',
      tagName: 'x',
      count: 0,
      frequency: 0,
      thumb: null,
      isOther: false,
    };
    const slices = buildSubChartSlices(parent, '#abcdef');
    expect(slices).toHaveLength(1);
    expect(slices[0].value).toBe(1); // Math.max(1, 0)
  });

  it('appends a post-coverage Others when parent.count > sub sum', () => {
    const parent = parentWith(1232, [
      {tagName: 'fate/grand_order', count: 1157},
      {tagName: 'fate/stay_night', count: 26},
    ]);
    const slices = buildSubChartSlices(parent);
    expect(slices).toHaveLength(3);
    expect(slices[0].label).toBe('fate/grand order');
    expect(slices[0].value).toBe(1157);
    expect(slices[1].label).toBe('fate/stay night');
    expect(slices[1].value).toBe(26);
    expect(slices[2].label).toBe('Others');
    expect(slices[2].value).toBe(1232 - 1157 - 26);
    expect(slices[2].details.kind).toBe('tag');
    expect((slices[2].details as {isOther?: boolean}).isOther).toBe(true);
  });

  it('omits Others when parent.count ≤ sub sum', () => {
    const parent = parentWith(50, [{tagName: 'a', count: 60}]);
    const slices = buildSubChartSlices(parent);
    expect(slices).toHaveLength(1);
    expect(slices[0].label).toBe('a');
  });

  it('merges applySubTagBreakdown Others with post-coverage Others (v9.7+)', () => {
    // subTags carries the 95% cumulative bucket (5) PLUS the parent has
    // headroom (100 − 50 − 40 − 5 = 5) for posts that don't hit any
    // displayed sub. Both contribute to the single Others slice the
    // tooltip / chart shows.
    const parent = parentWith(100, [
      {tagName: 'a', count: 50},
      {tagName: 'b', count: 40},
      {tagName: 'Others', count: 5, isOther: true},
    ]);
    const slices = buildSubChartSlices(parent);
    expect(slices).toHaveLength(3);
    expect(slices.map(s => s.label)).toEqual(['a', 'b', 'Others']);
    // applyOthers(5) + postCoverage(5) = 10
    expect(slices[2].value).toBe(10);
    expect((slices[2].details as {isOther?: boolean}).isOther).toBe(true);
  });

  it('keeps applySubTagBreakdown Others even when parent < sub sum (gundam-style)', () => {
    // gundam case: parent count is *less* than the sub sum (overlap
    // inflates sub totals). Post-coverage Others = 0, but the
    // applySubTagBreakdown bucket still surfaces in the chart so the
    // user sees the trailing Others row they expect.
    const parent = parentWith(765, [
      {tagName: 'a', count: 500},
      {tagName: 'b', count: 300},
      {tagName: 'Others', count: 30, isOther: true},
    ]);
    const slices = buildSubChartSlices(parent);
    expect(slices).toHaveLength(3);
    expect(slices[2].label).toBe('Others');
    expect(slices[2].value).toBe(30); // applyOthers only, no post-coverage
  });

  it('preserves tagName on details for navigation / row highlight lookup', () => {
    const parent = parentWith(100, [{tagName: 'fate/grand_order', count: 80}]);
    const slices = buildSubChartSlices(parent);
    const details = slices[0].details as {tagName?: string; isOther?: boolean};
    expect(details.tagName).toBe('fate/grand_order');
    expect(details.isOther).toBe(false);
  });

  it('handles undefined parent.count by treating it as 0 (no Others)', () => {
    const parent: DistributionItem = {
      name: 'x',
      tagName: 'x',
      count: 0,
      frequency: 0,
      thumb: null,
      isOther: false,
      subTags: [{tagName: 'a', count: 10, share: 1, isOther: false}],
    };
    const slices = buildSubChartSlices(parent);
    expect(slices).toHaveLength(1); // no Others (would be negative)
    expect(slices[0].label).toBe('a');
  });
});

describe('subSlicesToTooltipItems', () => {
  it('shares against parent.count, not sub sum (ninjago-style case)', () => {
    // ninjago: parent=212, only sub `dragons rising`=30. Without
    // post-coverage Others the tooltip would read "100%" — misleading.
    const parent = parentWith(212, [
      {tagName: 'ninjago:_dragons_rising', count: 30},
    ]);
    const slices = buildSubChartSlices(parent);
    const items = subSlicesToTooltipItems(
      slices,
      parent.count,
      'user:sabisabi',
    );
    expect(items).toHaveLength(2);
    expect(items[0].tagName).toBe('ninjago:_dragons_rising');
    expect(items[0].count).toBe(30);
    expect(items[0].share).toBeCloseTo(30 / 212, 4);
    expect(items[1].tagName).toBe('Others');
    expect(items[1].count).toBe(182);
    expect(items[1].share).toBeCloseTo(182 / 212, 4);
    // Shares sum to 1.0 (within float epsilon)
    expect(items[0].share + items[1].share).toBeCloseTo(1.0, 6);
  });

  it('renders Others as a non-clickable row (empty href)', () => {
    // Others bundles both post-coverage Others (parent only) AND the
    // applySubTagBreakdown long tail (sub-tags trimmed by the 95%
    // cumulative threshold). A `chartags:1` / `copytags:1` link would
    // miss the long-tail posts (those have ≥2 char/copy tags), so the
    // row stays non-clickable rather than ship a partial-coverage link.
    const parent = parentWith(100, [{tagName: 'a', count: 60}]);
    const items = subSlicesToTooltipItems(
      buildSubChartSlices(parent),
      parent.count,
      'user:alice',
    );
    expect(items[1].isOther).toBe(true);
    expect(items[1].href).toBe('');
  });

  it('builds /posts links with the supplied prefix', () => {
    const parent = parentWith(100, [{tagName: 'fate/grand_order', count: 60}]);
    const items = subSlicesToTooltipItems(
      buildSubChartSlices(parent),
      parent.count,
      'user:alice',
    );
    expect(items[0].href).toBe(
      `/posts?tags=${encodeURIComponent('user:alice fate/grand_order')}`,
    );
  });

  it('converts underscores to spaces in displayName (except Others)', () => {
    const parent = parentWith(100, [{tagName: 'hatsuboshi_gakuen', count: 60}]);
    const items = subSlicesToTooltipItems(
      buildSubChartSlices(parent),
      parent.count,
      'user:x',
    );
    expect(items[0].displayName).toBe('hatsuboshi gakuen');
    expect(items[1].displayName).toBe('Others');
  });

  it('falls back to sub-sum base when parentCount is 0', () => {
    // Defensive fallback — buildSubChartSlices returns [] for this case
    // anyway, so we synthesize a slices array directly.
    const items = subSlicesToTooltipItems(
      [
        {
          value: 60,
          label: 'a',
          color: '#ff0000',
          details: {kind: 'tag', tagName: 'a', count: 60, isOther: false},
        },
      ],
      0,
      'user:x',
    );
    expect(items[0].share).toBe(1.0); // 60 / 60 (sub sum)
  });
});

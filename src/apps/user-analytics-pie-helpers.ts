/**
 * Pure helpers used by the UserAnalytics pie-chart widget.
 *
 * These live in their own module so the vitest (node) environment can
 * import and test them without dragging in d3 or DOM-dependent code.
 */

import type {PieDetails} from './user-analytics-data';

/**
 * Builds the Danbooru `?tags=` query string for a pie slice click /
 * legend-link target. Single source of truth — both `handlePieClick`
 * and the legend builder call this so their URLs stay in sync (the
 * "Mirror handlePieClick's logic" duplication was a long-standing
 * footgun where one branch could drift from the other).
 *
 * Returns `null` when the slice can't produce a usable query — e.g.
 * missing `targetName`, missing `details.rating`, or an empty tag.
 *
 * Note on label fallback: when a tag slice has no `tagName` we
 * normalize the display label (`"Long Hair"` → `"long_hair"`) before
 * using it. The historical legend builder used the raw label, which
 * would 404 on multi-word labels — consolidating here makes the
 * legend match the click handler's (correct) behavior.
 */
export function buildSearchQuery(
  details: PieDetails,
  fallbackLabel: string,
  targetName: string,
  tab: string,
): string | null {
  if (!targetName) return null;
  switch (details.kind) {
    case 'rating':
      if (!details.rating) return null;
      return `user:${targetName} rating:${details.rating}`;
    case 'status':
      if (!details.name) return null;
      return `user:${targetName} status:${details.name}`;
    case 'tag': {
      if (tab === 'fav_copyright') {
        const tag = details.tagName || fallbackLabel;
        if (!tag) return null;
        return `ordfav:${targetName} ${tag}`;
      }
      let tag: string;
      if (details.originalTag) tag = details.originalTag;
      else if (details.tagName === 'untagged_commentary')
        tag = 'has:commentary -commentary -commentary_request';
      else if (details.tagName === 'untagged_translation')
        tag = '*_text -english_text -translation_request -translated';
      else if (details.tagName) tag = details.tagName;
      else tag = fallbackLabel.toLowerCase().replace(/ /g, '_');
      if (!tag) return null;
      return `user:${targetName} ${tag}`;
    }
  }
}

/**
 * Largest Remainder Method — formats a list of numbers as percentage
 * strings whose numeric values sum to exactly 100 (within `decimals`
 * precision). Each entry is independently rounded down to `decimals`
 * places and the leftover is distributed to the entries with the
 * largest fractional parts.
 *
 * Solves the "33% + 33% + 33% = 99%" / "16.67%×6 = 102%" displays.
 */
export function computePercentages(values: number[], decimals = 1): string[] {
  const n = values.length;
  if (n === 0) return [];

  const total = values.reduce(
    (acc, v) => acc + (Number.isFinite(v) ? v : 0),
    0,
  );
  if (total <= 0) return values.map(() => (0).toFixed(decimals) + '%');

  const factor = 10 ** decimals;
  const target = 100 * factor;

  const scaled = values.map(v => {
    if (!Number.isFinite(v) || v < 0) return 0;
    return (v / total) * target;
  });
  const floored = scaled.map(s => Math.floor(s));
  const sum = floored.reduce((a, b) => a + b, 0);
  let remainder = target - sum;

  const order = scaled
    .map((s, i) => ({i, frac: s - Math.floor(s)}))
    .sort((a, b) => b.frac - a.frac);

  for (let k = 0; k < order.length && remainder > 0; k++) {
    floored[order[k].i] += 1;
    remainder--;
  }

  return floored.map(v => (v / factor).toFixed(decimals) + '%');
}

/**
 * Whitelists hex colors (`#rgb`, `#rrggbb`, `#rrggbbaa`). Anything else
 * — including CSS keywords, `var(...)` references, or attacker-controlled
 * strings like `red; background-image:url(javascript:...)` — is replaced
 * with `#999`. Used wherever a slice color flows from data into a `style`
 * attribute (legend swatch, tooltip header), since `hair_color` carries
 * backend-derived colors.
 */
export function safeColor(c: unknown): string {
  const s = String(c ?? '');
  return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : '#999';
}

/**
 * Returns the input only if it's an `https://` URL on a `donmai.us`
 * subdomain (Danbooru's CDN). Anything else returns `null`, in which
 * case the caller should omit the thumbnail entirely. Prevents
 * `<img src="..." onerror="...">`-style escapes when a malicious or
 * malformed thumb URL slips into PieSlice.details.thumb via the async
 * `DanbooruInsights:DataUpdated` merge.
 */
export function safeThumbUrl(u: unknown): string | null {
  const s = String(u ?? '');
  // Reject any whitespace / quote / angle-bracket characters anywhere — they
  // have no place in a real CDN URL and would let an attacker break out of
  // a `src="..."` attribute even before escapeHtml gets a chance.
  return /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*donmai\.us\/[^\s"'<>]+$/i.test(
    s,
  )
    ? s
    : null;
}

/**
 * Tooltip placement candidate (document-coordinate top-left).
 */
export interface TooltipCandidate {
  left: number;
  top: number;
}

export interface TooltipBounds {
  minLeft: number;
  maxRight: number;
  minTop: number;
  maxBottom: number;
}

/**
 * Picks the first candidate whose bounding box (origin + width/height)
 * fits entirely inside `bounds`. Used by the mobile pie-chart tooltip
 * to honor a "no horizontal scroll, full tooltip visible" UX without
 * shrinking the tooltip itself — callers supply candidates in priority
 * order (e.g. four touch-relative quadrants, then chart-wrapper-centered
 * fallbacks). Returns `null` if no candidate fits; the caller should
 * apply a last-resort hard clamp in that case.
 */
export function pickFittingPosition(
  candidates: readonly TooltipCandidate[],
  width: number,
  height: number,
  bounds: TooltipBounds,
): TooltipCandidate | null {
  for (const c of candidates) {
    if (
      c.left >= bounds.minLeft &&
      c.left + width <= bounds.maxRight &&
      c.top >= bounds.minTop &&
      c.top + height <= bounds.maxBottom
    ) {
      return c;
    }
  }
  return null;
}

/**
 * Pure helpers used by the UserAnalytics pie-chart widget.
 *
 * These live in their own module so the vitest (node) environment can
 * import and test them without dragging in d3 or DOM-dependent code.
 */

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

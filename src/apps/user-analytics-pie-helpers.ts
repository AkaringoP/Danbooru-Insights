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

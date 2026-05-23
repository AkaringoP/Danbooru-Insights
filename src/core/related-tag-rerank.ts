/**
 * Helpers for the v9.6.2 dynamic candidate pool + count rerank applied
 * to the Character / Copyright / Fav-copyright pie tabs.
 *
 * Danbooru `/related_tag.json` returns `frequency` estimated from at
 * most 5,000 md5-ordered posts, which is enough for small users but
 * loses accuracy for dispersed-character uploaders (e.g. Unbreakable
 * with 276k posts and hundreds of viable Fate characters). The fix is
 * to widen the candidate pool by total post count, pull accurate
 * `/counts/posts.json` for every candidate, then rerank by count.
 *
 * Lives in core/ (not apps/) because `AnalyticsDataManager` consumes
 * these helpers — the architecture invariant forbids core/ importing
 * from apps/. The 10-step caps (80 char / 40 copy) are derived from
 * a Poisson SE model on the sample frequencies — wide enough that
 * dispersed-character uploaders see ≥99% top-10 stability after
 * the count rerank.
 */

/**
 * Candidate carrying both the frequency hint from `/related_tag.json`
 * (md5-ordered 5,000-row sample) and the accurate `/counts/posts.json`
 * count. `count === 0` means the count fetch failed — callers should
 * treat that as "rank last" rather than "zero posts".
 */
export interface FreqCandidate {
  name: string;
  tagName: string;
  frequency: number;
  count: number;
}

/**
 * Returns the top `k` candidates sorted by count desc, then frequency
 * desc, then tagName asc. The accurate per-tag count outranks the
 * frequency estimate because `/related_tag.json` only samples up to
 * 5,000 posts — large dispersed-character uploaders can have true
 * top-10 tags whose sampled frequency lands outside the 11+ window.
 * Does not mutate the input array.
 */
export function selectTopKByCount<T extends FreqCandidate>(
  candidates: T[],
  k: number,
): T[] {
  const sorted = candidates.slice().sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    return a.tagName.localeCompare(b.tagName);
  });
  return sorted.slice(0, Math.max(0, k));
}

/**
 * Candidate pool sizing for the Character pie tab. `N` is the user's
 * total upload count. Returns `filtered` — how many candidates to keep
 * *after* the isTopLevelTag filter so that `selectTopKByCount` has
 * enough headroom to absorb sample noise — and `raw` — how many to
 * fetch from `/related_tag.json` *before* filtering (1.5× margin for
 * variant-heavy fandoms where the filter drops a large fraction).
 *
 * 10-step mapping caps at 80 because Character is the most dispersed
 * category (Fate/Hololive-class catalogues with hundreds of viable
 * top-level characters). N ≤ 5000 returns the legacy 10/15 — for
 * those users the related_tag sample equals the full corpus, so
 * the rerank is a no-op but the count fetch still produces the
 * displayed value.
 */
export function charPoolSize(N: number): {filtered: number; raw: number} {
  const n = Number.isFinite(N) && N > 0 ? N : 0;
  let f: number;
  if (n <= 5_000) f = 10;
  else if (n <= 10_000) f = 15;
  else if (n <= 20_000) f = 20;
  else if (n <= 40_000) f = 25;
  else if (n <= 70_000) f = 35;
  else if (n <= 110_000) f = 45;
  else if (n <= 160_000) f = 55;
  else if (n <= 250_000) f = 65;
  else if (n <= 500_000) f = 75;
  else f = 80;
  return {filtered: f, raw: Math.ceil(f * 1.5)};
}

/**
 * Candidate pool sizing for the Copyright / Fav-copyright pie tabs.
 * Same shape as `charPoolSize` but caps at 40 — copyright/franchise
 * tags consolidate harder than character tags, so the dispersion risk
 * is lower and a smaller pool suffices for ~99% top-10 stability.
 */
export function copyPoolSize(N: number): {filtered: number; raw: number} {
  const n = Number.isFinite(N) && N > 0 ? N : 0;
  let f: number;
  if (n <= 5_000) f = 10;
  else if (n <= 10_000) f = 12;
  else if (n <= 20_000) f = 15;
  else if (n <= 40_000) f = 18;
  else if (n <= 70_000) f = 22;
  else if (n <= 110_000) f = 26;
  else if (n <= 160_000) f = 30;
  else if (n <= 250_000) f = 34;
  else if (n <= 500_000) f = 37;
  else f = 40;
  return {filtered: f, raw: Math.ceil(f * 1.5)};
}

#!/usr/bin/env node
// Compare two bench-collect outputs and emit a Markdown diff report.
//
// Usage:
//   node scripts/bench-compare.ts <main.json> <feature.json> > report.md
//
// Treats the first file as the baseline. Δ% is computed as
// (feature - main) / main * 100 on each per-label p95 value.
// Rows where |Δ%| > REGRESSION_THRESHOLD_PCT are flagged.
//
// Label normalization: before diffing, every label is run through the alias
// table so legacy `sync.full.*` / `render.fetchData.*` etc. (main baseline)
// align with the canonical `dbi:db:sync:full:*` / `dbi:net:fetchData:*`
// (feature build). `legacy:*` and unknown labels pass through unchanged.

import {readFileSync} from 'node:fs';

interface LabelStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

interface Bundle {
  parsedAt: string;
  sources: string[];
  totalEntries: number;
  stats: Record<string, LabelStats>;
}

const REGRESSION_THRESHOLD_PCT = 5;

function load(path: string): Bundle {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as Bundle;
}

/**
 * Translate a legacy perf label to its canonical `dbi:*` equivalent.
 * Mirrors the prefix table from Task 3.2 (P5 prefix rewrite). Labels that
 * already use `dbi:*` or `legacy:*` (PerfProbe family) pass through.
 */
function aliasLabel(label: string): string {
  if (label === 'render.total') return 'dbi:render:total';
  if (label === 'render.precheck') return 'dbi:render:precheck';
  if (label.startsWith('render.precheck.')) {
    return 'dbi:render:precheck:' + label.slice('render.precheck.'.length);
  }
  if (label.startsWith('sync.full.')) {
    return 'dbi:db:sync:full:' + label.slice('sync.full.'.length);
  }
  if (label.startsWith('sync.quick.')) {
    return 'dbi:db:sync:quick:' + label.slice('sync.quick.'.length);
  }
  if (label.startsWith('sync.refreshStats.')) {
    return 'dbi:db:refresh:' + label.slice('sync.refreshStats.'.length);
  }
  if (label.startsWith('render.fetchData.')) {
    return 'dbi:net:fetchData:' + label.slice('render.fetchData.'.length);
  }
  if (label.startsWith('render.widget.')) {
    return 'dbi:render:widget:' + label.slice('render.widget.'.length);
  }
  return label;
}

/**
 * Normalize all labels in `stats` through `aliasLabel`. Collisions (rare —
 * would only happen if a bundle already mixed old and new labels) are
 * resolved by keeping the entry with the larger `count`, which is the
 * safer choice for percentile aggregates.
 */
function normalizeStats(stats: Record<string, LabelStats>): {
  normalized: Record<string, LabelStats>;
  collisions: string[];
} {
  const out: Record<string, LabelStats> = {};
  const collisions: string[] = [];
  for (const [origLabel, data] of Object.entries(stats)) {
    const newLabel = aliasLabel(origLabel);
    if (newLabel in out) {
      const existing = out[newLabel];
      collisions.push(`${origLabel} → ${newLabel}`);
      out[newLabel] = existing.count >= data.count ? existing : data;
    } else {
      out[newLabel] = data;
    }
  }
  return {normalized: out, collisions};
}

function fmtMs(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(1)}ms`;
}

function fmtPct(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function flag(deltaPct: number): string {
  if (Math.abs(deltaPct) <= REGRESSION_THRESHOLD_PCT) return '';
  return deltaPct > 0 ? '⚠ regression' : '✓ improvement';
}

function diffRow(label: string, m?: LabelStats, f?: LabelStats) {
  const mP95 = m?.p95;
  const fP95 = f?.p95;
  const deltaMs = mP95 !== undefined && fP95 !== undefined ? fP95 - mP95 : NaN;
  const deltaPct =
    mP95 !== undefined && fP95 !== undefined && mP95 > 0
      ? ((fP95 - mP95) / mP95) * 100
      : NaN;
  return {
    label,
    mainP95: mP95,
    featureP95: fP95,
    deltaMs,
    deltaPct,
    mainCount: m?.count ?? 0,
    featureCount: f?.count ?? 0,
    flag: Number.isFinite(deltaPct) ? flag(deltaPct) : '',
  };
}

function main(): void {
  const [mainPath, featurePath] = process.argv.slice(2);
  if (!mainPath || !featurePath) {
    process.stderr.write(
      'Usage: node scripts/bench-compare.ts <main.json> <feature.json>\n',
    );
    process.exit(1);
  }

  const main = load(mainPath);
  const feature = load(featurePath);

  // Normalize both sides through the alias table so old `sync.full.*`
  // labels in the main baseline align with the canonical `dbi:db:sync:full:*`
  // emitted by the feature build.
  const mainNorm = normalizeStats(main.stats);
  const featureNorm = normalizeStats(feature.stats);
  const mainStats = mainNorm.normalized;
  const featureStats = featureNorm.normalized;

  const allLabels = new Set<string>([
    ...Object.keys(mainStats),
    ...Object.keys(featureStats),
  ]);

  const rows = [...allLabels]
    .map(l => diffRow(l, mainStats[l], featureStats[l]))
    .sort((a, b) => {
      const aAbs = Number.isFinite(a.deltaPct) ? Math.abs(a.deltaPct) : -1;
      const bAbs = Number.isFinite(b.deltaPct) ? Math.abs(b.deltaPct) : -1;
      return bAbs - aAbs;
    });

  const lines: string[] = [];
  lines.push(`# Bench compare: \`${mainPath}\` vs \`${featurePath}\``);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`- Main sources: ${main.sources.join(', ')}`);
  lines.push(`- Feature sources: ${feature.sources.join(', ')}`);
  lines.push(
    `- Regression threshold: ±${REGRESSION_THRESHOLD_PCT}% on per-label p95`,
  );
  if (mainNorm.collisions.length > 0 || featureNorm.collisions.length > 0) {
    lines.push(
      `- Label aliasing collisions (kept larger-count entry): ${
        [...mainNorm.collisions, ...featureNorm.collisions].length
      }`,
    );
  }
  lines.push('');
  lines.push('## P95 latency comparison');
  lines.push('');
  lines.push('| label | main p95 | feature p95 | Δ ms | Δ% | flag |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    const dMs = Number.isFinite(r.deltaMs)
      ? `${r.deltaMs > 0 ? '+' : ''}${r.deltaMs.toFixed(1)}ms`
      : '—';
    const dPct = Number.isFinite(r.deltaPct) ? fmtPct(r.deltaPct) : '—';
    lines.push(
      `| \`${r.label}\` | ${fmtMs(r.mainP95)} | ${fmtMs(r.featureP95)} | ${dMs} | ${dPct} | ${r.flag} |`,
    );
  }
  lines.push('');
  lines.push('## Coverage');
  lines.push('');
  lines.push('| label | main count | feature count |');
  lines.push('|---|---|---|');
  for (const r of rows) {
    lines.push(`| \`${r.label}\` | ${r.mainCount} | ${r.featureCount} |`);
  }
  lines.push('');
  process.stdout.write(lines.join('\n'));
}

main();

#!/usr/bin/env node
// Parse DanbooruInsights perf logs into structured JSON.
//
// Usage:
//   node scripts/bench-collect.ts <log-file> [<log-file>...] > out.json
//   cat log | node scripts/bench-collect.ts > out.json
//
// Multiple input files are concatenated into a single sample set per label
// (e.g. pass 3 run logs for one scenario to get pooled stats across runs).
//
// Two log formats are recognized:
//
//   1. perf-logger.ts (`[Perf #N] <label>: <delta>ms (abs <abs>ms) <meta>`)
//      Used by all `dbi:db:sync:*`, `dbi:net:*`, `dbi:render:*` spans.
//
//   2. logger.ts DEBUG output (`[DI:<ns>] DEBUG ...`) used by the legacy
//      tag-analytics PerfProbe instrumentation. Emitted as `legacy:*`
//      labels:
//        [PerfProbe] foo: 12.3ms        → legacy:probe:foo
//        [PerfProbe] grp: a=1ms, b=2ms  → legacy:probe:grp:a, legacy:probe:grp:b
//        [Task] Finished: Foo (45.6ms)  → legacy:task:Foo
//        [Phase 1] Bar in 7.8ms         → legacy:phase:1
//        Total analysis time: 90s       → legacy:total
//        renderDashboard - Initial Render (97ms) → legacy:render:initial

import {readFileSync} from 'node:fs';

interface Entry {
  seq: number;
  label: string;
  delta: number;
  abs: number;
  meta?: string;
}

interface LabelStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

interface Output {
  parsedAt: string;
  sources: string[];
  totalEntries: number;
  stats: Record<string, LabelStats>;
  entries: Entry[];
}

// Format 1: perf-logger.ts canonical output.
const PERF_RE =
  /\[Perf #(\d+)\] (.+?): ([\d.]+)ms \(abs (\d+(?:\.\d+)?)ms\)(?: (.*))?$/;

// Format 2: legacy logger.ts DEBUG output (tag-analytics PerfProbe family).
// Each pattern starts with the `[DI:<namespace>] DEBUG ` prefix, which may
// be preceded by Chrome devtools location info (filename:line) — hence the
// non-anchored regexes.
const TASK_RE =
  /\[DI:[^\]]+\] DEBUG \[Task\] Finished:\s+(.+?)\s*\(([\d.]+)ms\)/;
const PHASE_RE = /\[DI:[^\]]+\] DEBUG \[Phase (\d+)\]\s+.+?\s+in\s+([\d.]+)ms/;
const PROBE_RE = /\[DI:[^\]]+\] DEBUG \[PerfProbe\]\s+(.+)$/;
const TOTAL_RE = /\[DI:[^\]]+\] DEBUG Total analysis time:\s+([\d.]+)ms/;
const RENDER_INIT_RE =
  /\[DI:[^\]]+\] DEBUG renderDashboard\s*[-–]\s*Initial Render\s*\(([\d.]+)ms\)/;

// Inside a [PerfProbe] body, distinguish single ('foo: 12.3ms') from
// composite ('grp: a=1ms, b=2ms (meta)'). Composite lines have at least
// one '<word>=<num>ms' pair after the leading group label.
const PROBE_SINGLE_RE = /^([^:]+?):\s*([\d.]+)ms\s*$/;
const PROBE_COMPOSITE_RE = /^([^:]+?):\s+(.+)$/;
const PROBE_PAIR_RE = /([\w.#]+)=([\d.]+)ms/g;

function makeEntry(label: string, delta: number): Entry {
  return {seq: 0, label, delta, abs: 0};
}

function parseLegacyLine(line: string): Entry[] {
  // Order matters: the more specific patterns (TOTAL, RENDER_INIT, TASK,
  // PHASE) before the catch-all PROBE.
  let m: RegExpExecArray | null;
  if ((m = TOTAL_RE.exec(line))) {
    return [makeEntry('legacy:total', Number(m[1]))];
  }
  if ((m = RENDER_INIT_RE.exec(line))) {
    return [makeEntry('legacy:render:initial', Number(m[1]))];
  }
  if ((m = TASK_RE.exec(line))) {
    return [makeEntry(`legacy:task:${m[1].trim()}`, Number(m[2]))];
  }
  if ((m = PHASE_RE.exec(line))) {
    return [makeEntry(`legacy:phase:${m[1]}`, Number(m[2]))];
  }
  if ((m = PROBE_RE.exec(line))) {
    const body = m[1].trim();
    const single = PROBE_SINGLE_RE.exec(body);
    if (single) {
      return [makeEntry(`legacy:probe:${single[1].trim()}`, Number(single[2]))];
    }
    const grp = PROBE_COMPOSITE_RE.exec(body);
    if (!grp) return [];
    const groupName = grp[1].trim();
    // Strip trailing parenthesized meta like '(fetched=100, target=1200)'.
    const restNoMeta = grp[2].replace(/\s*\([^)]*\)\s*$/, '');
    const out: Entry[] = [];
    for (const pair of restNoMeta.matchAll(PROBE_PAIR_RE)) {
      out.push(
        makeEntry(`legacy:probe:${groupName}:${pair[1]}`, Number(pair[2])),
      );
    }
    return out;
  }
  return [];
}

function parseLines(text: string): Entry[] {
  const out: Entry[] = [];
  let synthSeq = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const perfMatch = PERF_RE.exec(line);
    if (perfMatch) {
      const [, seq, label, delta, abs, meta] = perfMatch;
      out.push({
        seq: Number(seq),
        label,
        delta: Number(delta),
        abs: Number(abs),
        ...(meta ? {meta} : {}),
      });
      continue;
    }
    const legacyEntries = parseLegacyLine(line);
    for (const e of legacyEntries) {
      e.seq = ++synthSeq;
      out.push(e);
    }
  }
  return out;
}

// Nearest-rank percentile on a pre-sorted ascending array.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function aggregate(entries: Entry[]): Record<string, LabelStats> {
  const buckets = new Map<string, number[]>();
  for (const e of entries) {
    const arr = buckets.get(e.label) ?? [];
    arr.push(e.delta);
    buckets.set(e.label, arr);
  }
  const stats: Record<string, LabelStats> = {};
  for (const [label, vals] of buckets) {
    vals.sort((a, b) => a - b);
    const sum = vals.reduce((s, v) => s + v, 0);
    stats[label] = {
      count: vals.length,
      min: vals[0],
      max: vals[vals.length - 1],
      mean: sum / vals.length,
      p50: percentile(vals, 50),
      p95: percentile(vals, 95),
      p99: percentile(vals, 99),
    };
  }
  return stats;
}

function main(): void {
  const args = process.argv.slice(2);
  let texts: string[] = [];
  let sources: string[] = [];
  if (args.length === 0) {
    // Read from stdin.
    texts = [readFileSync(0, 'utf8')];
    sources = ['<stdin>'];
  } else {
    texts = args.map(p => readFileSync(p, 'utf8'));
    sources = args;
  }
  const entries = texts.flatMap(parseLines);
  const out: Output = {
    parsedAt: new Date().toISOString(),
    sources,
    totalEntries: entries.length,
    stats: aggregate(entries),
    entries,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main();

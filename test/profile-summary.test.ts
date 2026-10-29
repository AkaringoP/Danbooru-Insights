import {describe, expect, it} from 'vitest';
import {
  buildProfileSummary,
  deriveActivity,
  formatPct,
  formatYearMonth,
  newestPoints,
  scatterPointToWindowPoint,
  userSearchUrl,
} from '../src/core/profile-summary';
import type {
  ProfileSummary,
  ProfileSummaryInput,
  WindowPoint,
} from '../src/types';

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const H = 3_600_000;
const D = 24 * H;

/** A healthy upload; `ageMs` back from NOW. */
function pt(id: number, ageMs: number, over: Partial<WindowPoint> = {}) {
  return {
    id,
    ts: NOW - ageMs,
    del: false,
    ban: false,
    pending: false,
    flagged: false,
    score: 5,
    gentags: 20,
    rating: 's',
    copyrights: ['blue_archive'],
    characters: ['hoshino_(blue_archive)'],
    ...over,
  } as WindowPoint;
}

/** 200 live uploads, newest first, one every 6h (index 0 = 6h old). */
function win(mod: (i: number) => Partial<WindowPoint> = () => ({})) {
  return Array.from({length: 200}, (_, i) =>
    pt(10_000 - i, (i + 1) * 6 * H, mod(i)),
  );
}

/** 400 older uploads, one per day, 51–450 days old. */
function earlier(mod: (i: number) => Partial<WindowPoint> = () => ({})) {
  return Array.from({length: 400}, (_, i) => pt(400 - i, (51 + i) * D, mod(i)));
}

function input(over: Partial<ProfileSummaryInput> = {}): ProfileSummaryInput {
  const window = over.window ?? win();
  return {
    userName: 'tester',
    firstUploadDate: new Date(Date.UTC(2021, 2, 21)),
    total: 1000,
    lifetimeDeleted: 2,
    copyrightTop: ['blue_archive', 'arknights'],
    characterTop: ['hoshino_(blue_archive)'],
    lifetimePoints: [...earlier(), ...window],
    window,
    ...over,
  };
}

const text = (s: ProfileSummary, line: number) =>
  (s.lines[line] ?? []).map(p => p.text).join('');
const line1 = (i: ProfileSummaryInput) => text(buildProfileSummary(i, NOW), 0);
const line2 = (i: ProfileSummaryInput) => text(buildProfileSummary(i, NOW), 1);
const flagIds = (i: ProfileSummaryInput) => {
  const s = buildProfileSummary(i, NOW);
  return [
    ...s.lines[0].filter(p => p.href && p.severity).map(p => p.href),
    ...s.overflow.map(f => f.id),
  ];
};
/** Window where indices in [from, from+n) get `over` (default: old ones). */
const some = (n: number, over: Partial<WindowPoint>, from = 50) =>
  win(i => (i >= from && i < from + n ? over : {}));

describe('formatting helpers', () => {
  it('formats percentages with one decimal under 1%', () => {
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(0.002)).toBe('0.2%');
    expect(formatPct(0.1)).toBe('10%');
    expect(formatPct(0.235)).toBe('24%');
  });

  it('formats the anchor month in UTC', () => {
    expect(formatYearMonth(new Date(Date.UTC(2021, 2, 1)))).toBe('2021-03');
    expect(formatYearMonth(new Date('2019-12-31T23:30:00Z'))).toBe('2019-12');
  });

  it('encodes user search links', () => {
    expect(userSearchUrl('a_b', 'gentags:<10')).toBe(
      `/posts?tags=${encodeURIComponent('user:a_b gentags:<10')}`,
    );
  });

  it('maps scatter points, leaving live-only fields unknown', () => {
    const p = scatterPointToWindowPoint({
      id: 7,
      d: 100,
      s: -2,
      t: 4,
      r: 'e',
      del: true,
      ban: false,
    });
    expect(p).toEqual({
      id: 7,
      ts: 100,
      del: true,
      ban: false,
      score: -2,
      gentags: 4,
      rating: 'e',
    });
    expect(p.pending).toBeUndefined();
    expect(p.copyrights).toBeUndefined();
  });

  it('picks the newest points by id', () => {
    const pts = [pt(1, D), pt(3, D), pt(2, D)];
    expect(newestPoints(pts, 2).map(p => p.id)).toEqual([3, 2]);
  });
});

describe('line 1 — anchor + recent health', () => {
  it('reports a clean window against the lifetime deletion rate', () => {
    expect(line1(input())).toBe(
      'Uploading since 2021-03. Last 200 uploads are clean — none deleted ' +
        '(around their lifetime 0.2%), none banned, none pending, all tagged ' +
        '(avg 20 general tags).',
    );
  });

  it('drops the anchor when the first upload is unknown', () => {
    expect(line1(input({firstUploadDate: null}))).toMatch(/^Last 200 uploads/);
  });

  it('keeps only the anchor for an empty window', () => {
    expect(line1(input({window: []}))).toBe('Uploading since 2021-03.');
  });

  it('omits fields the local fallback cannot know', () => {
    const local = win(() => ({pending: undefined, flagged: undefined}));
    expect(line1(input({window: local}))).toBe(
      'Uploading since 2021-03. Last 200 uploads are clean — none deleted ' +
        '(around their lifetime 0.2%), none banned, all tagged ' +
        '(avg 20 general tags).',
    );
  });

  it('skips the deletion ratio when most rows predate the backfill', () => {
    const w = win(i => (i < 101 ? {del: undefined} : {}));
    expect(line1(input({window: w}))).not.toMatch(/deleted/);
  });

  it('flags deletions from 10% (warn) and 23% (bad)', () => {
    expect(flagIds(input({window: some(19, {del: true})}))).toEqual([]);
    const warn = buildProfileSummary(
      input({window: some(20, {del: true})}),
      NOW,
    );
    const part = warn.lines[0].find(p => p.href && p.severity);
    expect(part?.severity).toBe('warn');
    expect(part?.text).toBe('20 deleted (10%, above their lifetime 0.2%)');
    expect(part?.href).toBe(userSearchUrl('tester', 'status:deleted'));
    const bad = (n: number) =>
      buildProfileSummary(
        input({window: some(n, {del: true})}),
        NOW,
      ).lines[0].find(p => p.href && p.severity)?.severity;
    expect(bad(45)).toBe('warn');
    expect(bad(46)).toBe('bad');
  });

  it('flags deletions inside the 3-day moderation period', () => {
    // index 11 is 72h old (outside), index 10 is 66h old (inside).
    expect(flagIds(input({window: some(1, {del: true}, 11)}))).toEqual([]);
    const s = buildProfileSummary(
      input({window: some(1, {del: true}, 10)}),
      NOW,
    );
    expect(text(s, 0)).toContain('1 deleted within 3 days of upload');
  });

  it('flags essentially-untagged uploads from 5%', () => {
    expect(line1(input({window: some(9, {gentags: 3})}))).toContain(
      '9 thinly tagged',
    );
    const s = buildProfileSummary(input({window: some(10, {gentags: 3})}), NOW);
    const part = s.lines[0].find(p => p.href && p.severity);
    expect(part).toMatchObject({
      severity: 'bad',
      text: '10 still essentially untagged',
      href: userSearchUrl('tester', 'gentags:<=3'),
    });
    expect(line1(input({window: some(10, {gentags: 4})}))).toContain('clean');
  });

  it('gives fresh uploads a 15-minute tagging grace period', () => {
    const fresh = Array.from({length: 10}, (_, i) =>
      pt(20_000 + i, 5 * 60_000, {gentags: 0}),
    );
    const w = [...fresh, ...win().slice(0, 190)];
    expect(line1(input({window: w}))).toContain('all tagged');
  });

  it('ignores deleted uploads when judging tagging', () => {
    const w = some(10, {gentags: 0, del: true}, 60);
    expect(flagIds(input({window: w}))).not.toContain(
      userSearchUrl('tester', 'gentags:<=3'),
    );
  });

  it('grades under-tagging at 20% (warn) and 50% (bad)', () => {
    const sev = (n: number) =>
      buildProfileSummary(
        input({window: some(n, {gentags: 8}, 0)}),
        NOW,
      ).lines[0].find(p => p.href && p.severity)?.severity;
    expect(sev(39)).toBeUndefined();
    expect(sev(40)).toBe('warn');
    expect(sev(99)).toBe('warn');
    expect(sev(100)).toBe('bad');
  });

  it('moves under-tagged to overflow when untagged is shown', () => {
    const w = win(i => (i < 60 ? {gentags: i < 20 ? 1 : 8} : {}));
    const s = buildProfileSummary(input({window: w}), NOW);
    const inline = s.lines[0].filter(p => p.severity).map(p => p.text);
    expect(inline.join('|')).not.toMatch(/under-tagged/);
    expect(s.overflow.map(f => f.id)).toContain('undertagged-recent');
  });

  it('flags thinner tagging than the earlier baseline', () => {
    expect(line1(input({window: win(() => ({gentags: 15}))}))).toContain(
      'clean',
    );
    expect(line1(input({window: win(() => ({gentags: 14}))}))).toContain(
      'tagging thinner than before (20 → 14 general tags per upload)',
    );
  });

  it('flags heavy downvotes from 10%', () => {
    expect(line1(input({window: some(19, {score: -3})}))).toContain('clean');
    expect(line1(input({window: some(20, {score: -3})}))).toContain(
      '10% heavily downvoted',
    );
    expect(line1(input({window: some(20, {score: -2})}))).toContain('clean');
  });

  it('keeps pending as info inside a clean report', () => {
    expect(line1(input({window: some(3, {pending: true}, 0)}))).toContain(
      'Last 200 uploads are clean — none deleted (around their lifetime ' +
        '0.2%), none banned, 3 pending (2%), all tagged',
    );
  });

  it('lists the status breakdown, then the two most severe other flags', () => {
    const w = win(i => {
      if (i >= 50 && i < 100) return {del: true};
      if (i >= 100 && i < 120) return {gentags: 1};
      if (i >= 120 && i < 145) return {score: -5};
      if (i >= 145 && i < 147) return {flagged: true};
      return {};
    });
    const s = buildProfileSummary(input({window: w}), NOW);
    expect(text(s, 0)).toBe(
      'Uploading since 2021-03. In the last 200 uploads: 50 deleted (25%, ' +
        'above their lifetime 0.2%), none banned, none pending; 20 still ' +
        'essentially untagged; 13% heavily downvoted (+1 more).',
    );
    expect(s.overflow.map(f => f.id)).toEqual(['flagged-recent']);
  });

  it('reports banned and flagged uploads with links', () => {
    const w = win(i =>
      i === 60 ? {ban: true} : i === 61 ? {flagged: true} : {},
    );
    const parts = buildProfileSummary(input({window: w}), NOW).lines[0];
    expect(parts.find(p => p.text === '1 banned (0.5%)')?.href).toBe(
      userSearchUrl('tester', 'status:banned'),
    );
    expect(parts.find(p => p.text === '1 currently flagged')).toBeDefined();
  });
});

describe('tones', () => {
  const tones = (i: ProfileSummaryInput) =>
    Object.fromEntries(
      buildProfileSummary(i, NOW)
        .lines.flat()
        .filter(p => p.severity)
        .map(p => [p.text, p.severity]),
    );

  it('marks a clean report and a faster pace/streak as good', () => {
    const t = tones(input());
    expect(t['Last 200 uploads are clean']).toBe('good');
    expect(Object.entries(t).filter(([, v]) => v === 'good')).toHaveLength(3);
  });

  it('marks a slowdown and weaker reception as warn', () => {
    const w = win(() => ({score: 1})).map(p => ({...p, ts: p.ts - 40 * D}));
    const t = tones(input({window: w, lifetimePoints: [...earlier(), ...w]}));
    expect(t['No uploads in the last 30 days']).toBe('warn');
    expect(t['scoring below their usual (median 1 vs 5)']).toBe('warn');
  });

  it('leaves rating drift and focus untoned', () => {
    const t = tones(input({window: win(() => ({rating: 'e'}))}));
    expect(t['more explicit lately']).toBeUndefined();
    expect(t['blue archive']).toBeUndefined();
  });
});

describe('line 2 — recent vs usual', () => {
  it('describes pace, streak and steady focus by default', () => {
    expect(line2(input())).toMatch(
      /^Uploading at about 2\.\d× their 12-month pace over the last 30 days, on a \d+-day streak; still centred on blue archive\.$/,
    );
  });

  it('links the focus series to a user search', () => {
    const s = buildProfileSummary(input(), NOW);
    expect(s.lines[1].find(p => p.text === 'blue archive')?.href).toBe(
      userSearchUrl('tester', 'blue_archive'),
    );
  });

  it('tags focus links with their Danbooru category', () => {
    const w = win(i =>
      i < 120
        ? {
            copyrights: ['wuthering_waves'],
            characters: ['camellya_(wuthering_waves)'],
          }
        : {},
    );
    const links = buildProfileSummary(input({window: w}), NOW)
      .lines[1].filter(p => p.href)
      .map(p => [p.text, p.category]);
    expect(links).toEqual([
      ['blue archive', 'copyright'],
      ['wuthering waves', 'copyright'],
      ['camellya (wuthering waves)', 'character'],
    ]);
  });

  it('reports dormancy instead of pace', () => {
    const w = win().map(p => ({...p, ts: p.ts - 300 * D}));
    const life = earlier().map(p => ({...p, ts: p.ts - 300 * D}));
    const out = line2(input({window: w, lifetimePoints: [...life, ...w]}));
    // Newest upload: 300 days + 6h before 2026-10-18 → 2025-12-22.
    expect(out).toBe(
      'No uploads since 2025-12; still centred on blue archive.',
    );
  });

  it('reports a stopped month', () => {
    const w = win().map(p => ({...p, ts: p.ts - 40 * D}));
    expect(
      line2(input({window: w, lifetimePoints: [...earlier(), ...w]})),
    ).toMatch(/^No uploads in the last 30 days; /);
  });

  it('skips pace for young accounts', () => {
    const a = deriveActivity(
      input({firstUploadDate: new Date(NOW - 60 * D)}),
      NOW,
    );
    expect(a.pace30).toBeNull();
  });

  it('describes a shift away from the lifetime top series', () => {
    const w = win(i =>
      i < 120
        ? {
            copyrights: ['wuthering_waves'],
            characters: ['camellya_(wuthering_waves)'],
          }
        : {},
    );
    expect(line2(input({window: w}))).toContain(
      'lately shifted from blue archive to wuthering waves (60% of recent ' +
        'uploads) (mostly camellya (wuthering waves))',
    );
  });

  it('stays quiet about a weak shift', () => {
    const w = win(i =>
      i < 50 ? {copyrights: ['wuthering_waves']} : {copyrights: [`s${i}`]},
    );
    expect(line2(input({window: w}))).not.toMatch(/shifted|centred|spread/);
  });

  it('describes spread-out recent uploads', () => {
    const w = win(i => ({copyrights: [`series_${i}`]}));
    expect(line2(input({window: w}))).toContain(
      'spread across 200 series lately',
    );
  });

  it('names new series not in the lifetime top', () => {
    const w = win(i =>
      i < 40
        ? {copyrights: ['genshin_impact']}
        : i < 60
          ? {copyrights: ['arknights']}
          : {},
    );
    expect(line2(input({window: w}))).toContain(
      'still centred on blue archive, branching into genshin impact',
    );
  });

  it('compares settled scores to the earlier median', () => {
    expect(line2(input({window: win(() => ({score: 3}))}))).not.toMatch(
      /scoring/,
    );
    // Exactly half the earlier median is the boundary.
    expect(line2(input({window: win(() => ({score: 2.5}))}))).toContain(
      'scoring below their usual (median 2.5 vs 5)',
    );
    expect(line2(input({window: win(() => ({score: 10}))}))).toContain(
      'scoring above their usual (median 10 vs 5)',
    );
  });

  it('notes a rating drift when reception is unchanged', () => {
    const e = (n: number) => win(i => (i < n ? {rating: 'e'} : {}));
    expect(line2(input({window: e(39)}))).not.toMatch(/explicit/);
    expect(line2(input({window: e(40)}))).toContain('more explicit lately');
  });

  it('drops focus clauses when the window lacks tag strings', () => {
    const w = win(() => ({copyrights: undefined, characters: undefined}));
    expect(line2(input({window: w}))).not.toMatch(/centred|series/);
  });

  it('mentions a current streak from 7 days', () => {
    // One upload per day ending today; too few uploads for pace or focus.
    const days = (n: number) =>
      Array.from({length: n}, (_, k) => pt(100 - k, H + k * D));
    const run = (n: number) =>
      buildProfileSummary(
        input({window: days(n), lifetimePoints: days(n)}),
        NOW,
      );
    expect(text(run(7), 1)).toBe('On a 7-day streak.');
    expect(run(6).lines.length).toBe(1);
  });

  it('omits line 2 when nothing differs', () => {
    const w = win(() => ({copyrights: undefined}));
    const s = buildProfileSummary(
      input({window: w, firstUploadDate: new Date(NOW - 60 * D)}),
      NOW,
    );
    // Young account (no pace) but a streak still qualifies; strip it too.
    const sparse = w.filter((_, i) => i % 8 === 0);
    const s2 = buildProfileSummary(
      input({
        window: sparse,
        lifetimePoints: sparse,
        firstUploadDate: new Date(NOW - 60 * D),
      }),
      NOW,
    );
    expect(s.lines.length).toBe(2);
    expect(s2.lines.length).toBe(1);
  });
});

describe('lifetime scope (dashboard card)', () => {
  const life = (i: ProfileSummaryInput, line: number) =>
    text(buildProfileSummary(i, NOW, 'lifetime'), line);

  it('judges every synced upload with the remote status counts', () => {
    expect(
      life(input({lifetimeStatus: {pending: 0, flagged: 0, banned: 0}}), 0),
    ).toBe(
      'Uploading since 2021-03. All 1,000 uploads are clean — 2 deleted ' +
        '(0.2%), none banned, none pending, all tagged (avg 20 general tags).',
    );
    expect(
      life(input({lifetimeStatus: {pending: 3, flagged: 0, banned: 285}}), 0),
    ).toContain('2 deleted (0.2%), 285 banned (28%), 3 pending (0.3%)');
  });

  it('grades the lifetime deletion rate without a self-comparison', () => {
    const out = life(input({lifetimeDeleted: 150}), 0);
    expect(out).toContain('Across all 1,000 uploads: 150 deleted (15%),');
    expect(out).not.toMatch(/their lifetime/);
  });

  it('counts tagging problems across all synced uploads', () => {
    const old = earlier(i => (i < 30 ? {gentags: 1} : {}));
    const w = win();
    const i = input({window: w, lifetimePoints: [...old, ...w]});
    expect(life(i, 0)).toContain('30 still essentially untagged');
    // The recent view only sees the clean newest 200.
    expect(text(buildProfileSummary(i, NOW, 'recent'), 0)).toContain('clean');
  });

  it('describes the yearly arc instead of recent focus', () => {
    const peak = Array.from({length: 1000}, (_, k) =>
      pt(-k, NOW - Date.UTC(2024, 5, 1) + k * 1000),
    );
    const w = win();
    const i = input({window: w, lifetimePoints: [...peak, ...earlier(), ...w]});
    const out = life(i, 1);
    expect(out).toContain(
      'busiest in 2024 (1,000 uploads); the last 12 months reached 52% of that',
    );
    expect(out).not.toMatch(/centred/);
    expect(text(buildProfileSummary(i, NOW, 'recent'), 1)).toContain(
      'still centred on blue archive',
    );
  });

  it('flags a new high and names the subject of reception drift', () => {
    const out = life(input({window: win(() => ({score: 2.5}))}), 1);
    expect(out).toContain('the last 12 months are their busiest yet');
    expect(out).toContain('recent uploads scoring below their usual');
  });
});

describe('lifetime focus (dashboard line 1)', () => {
  const focus = (
    copyright: Array<[string, number]>,
    character: Array<[string, number]> = [],
  ) => ({
    lifetimeFocus: {
      copyright: copyright.map(([tag, count]) => ({tag, count})),
      character: character.map(([tag, count]) => ({tag, count})),
    },
  });
  const line1 = (over: Partial<ProfileSummaryInput>) =>
    buildProfileSummary(input(over), NOW, 'lifetime').lines[0];
  const head = (over: Partial<ProfileSummaryInput>) => {
    const t = line1(over)
      .map(p => p.text)
      .join('');
    return t.slice(0, t.indexOf('.') + 1);
  };

  it('names the main series, a strong second and the top character', () => {
    const over = focus(
      [
        ['idolmaster', 310],
        ['blue_archive', 100],
      ],
      [['hoshino_(blue_archive)', 100]],
    );
    expect(head(over)).toBe(
      'Uploading since 2021-03, mainly idolmaster (31%) and blue archive ' +
        '(10%), above all hoshino (blue archive) (10%).',
    );
    const links = line1(over).filter(p => p.category);
    expect(links.map(p => [p.href, p.category])).toEqual([
      [
        '/posts?tags=' + encodeURIComponent('user:tester idolmaster'),
        'copyright',
      ],
      [
        '/posts?tags=' + encodeURIComponent('user:tester blue_archive'),
        'copyright',
      ],
      [
        '/posts?tags=' +
          encodeURIComponent('user:tester hoshino_(blue_archive)'),
        'character',
      ],
    ]);
  });

  it('drops a second series or character under 10%', () => {
    const over = focus(
      [
        ['idolmaster', 150],
        ['blue_archive', 99],
      ],
      [['x', 99]],
    );
    expect(head(over)).toBe(
      'Uploading since 2021-03, mainly idolmaster (15%).',
    );
  });

  it('calls a top series under 15% spread', () => {
    expect(head(focus([['touhou', 149]]))).toBe(
      'Uploading since 2021-03, spread across many series (top: touhou 15%).',
    );
  });

  it('stays out of the recent (popover) view', () => {
    const t = buildProfileSummary(input(focus([['idolmaster', 310]])), NOW)
      .lines[0].map(p => p.text)
      .join('');
    expect(t).toMatch(/^Uploading since 2021-03\. /);
  });
});

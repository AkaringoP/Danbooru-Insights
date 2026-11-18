// @vitest-environment jsdom

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

// d3 itself is unused on the "empty data" / scaffolding-only paths exercised
// here. Mock it out so renderPieWidget's transitive `import * as d3` does
// not try to evaluate D3's module-level globals against JSDOM. The actual
// chart-rendering D3 path is covered by the Playwright baseline.
vi.mock('d3', () => ({}));
vi.mock('../src/ui/popover-utils', async () => {
  const actual = await vi.importActual<
    typeof import('../src/ui/popover-utils')
  >('../src/ui/popover-utils');
  return {
    ...actual,
    // Avoid attaching a real tooltip to document.body across tests.
    createBodyTooltip: vi.fn(() => document.createElement('div')),
  };
});

import {
  processSlices,
  renderHistoryChart,
  renderPieLegend,
  renderPieWidget,
} from '../src/apps/user-analytics-charts';
import type {AnalyticsDataManager} from '../src/core/analytics-data-manager';
import type {MilestoneEntry, TargetUser} from '../src/types';

const TARGET_USER: TargetUser = {
  name: 'fixture_user',
  normalizedName: 'fixture_user',
  id: '42',
  created_at: '2020-01-01T00:00:00Z',
  joinDate: new Date('2020-01-01T00:00:00Z'),
  level_string: 'Member',
};

/** Stub data manager — every fetch method resolves to an empty array so any
 *  async loadTab() call settles cleanly without surfacing as an unhandled
 *  rejection in the test runner. */
function makeStubDataManager(): AnalyticsDataManager {
  const noop = vi.fn(async () => []);
  return {
    getCharacterDistribution: noop,
    getCopyrightDistribution: noop,
    getFavCopyrightDistribution: noop,
    getStatusDistribution: noop,
    getRatingDistribution: noop,
    getBreastsDistribution: noop,
    getHairLengthDistribution: noop,
    getHairColorDistribution: noop,
    getGenderDistribution: noop,
    getCommentaryDistribution: noop,
    getTranslationDistribution: noop,
  } as unknown as AnalyticsDataManager;
}

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderPieWidget - initial scaffolding', () => {
  it('injects the 11-tab DOM structure into the container', () => {
    const container = makeContainer();
    renderPieWidget(
      container,
      {},
      false,
      makeStubDataManager(),
      {targetUser: TARGET_USER},
      null,
    );

    const tabs = container.querySelectorAll('.di-pie-tab');
    expect(tabs.length).toBe(11);

    const modes = Array.from(tabs).map(t => t.getAttribute('data-mode'));
    expect(modes).toEqual([
      'copyright',
      'character',
      'fav_copyright',
      'status',
      'rating',
      'commentary',
      'translation',
      'gender',
      'breasts',
      'hair_length',
      'hair_color',
    ]);

    expect(container.querySelector('.pie-content')).not.toBeNull();
  });

  it('hides the breasts tab when initial NSFW is disabled', () => {
    const container = makeContainer();
    renderPieWidget(
      container,
      {},
      false,
      makeStubDataManager(),
      {targetUser: TARGET_USER},
      null,
    );
    const boobBtn = container.querySelector(
      '.di-pie-tab[data-mode="breasts"]',
    ) as HTMLElement;
    expect(boobBtn.style.display).toBe('none');
  });

  it('shows the breasts tab when initial NSFW is enabled', () => {
    const container = makeContainer();
    renderPieWidget(
      container,
      {},
      true,
      makeStubDataManager(),
      {targetUser: TARGET_USER},
      null,
    );
    const boobBtn = container.querySelector(
      '.di-pie-tab[data-mode="breasts"]',
    ) as HTMLElement;
    expect(boobBtn.style.display).toBe('block');
  });
});

describe('renderPieWidget - empty/loading branches', () => {
  it('renders the "No data available" message when the active tab has an empty array', async () => {
    const container = makeContainer();
    renderPieWidget(
      container,
      {copyright: []},
      false,
      makeStubDataManager(),
      {targetUser: TARGET_USER},
      null,
    );

    // loadTab('copyright') runs synchronously inside the constructor because
    // pieData['copyright'] is already present (empty array is truthy enough
    // for the gate); renderPieContent's data.length===0 branch fires.
    const pieContent = container.querySelector('.pie-content') as HTMLElement;
    expect(pieContent.textContent).toContain('No data available');
  });

  it('keeps the placeholder "Loading..." message until loadTab resolves', async () => {
    const container = makeContainer();
    renderPieWidget(
      container,
      {},
      false,
      makeStubDataManager(),
      {targetUser: TARGET_USER},
      null,
    );
    const pieContent = container.querySelector('.pie-content') as HTMLElement;
    // Synchronously after construction, before the async loadTab resolves.
    expect(pieContent.textContent?.trim()).toMatch(/Loading/);
  });
});

describe('renderPieWidget - onNsfwChange callback', () => {
  it('shows/hides the breasts tab on subsequent NSFW changes', () => {
    const container = makeContainer();
    const {onNsfwChange} = renderPieWidget(
      container,
      {},
      false,
      makeStubDataManager(),
      {targetUser: TARGET_USER},
      null,
    );

    const boobBtn = container.querySelector(
      '.di-pie-tab[data-mode="breasts"]',
    ) as HTMLElement;
    expect(boobBtn.style.display).toBe('none');

    onNsfwChange(true);
    expect(boobBtn.style.display).toBe('block');

    onNsfwChange(false);
    expect(boobBtn.style.display).toBe('none');
  });
});

describe('renderPieWidget - DanbooruInsights:DataUpdated subscription', () => {
  it('live-patches the active tab: re-renders from a matching DataUpdated event', async () => {
    // The live-patch handler replaces pieData[tab] with the event's fresh data
    // and re-renders the active tab (audit R2 follow-up), so a background
    // revalidate lands on the open dashboard without a reopen. d3 is mocked, so
    // we stay on the pre-d3 path by sending a zero-count row: renderPieContent
    // short-circuits to the distinctive "Total count is 0" message, proving the
    // fresh data was ingested and the active tab re-rendered.
    const container = makeContainer();
    renderPieWidget(
      container,
      {},
      false,
      makeStubDataManager(),
      {targetUser: TARGET_USER},
      null,
    );

    const pieContent = container.querySelector('.pie-content') as HTMLElement;
    // Let the initial loadTab (stub → []) settle first (renders the generic
    // "No data available"), so it doesn't clobber the event below.
    await vi.waitFor(() =>
      expect(pieContent.textContent).toContain('No data available'),
    );

    window.dispatchEvent(
      new CustomEvent('DanbooruInsights:DataUpdated', {
        detail: {
          contentType: 'copyright_dist', // default active tab
          data: [
            {
              name: 'Hatsune Miku',
              tagName: 'hatsune_miku',
              count: 0,
              frequency: 0,
              thumb: 'https://example.com/miku.webp',
              isOther: false,
            },
          ],
        },
      }),
    );

    await vi.waitFor(() =>
      expect(pieContent.textContent).toContain('Total count is 0'),
    );
  });

  it('ignores DataUpdated events for unknown contentTypes', () => {
    const container = makeContainer();
    renderPieWidget(
      container,
      {copyright: []},
      false,
      makeStubDataManager(),
      {targetUser: TARGET_USER},
      null,
    );
    // Should not throw / do anything for a contentType the pie doesn't map.
    expect(() =>
      window.dispatchEvent(
        new CustomEvent('DanbooruInsights:DataUpdated', {
          detail: {contentType: 'created_tags', data: [{name: 'x', count: 1}]},
        }),
      ),
    ).not.toThrow();
  });
});

describe('renderPieWidget - tab click handler', () => {
  it('updates the active-tab style when a non-NSFW tab is clicked', async () => {
    const container = makeContainer();
    renderPieWidget(
      container,
      // Pre-load empty arrays so loadTab takes the "no fetch needed" path
      // and renderPieContent short-circuits on data.length===0 — keeps the
      // test off the d3 render path (which is covered by the Playwright
      // baseline). Without these the tab click would resolve loadTab via
      // the stub data manager and reach the d3 call sites mocked as {}.
      {copyright: [], character: []},
      false,
      makeStubDataManager(),
      {targetUser: TARGET_USER},
      null,
    );

    const charBtn = container.querySelector(
      '.di-pie-tab[data-mode="character"]',
    ) as HTMLElement;
    const copyBtn = container.querySelector(
      '.di-pie-tab[data-mode="copyright"]',
    ) as HTMLElement;

    // Sanity: copyright is the initial active tab and carries the dark
    // background updatePieTabs assigns.
    expect(copyBtn.style.background).toContain('di-text-secondary');
    expect(charBtn.style.background).toContain('di-bg-tertiary');

    charBtn.click();
    // Yield so the click handler's synchronous updatePieTabs() and
    // loadTab() chain run.
    await Promise.resolve();

    expect(charBtn.style.background).toContain('di-text-secondary');
    expect(copyBtn.style.background).toContain('di-bg-tertiary');
  });
});

describe('renderPieWidget — lazy-revalidate event contract', () => {
  /**
   * The pie and the app talk over three CustomEvents. Both endpoints are
   * plain strings — the tab name, the piestats cacheKey, the event name —
   * so TypeScript cannot catch a rename on one side. The app's half
   * (schedulePieRevalidate) is covered in user-analytics-app.test.ts; this
   * pins the pie's half so the pair cannot drift apart silently.
   */
  function mountPie(): HTMLElement {
    const container = makeContainer();
    renderPieWidget(
      container,
      {},
      false,
      makeStubDataManager(),
      {targetUser: TARGET_USER},
      null,
    );
    return container;
  }

  function clickTab(container: HTMLElement, mode: string): void {
    const tab = container.querySelector(
      `.di-pie-tab[data-mode="${mode}"]`,
    ) as HTMLElement;
    expect(tab, `tab "${mode}" should exist`).not.toBeNull();
    tab.click();
  }

  it('announces a tab switch with the piestats cacheKey, not the tab name', async () => {
    // schedulePieRevalidate looks the starter up by cacheKey ('copyright_dist'),
    // so emitting the bare tab name would silently match nothing and that
    // tab would never revalidate.
    const container = mountPie();
    const seen: string[] = [];
    const onActivated = (e: Event) => {
      seen.push((e as CustomEvent).detail?.contentType);
    };
    window.addEventListener('DanbooruInsights:PieTabActivated', onActivated);

    clickTab(container, 'character');
    clickTab(container, 'status');

    window.removeEventListener('DanbooruInsights:PieTabActivated', onActivated);
    expect(seen).toEqual(['character_dist', 'status_dist']);
  });

  it('does not re-announce the tab already showing', async () => {
    // The pie opens on copyright; clicking it is not a switch, and firing
    // anyway would burn the app's fire-once starter for no reason.
    const container = mountPie();
    const onActivated = vi.fn();
    window.addEventListener('DanbooruInsights:PieTabActivated', onActivated);

    clickTab(container, 'copyright');

    window.removeEventListener('DanbooruInsights:PieTabActivated', onActivated);
    expect(onActivated).not.toHaveBeenCalled();
  });

  it('shows the Updating badge only while the visible tab is refreshing', async () => {
    const container = mountPie();
    const badge = container.querySelector(
      '.di-pie-updating-badge',
    ) as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.classList.contains('is-active')).toBe(false);

    const refreshing = (contentType: string, active: boolean) =>
      window.dispatchEvent(
        new CustomEvent('DanbooruInsights:PieTabRefreshing', {
          detail: {contentType, active},
        }),
      );

    // A background refresh of a tab the user is not looking at must stay
    // invisible — otherwise the badge claims the shown counts are pending.
    refreshing('character_dist', true);
    expect(badge.classList.contains('is-active')).toBe(false);

    refreshing('copyright_dist', true);
    expect(badge.classList.contains('is-active')).toBe(true);

    refreshing('copyright_dist', false);
    expect(badge.classList.contains('is-active')).toBe(false);
  });

  it('carries the badge over when switching to a tab still refreshing', async () => {
    const container = mountPie();
    const badge = container.querySelector(
      '.di-pie-updating-badge',
    ) as HTMLElement;

    window.dispatchEvent(
      new CustomEvent('DanbooruInsights:PieTabRefreshing', {
        detail: {contentType: 'character_dist', active: true},
      }),
    );
    expect(badge.classList.contains('is-active')).toBe(false);

    // Switching to it must adopt its in-flight state; the refresh started
    // before the switch and no further event is coming until it settles.
    clickTab(container, 'character');
    expect(badge.classList.contains('is-active')).toBe(true);
  });

  it('ignores refresh events for content types the pie does not show', () => {
    const container = mountPie();
    const badge = container.querySelector(
      '.di-pie-updating-badge',
    ) as HTMLElement;

    expect(() =>
      window.dispatchEvent(
        new CustomEvent('DanbooruInsights:PieTabRefreshing', {
          detail: {contentType: 'tag_cloud_general', active: true},
        }),
      ),
    ).not.toThrow();
    expect(badge.classList.contains('is-active')).toBe(false);
  });
});

describe('renderPieWidget — lazy tab loading', () => {
  // On a cold cache six tabs arrive without data and load when opened.
  // Hair_L / Hair_C had no branch in the on-open fetcher and silently
  // rendered "No data available".
  const FETCHER_BY_TAB: Record<string, keyof AnalyticsDataManager> = {
    character: 'getCharacterDistribution',
    fav_copyright: 'getFavCopyrightDistribution',
    status: 'getStatusDistribution',
    rating: 'getRatingDistribution',
    breasts: 'getBreastsDistribution',
    hair_length: 'getHairLengthDistribution',
    hair_color: 'getHairColorDistribution',
    gender: 'getGenderDistribution',
    commentary: 'getCommentaryDistribution',
    translation: 'getTranslationDistribution',
  };

  it('every tab without preloaded data fetches its own distribution on open', async () => {
    const dm = Object.fromEntries(
      Object.values(FETCHER_BY_TAB).map(m => [m, vi.fn(async () => [])]),
    ) as unknown as AnalyticsDataManager;
    const container = makeContainer();
    renderPieWidget(
      container,
      {copyright: []},
      true,
      dm,
      {targetUser: TARGET_USER},
      null,
    );

    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('.di-pie-tab'),
    )
      .map(b => b.getAttribute('data-mode') ?? '')
      .filter(mode => mode !== 'copyright');
    // Every rendered tab is covered by this table, so a new tab without a
    // fetch branch fails here too.
    expect(tabs.sort()).toEqual(Object.keys(FETCHER_BY_TAB).sort());

    for (const mode of tabs) {
      (
        container.querySelector(
          `.di-pie-tab[data-mode="${mode}"]`,
        ) as HTMLElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
      const fetcher = dm[FETCHER_BY_TAB[mode]] as ReturnType<typeof vi.fn>;
      expect(fetcher, `tab ${mode}`).toHaveBeenCalledTimes(1);
    }
  });
});

describe('pie legend — unknown slices (T-204)', () => {
  // A count the server would not give (422 over the viewer's tag limit, a
  // null) is an `unknown` slice: "—" in the legend, not a 0.0% that reads
  // as "none", and no share of the pie.
  const DATA = [
    {name: 'Commentary', tagName: 'commentary', count: 30},
    {name: 'Requested', tagName: 'commentary_request', count: 10},
    {name: 'Untagged', tagName: 'untagged_commentary', count: 0, unknown: true},
  ].map(d => ({...d, frequency: 0, thumb: null, isOther: false}));

  it('carries the flag into the slice details', () => {
    const slices = processSlices(DATA, 'commentary');
    expect(slices[2].details).toMatchObject({kind: 'tag', unknown: true});
    expect(slices[2].value).toBe(0);
  });

  it('shows "—" with an explanation instead of a percentage', () => {
    const legendDiv = document.createElement('div');
    renderPieLegend({
      legendDiv,
      processedData: processSlices(DATA, 'commentary'),
      currentPieTab: 'commentary',
      pctFor: label => (label === 'Commentary' ? '75.0%' : '25.0%'),
      normalizedName: 'fixture_user',
    });

    const rows = Array.from(
      legendDiv.querySelectorAll<HTMLElement>('div[style*="margin-left:auto"]'),
    );
    expect(rows.map(r => r.textContent)).toEqual(['75.0%', '25.0%', '—']);
    expect(rows[2].title).toMatch(/^Unknown/);
  });
});

describe('renderHistoryChart - month column click (CSP-safe)', () => {
  // Danbooru's CSP (2026-11-11) blocks inline `onclick` attributes, so the
  // month → search link must come from a real listener.
  const MONTHLY = [
    {date: '2024-01', count: 3, label: 'Jan 2024'},
    {date: '2024-02', count: 5, label: 'Feb 2024'},
  ];
  const STAR: MilestoneEntry = {
    milestone: 1,
    post: {
      id: 777,
      created_at: '2024-02-15T12:00:00Z',
      uploader_id: 42,
      rating: 'g',
    },
  };

  async function renderChart(milestones: MilestoneEntry[] = []) {
    const dm = {
      getMonthlyStats: vi.fn(async () => MONTHLY),
    } as unknown as AnalyticsDataManager;
    const container = makeContainer();
    await renderHistoryChart(
      container,
      dm,
      {targetUser: TARGET_USER},
      milestones,
      [],
    );
    return container;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders no inline event handler attributes', async () => {
    const container = await renderChart([STAR]);
    const withHandler = Array.from(container.querySelectorAll('*')).filter(el =>
      Array.from(el.attributes).some(a => /^on/i.test(a.name)),
    );
    expect(withHandler).toEqual([]);
  });

  it('opens the clicked month search in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const container = await renderChart();
    const columns = container.querySelectorAll('.month-column');
    expect(columns.length).toBe(2);

    columns[0]
      .querySelector('.column-overlay')!
      .dispatchEvent(new MouseEvent('click', {bubbles: true}));

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      '/posts?tags=user:fixture_user+date:2024-01-01...2024-02-01',
      '_blank',
    );
  });

  it('does not open a month search when a milestone star is clicked', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const container = await renderChart([STAR]);
    const star = Array.from(container.querySelectorAll('svg text')).find(t =>
      t.textContent?.includes('★'),
    );
    expect(star).toBeDefined();

    star!.dispatchEvent(new MouseEvent('click', {bubbles: true}));

    expect(open).not.toHaveBeenCalled();
  });
});

describe('renderPieLegend - "?" note when shares overlap', () => {
  // ootsu_mari and the rest co-occur: the top three are tagged 260 times
  // across 200 uploads, so the pie's shares (of 260) differ from
  // At a glance's (of 200).
  const CHARS = [
    {name: 'ootsu mari', tagName: 'ootsu_mari', count: 120},
    {name: 'coco', tagName: 'coco', count: 80},
    {name: 'tetia', tagName: 'tetia', count: 60},
  ].map(d => ({...d, frequency: 0, thumb: null, isOther: false}));

  function render(
    tab: string,
    data: typeof CHARS,
    uploadTotal?: number,
  ): HTMLElement {
    const legendDiv = document.createElement('div');
    renderPieLegend({
      legendDiv,
      processedData: processSlices(data, tab),
      currentPieTab: tab,
      pctFor: () => '46.2%',
      normalizedName: 'fixture_user',
      uploadTotal,
    });
    return legendDiv;
  }

  it('explains why the shares differ, beside the title', () => {
    const note = render('character', CHARS, 200).querySelector(
      '.di-pie-share-help',
    );
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('several characters');
    expect(note!.textContent).toContain('At a glance');
  });

  it('also appears on the copyright tab', () => {
    expect(
      render('copyright', CHARS, 200).querySelector('.di-pie-share-help'),
    ).not.toBeNull();
  });

  it('is absent when the top tags fit within the uploads', () => {
    // 260 tags ≤ 300 uploads: Others fills the rest, shares are of uploads.
    expect(
      render('character', CHARS, 300).querySelector('.di-pie-share-help'),
    ).toBeNull();
  });

  it('is absent without an upload total', () => {
    expect(
      render('character', CHARS).querySelector('.di-pie-share-help'),
    ).toBeNull();
  });

  it('is absent on tabs At a glance does not quote', () => {
    expect(
      render('fav_copyright', CHARS, 200).querySelector('.di-pie-share-help'),
    ).toBeNull();
  });
});

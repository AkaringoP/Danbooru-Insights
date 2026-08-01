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

import {renderPieWidget} from '../src/apps/user-analytics-charts';
import type {AnalyticsDataManager} from '../src/core/analytics-data-manager';
import type {TargetUser} from '../src/types';

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

// @vitest-environment jsdom

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

// CalHeatmap is shipped via @require / window-global in production. The
// graph-renderer references it as `(window as CalHeatmapAny).CalHeatmap`.
// JSDOM has no such global — we install a chainable mock that records
// paint/destroy invocations.
class MockCalHeatmap {
  paint = vi.fn(() => Promise.resolve(this));
  destroy = vi.fn();
  on = vi.fn();
}

// settings-popover drags in a lot of unrelated DOM/CSS at module evaluation
// time; renderGraph wires it up via createSettingsPopover. We stub the
// whole module so the smoke test stays focused on the graph plumbing.
vi.mock('../src/ui/settings-popover', () => ({
  createSettingsPopover: vi.fn(() => ({
    popover: document.createElement('div'),
    close: vi.fn(),
    refresh: vi.fn(),
  })),
  applyPopoverPalette: vi.fn(),
}));
vi.mock('../src/ui/approval-detail-popover', () => ({
  showApprovalsDetail: vi.fn(),
}));

import {GraphRenderer} from '../src/ui/graph-renderer';
import {SettingsManager} from '../src/core/settings';
import type {DataManager} from '../src/core/data-manager';
import type {Database} from '../src/core/database';
import type {MetricData} from '../src/types';

function makeDataManager(): DataManager {
  return {
    getGrassSettings: vi.fn(async () => null),
    saveGrassSettings: vi.fn(async () => {}),
  } as unknown as DataManager;
}

function buildProfileDom(): void {
  document.body.innerHTML = `
    <div id="page">
      <h1>fixture_user</h1>
      <div class="user-statistics">
        <table>
          <tbody><tr><th>Join Date</th><td>2020-01-01</td></tr></tbody>
        </table>
      </div>
    </div>
  `;
}

function installCalHeatmap(): typeof MockCalHeatmap {
  const w = window as unknown as {CalHeatmap?: unknown; cal?: unknown};
  w.CalHeatmap = MockCalHeatmap;
  w.cal = undefined;
  return MockCalHeatmap;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.clearAllMocks();
  installCalHeatmap();
});

afterEach(() => {
  document.body.innerHTML = '';
  const w = window as unknown as {CalHeatmap?: unknown; cal?: unknown};
  delete w.CalHeatmap;
  delete w.cal;
});

describe('GraphRenderer.injectSkeleton', () => {
  it('returns false when no injection point exists in the DOM', async () => {
    const gr = new GraphRenderer(new SettingsManager(), {} as Database);
    const result = await gr.injectSkeleton(makeDataManager(), '42');
    expect(result).toBe(false);
  });

  it('returns true and creates #danbooru-grass-container under .user-statistics', async () => {
    buildProfileDom();
    const gr = new GraphRenderer(new SettingsManager(), {} as Database);
    const result = await gr.injectSkeleton(makeDataManager(), '42');

    expect(result).toBe(true);
    expect(document.getElementById('danbooru-grass-container')).not.toBeNull();
    expect(document.getElementById('danbooru-grass-wrapper')).not.toBeNull();
    // The CalHeatmap mount point lives inside the container so renderGraph
    // can find it later.
    expect(document.getElementById('cal-heatmap')).not.toBeNull();
  });

  it('is idempotent — second call is a no-op that preserves the container', async () => {
    buildProfileDom();
    const gr = new GraphRenderer(new SettingsManager(), {} as Database);
    const dm = makeDataManager();

    await gr.injectSkeleton(dm, '42');
    const firstContainer = document.getElementById('danbooru-grass-container');
    expect(firstContainer).not.toBeNull();

    // Second call: no setup work — must not even fetch settings again.
    const result = await gr.injectSkeleton(dm, '42');
    expect(result).toBe(true);
    // Same node — re-injection would mint a fresh one.
    expect(document.getElementById('danbooru-grass-container')).toBe(
      firstContainer,
    );
    // The first call hits getGrassSettings once; the second call should
    // bail before reaching it.
    expect(dm.getGrassSettings).toHaveBeenCalledTimes(1);
  });

  it('reads per-user grass settings during the first injection', async () => {
    buildProfileDom();
    const dm = makeDataManager();
    const gr = new GraphRenderer(new SettingsManager(), {} as Database);
    await gr.injectSkeleton(dm, '42');
    expect(dm.getGrassSettings).toHaveBeenCalledWith('42');
  });

  it('creates the global tooltip element', async () => {
    buildProfileDom();
    const gr = new GraphRenderer(new SettingsManager(), {} as Database);
    await gr.injectSkeleton(makeDataManager(), '42');
    expect(document.getElementById('danbooru-grass-tooltip')).not.toBeNull();
  });
});

describe('GraphRenderer.renderGraph with mocked CalHeatmap', () => {
  function makeSampleData(): MetricData {
    return {
      daily: {
        '2026-01-01': 3,
        '2026-01-02': 7,
        '2026-01-03': 1,
      },
      hourly: new Array(24).fill(0),
    };
  }

  async function setupRenderer(): Promise<GraphRenderer> {
    buildProfileDom();
    const gr = new GraphRenderer(new SettingsManager(), {} as Database);
    await gr.injectSkeleton(makeDataManager(), '42');
    return gr;
  }

  it('returns early without painting when #cal-heatmap is missing (skeleton not yet injected)', async () => {
    // No skeleton — #cal-heatmap absent. The CalHeatmap *instance* is
    // still created (the constructor call sits above the container
    // lookup in renderGraph), but paint() must not fire because the
    // resulting heatmap would have nowhere to mount.
    const gr = new GraphRenderer(new SettingsManager(), {} as Database);
    await expect(
      gr.renderGraph(
        makeSampleData(),
        2026,
        'uploads',
        'fixture_user',
        [2026],
        () => {},
        () => {},
      ),
    ).resolves.toBeUndefined();

    const cal = (window as unknown as {cal?: MockCalHeatmap}).cal;
    expect(cal).toBeInstanceOf(MockCalHeatmap);
    expect(cal!.paint).not.toHaveBeenCalled();
  });

  it('updates the contribution-count header with the formatted total', async () => {
    const gr = await setupRenderer();
    await gr.renderGraph(
      makeSampleData(),
      2026,
      'uploads',
      'fixture_user',
      [2026, 2025],
      () => {},
      () => {},
    );
    const header = document.querySelector('#danbooru-grass-container h2');
    expect(header?.textContent).toContain('11 contributions in ');
  });

  it('renders the year-selector with one option per availableYears entry', async () => {
    const gr = await setupRenderer();
    await gr.renderGraph(
      makeSampleData(),
      2026,
      'uploads',
      'fixture_user',
      [2026, 2025, 2024],
      () => {},
      () => {},
    );
    const select = document.querySelector(
      '#danbooru-grass-container h2 select',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(Array.from(select.options).map(o => o.value)).toEqual([
      '2026',
      '2025',
      '2024',
    ]);
    expect(select.value).toBe('2026');
  });

  it('instantiates a CalHeatmap and calls paint() exactly once', async () => {
    const gr = await setupRenderer();
    await gr.renderGraph(
      makeSampleData(),
      2026,
      'uploads',
      'fixture_user',
      [2026],
      () => {},
      () => {},
    );

    const cal = (window as unknown as {cal?: MockCalHeatmap}).cal;
    expect(cal).toBeInstanceOf(MockCalHeatmap);
    expect(cal!.paint).toHaveBeenCalledTimes(1);
  });

  it('destroys the previous window.cal instance before re-painting', async () => {
    const gr = await setupRenderer();
    await gr.renderGraph(
      makeSampleData(),
      2026,
      'uploads',
      'fixture_user',
      [2026],
      () => {},
      () => {},
    );
    const firstCal = (window as unknown as {cal: MockCalHeatmap}).cal;

    await gr.renderGraph(
      makeSampleData(),
      2026,
      'uploads',
      'fixture_user',
      [2026],
      () => {},
      () => {},
    );
    const secondCal = (window as unknown as {cal: MockCalHeatmap}).cal;

    expect(firstCal.destroy).toHaveBeenCalledTimes(1);
    expect(secondCal).not.toBe(firstCal);
    expect(secondCal.paint).toHaveBeenCalledTimes(1);
  });
});

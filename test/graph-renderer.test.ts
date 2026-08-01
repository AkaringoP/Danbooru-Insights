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

// JSDOM's window carries `ontouchstart`, so isTouchDevice() reports true and
// the renderer wires its tap path. Pin it to false: these tests cover the
// desktop hover/dwell interaction, which has a dismissal lifecycle (linger →
// fade) that the tap path does not.
vi.mock('../src/ui/two-step-tap', async importActual => {
  const actual = await importActual<typeof import('../src/ui/two-step-tap')>();
  return {...actual, isTouchDevice: () => false};
});

// January's popover asks core for last December's total. Held under test
// control so the "lookup still in flight while the user moves on" window —
// the whole point of the generation / dismissal guards — can be opened at will.
const {resolvePrevDecemberTotal} = vi.hoisted(() => ({
  resolvePrevDecemberTotal: vi.fn(),
}));
vi.mock('../src/core/grass-prev-month', () => ({resolvePrevDecemberTotal}));

import {GraphRenderer} from '../src/ui/graph-renderer';
import {SettingsManager} from '../src/core/settings';
import {hideGrassMonthPopover} from '../src/ui/grass-month-popover';
import type {DataManager} from '../src/core/data-manager';
import type {Database} from '../src/core/database';
import type {MetricData, TargetUser} from '../src/types';

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

describe('GraphRenderer month popover — late December lookup', () => {
  const POPOVER_ID = '#danbooru-grass-month-popover';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** Matches HIDE_GRACE_MS + FADE_MS in grass-month-popover.ts. */
  const DISMISSAL_MS = 400 + 200;

  /** A promise the test resolves by hand, standing in for a slow lookup. */
  function deferred<T>(): {promise: Promise<T>; resolve: (v: T) => void} {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>(r => {
      resolve = r;
    });
    return {promise, resolve};
  }

  /** Drain the microtask queue so a resolved lookup's .then() has run. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  function headerText(): string | null {
    return (
      document.querySelector(`${POPOVER_ID} .di-gmp-header`)?.textContent ??
      null
    );
  }

  /**
   * Paint a graph, then stand in for the month labels CalHeatmap would have
   * inserted and let the post-paint wiring (300ms) find them.
   */
  async function paintWithLabels(
    daily: Record<string, number>,
  ): Promise<SVGTextElement[]> {
    buildProfileDom();
    const gr = new GraphRenderer(new SettingsManager(), {} as Database);
    await gr.injectSkeleton(makeDataManager(), '42');
    await gr.renderGraph(
      {daily, hourly: new Array(24).fill(0)},
      2026,
      'uploads',
      {name: 'fixture_user', id: '42'} as TargetUser,
      [2026],
      () => {},
      () => {},
    );
    // renderGraph resolves before paint()'s .then() runs, and that callback is
    // what schedules the post-paint wiring — so drain microtasks first, or the
    // 300ms timer does not exist yet to be advanced.
    await flush();

    const scroll = document.getElementById('cal-heatmap-scroll')!;
    const labels: SVGTextElement[] = [];
    for (let m = 0; m < 12; m++) {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('class', 'ch-domain-text');
      scroll.appendChild(label);
      labels.push(label as SVGTextElement);
    }
    vi.advanceTimersByTime(300);
    return labels;
  }

  /** Hover a label and wait out the 200ms dwell that opens the popover. */
  function hover(label: SVGTextElement): void {
    label.dispatchEvent(new MouseEvent('mouseover'));
    vi.advanceTimersByTime(200);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // 2026 is wholly in the past relative to this clock, so every month gets a
    // complete series no matter when the suite actually runs.
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
  });

  afterEach(() => {
    hideGrassMonthPopover();
    vi.useRealTimers();
  });

  it('patches January in place once December resolves', async () => {
    resolvePrevDecemberTotal.mockResolvedValue(4);
    const labels = await paintWithLabels({'2026-01-10': 5});

    hover(labels[0]);
    // Opens with the total only — December is not in the loaded year.
    expect(headerText()).toContain('January 2026');
    expect(document.querySelector(`${POPOVER_ID} .di-gmp-mom`)).toBeNull();

    await flush();

    // 5 vs 4 → +25%. The guards must not block the case they exist for.
    const mom = document.querySelector(`${POPOVER_ID} .di-gmp-mom`);
    expect(mom?.textContent).toContain('25%');
    expect(mom?.textContent).toContain('vs December');
  });

  it('drops the patch when another month has taken over the popover', async () => {
    const december = deferred<number | null>();
    resolvePrevDecemberTotal.mockReturnValue(december.promise);
    const labels = await paintWithLabels({'2026-01-10': 5, '2026-03-10': 9});

    hover(labels[0]);
    expect(headerText()).toContain('January 2026');

    // Pointer moves on before the lookup lands. Re-hovering cancels the
    // pending dismissal, so only the generation guard can catch this.
    labels[0].dispatchEvent(new MouseEvent('mouseout'));
    hover(labels[2]);
    expect(headerText()).toContain('March 2026');

    december.resolve(3);
    await flush();

    // March's popover must not be rewritten with January's numbers, under
    // January's anchor.
    expect(headerText()).toContain('March 2026');
    expect(headerText()).not.toContain('January');
  });

  it('lets a dismissal finish instead of resurrecting the popover', async () => {
    const december = deferred<number | null>();
    resolvePrevDecemberTotal.mockReturnValue(december.promise);
    const labels = await paintWithLabels({'2026-01-10': 5});

    hover(labels[0]);
    expect(document.querySelector(POPOVER_ID)).not.toBeNull();

    // Pointer leaves: linger → fade → removal is now scheduled, and the
    // mouseout that scheduled it will never fire again.
    labels[0].dispatchEvent(new MouseEvent('mouseout'));
    december.resolve(3);
    await flush();

    // Re-showing here would clear those timers and strand the popover open.
    vi.advanceTimersByTime(DISMISSAL_MS);
    expect(document.querySelector(POPOVER_ID)).toBeNull();
  });
});

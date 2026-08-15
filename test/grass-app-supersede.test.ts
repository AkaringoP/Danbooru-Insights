// @vitest-environment jsdom
/**
 * Issue #4 regression: rapidly switching metric/year while GrassApp is
 * loading must not render the previous selection's data under the new
 * selection's labels.
 *
 * The bug: `updateView()` read the shared `currentMetric`/`currentYear`
 * bindings *after* awaiting `getMetricData`, so a run that lost the race
 * painted its (old) data with the (new) labels — an uploads-labelled graph
 * showing approvals counts. The fix snapshots the selection per run and
 * supersedes stale runs via a generation token.
 */
import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {Mock} from 'vitest';

vi.mock('../src/core/data-manager', () => ({DataManager: vi.fn()}));
vi.mock('../src/ui/graph-renderer', () => ({GraphRenderer: vi.fn()}));

import {DataManager} from '../src/core/data-manager';
import {GraphRenderer} from '../src/ui/graph-renderer';
import {GrassApp} from '../src/apps/grass-app';
import type {Database} from '../src/core/database';
import type {SettingsManager} from '../src/core/settings';
import type {ProfileContext} from '../src/core/profile-context';
import type {MetricData} from '../src/types';

interface Deferred {
  promise: Promise<MetricData>;
  resolve: (v: MetricData) => void;
}

function deferred(): Deferred {
  let resolve!: (v: MetricData) => void;
  const promise = new Promise<MetricData>(r => (resolve = r));
  return {promise, resolve};
}

/** Flushes pending microtasks + timers so awaits inside run() settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
}

describe('GrassApp updateView supersede (issue #4)', () => {
  // One deferred per getMetricData call, keyed by call order.
  let fetchCalls: Array<{metric: string; year: number; d: Deferred}>;
  let renderGraph: Mock;
  let updateControls: Mock;
  let setLoading: Mock;
  let renderError: Mock;

  function makeDataManagerStub() {
    return {
      getMetricData: vi.fn((metric: string, _u: unknown, year: number) => {
        const d = deferred();
        fetchCalls.push({metric, year, d});
        return d.promise;
      }),
      fetchPromotionDate: vi.fn(async () => null),
      clearCache: vi.fn(async () => undefined),
    };
  }

  function makeRendererStub() {
    return {
      injectSkeleton: vi.fn(async () => true),
      renderGraph,
      updateControls,
      setLoading,
      renderError,
    };
  }

  const uploadsData = {daily: {'2026-08-01': 672}} as unknown as MetricData;
  const approvalsData = {daily: {'2026-08-01': 15}} as unknown as MetricData;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls = [];

    // `new DataManager(...)` requires a constructible implementation, so
    // pass hoisted function declarations by reference (arrow fns can't be
    // `new`ed, and gts fix rewrites inline `function` expressions into
    // arrows via prefer-arrow-callback).
    (DataManager as unknown as Mock).mockImplementation(makeDataManagerStub);

    renderGraph = vi.fn(async () => undefined);
    updateControls = vi.fn();
    setLoading = vi.fn();
    renderError = vi.fn();
    (GraphRenderer as unknown as Mock).mockImplementation(makeRendererStub);

    // The post-render auto-tune block is out of scope here.
    vi.spyOn(GrassApp.prototype, 'maybeRunScheduledAutoTune').mockResolvedValue(
      true,
    );
  });

  function makeApp(): GrassApp {
    const settings = {
      getLastMode: vi.fn(() => 'uploads'),
      setLastMode: vi.fn(),
    } as unknown as SettingsManager;
    const context = {
      targetUser: {id: 1, name: 'tester', joinDate: new Date('2020-01-15')},
    } as unknown as ProfileContext;
    return new GrassApp({} as unknown as Database, settings, context);
  }

  it('discards a stale run instead of rendering old data under new labels', async () => {
    const app = makeApp();
    await app.run();
    await flush();

    // Run #1 (uploads) is now parked on its getMetricData await.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].metric).toBe('uploads');

    // User switches to approvals while uploads is still loading.
    const onMetricChange = updateControls.mock.calls[0][4] as (
      m: string,
    ) => void;
    onMetricChange('approvals');
    await flush();
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].metric).toBe('approvals');

    // The uploads fetch loses the race and resolves late.
    fetchCalls[0].d.resolve(uploadsData);
    await flush();

    // The stale run must not have painted: no renderGraph call carries the
    // uploads payload, in particular not one labelled 'approvals' (the
    // exact corruption from issue #4).
    const dataCalls = renderGraph.mock.calls.filter(c => c[0] === uploadsData);
    expect(dataCalls).toEqual([]);
    // And it must not clear the spinner the approvals run still owns.
    expect(setLoading).not.toHaveBeenCalledWith(false);

    // The approvals fetch completes → that run paints, correctly labelled.
    fetchCalls[1].d.resolve(approvalsData);
    await flush();

    const finalCall = renderGraph.mock.calls.find(c => c[0] === approvalsData);
    expect(finalCall).toBeDefined();
    expect(finalCall![2]).toBe('approvals');
    expect(setLoading).toHaveBeenCalledWith(false);
    expect(renderError).not.toHaveBeenCalled();
  });

  it('renders normally when no switch happens mid-load', async () => {
    const app = makeApp();
    await app.run();
    await flush();

    fetchCalls[0].d.resolve(uploadsData);
    await flush();

    const finalCall = renderGraph.mock.calls.find(c => c[0] === uploadsData);
    expect(finalCall).toBeDefined();
    expect(finalCall![2]).toBe('uploads');
    expect(setLoading).toHaveBeenCalledWith(false);
  });

  it('last selection wins across several rapid switches', async () => {
    const app = makeApp();
    await app.run();
    await flush();

    const onMetricChange = updateControls.mock.calls[0][4] as (
      m: string,
    ) => void;
    onMetricChange('notes');
    await flush();
    onMetricChange('uploads');
    await flush();
    expect(fetchCalls.map(c => c.metric)).toEqual([
      'uploads',
      'notes',
      'uploads',
    ]);

    // Resolve out of order: the two stale runs land after the switching
    // stopped, the newest run last.
    fetchCalls[1].d.resolve(approvalsData); // stale (notes run)
    fetchCalls[0].d.resolve(approvalsData); // stale (first uploads run)
    await flush();
    expect(renderGraph.mock.calls.filter(c => c[0] === approvalsData)).toEqual(
      [],
    );

    fetchCalls[2].d.resolve(uploadsData); // current
    await flush();
    const finalCall = renderGraph.mock.calls.find(c => c[0] === uploadsData);
    expect(finalCall).toBeDefined();
    expect(finalCall![2]).toBe('uploads');
  });
});

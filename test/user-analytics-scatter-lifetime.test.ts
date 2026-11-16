// @vitest-environment jsdom

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

// jsdom reads as a touch device, where drag selection (the `mousemove` /
// `mouseup` listeners) is not wired at all.
vi.mock('../src/ui/two-step-tap', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../src/ui/two-step-tap')>();
  return {...actual, isTouchDevice: vi.fn(() => false)};
});

import {renderScatterPlot} from '../src/apps/user-analytics-scatter';
import type {ChartContext} from '../src/apps/user-analytics-charts';
import type {ScatterDataPoint} from '../src/types';

/**
 * A scatter plot listens on `window` / `document` and appends its popover
 * and Y=10 tooltip to `<body>`. The dashboard re-renders on every open, so
 * what a plot holds outside its own subtree has to go when the plot does.
 */
describe('renderScatterPlot — released when it leaves the document', () => {
  const CONTEXT = {
    targetUser: {
      name: 'fixture_user',
      normalizedName: 'fixture_user',
      id: '42',
    },
  } as unknown as ChartContext;
  const POINTS: ScatterDataPoint[] = [
    {id: 1, d: Date.UTC(2024, 0, 1), s: 5, t: 20, r: 'g'},
    {id: 2, d: Date.UTC(2025, 0, 1), s: 9, t: 30, r: 's'},
  ];

  interface Registration {
    target: 'window' | 'document';
    type: string;
    signal: AbortSignal | undefined;
  }
  let registrations: Registration[];

  beforeEach(() => {
    document.body.innerHTML = '';
    registrations = [];
    for (const [name, target] of [
      ['window', window],
      ['document', document],
    ] as const) {
      const original = target.addEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation(
        (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) => {
          registrations.push({
            target: name,
            type,
            signal: typeof options === 'object' ? options.signal : undefined,
          });
          original(type, listener, options);
        },
      );
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function mount(): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderScatterPlot(container, POINTS, CONTEXT, []);
    return container;
  }

  /** The plot's own global listeners (two-step-tap's are released apart). */
  const plotListeners = () =>
    registrations.filter(
      r =>
        (r.target === 'window' &&
          ['mousemove', 'mouseup', 'resize'].includes(r.type)) ||
        (r.target === 'document' && r.type === 'mousedown') ||
        (r.target === 'document' && r.type === 'click' && r.signal),
    );

  it('keeps its global listeners while it is in the document', () => {
    mount();

    window.dispatchEvent(new Event('mousemove'));

    const listeners = plotListeners();
    expect(listeners.map(l => `${l.target}:${l.type}`).sort()).toEqual([
      'document:click',
      'document:mousedown',
      'window:mousemove',
      'window:mouseup',
      'window:resize',
    ]);
    expect(listeners.every(l => l.signal && !l.signal.aborted)).toBe(true);
    expect(document.querySelectorAll('#scatter-popover-ui')).toHaveLength(1);
  });

  it('drops them, and its nodes on <body>, once it has left', () => {
    const container = mount();
    const bodyNodesWithPlot = document.body.children.length;

    // What a dashboard re-render does to the previous open's plot.
    container.remove();
    window.dispatchEvent(new Event('mousemove'));

    const listeners = plotListeners();
    expect(listeners).toHaveLength(5);
    expect(listeners.every(l => l.signal?.aborted)).toBe(true);
    expect(document.querySelectorAll('#scatter-popover-ui')).toHaveLength(0);
    // The container, the popover and the Y=10 tooltip are gone.
    expect(document.body.children.length).toBe(bodyNodesWithPlot - 3);
  });

  it('leaves one popover on <body> after a second open', () => {
    mount().remove();
    mount();

    window.dispatchEvent(new Event('mousemove'));

    expect(document.querySelectorAll('#scatter-popover-ui')).toHaveLength(1);
  });

  it('is not released by an event that arrives before it is attached', () => {
    const container = document.createElement('div');
    renderScatterPlot(container, POINTS, CONTEXT, []);

    window.dispatchEvent(new Event('mousemove'));
    document.body.appendChild(container);
    window.dispatchEvent(new Event('mousemove'));

    expect(plotListeners().every(l => l.signal && !l.signal.aborted)).toBe(
      true,
    );
  });
});

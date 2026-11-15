import {afterEach, describe, expect, it, vi} from 'vitest';
import {GrassLoadGate} from '../src/core/grass-load-gate';

describe('GrassLoadGate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts off and follows set()', () => {
    const gate = new GrassLoadGate();
    expect(gate.isLoading()).toBe(false);
    gate.set(true);
    expect(gate.isLoading()).toBe(true);
    gate.set(false);
    expect(gate.isLoading()).toBe(false);
  });

  it('tells listeners about changes only, until unsubscribed', () => {
    const gate = new GrassLoadGate();
    const seen: boolean[] = [];
    const unsubscribe = gate.subscribe(v => seen.push(v));

    gate.set(true);
    gate.set(true); // no change
    gate.set(false);
    unsubscribe();
    gate.set(true);

    expect(seen).toEqual([true, false]);
  });

  it('reports how long it has been on', () => {
    vi.useFakeTimers();
    const gate = new GrassLoadGate();
    expect(gate.loadingForMs()).toBe(0);
    gate.set(true);
    vi.advanceTimersByTime(250);
    expect(gate.loadingForMs()).toBe(250);
    gate.set(false);
    expect(gate.loadingForMs()).toBe(0);
  });
});

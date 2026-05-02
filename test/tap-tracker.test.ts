import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {TapTracker} from '../src/ui/two-step-tap';

const touchEvent = (
  list: 'touches' | 'changedTouches',
  x: number,
  y: number,
): TouchEvent => {
  const t = {clientX: x, clientY: y} as Touch;
  return {
    [list]: [t],
    touches: list === 'touches' ? [t] : [],
    changedTouches: list === 'changedTouches' ? [t] : [],
  } as unknown as TouchEvent;
};

const empty = (list: 'touches' | 'changedTouches'): TouchEvent =>
  ({
    [list]: [],
    touches: [],
    changedTouches: [],
  }) as unknown as TouchEvent;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('TapTracker', () => {
  it('start + end at same spot within 600ms is a tap', () => {
    const t = new TapTracker();
    t.onTouchStart(touchEvent('touches', 100, 100));
    vi.advanceTimersByTime(150);
    expect(t.onTouchEnd(touchEvent('changedTouches', 102, 99))).toBe(true);
  });

  it('move beyond 10px cancels the tap (treated as scroll/swipe)', () => {
    const t = new TapTracker();
    t.onTouchStart(touchEvent('touches', 100, 100));
    t.onTouchMove(touchEvent('touches', 100, 115)); // 15px down
    expect(t.isTracking).toBe(false);
    expect(t.onTouchEnd(touchEvent('changedTouches', 100, 115))).toBe(false);
  });

  it('move within 10px does not cancel the tap', () => {
    const t = new TapTracker();
    t.onTouchStart(touchEvent('touches', 100, 100));
    t.onTouchMove(touchEvent('touches', 105, 95));
    expect(t.isTracking).toBe(true);
    expect(t.onTouchEnd(touchEvent('changedTouches', 108, 93))).toBe(true);
  });

  it('end-position drift > 10px cancels even without touchmove', () => {
    const t = new TapTracker();
    t.onTouchStart(touchEvent('touches', 100, 100));
    expect(t.onTouchEnd(touchEvent('changedTouches', 100, 120))).toBe(false);
  });

  it('long-press past 600ms is not a tap', () => {
    const t = new TapTracker();
    t.onTouchStart(touchEvent('touches', 100, 100));
    vi.advanceTimersByTime(800);
    expect(t.onTouchEnd(touchEvent('changedTouches', 100, 100))).toBe(false);
  });

  it('end without prior start returns false (synthetic-event guard)', () => {
    const t = new TapTracker();
    expect(t.onTouchEnd(touchEvent('changedTouches', 100, 100))).toBe(false);
  });

  it('end always clears state; second end after a single start is no-op', () => {
    const t = new TapTracker();
    t.onTouchStart(touchEvent('touches', 100, 100));
    expect(t.onTouchEnd(touchEvent('changedTouches', 100, 100))).toBe(true);
    expect(t.onTouchEnd(touchEvent('changedTouches', 100, 100))).toBe(false);
  });

  it('start with no touches resets in-flight tap (defensive)', () => {
    const t = new TapTracker();
    t.onTouchStart(touchEvent('touches', 100, 100));
    t.onTouchStart(empty('touches'));
    expect(t.isTracking).toBe(false);
  });

  it('exact 10px / 600ms boundaries are inclusive (≤)', () => {
    const t = new TapTracker();
    t.onTouchStart(touchEvent('touches', 100, 100));
    vi.advanceTimersByTime(600);
    expect(t.onTouchEnd(touchEvent('changedTouches', 110, 110))).toBe(true);
  });
});

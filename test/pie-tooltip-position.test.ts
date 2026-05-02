import {describe, it, expect} from 'vitest';
import {pickFittingPosition} from '../src/apps/user-analytics-pie-helpers';

const bounds = {minLeft: 0, maxRight: 360, minTop: 0, maxBottom: 600};

describe('pickFittingPosition', () => {
  it('returns the first candidate that fits', () => {
    const out = pickFittingPosition(
      [
        {left: -50, top: 100}, // overflows minLeft
        {left: 50, top: 100}, // fits
        {left: 200, top: 100}, // also fits but lower priority
      ],
      120,
      80,
      bounds,
    );
    expect(out).toEqual({left: 50, top: 100});
  });

  it('skips candidates that overflow the right edge', () => {
    const out = pickFittingPosition(
      [
        {left: 250, top: 100}, // 250+120=370 > 360
        {left: 230, top: 100}, // 230+120=350 ≤ 360 ✓
      ],
      120,
      80,
      bounds,
    );
    expect(out).toEqual({left: 230, top: 100});
  });

  it('skips candidates that overflow the bottom edge', () => {
    const out = pickFittingPosition(
      [
        {left: 50, top: 550}, // 550+80=630 > 600
        {left: 50, top: 500}, // 500+80=580 ≤ 600 ✓
      ],
      120,
      80,
      bounds,
    );
    expect(out).toEqual({left: 50, top: 500});
  });

  it('returns null when no candidate fits — caller applies fallback clamp', () => {
    const out = pickFittingPosition(
      [
        {left: -10, top: 0}, // negative left
        {left: 250, top: 100}, // right overflow
        {left: 50, top: 700}, // bottom overflow
      ],
      120,
      80,
      bounds,
    );
    expect(out).toBeNull();
  });

  it('respects exact-edge equality (≤ not <)', () => {
    // 240 + 120 = 360 = maxRight → should fit (≤).
    const out = pickFittingPosition([{left: 240, top: 520}], 120, 80, bounds);
    expect(out).toEqual({left: 240, top: 520});
  });

  it('priority order: 4-quadrant before wrapper-center fallback', () => {
    // Simulates a tap where touch-relative quadrant 4 (bottom-right) fits
    // but quadrants 1-3 don't — the helper should still prefer 4 over the
    // wrapper-center fallback that comes later.
    const out = pickFittingPosition(
      [
        {left: -50, top: -50}, // q1 overflows top/left
        {left: 250, top: -50}, // q2 overflows top
        {left: -50, top: 100}, // q3 overflows left
        {left: 50, top: 100}, // q4 fits ✓
        {left: 100, top: -50}, // wrapper-center top — would have overflowed
        {left: 100, top: 540}, // wrapper-center bottom — also fits
      ],
      120,
      80,
      bounds,
    );
    expect(out).toEqual({left: 50, top: 100});
  });
});

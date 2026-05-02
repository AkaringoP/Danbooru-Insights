import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {createTwoStepTap} from '../src/ui/two-step-tap';

beforeEach(() => {
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createTwoStepTap navigateOnSameTap', () => {
  it('default (true): second tap on same datum triggers onSecondTap', () => {
    const onFirstTap = vi.fn();
    const onSecondTap = vi.fn();
    const ctrl = createTwoStepTap<string>({
      insideElements: () => [],
      onFirstTap,
      onSecondTap,
      onReset: vi.fn(),
    });

    expect(ctrl.tap('a')).toBe(false);
    expect(onFirstTap).toHaveBeenCalledTimes(1);
    expect(onSecondTap).not.toHaveBeenCalled();

    expect(ctrl.tap('a')).toBe(true);
    expect(onSecondTap).toHaveBeenCalledTimes(1);
    expect(ctrl.active).toBeNull();
  });

  it('false: second tap on same datum is a no-op (preview persists)', () => {
    const onFirstTap = vi.fn();
    const onSecondTap = vi.fn();
    const ctrl = createTwoStepTap<string>({
      insideElements: () => [],
      onFirstTap,
      onSecondTap,
      onReset: vi.fn(),
      navigateOnSameTap: false,
    });

    expect(ctrl.tap('a')).toBe(false);
    expect(onFirstTap).toHaveBeenCalledTimes(1);

    // Second tap on same datum: no navigation, no extra onFirstTap call,
    // active datum stays set.
    expect(ctrl.tap('a')).toBe(false);
    expect(onSecondTap).not.toHaveBeenCalled();
    expect(onFirstTap).toHaveBeenCalledTimes(1);
    expect(ctrl.active).toBe('a');
  });

  it('false: navigateActive() still works (tooltip-tap navigation path)', () => {
    const onSecondTap = vi.fn();
    const ctrl = createTwoStepTap<string>({
      insideElements: () => [],
      onFirstTap: vi.fn(),
      onSecondTap,
      onReset: vi.fn(),
      navigateOnSameTap: false,
    });

    ctrl.tap('a');
    expect(ctrl.navigateActive()).toBe(true);
    expect(onSecondTap).toHaveBeenCalledWith('a');
    expect(ctrl.active).toBeNull();
  });

  it('false: switching to a different datum still fires onFirstTap', () => {
    const onFirstTap = vi.fn();
    const onSecondTap = vi.fn();
    const ctrl = createTwoStepTap<string>({
      insideElements: () => [],
      onFirstTap,
      onSecondTap,
      onReset: vi.fn(),
      navigateOnSameTap: false,
    });

    ctrl.tap('a');
    ctrl.tap('b');
    expect(onFirstTap).toHaveBeenCalledTimes(2);
    expect(onSecondTap).not.toHaveBeenCalled();
    expect(ctrl.active).toBe('b');
  });
});

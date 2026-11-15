// @vitest-environment jsdom
/**
 * Keyed toasts: a message shown again while it is still on screen keeps the
 * one toast up instead of stacking a copy (the 📊 lock toast, clicked again
 * and again while Grass loads).
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

type ToastModule = typeof import('../src/ui/toast');

let showToast: ToastModule['showToast'];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0));
  document.body.innerHTML = '';
  // Fresh module state (container, active and keyed toasts) per test.
  vi.resetModules();
  ({showToast} = await import('../src/ui/toast'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const toasts = () => document.querySelectorAll('.di-toast');

describe('showToast — key', () => {
  it('shows one toast for repeated calls with the same key', () => {
    showToast({type: 'info', message: 'Wait.', key: 'lock'});
    showToast({type: 'info', message: 'Wait.', key: 'lock'});
    showToast({type: 'info', message: 'Wait.', key: 'lock'});

    expect(toasts()).toHaveLength(1);
  });

  it('a repeat restarts the timer of the one on screen', () => {
    showToast({type: 'info', message: 'Wait.', key: 'lock', duration: 3000});
    vi.advanceTimersByTime(2000);
    showToast({type: 'info', message: 'Wait.', key: 'lock', duration: 3000});

    vi.advanceTimersByTime(2000); // 4 s after the first, 2 s after the repeat
    expect(toasts()).toHaveLength(1);

    vi.advanceTimersByTime(1000 + 350); // the repeat's 3 s, then the exit
    expect(toasts()).toHaveLength(0);
  });

  it('shows a new one once the keyed toast is gone', () => {
    showToast({type: 'info', message: 'Wait.', key: 'lock', duration: 1000});
    vi.advanceTimersByTime(1000 + 350);
    expect(toasts()).toHaveLength(0);

    showToast({type: 'info', message: 'Wait.', key: 'lock', duration: 1000});
    expect(toasts()).toHaveLength(1);
  });

  it('stacks toasts without a key, and different keys apart', () => {
    showToast({type: 'info', message: 'A.'});
    showToast({type: 'info', message: 'A.'});
    showToast({type: 'info', message: 'B.', key: 'b'});
    showToast({type: 'info', message: 'C.', key: 'c'});

    expect(toasts()).toHaveLength(4);
  });
});

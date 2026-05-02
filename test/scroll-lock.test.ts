import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
  lockBodyScroll,
  unlockBodyScroll,
  _resetScrollLockForTests,
} from '../src/core/scroll-lock';

const makeStyle = () => ({
  position: '',
  top: '',
  width: '',
  overflow: '',
});

beforeEach(() => {
  _resetScrollLockForTests();
  const bodyStyle = makeStyle();
  const htmlStyle = makeStyle();
  vi.stubGlobal('document', {
    body: {style: bodyStyle},
    documentElement: {style: htmlStyle},
  });
  vi.stubGlobal('window', {
    scrollY: 0,
    scrollTo: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetScrollLockForTests();
});

describe('scroll-lock', () => {
  it('lock applies fixed-position freeze with saved scrollY', () => {
    (globalThis as unknown as {window: {scrollY: number}}).window.scrollY = 432;

    lockBodyScroll();

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-432px');
    expect(document.body.style.width).toBe('100%');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('unlock restores prior styles and scroll position', () => {
    document.body.style.position = 'relative';
    document.body.style.overflow = 'visible';
    document.documentElement.style.overflow = 'auto';
    (globalThis as unknown as {window: {scrollY: number}}).window.scrollY = 250;

    lockBodyScroll();
    unlockBodyScroll();

    expect(document.body.style.position).toBe('relative');
    expect(document.body.style.top).toBe('');
    expect(document.body.style.width).toBe('');
    expect(document.body.style.overflow).toBe('visible');
    expect(document.documentElement.style.overflow).toBe('auto');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 250);
  });

  it('nested locks: second lock is a no-op, only the outermost unlock restores', () => {
    (globalThis as unknown as {window: {scrollY: number}}).window.scrollY = 100;

    lockBodyScroll();
    expect(document.body.style.position).toBe('fixed');
    const topAfterFirst = document.body.style.top;

    // Second lock should NOT overwrite saved scrollY (would lose origin
    // position after the inner unlock).
    (globalThis as unknown as {window: {scrollY: number}}).window.scrollY = 999;
    lockBodyScroll();
    expect(document.body.style.top).toBe(topAfterFirst);

    // First inner unlock — body still locked.
    unlockBodyScroll();
    expect(document.body.style.position).toBe('fixed');
    expect(window.scrollTo).not.toHaveBeenCalled();

    // Outer unlock — fully restored, scroll restored to original.
    unlockBodyScroll();
    expect(document.body.style.position).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 100);
  });

  it('unlock without preceding lock is a safe no-op', () => {
    expect(() => unlockBodyScroll()).not.toThrow();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

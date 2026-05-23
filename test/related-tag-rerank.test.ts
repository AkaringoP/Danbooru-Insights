import {describe, it, expect} from 'vitest';
import {
  selectTopKByCount,
  charPoolSize,
  copyPoolSize,
  type FreqCandidate,
} from '../src/core/related-tag-rerank';

const mk = (
  tagName: string,
  count: number,
  frequency: number,
): FreqCandidate => ({
  name: tagName.replace(/_/g, ' '),
  tagName,
  count,
  frequency,
});

describe('selectTopKByCount', () => {
  it('reorders by count desc when frequency disagrees', () => {
    const out = selectTopKByCount(
      [mk('a', 100, 0.5), mk('b', 200, 0.4), mk('c', 50, 0.6)],
      3,
    );
    expect(out.map(c => c.tagName)).toEqual(['b', 'a', 'c']);
  });

  it('breaks count ties by frequency desc', () => {
    const out = selectTopKByCount(
      [mk('a', 100, 0.2), mk('b', 100, 0.9), mk('c', 100, 0.5)],
      3,
    );
    expect(out.map(c => c.tagName)).toEqual(['b', 'c', 'a']);
  });

  it('breaks count+frequency ties by tagName asc (deterministic)', () => {
    const out = selectTopKByCount(
      [mk('zeta', 50, 0.1), mk('alpha', 50, 0.1), mk('mu', 50, 0.1)],
      3,
    );
    expect(out.map(c => c.tagName)).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('returns fewer than k when input is short', () => {
    const out = selectTopKByCount([mk('a', 10, 0.1), mk('b', 20, 0.2)], 5);
    expect(out.map(c => c.tagName)).toEqual(['b', 'a']);
  });

  it('returns [] for empty input', () => {
    expect(selectTopKByCount([], 10)).toEqual([]);
  });

  it('places count=0 candidates last (fallback for failed fetches)', () => {
    const out = selectTopKByCount(
      [mk('failed', 0, 0.9), mk('ok', 5, 0.1), mk('mid', 50, 0.5)],
      3,
    );
    expect(out.map(c => c.tagName)).toEqual(['mid', 'ok', 'failed']);
  });

  it('does not mutate the input array', () => {
    const input = [mk('a', 1, 0.1), mk('b', 5, 0.5), mk('c', 3, 0.3)];
    const before = input.map(c => c.tagName);
    selectTopKByCount(input, 2);
    expect(input.map(c => c.tagName)).toEqual(before);
  });

  it('clamps k=0 to []', () => {
    expect(selectTopKByCount([mk('a', 1, 0.1)], 0)).toEqual([]);
  });

  it('clamps negative k to []', () => {
    expect(selectTopKByCount([mk('a', 1, 0.1)], -3)).toEqual([]);
  });
});

describe('charPoolSize', () => {
  it.each([
    [0, 10, 15],
    [1, 10, 15],
    [5_000, 10, 15],
    [5_001, 15, 23],
    [10_000, 15, 23],
    [10_001, 20, 30],
    [20_000, 20, 30],
    [20_001, 25, 38],
    [40_000, 25, 38],
    [40_001, 35, 53],
    [70_000, 35, 53],
    [70_001, 45, 68],
    [110_000, 45, 68],
    [110_001, 55, 83],
    [160_000, 55, 83],
    [160_001, 65, 98],
    [250_000, 65, 98],
    [250_001, 75, 113],
    [500_000, 75, 113],
    [500_001, 80, 120],
    [1_000_000, 80, 120],
  ])('N=%i → filtered=%i, raw=%i', (n, filtered, raw) => {
    expect(charPoolSize(n)).toEqual({filtered, raw});
  });

  it('Unbreakable case (N=276_000) → {75, 113}', () => {
    expect(charPoolSize(276_000)).toEqual({filtered: 75, raw: 113});
  });

  it('defensive: negative N treated as 0', () => {
    expect(charPoolSize(-1)).toEqual({filtered: 10, raw: 15});
  });

  it('defensive: NaN N treated as 0', () => {
    expect(charPoolSize(Number.NaN)).toEqual({filtered: 10, raw: 15});
  });
});

describe('copyPoolSize', () => {
  it.each([
    [0, 10, 15],
    [1, 10, 15],
    [5_000, 10, 15],
    [5_001, 12, 18],
    [10_000, 12, 18],
    [10_001, 15, 23],
    [20_000, 15, 23],
    [20_001, 18, 27],
    [40_000, 18, 27],
    [40_001, 22, 33],
    [70_000, 22, 33],
    [70_001, 26, 39],
    [110_000, 26, 39],
    [110_001, 30, 45],
    [160_000, 30, 45],
    [160_001, 34, 51],
    [250_000, 34, 51],
    [250_001, 37, 56],
    [500_000, 37, 56],
    [500_001, 40, 60],
    [1_000_000, 40, 60],
  ])('N=%i → filtered=%i, raw=%i', (n, filtered, raw) => {
    expect(copyPoolSize(n)).toEqual({filtered, raw});
  });

  it('Unbreakable case (N=276_000) → {37, 56}', () => {
    expect(copyPoolSize(276_000)).toEqual({filtered: 37, raw: 56});
  });

  it('defensive: negative N treated as 0', () => {
    expect(copyPoolSize(-1)).toEqual({filtered: 10, raw: 15});
  });
});

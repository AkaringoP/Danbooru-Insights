import {describe, it, expect} from 'vitest';
import {numericExtent, replaceArrayContents} from '../src/utils';

// Past the ~124k argument limit that `Math.min(...xs)` / `xs.push(...ys)`
// hit in Chrome and Node (audit DA-05).
const BIG = 150_000;

describe('numericExtent', () => {
  it('returns min and max of a list larger than the spread limit', () => {
    const values = Array.from({length: BIG}, (_, i) => i - 7);
    expect(numericExtent(values)).toEqual({min: -7, max: BIG - 8});
  });

  it('matches Math.min()/Math.max() on empty input', () => {
    expect(numericExtent([])).toEqual({min: Infinity, max: -Infinity});
  });

  it('accepts any iterable', () => {
    expect(numericExtent(new Set([3, 1, 2]))).toEqual({min: 1, max: 3});
  });
});

describe('replaceArrayContents', () => {
  it('replaces in place, keeping the array identity', () => {
    const target = [1, 2, 3];
    const ref = target;
    replaceArrayContents(target, [9]);
    expect(target).toBe(ref);
    expect(target).toEqual([9]);
  });

  it('copies a source larger than the spread limit', () => {
    const target = [0];
    const source = Array.from({length: BIG}, (_, i) => i);
    replaceArrayContents(target, source);
    expect(target.length).toBe(BIG);
    expect(target[BIG - 1]).toBe(BIG - 1);
  });
});

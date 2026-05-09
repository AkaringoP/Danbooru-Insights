import {describe, it, expect} from 'vitest';
import {computePercentages} from '../src/apps/user-analytics-pie-helpers';

const sumPct = (parts: string[]): number =>
  parts.reduce((acc, p) => acc + parseFloat(p), 0);

describe('computePercentages', () => {
  it('returns empty array for empty input', () => {
    expect(computePercentages([])).toEqual([]);
  });

  it('renders single slice as 100.0%', () => {
    expect(computePercentages([42])).toEqual(['100.0%']);
  });

  it('returns 0.0% for each entry when total is 0', () => {
    expect(computePercentages([0, 0, 0])).toEqual(['0.0%', '0.0%', '0.0%']);
  });

  it('three near-equal thirds sum to exactly 100%', () => {
    const parts = computePercentages([3334, 3333, 3333]);
    expect(sumPct(parts)).toBeCloseTo(100, 5);
    expect(parts.length).toBe(3);
  });

  it('six equal sixths sum to exactly 100% (no 102% overshoot)', () => {
    const parts = computePercentages([1, 1, 1, 1, 1, 1]);
    expect(sumPct(parts)).toBeCloseTo(100, 5);
  });

  it('three equal thirds sum to exactly 100%', () => {
    const parts = computePercentages([1, 1, 1]);
    expect(sumPct(parts)).toBeCloseTo(100, 5);
  });

  it('decimals=0 renders integers and still sums to 100', () => {
    const parts = computePercentages([1, 1, 1], 0);
    expect(sumPct(parts)).toBeCloseTo(100, 5);
    parts.forEach(p => expect(p).toMatch(/^\d+%$/));
  });

  it('largest-remainder picks the largest fractional parts first', () => {
    // values 50, 30, 20 → exact 50.0 / 30.0 / 20.0 (no rounding needed)
    expect(computePercentages([50, 30, 20])).toEqual([
      '50.0%',
      '30.0%',
      '20.0%',
    ]);
  });

  it('preserves array length even when zeros are present', () => {
    const parts = computePercentages([10, 0, 0, 5]);
    expect(parts).toHaveLength(4);
    expect(sumPct(parts)).toBeCloseTo(100, 5);
    expect(parts[1]).toBe('0.0%');
    expect(parts[2]).toBe('0.0%');
  });

  it('rejects NaN/Infinity by treating them as 0', () => {
    const parts = computePercentages([NaN, Infinity, 1]);
    expect(parts).toEqual(['0.0%', '0.0%', '100.0%']);
  });

  it('handles many slices precisely', () => {
    const parts = computePercentages(Array(7).fill(1));
    expect(sumPct(parts)).toBeCloseTo(100, 5);
  });
});

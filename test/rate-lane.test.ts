import {describe, it, expect} from 'vitest';
import {
  LANE_MAX_IN_FLIGHT,
  RateLane,
  parseXRateLimit,
} from '../src/core/rate-lane';

const header = (points: number, rate = 1, burst = 15) =>
  JSON.stringify({
    action: 'counts:posts',
    rate,
    burst,
    cost: 1,
    minimum_points: -30,
    enabled: true,
    limits: {'user/1': points + 3, 'ip/1.2.3.0/24': points},
  });

describe('parseXRateLimit', () => {
  it('reads rate, burst, cost and the binding (lowest) key', () => {
    expect(parseXRateLimit(header(4))).toEqual({
      action: 'counts:posts',
      rate: 1,
      burst: 15,
      cost: 1,
      lowest: 4,
    });
  });

  it('rejects missing or unusable headers', () => {
    expect(parseXRateLimit(null)).toBeNull();
    expect(parseXRateLimit('<html>')).toBeNull();
    expect(parseXRateLimit('{"rate":0,"limits":{"a":1}}')).toBeNull();
    expect(parseXRateLimit('{"rate":1,"limits":{}}')).toBeNull();
  });
});

describe('RateLane', () => {
  const counts = {rate: 1, burst: 15};

  it('spends the burst, keeping one point in reserve, then 1 per second', () => {
    const lane = new RateLane('counts', counts, 0);
    let sent = 0;
    while (lane.waitMs(0) === 0) {
      lane.onSend(0);
      lane.onResponse(0, 0, null);
      sent++;
    }
    expect(sent).toBe(14);
    expect(lane.waitMs(0)).toBe(1000);
  });

  it('holds new requests while its in-flight slots are full', () => {
    const lane = new RateLane('counts', counts, 0);
    for (let i = 0; i < LANE_MAX_IN_FLIGHT; i++) lane.onSend(0);
    expect(lane.waitMs(0)).toBe(Infinity);
    lane.onResponse(10, 0, null);
    expect(lane.waitMs(10)).toBe(0);
  });

  it('subtracts requests sent after the one whose header arrived', () => {
    const lane = new RateLane('counts', counts, 0);
    lane.onSend(0);
    lane.onSend(100);
    // The server had 5 points left after the first request; the second is
    // already charged there but not in this header.
    lane.onResponse(1000, 0, header(5));
    expect(lane.pointsAt(1000)).toBeCloseTo(5 + 1 - 1);
  });

  it('ignores a header older than one already applied', () => {
    const lane = new RateLane('counts', counts, 0);
    lane.onSend(0);
    lane.onSend(500);
    lane.onResponse(600, 500, header(10));
    lane.onResponse(700, 0, header(-20)); // stale, from the earlier request
    expect(lane.pointsAt(700)).toBeCloseTo(10 + 0.2);
  });

  it('waits out a negative balance before sending again', () => {
    const lane = new RateLane('counts', counts, 0);
    lane.onSend(0);
    lane.onResponse(0, 0, header(-9));
    // Needs 2 points (cost + reserve): 11 s at 1 point/s.
    expect(lane.waitMs(0)).toBe(11_000);
  });
});

import {describe, it, expect} from 'vitest';
import {getBestThumbnailUrl} from '../src/utils';
import {
  isBackfillInCooldown,
  recordFailure,
  shouldCountHttpAsFailure,
  backfillFailureStorageKey,
  BACKFILL_FAILURE_THRESHOLD,
  BACKFILL_COOLDOWN_MS,
  type BackfillFailureState,
} from '../src/core/analytics-data-manager';

describe('getBestThumbnailUrl', () => {
  it('빈 post(null)이면 빈 문자열 반환', () => {
    expect(getBestThumbnailUrl(null)).toBe('');
  });

  it('variants에 720x720 webp가 있으면 그 URL 반환', () => {
    const post = {
      variants: [
        {type: '360x360', file_ext: 'webp', url: 'http://example.com/360.webp'},
        {type: '720x720', file_ext: 'webp', url: 'http://example.com/720.webp'},
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/720.webp');
  });

  it('720x720 webp 없으면 360x360 webp 반환', () => {
    const post = {
      variants: [
        {type: '360x360', file_ext: 'webp', url: 'http://example.com/360.webp'},
        {type: '720x720', file_ext: 'jpg', url: 'http://example.com/720.jpg'},
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/360.webp');
  });

  it('webp 없으면 preferred type(720x720) 중 첫 번째 반환', () => {
    const post = {
      variants: [
        {type: '720x720', file_ext: 'jpg', url: 'http://example.com/720.jpg'},
        {type: '360x360', file_ext: 'png', url: 'http://example.com/360.png'},
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/720.jpg');
  });

  it('preferred type 없으면 첫 번째 variant URL 반환', () => {
    const post = {
      variants: [
        {
          type: 'original',
          file_ext: 'png',
          url: 'http://example.com/original.png',
        },
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/original.png');
  });

  it('variants가 빈 배열이면 preview_file_url fallback', () => {
    const post = {
      variants: [],
      preview_file_url: 'http://example.com/preview.jpg',
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/preview.jpg');
  });

  it('variants 없으면 file_url fallback', () => {
    const post = {
      file_url: 'http://example.com/file.jpg',
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/file.jpg');
  });

  it('모든 fallback 없으면 빈 문자열', () => {
    expect(getBestThumbnailUrl({})).toBe('');
  });
});

// ============================================================
// Task 4 — Backfill error recovery: threshold + cooldown logic
// ============================================================
//
// These tests cover the pure functions exported from analytics-data-manager
// (isBackfillInCooldown, recordFailure, shouldCountHttpAsFailure,
// backfillFailureStorageKey). They intentionally do NOT exercise the class
// methods or the Dexie/RateLimiter integration — that would require full
// mocks for the data layer, which is out of scope for this task. The pure
// helpers carry the entire decision logic, so testing them is sufficient
// per the acceptance criterion.

describe('isBackfillInCooldown', () => {
  it('returns false when state is null (never failed)', () => {
    expect(isBackfillInCooldown(null, Date.now())).toBe(false);
  });

  it('returns false when failureCount is below threshold', () => {
    const state: BackfillFailureState = {
      failureCount: BACKFILL_FAILURE_THRESHOLD - 1,
      lastAttemptAt: Date.now(),
    };
    expect(isBackfillInCooldown(state, Date.now())).toBe(false);
  });

  it('returns true when failureCount equals threshold and within window', () => {
    const now = 1_000_000_000_000;
    const state: BackfillFailureState = {
      failureCount: BACKFILL_FAILURE_THRESHOLD,
      lastAttemptAt: now - 1000, // 1 second ago
    };
    expect(isBackfillInCooldown(state, now)).toBe(true);
  });

  it('returns true when failureCount exceeds threshold and within window', () => {
    const now = 1_000_000_000_000;
    const state: BackfillFailureState = {
      failureCount: 10,
      lastAttemptAt: now - 60 * 60 * 1000, // 1 hour ago
    };
    expect(isBackfillInCooldown(state, now)).toBe(true);
  });

  it('returns false when cooldown window has elapsed', () => {
    const now = 1_000_000_000_000;
    const state: BackfillFailureState = {
      failureCount: 5,
      lastAttemptAt: now - (BACKFILL_COOLDOWN_MS + 1000), // just past 24h
    };
    expect(isBackfillInCooldown(state, now)).toBe(false);
  });

  it('returns true at the exact boundary of the cooldown window', () => {
    // (now - lastAttemptAt) === BACKFILL_COOLDOWN_MS - 1ms → still inside
    const now = 1_000_000_000_000;
    const state: BackfillFailureState = {
      failureCount: BACKFILL_FAILURE_THRESHOLD,
      lastAttemptAt: now - (BACKFILL_COOLDOWN_MS - 1),
    };
    expect(isBackfillInCooldown(state, now)).toBe(true);
  });

  it('returns false at exactly cooldown duration (boundary is exclusive)', () => {
    // The check is `now - lastAttemptAt < COOLDOWN_MS`. Equal → not less.
    const now = 1_000_000_000_000;
    const state: BackfillFailureState = {
      failureCount: BACKFILL_FAILURE_THRESHOLD,
      lastAttemptAt: now - BACKFILL_COOLDOWN_MS,
    };
    expect(isBackfillInCooldown(state, now)).toBe(false);
  });
});

describe('recordFailure', () => {
  it('returns count 1 when starting from null state', () => {
    const next = recordFailure(null, 12345);
    expect(next.failureCount).toBe(1);
    expect(next.lastAttemptAt).toBe(12345);
  });

  it('increments failureCount from existing state', () => {
    const prev: BackfillFailureState = {
      failureCount: 2,
      lastAttemptAt: 1000,
    };
    const next = recordFailure(prev, 5000);
    expect(next.failureCount).toBe(3);
    expect(next.lastAttemptAt).toBe(5000);
  });

  it('does not mutate the previous state', () => {
    const prev: BackfillFailureState = {
      failureCount: 1,
      lastAttemptAt: 1000,
    };
    recordFailure(prev, 9999);
    expect(prev).toEqual({failureCount: 1, lastAttemptAt: 1000});
  });
});

describe('shouldCountHttpAsFailure', () => {
  it('does NOT count 429 as a hard failure (rate-limiter handles it)', () => {
    expect(shouldCountHttpAsFailure(429)).toBe(false);
  });

  it('counts 500 as a hard failure', () => {
    expect(shouldCountHttpAsFailure(500)).toBe(true);
  });

  it('counts 503 as a hard failure', () => {
    expect(shouldCountHttpAsFailure(503)).toBe(true);
  });

  it('counts 404 as a hard failure', () => {
    expect(shouldCountHttpAsFailure(404)).toBe(true);
  });

  it('counts 401 as a hard failure', () => {
    expect(shouldCountHttpAsFailure(401)).toBe(true);
  });
});

describe('backfillFailureStorageKey', () => {
  it('produces a per-user storage key', () => {
    expect(backfillFailureStorageKey(123)).toBe('di_backfill_failure_123');
    expect(backfillFailureStorageKey(456)).toBe('di_backfill_failure_456');
  });

  it('does not collide with the post-metadata-v2 completion flag key', () => {
    // Sanity check: the failure-state key must not accidentally overlap with
    // the existing completion flag key `di_post_metadata_v2_${id}`. They
    // store different things and clearing one must not affect the other.
    const failureKey = backfillFailureStorageKey(789);
    const completionKey = 'di_post_metadata_v2_789';
    expect(failureKey).not.toBe(completionKey);
  });
});

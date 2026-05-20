/**
 * Sanity tests for v9.6.0 widget-gate constants.
 *
 * The actual gating *behaviour* is covered indirectly:
 *  - placeholder DOM rendering: `test/widget-locked-placeholder.test.ts`
 *  - Lift filter integration:   `test/global-tag-stats.test.ts`
 *
 * This file pins the two constants so that an accidental change (e.g. a
 * thoughtless lint auto-fix or copy-paste) shows up in CI as a deliberate
 * decision — both numbers came from a design discussion (Tag Cloud 100,
 * Scatter 300; see `docs/v10/DanbooruInsights v10: 위젯별 설정
 * Customizing 설계 보고서.md` for rationale).
 */
import {describe, it, expect} from 'vitest';
import {
  TAG_CLOUD_MIN_UPLOADS,
  SCATTER_MIN_UPLOADS,
} from '../src/apps/widget-gates';

describe('widget-gates constants (v9.6.0)', () => {
  it('Tag Cloud unlocks at 100 uploads', () => {
    expect(TAG_CLOUD_MIN_UPLOADS).toBe(100);
  });

  it('Scatter Plot unlocks at 300 uploads', () => {
    expect(SCATTER_MIN_UPLOADS).toBe(300);
  });

  it('Scatter threshold is stricter than Tag Cloud (more data needed for patterns)', () => {
    expect(SCATTER_MIN_UPLOADS).toBeGreaterThan(TAG_CLOUD_MIN_UPLOADS);
  });
});

import {describe, it, expect} from 'vitest';
import {CONFIG} from '../src/config';
import type {Theme} from '../src/types';

/** Every ramp a user could end up looking at, in resolveLevels' order. */
function selectableRamps(theme: Theme): Array<string[] | undefined> {
  return theme.grassOptions?.length
    ? theme.grassOptions.map(o => o.levels)
    : [theme.levels];
}

describe('CONFIG', () => {
  describe('THEMES', () => {
    const requiredFields = ['name', 'bg', 'empty', 'text'];

    Object.entries(CONFIG.THEMES).forEach(([key, theme]) => {
      it(`theme "${key}" has all required fields`, () => {
        for (const field of requiredFields) {
          expect(theme).toHaveProperty(field);
        }
      });
    });

    // A theme supplies its ramp one of two ways — a bare `levels`, or one
    // entry per `grassOptions` palette — and `SettingsManager.resolveLevels`
    // prefers grassOptions whenever they exist. So checking `levels` alone
    // only covers the two themes that have it; every *selectable* ramp is
    // what actually has to be five long, since the legend and the popover
    // charts index [0..4] directly and a short one paints `undefined`.
    Object.entries(CONFIG.THEMES).forEach(([key, theme]) => {
      const ramps = selectableRamps(theme);
      it(`theme "${key}" resolves to a 5-color ramp`, () => {
        expect(ramps.length).toBeGreaterThan(0);
        for (const ramp of ramps) {
          expect(ramp).toHaveLength(5);
        }
      });
    });
  });

  it('ANALYTICS_CLEANUP_THRESHOLD_MS equals 14 days in milliseconds', () => {
    // The retention window cleanupStaleData enforces on other users' rows.
    expect(CONFIG.ANALYTICS_CLEANUP_THRESHOLD_MS).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
  });

  it('STORAGE_PREFIX is correct', () => {
    expect(CONFIG.STORAGE_PREFIX).toBe('danbooru_contrib_');
  });
});

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {SettingsManager} from '../src/core/settings';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    _peek: () => store,
  };
})();

beforeEach(() => {
  localStorageMock.clear();
  vi.stubGlobal('localStorage', localStorageMock);
});

describe('SettingsManager — per-profile thresholds', () => {
  describe('getThresholdsForView()', () => {
    it('falls back to global when no per-profile entry exists', () => {
      const sm = new SettingsManager();
      expect(sm.getThresholdsForView('user_42', 'uploads')).toEqual([
        1, 10, 25, 50,
      ]);
    });

    it('returns per-profile override when set', () => {
      const sm = new SettingsManager();
      sm.setProfileThresholds('user_42', 'uploads', [1, 5, 12, 30]);
      expect(sm.getThresholdsForView('user_42', 'uploads')).toEqual([
        1, 5, 12, 30,
      ]);
    });

    it('falls back to global for a different userId', () => {
      const sm = new SettingsManager();
      sm.setProfileThresholds('user_42', 'uploads', [1, 5, 12, 30]);
      expect(sm.getThresholdsForView('user_99', 'uploads')).toEqual([
        1, 10, 25, 50,
      ]);
    });

    it('returns global for unset metric on a profile that has other overrides', () => {
      const sm = new SettingsManager();
      sm.setProfileThresholds('user_42', 'uploads', [1, 5, 12, 30]);
      // approvals is NOT overridden — should fall through.
      expect(sm.getThresholdsForView('user_42', 'approvals')).toEqual([
        10, 50, 100, 150,
      ]);
    });
  });

  describe('setProfileThresholds()', () => {
    it('persists across instance recreations', () => {
      const sm1 = new SettingsManager();
      sm1.setProfileThresholds('user_42', 'uploads', [1, 4, 11, 24]);
      const sm2 = new SettingsManager();
      expect(sm2.getThresholdsForView('user_42', 'uploads')).toEqual([
        1, 4, 11, 24,
      ]);
    });

    it('does not affect global thresholds (orthogonal)', () => {
      const sm = new SettingsManager();
      sm.setProfileThresholds('user_42', 'uploads', [1, 4, 11, 24]);
      expect(sm.getThresholds('uploads')).toEqual([1, 10, 25, 50]);
    });

    it('keeps other metrics on the same profile untouched', () => {
      const sm = new SettingsManager();
      sm.setProfileThresholds('user_42', 'uploads', [1, 4, 11, 24]);
      sm.setProfileThresholds('user_42', 'approvals', [1, 18, 48, 110]);
      expect(sm.getThresholdsForView('user_42', 'uploads')).toEqual([
        1, 4, 11, 24,
      ]);
      expect(sm.getThresholdsForView('user_42', 'approvals')).toEqual([
        1, 18, 48, 110,
      ]);
    });
  });

  describe('clearProfileThreshold()', () => {
    it('removes a single metric override and leaves siblings intact', () => {
      const sm = new SettingsManager();
      sm.setProfileThresholds('user_42', 'uploads', [1, 4, 11, 24]);
      sm.setProfileThresholds('user_42', 'approvals', [1, 18, 48, 110]);
      sm.clearProfileThreshold('user_42', 'uploads');
      expect(sm.hasProfileThresholds('user_42', 'uploads')).toBe(false);
      expect(sm.hasProfileThresholds('user_42', 'approvals')).toBe(true);
      // uploads now falls through to global, approvals stays overridden.
      expect(sm.getThresholdsForView('user_42', 'uploads')).toEqual([
        1, 10, 25, 50,
      ]);
      expect(sm.getThresholdsForView('user_42', 'approvals')).toEqual([
        1, 18, 48, 110,
      ]);
    });

    it('drops the userId entry entirely when the last metric is cleared', () => {
      const sm = new SettingsManager();
      sm.setProfileThresholds('user_42', 'uploads', [1, 4, 11, 24]);
      sm.clearProfileThreshold('user_42', 'uploads');
      expect(sm.hasProfileThresholds('user_42')).toBe(false);
    });

    it('is a no-op when no override exists', () => {
      const sm = new SettingsManager();
      // Should not throw.
      sm.clearProfileThreshold('user_42', 'uploads');
      expect(sm.hasProfileThresholds('user_42')).toBe(false);
    });
  });

  describe('hasProfileThresholds()', () => {
    it('returns false when no override exists', () => {
      const sm = new SettingsManager();
      expect(sm.hasProfileThresholds('user_42')).toBe(false);
    });

    it('returns true when any override exists for the userId', () => {
      const sm = new SettingsManager();
      sm.setProfileThresholds('user_42', 'uploads', [1, 4, 11, 24]);
      expect(sm.hasProfileThresholds('user_42')).toBe(true);
    });

    it('checks per-metric when metric arg supplied', () => {
      const sm = new SettingsManager();
      sm.setProfileThresholds('user_42', 'uploads', [1, 4, 11, 24]);
      expect(sm.hasProfileThresholds('user_42', 'uploads')).toBe(true);
      expect(sm.hasProfileThresholds('user_42', 'approvals')).toBe(false);
    });
  });

  describe('global setThresholds() vs per-profile orthogonality', () => {
    it('global setThresholds does not touch per-profile overrides', () => {
      const sm = new SettingsManager();
      sm.setProfileThresholds('user_42', 'uploads', [1, 4, 11, 24]);
      sm.setThresholds('uploads', [2, 20, 50, 100]);
      // Global got the new values…
      expect(sm.getThresholds('uploads')).toEqual([2, 20, 50, 100]);
      // …but the per-profile override is unchanged.
      expect(sm.getThresholdsForView('user_42', 'uploads')).toEqual([
        1, 4, 11, 24,
      ]);
    });
  });

  describe('autoTuneSchedule', () => {
    it('returns default (disabled, semiannual) when nothing is stored', () => {
      const sm = new SettingsManager();
      expect(sm.getAutoTuneSchedule()).toEqual({
        enabled: false,
        interval: 'semiannual',
      });
    });

    it('persists explicit schedule across instances', () => {
      const sm1 = new SettingsManager();
      sm1.setAutoTuneSchedule({enabled: true, interval: 'quarterly'});
      const sm2 = new SettingsManager();
      expect(sm2.getAutoTuneSchedule()).toEqual({
        enabled: true,
        interval: 'quarterly',
      });
    });
  });

  describe('perProfileTuneTimes', () => {
    it('returns 0 when no tune time recorded', () => {
      const sm = new SettingsManager();
      expect(sm.getProfileTuneTime('user_42', 'uploads')).toBe(0);
    });

    it('persists per (userId, metric) and survives reload', () => {
      const sm1 = new SettingsManager();
      sm1.setProfileTuneTime('user_42', 'uploads', 1700000000000);
      const sm2 = new SettingsManager();
      expect(sm2.getProfileTuneTime('user_42', 'uploads')).toBe(1700000000000);
      // Other metric on the same profile is independent.
      expect(sm2.getProfileTuneTime('user_42', 'approvals')).toBe(0);
    });

    it('keeps siblings intact when one metric is updated', () => {
      const sm = new SettingsManager();
      sm.setProfileTuneTime('user_42', 'uploads', 1700000000000);
      sm.setProfileTuneTime('user_42', 'approvals', 1700000999999);
      sm.setProfileTuneTime('user_42', 'uploads', 1700001234567);
      expect(sm.getProfileTuneTime('user_42', 'uploads')).toBe(1700001234567);
      expect(sm.getProfileTuneTime('user_42', 'approvals')).toBe(1700000999999);
    });
  });

  describe('migration', () => {
    it('handles legacy settings without perProfileThresholds field', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({
          theme: 'midnight',
          thresholds: {
            uploads: [1, 10, 25, 50],
            approvals: [10, 50, 100, 150],
            notes: [1, 10, 20, 30],
          },
          rememberedModes: {},
        }),
      );
      const sm = new SettingsManager();
      expect(sm.hasProfileThresholds('user_42')).toBe(false);
      // Subsequent set still works.
      sm.setProfileThresholds('user_42', 'uploads', [1, 4, 11, 24]);
      expect(sm.getThresholdsForView('user_42', 'uploads')).toEqual([
        1, 4, 11, 24,
      ]);
    });
  });
});

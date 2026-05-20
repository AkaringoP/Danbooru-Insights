import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  SettingsManager,
  getCountCacheTtlMin,
  getCountCacheTtlMs,
  setCountCacheTtlMin,
} from '../src/core/settings';

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
  };
})();

beforeEach(() => {
  localStorageMock.clear();
  vi.stubGlobal('localStorage', localStorageMock);
});

describe('SettingsManager', () => {
  describe('load()', () => {
    it('returns defaults when localStorage is empty', () => {
      const sm = new SettingsManager();
      expect(sm.getTheme()).toBe('light');
      expect(sm.getThresholds('uploads')).toEqual([1, 10, 25, 50]);
      expect(sm.getThresholds('approvals')).toEqual([10, 50, 100, 150]);
    });

    it('migrates remembered_modes to rememberedModes', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({remembered_modes: {'123': 'uploads'}}),
      );
      const sm = new SettingsManager();
      expect(sm.getLastMode('123')).toBe('uploads');
    });

    it('does not overwrite existing rememberedModes', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({rememberedModes: {'456': 'approvals'}}),
      );
      const sm = new SettingsManager();
      expect(sm.getLastMode('456')).toBe('approvals');
    });

    it('deep-merges saved thresholds with defaults', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({thresholds: {uploads: [2, 20, 50, 100]}}),
      );
      const sm = new SettingsManager();
      expect(sm.getThresholds('uploads')).toEqual([2, 20, 50, 100]);
      expect(sm.getThresholds('approvals')).toEqual([10, 50, 100, 150]); // default preserved
    });

    it('falls back to defaults on JSON parse error', () => {
      localStorageMock.setItem('danbooru_contrib_settings', 'invalid json{{{');
      const sm = new SettingsManager();
      expect(sm.getTheme()).toBe('light');
      expect(sm.getThresholds('uploads')).toEqual([1, 10, 25, 50]);
    });
  });

  describe('getTheme()', () => {
    it('returns saved theme when valid', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({theme: 'midnight'}),
      );
      const sm = new SettingsManager();
      expect(sm.getTheme()).toBe('midnight');
    });

    it('falls back to light for invalid theme key', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({theme: 'nonexistent_theme'}),
      );
      const sm = new SettingsManager();
      expect(sm.getTheme()).toBe('light');
    });
  });

  describe('setThresholds() / getThresholds()', () => {
    it('saves and retrieves custom thresholds', () => {
      const sm = new SettingsManager();
      sm.setThresholds('uploads', [5, 20, 50, 100]);
      expect(sm.getThresholds('uploads')).toEqual([5, 20, 50, 100]);
    });

    it('preserves other metrics when one is updated', () => {
      const sm = new SettingsManager();
      sm.setThresholds('notes', [2, 8, 15, 25]);
      expect(sm.getThresholds('approvals')).toEqual([10, 50, 100, 150]); // unchanged
    });
  });

  describe('setLastMode() / getLastMode()', () => {
    it('stores and retrieves mode per user', () => {
      const sm = new SettingsManager();
      sm.setLastMode('user123', 'approvals');
      expect(sm.getLastMode('user123')).toBe('approvals');
    });

    it('returns null for unknown user', () => {
      const sm = new SettingsManager();
      expect(sm.getLastMode('unknown')).toBeNull();
    });
  });

  describe('getSyncThreshold() / setSyncThreshold()', () => {
    it('returns default sync threshold of 5', () => {
      const sm = new SettingsManager();
      expect(sm.getSyncThreshold()).toBe(5);
    });

    it('stores and retrieves custom sync threshold', () => {
      const sm = new SettingsManager();
      sm.setSyncThreshold(10);
      expect(sm.getSyncThreshold()).toBe(10);
    });
  });
});

// ---------------------------------------------------------------------------
// v9.6 count-cache TTL preference (shared by both analytics popovers)
// ---------------------------------------------------------------------------

describe('Count-cache TTL preference (v9.6)', () => {
  it('defaults to 10 minutes when unset', () => {
    expect(getCountCacheTtlMin()).toBe(10);
  });

  it('getCountCacheTtlMs returns minutes × 60_000', () => {
    expect(getCountCacheTtlMs()).toBe(10 * 60_000);
    setCountCacheTtlMin(15);
    expect(getCountCacheTtlMs()).toBe(15 * 60_000);
  });

  it('persists and reads back a custom TTL', () => {
    setCountCacheTtlMin(30);
    expect(getCountCacheTtlMin()).toBe(30);
  });

  it('clamps writes below 1 minute up to 1', () => {
    setCountCacheTtlMin(0);
    expect(getCountCacheTtlMin()).toBe(1);
    setCountCacheTtlMin(-5);
    expect(getCountCacheTtlMin()).toBe(1);
  });

  it('floors fractional minutes (Math.floor)', () => {
    setCountCacheTtlMin(7.9);
    expect(getCountCacheTtlMin()).toBe(7);
  });

  it('falls back to default when stored value is non-numeric', () => {
    // Bypass the setter (which would clamp) to simulate a corrupt prefs blob.
    localStorageMock.setItem('di.count_cache_ttl_min', 'banana');
    expect(getCountCacheTtlMin()).toBe(10);
  });

  it('falls back to default when stored value is below 1', () => {
    // Direct write to test the read-side guard; the setter would clamp first.
    localStorageMock.setItem('di.count_cache_ttl_min', '0');
    expect(getCountCacheTtlMin()).toBe(10);
  });
});

/**
 * Grass cache sweep (T-606, decision G-6): a user's Grass cache unopened
 * for 90 days is dropped once a day, never the user on screen.
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {DataManager, GRASS_CACHE_RETENTION_MS} from '../src/core/data-manager';
import type {TargetUser} from '../src/types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 16);

const GRASS_TABLES = [
  'uploads',
  'approvals',
  'approvals_detail',
  'notes',
  'completed_years',
  'hourly_stats',
];

/** Grass tables holding rows of the given user ids; records deletions. */
function makeDb(
  rowsByTable: Record<string, string[]>,
  meta: Map<number, Record<string, unknown>>,
) {
  const deleted: Array<[string, string]> = [];
  const db: Record<string, unknown> = {
    sync_meta: {
      get: async (k: number) => meta.get(k),
      put: async (r: Record<string, unknown>) => {
        meta.set(r.userId as number, r);
      },
    },
    transaction: async (_m: string, _t: unknown, cb: () => Promise<void>) =>
      cb(),
  };
  for (const name of GRASS_TABLES) {
    const userIds = rowsByTable[name] ?? [];
    db[name] = {
      orderBy: () => ({uniqueKeys: async () => [...new Set(userIds)]}),
      where: () => ({
        equals: (uid: string) => ({
          primaryKeys: async () =>
            userIds.filter(u => u === uid).map((u, i) => `${u}_${i}`),
        }),
      }),
      bulkDelete: async (keys: string[]) => {
        for (const k of keys) deleted.push([name, k]);
      },
    };
  }
  return {db, deleted};
}

let storage: Map<string, string>;

beforeEach(() => {
  vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sweepGrassCache (T-606)', () => {
  it('drops only users unopened past 90 days, never the one on screen', async () => {
    const meta = new Map<number, Record<string, unknown>>([
      [42, {userId: 42, lastVisitedAt: NOW - 200 * DAY}], // on screen
      [7, {userId: 7, lastVisitedAt: NOW - GRASS_CACHE_RETENTION_MS - DAY}],
      [8, {userId: 8, lastVisitedAt: NOW - 10 * DAY}],
    ]);
    const {db, deleted} = makeDb(
      {
        uploads: ['42', '7', '8', '9', 'someone'],
        approvals: ['7'],
        hourly_stats: ['7', '7', '8'],
      },
      meta,
    );

    const dropped = await new DataManager(db, {} as never).sweepGrassCache(
      '42',
      NOW,
    );

    expect(dropped).toBe(1);
    expect(deleted).toEqual([
      ['uploads', '7_0'],
      ['approvals', '7_0'],
      ['hourly_stats', '7_0'],
      ['hourly_stats', '7_1'],
    ]);
    // Cached before visits were recorded: its 90 days start now.
    expect(meta.get(9)).toEqual({userId: 9, lastVisitedAt: NOW});
    // Known only by name: no sync_meta row to keep a visit in.
    expect([...meta.keys()].sort()).toEqual([42, 7, 8, 9].sort());
  });

  it('runs once a day', async () => {
    const meta = new Map<number, Record<string, unknown>>([
      [7, {userId: 7, lastVisitedAt: NOW - 100 * DAY}],
    ]);
    const {db, deleted} = makeDb({uploads: ['7']}, meta);
    const dm = new DataManager(db, {} as never);

    expect(await dm.sweepGrassCache('42', NOW)).toBe(1);
    expect(await dm.sweepGrassCache('42', NOW + 3_600_000)).toBe(0);
    expect(deleted).toHaveLength(1);
    // A day on, it is due again (the fake still holds the row).
    expect(await dm.sweepGrassCache('42', NOW + DAY + 1)).toBe(1);
  });
});

describe('noteGrassVisit (T-606)', () => {
  it('records the visit for a numeric id only', async () => {
    const meta = new Map<number, Record<string, unknown>>();
    const {db} = makeDb({}, meta);
    const dm = new DataManager(db, {} as never);
    const user = (id: string | null): TargetUser => ({
      name: 'someone',
      normalizedName: 'someone',
      id,
      created_at: '2020-01-01T00:00:00Z',
      joinDate: new Date('2020-01-01'),
      level_string: 'Member',
    });

    await dm.noteGrassVisit(user('42'), NOW);
    await dm.noteGrassVisit(user(null), NOW);

    expect(meta).toEqual(new Map([[42, {userId: 42, lastVisitedAt: NOW}]]));
  });
});

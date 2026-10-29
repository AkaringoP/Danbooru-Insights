import {describe, expect, it, vi} from 'vitest';
import {
  assembleProfileSummaryInput,
  buildRecentSummaryInput,
} from '../src/apps/user-analytics-data';
import type {
  DistributionItem,
  ScatterDataPoint,
  TargetUser,
  WindowPoint,
} from '../src/types';

const user: TargetUser = {
  name: 'some user',
  normalizedName: 'some_user',
  id: '42',
  created_at: '2020-01-01T00:00:00Z',
  joinDate: new Date('2020-01-01T00:00:00Z'),
  level_string: 'Member',
};

const scatter = (n: number): ScatterDataPoint[] =>
  Array.from({length: n}, (_, i) => ({
    id: i + 1,
    d: 1_000 + i,
    s: 1,
    t: 12,
    r: 's',
    del: false,
  }));

const dist = (tags: string[]): DistributionItem[] => [
  ...tags.map(t => ({
    name: t.replace(/_/g, ' '),
    tagName: t,
    count: 5,
    frequency: 0.1,
    thumb: null,
    isOther: false,
  })),
  {
    name: 'Others',
    tagName: '',
    count: 9,
    frequency: 0,
    thumb: null,
    isOther: true,
  },
];

function run(over: {
  scatterData?: ScatterDataPoint[];
  recentWindow?: WindowPoint[];
}) {
  const getScatterData = vi.fn(async () => scatter(250));
  const promise = assembleProfileSummaryInput({
    dataManager: {getScatterData} as never,
    user,
    firstUploadDate: new Date('2021-03-01T00:00:00Z'),
    total: 500,
    status: [
      {name: 'active', count: 480},
      {name: 'deleted', count: 20},
    ],
    copyright: dist(['blue_archive', 'arknights']),
    character: dist(['hoshino_(blue_archive)']),
    scatterData: over.scatterData ?? [],
    recentWindow: over.recentWindow ?? [],
  });
  return {promise, getScatterData};
}

describe('assembleProfileSummaryInput', () => {
  it('maps the already-loaded dashboard data', async () => {
    const live = [{id: 999, ts: 5, gentags: 3, rating: 'e'}];
    const {promise, getScatterData} = run({
      scatterData: scatter(400),
      recentWindow: live,
    });
    const input = await promise;
    expect(getScatterData).not.toHaveBeenCalled();
    expect(input.userName).toBe('some_user');
    expect(input.lifetimeDeleted).toBe(20);
    expect(input.copyrightTop).toEqual(['blue_archive', 'arknights']);
    expect(input.characterTop).toEqual(['hoshino_(blue_archive)']);
    expect(input.lifetimeFocus?.copyright).toEqual([
      {tag: 'blue_archive', count: 5},
      {tag: 'arknights', count: 5},
    ]);
    expect(input.lifetimePoints).toHaveLength(400);
    expect(input.window).toBe(live);
  });

  it('reads the local posts once when the scatter fetch was gated', async () => {
    const {promise, getScatterData} = run({
      recentWindow: [{id: 1, ts: 1, gentags: 1, rating: 'g'}],
    });
    const input = await promise;
    expect(getScatterData).toHaveBeenCalledTimes(1);
    expect(input.lifetimePoints).toHaveLength(250);
  });

  it('falls back to the newest local uploads when the live window is empty', async () => {
    const {promise} = run({scatterData: scatter(400)});
    const input = await promise;
    expect(input.window).toHaveLength(200);
    expect(input.window[0].id).toBe(400);
    expect(input.window[0].pending).toBeUndefined();
  });

  it('leaves the lifetime deletion count unknown without a status row', async () => {
    const getScatterData = vi.fn(async () => []);
    const input = await assembleProfileSummaryInput({
      dataManager: {getScatterData} as never,
      user,
      firstUploadDate: null,
      total: 0,
      status: [],
      copyright: [],
      character: [],
      scatterData: [],
      recentWindow: [],
    });
    expect(input.lifetimeDeleted).toBeNull();
    expect(input.window).toEqual([]);
  });
});

describe('buildRecentSummaryInput (popover)', () => {
  it('pairs the live window with local data and cached pies only', async () => {
    const live = [{id: 999, ts: 5, gentags: 3, rating: 'e'}];
    const getStats = vi.fn(async (key: string) =>
      key === 'status_dist'
        ? [
            {name: 'deleted', count: 7},
            {name: 'pending', count: 1},
          ]
        : key === 'copyright_dist'
          ? dist(['touhou'])
          : null,
    );
    const dm = {
      getRecentUploadWindow: vi.fn(async () => live),
      getScatterData: vi.fn(async () => scatter(300)),
      getStats,
    };
    const input = await buildRecentSummaryInput(dm as never, user, 500);
    expect(input.window).toBe(live);
    expect(input.lifetimePoints).toHaveLength(300);
    expect(input.lifetimeDeleted).toBe(7);
    expect(input.lifetimeStatus).toEqual({pending: 1, flagged: 0, banned: 0});
    expect(input.copyrightTop).toEqual(['touhou']);
    expect(input.characterTop).toEqual([]);
    expect(input.firstUploadDate?.getTime()).toBe(1_000);
    expect(dm.getScatterData).toHaveBeenCalledTimes(1);
  });

  it('works for a never-synced user', async () => {
    const dm = {
      getRecentUploadWindow: vi.fn(async () => []),
      getScatterData: vi.fn(async () => []),
      getStats: vi.fn(async () => null),
    };
    const input = await buildRecentSummaryInput(dm as never, user, 0);
    expect(input.firstUploadDate).toBeNull();
    expect(input.lifetimeDeleted).toBeNull();
    expect(input.window).toEqual([]);
  });
});

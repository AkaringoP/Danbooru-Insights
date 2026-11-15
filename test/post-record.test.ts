/**
 * The sync's `posts` row (T-402) and the sync_meta helpers.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Database} from '../src/core/database';
import type {DanbooruPost} from '../src/types';
import {SYNC_POST_FIELDS, toPostRecord} from '../src/core/post-record';
import {
  patchSyncMeta,
  responseServerTime,
  viewerTimeZone,
} from '../src/core/sync-meta';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toPostRecord', () => {
  const post: DanbooruPost = {
    id: 5,
    uploader_id: 42,
    created_at: '2026-11-01T10:00:00.000+09:00',
    updated_at: '2026-11-02T00:00:00.000Z',
    up_score: 4,
    down_score: -2,
    rating: 'g',
    is_deleted: true,
    is_flagged: true,
    tag_count: 25,
    tag_count_general: 18,
    tag_string_character: 'a b',
    tag_string_copyright: 'c',
    preview_file_url: 'p.jpg',
  };

  it('keeps the old fields and adds version 2 under short names', () => {
    expect(toPostRecord(post, 9)).toEqual({
      id: 5,
      uploader_id: 42,
      no: 9,
      created_at: '2026-11-01T10:00:00.000+09:00',
      score: 2,
      up_score: 4,
      down_score: -2,
      is_deleted: true,
      is_banned: false,
      rating: 'g',
      tag_count_general: 18,
      preview_file_url: 'p.jpg',
      upd: Date.parse('2026-11-02T00:00:00.000Z'),
      pend: false,
      flag: true,
      tc: 25,
      chr: 'a b',
      cpy: 'c',
    });
  });

  it('leaves a missing count or time unset instead of 0', () => {
    const row = toPostRecord(
      {id: 1, uploader_id: 42, created_at: 'x', rating: 'g'},
      1,
    );
    expect(row.tc).toBeUndefined();
    expect(row.upd).toBeUndefined();
    expect(row.chr).toBe('');
    expect('variants' in row).toBe(false);
  });

  it('asks for every field the row reads, and not variants', () => {
    const fields = SYNC_POST_FIELDS.split(',');
    for (const f of [
      'updated_at',
      'is_pending',
      'is_flagged',
      'tag_count',
      'tag_count_general',
      'tag_string_character',
      'tag_string_copyright',
    ]) {
      expect(fields).toContain(f);
    }
    expect(fields).not.toContain('variants');
  });
});

describe('patchSyncMeta', () => {
  function makeDb(initial?: Record<string, unknown>) {
    const rows = new Map<number, Record<string, unknown>>();
    if (initial) rows.set(initial.userId as number, initial);
    const db = {
      sync_meta: {
        get: vi.fn(async (k: number) => rows.get(k)),
        put: vi.fn(async (r: Record<string, unknown>) => {
          rows.set(r.userId as number, r);
        }),
      },
      transaction: vi.fn(async (_m: string, _t: unknown, fn: () => unknown) =>
        fn(),
      ),
    };
    return {db: db as unknown as Database, rows};
  }

  it('merges into the row, keeping fields it does not name', async () => {
    const {db, rows} = makeDb({userId: 42, lastVisitedAt: 1});
    expect(await patchSyncMeta(db, 42, {fieldsVersion: 2})).toBe(true);
    expect(rows.get(42)).toEqual({
      userId: 42,
      lastVisitedAt: 1,
      fieldsVersion: 2,
    });
  });

  it('creates the row when there is none', async () => {
    const {db, rows} = makeDb();
    await patchSyncMeta(db, 7, {timeZone: 'UTC'});
    expect(rows.get(7)).toEqual({userId: 7, timeZone: 'UTC'});
  });

  it('reports a failure instead of throwing', async () => {
    const {db} = makeDb();
    (db.sync_meta.put as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('quota'),
    );
    expect(await patchSyncMeta(db, 7, {timeZone: 'UTC'})).toBe(false);
  });
});

describe('responseServerTime', () => {
  const resp = (date: string | null) =>
    ({headers: {get: () => date}}) as unknown as Response;

  it('reads the Date header', () => {
    expect(responseServerTime(resp('Sat, 14 Nov 2026 13:53:29 GMT'), 0)).toBe(
      Date.UTC(2026, 10, 14, 13, 53, 29),
    );
  });

  it('falls back without one, or with one it cannot read', () => {
    expect(responseServerTime(resp(null), 123)).toBe(123);
    expect(responseServerTime(resp('soon'), 123)).toBe(123);
    expect(responseServerTime({} as Response, 123)).toBe(123);
  });
});

describe('viewerTimeZone', () => {
  it('reads the body attribute as is (a Rails zone name)', () => {
    vi.stubGlobal('document', {
      body: {dataset: {currentUserTimeZone: 'Seoul'}},
    });
    expect(viewerTimeZone()).toBe('Seoul');
  });

  it('is undefined off a Danbooru page', () => {
    vi.stubGlobal('document', {body: {dataset: {}}});
    expect(viewerTimeZone()).toBeUndefined();
  });
});

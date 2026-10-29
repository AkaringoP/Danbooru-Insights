import {describe, it, expect, vi, beforeEach} from 'vitest';

vi.mock('../src/core/quota-manager', () => ({
  bulkPutSafe: vi.fn(
    async (table: {bulkPut: (r: unknown[]) => Promise<unknown>}, rows) =>
      table.bulkPut(rows),
  ),
  evictOldestNonCurrentUser: vi.fn(),
}));

// The session cache is module-level, so each test loads a fresh module.
async function load() {
  vi.resetModules();
  return import('../src/core/top-level-tags');
}

function jsonResponse(body: unknown, status = 200) {
  return {ok: status < 400, status, json: async () => body} as Response;
}

function makeDb(rows: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(rows));
  return {
    tag_implications_cache: {
      bulkGet: vi.fn(async (keys: string[]) => keys.map(k => store.get(k))),
      bulkPut: vi.fn(async (records: Array<{tagName: string}>) => {
        for (const r of records) store.set(r.tagName, r);
      }),
    },
    store,
  };
}

describe('getTopLevelFlags', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves 53 candidates with two batched requests, not 53', async () => {
    const {getTopLevelFlags} = await load();
    const names = Array.from({length: 53}, (_, i) => `tag_${i}`);
    const rl = {
      fetch: vi.fn(async (_url: string) =>
        jsonResponse([{antecedent_name: 'tag_3', consequent_name: 'tag_0'}]),
      ),
    };

    const flags = await getTopLevelFlags(rl as never, makeDb() as never, names);

    expect(rl.fetch).toHaveBeenCalledTimes(2);
    expect(rl.fetch.mock.calls[0][0]).toContain('antecedent_name_comma');
    expect(rl.fetch.mock.calls[0][0]).toContain('search[status]=active');
    expect(flags.get('tag_3')).toBe(false);
    expect(flags.get('tag_0')).toBe(true);
    expect(flags.size).toBe(53);
  });

  it('serves repeat lookups from cache with no request', async () => {
    const {getTopLevelFlags} = await load();
    const db = makeDb();
    const rl = {fetch: vi.fn(async () => jsonResponse([]))};

    await getTopLevelFlags(rl as never, db as never, ['a', 'b']);
    await getTopLevelFlags(rl as never, db as never, ['a', 'b']);
    expect(rl.fetch).toHaveBeenCalledTimes(1);
    expect(db.store.size).toBe(2);

    // A fresh session (new module) reads the persisted rows instead.
    const fresh = await load();
    const rl2 = {fetch: vi.fn(async () => jsonResponse([]))};
    const flags = await fresh.getTopLevelFlags(rl2 as never, db as never, [
      'a',
    ]);
    expect(rl2.fetch).not.toHaveBeenCalled();
    expect(flags.get('a')).toBe(true);
  });

  it('keeps candidates but caches nothing when the lookup is rate-limited', async () => {
    // A 429 JSON body used to parse as "no implications": every candidate
    // marked top-level and, on the tag page, cached for 180 days.
    const {getTopLevelFlags} = await load();
    const db = makeDb();
    const rl = {
      fetch: vi.fn(async () => jsonResponse({success: false}, 429)),
    };

    const flags = await getTopLevelFlags(rl as never, db as never, ['x', 'y']);

    expect(flags.get('x')).toBe(true);
    expect(db.store.size).toBe(0);
    rl.fetch.mockResolvedValue(
      jsonResponse([{antecedent_name: 'x', consequent_name: 'y'}]),
    );
    const retry = await getTopLevelFlags(rl as never, db as never, ['x']);
    expect(retry.get('x')).toBe(false);
  });
});

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {fetchHeavyDistributionsSwr} from '../src/apps/user-analytics-data';
import type {TargetUser} from '../src/types';

const USER = {name: 'tester', id: '42'} as TargetUser;
const ROWS = [{name: 'x', count: 1}];

const FETCHERS = {
  copyright: 'getCopyrightDistribution',
  character: 'getCharacterDistribution',
  fav_copyright: 'getFavCopyrightDistribution',
  breasts: 'getBreastsDistribution',
  hair_length: 'getHairLengthDistribution',
  hair_color: 'getHairColorDistribution',
  gender: 'getGenderDistribution',
  commentary: 'getCommentaryDistribution',
  translation: 'getTranslationDistribution',
} as const;

function makeDataManager(cachedKeys: string[]) {
  const dm: Record<string, ReturnType<typeof vi.fn>> = {
    getStats: vi.fn(async (key: string) =>
      cachedKeys.includes(key) ? ROWS : null,
    ),
  };
  for (const method of Object.values(FETCHERS)) {
    dm[method] = vi.fn(async () => ROWS);
  }
  return dm;
}

beforeEach(() => {
  vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
  vi.stubGlobal('localStorage', {getItem: vi.fn(() => null)});
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchHeavyDistributionsSwr — cold cache', () => {
  it('fetches only copyright and character', async () => {
    // A cold first open used to fire all nine (~250 requests for 46k posts);
    // fav copyright waited too until T-704 (~37 counts for a hidden tab).
    const dm = makeDataManager([]);

    const {distributions, revalidators} = await fetchHeavyDistributionsSwr(
      dm as never,
      USER,
      42,
      () => {},
      false,
    );

    expect(Object.keys(distributions).sort()).toEqual([
      'character',
      'copyright',
    ]);
    for (const [key, method] of Object.entries(FETCHERS)) {
      const eager = ['copyright', 'character'].includes(key);
      expect(dm[method]).toHaveBeenCalledTimes(eager ? 1 : 0);
    }
    // Lazy tabs carry no revalidator; the pie loads them on first view.
    expect(revalidators.filter(([, s]) => s !== undefined)).toEqual([]);
  });

  it('a lazy tab with a cache shows it and revalidates as before', async () => {
    const dm = makeDataManager(['gender_dist']);

    const {distributions, revalidators} = await fetchHeavyDistributionsSwr(
      dm as never,
      USER,
      42,
      () => {},
      true, // post-sync: force a revalidate starter
    );

    expect(distributions.gender).toEqual(ROWS);
    expect(dm.getGenderDistribution).not.toHaveBeenCalled();
    const gender = revalidators.find(([k]) => k === 'gender_dist');
    expect(gender?.[1]).toBeTypeOf('function');
  });

  it('fav copyright with a cache shows it at once (T-704)', async () => {
    const dm = makeDataManager(['fav_copyright_dist']);

    const {distributions} = await fetchHeavyDistributionsSwr(
      dm as never,
      USER,
      42,
      () => {},
      false,
    );

    expect(distributions.fav_copyright).toEqual(ROWS);
  });
});

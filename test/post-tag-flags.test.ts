/**
 * The secondary pies' tag flags on a sync row (T-703).
 */
import {describe, expect, it} from 'vitest';
import {
  TAG_FLAG_NAMES,
  tagFlagNames,
  tagFlagsOf,
} from '../src/core/post-tag-flags';
import {
  POST_FIELDS_VERSION,
  TAG_FLAGS_FIELDS_VERSION,
} from '../src/core/post-record';

describe('tagFlagsOf', () => {
  it('flags the listed tags of both strings, once each, sorted', () => {
    const flags = tagFlagsOf(
      'long_hair 1girl solo long_hair black_hair',
      'commentary highres',
    )!;
    expect(tagFlagNames(flags).sort()).toEqual(
      ['1girl', 'black_hair', 'commentary', 'long_hair'].sort(),
    );
    expect(flags).toEqual([...flags].sort((a, b) => a - b));
  });

  it('flags *_text for any tag ending in _text, listed or not', () => {
    expect(tagFlagNames(tagFlagsOf('chinese_text', '')!)).toEqual(['*_text']);
    expect(tagFlagNames(tagFlagsOf('english_text', '')!).sort()).toEqual(
      ['*_text', 'english_text'].sort(),
    );
    expect(tagFlagsOf('text_focus', '')).toEqual([]);
  });

  it('is empty for strings with none of the tags, unset without strings', () => {
    expect(tagFlagsOf('solo highres', '')).toEqual([]);
    expect(tagFlagsOf('', undefined)).toEqual([]);
    expect(tagFlagsOf(undefined, undefined)).toBeUndefined();
  });
});

describe('TAG_FLAG_NAMES', () => {
  it('is the stored format: a change needs a new fields version', () => {
    // Rows store indices into this list. Changing it (adding, removing,
    // reordering) changes what every stored row means: bump
    // POST_FIELDS_VERSION, move TAG_FLAGS_FIELDS_VERSION to it, then update
    // this pin. The backfill rebuilds the rows; the pies count remotely
    // until it has.
    expect(TAG_FLAG_NAMES.join(' ')).toBe(
      'translated translation_request english_text *_text ' +
        'commentary commentary_request ' +
        '1girl 2girls 3girls 4girls 5girls 6+girls ' +
        '1boy 2boys 3boys 4boys 5boys 6+boys ' +
        '1other 2others 3others 4others 5others 6+others no_humans ' +
        'flat_chest small_breasts medium_breasts large_breasts huge_breasts gigantic_breasts ' +
        'bald bald_female very_short_hair short_hair medium_hair long_hair very_long_hair absurdly_long_hair ' +
        'black_hair brown_hair blonde_hair red_hair orange_hair pink_hair purple_hair green_hair blue_hair aqua_hair grey_hair white_hair',
    );
    expect(TAG_FLAGS_FIELDS_VERSION).toBe(3);
    expect(POST_FIELDS_VERSION).toBeGreaterThanOrEqual(
      TAG_FLAGS_FIELDS_VERSION,
    );
  });

  it('has no name twice', () => {
    expect(new Set(TAG_FLAG_NAMES).size).toBe(TAG_FLAG_NAMES.length);
  });
});

/**
 * Local distributions (T-405): the count-based pies of the user dashboard
 * from the `posts` rows, in one pass.
 */
import {describe, expect, it} from 'vitest';
import {createLocalDistributionCounter} from '../src/core/local-distributions';
import {tagFlagsOf} from '../src/core/post-tag-flags';
import type {PostRecord} from '../src/types';

let nextId = 1;
const row = (fields: Partial<PostRecord>): PostRecord => ({
  id: nextId++,
  uploader_id: 42,
  no: 1,
  created_at: '2025-01-01T00:00:00Z',
  score: 0,
  rating: 'g',
  tag_count_general: 20,
  is_deleted: false,
  is_banned: false,
  pend: false,
  flag: false,
  tc: 30,
  chr: '',
  cpy: '',
  ...fields,
});

function count(rows: PostRecord[]) {
  const counter = createLocalDistributionCounter();
  for (const r of rows) counter.add(r);
  return counter.result();
}

describe('status', () => {
  it('counts each flag, and active as not pending, deleted or flagged', () => {
    const d = count([
      row({}),
      row({is_deleted: true}),
      row({pend: true}),
      row({flag: true}),
    ]);
    expect(d.status).toEqual({
      active: 1,
      deleted: 1,
      banned: 0,
      pending: 1,
      flagged: 1,
    });
  });

  it('keeps a banned post active unless something else holds it back', () => {
    const d = count([row({is_banned: true})]);
    expect(d.status).toMatchObject({active: 1, banned: 1});
  });

  it('counts a post in every status it has', () => {
    const d = count([
      row({is_deleted: true, is_banned: true}),
      row({pend: true, flag: true}),
    ]);
    expect(d.status).toEqual({
      active: 0,
      deleted: 1,
      banned: 1,
      pending: 1,
      flagged: 1,
    });
  });
});

describe('rating', () => {
  it('counts the four letters, starting each at 0', () => {
    const d = count([
      row({rating: 'e'}),
      row({rating: 'e'}),
      row({rating: 's'}),
    ]);
    expect(d.rating).toEqual({g: 0, s: 1, q: 0, e: 2});
  });

  it('ignores a rating it does not know', () => {
    expect(count([row({rating: 'x'})]).rating).toEqual({
      g: 0,
      s: 0,
      q: 0,
      e: 0,
    });
  });
});

describe('characters and copyrights', () => {
  it('counts each tag once per post', () => {
    const d = count([
      row({chr: 'hakurei_reimu kirisame_marisa', cpy: 'touhou'}),
      row({chr: 'hakurei_reimu', cpy: 'touhou'}),
    ]);
    expect([...d.characters]).toEqual([
      ['hakurei_reimu', 2],
      ['kirisame_marisa', 1],
    ]);
    expect([...d.copyrights]).toEqual([['touhou', 2]]);
  });

  it('copes with empty strings, repeated spaces and a repeated tag', () => {
    const d = count([
      row({chr: ''}),
      row({chr: undefined}),
      row({chr: '  a   b  '}),
      row({chr: 'a a'}),
    ]);
    expect([...d.characters]).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});

describe('tag counts under 10', () => {
  it('counts general and total tag counts below 10', () => {
    const d = count([
      row({tag_count_general: 9, tc: 9}),
      row({tag_count_general: 9, tc: 10}),
      row({tag_count_general: 10, tc: 12}),
    ]);
    expect(d.gentagsUnder10).toBe(2);
    expect(d.tagcountUnder10).toBe(1);
  });

  it('does not read a missing total tag count as 0', () => {
    expect(count([row({tc: undefined})]).tagcountUnder10).toBe(0);
  });
});

it('counts the rows, and an empty set is all zeros', () => {
  expect(count([row({}), row({})]).rows).toBe(2);
  const empty = count([]);
  expect(empty.rows).toBe(0);
  expect(empty.status.active).toBe(0);
  expect(empty.characters.size).toBe(0);
});

describe('tag flags (T-703)', () => {
  const flagged = (general: string, meta = '') =>
    row({tf: tagFlagsOf(general, meta)});

  it('counts each flagged tag per post, and the rows that hold flags', () => {
    const d = count([
      flagged('1girl long_hair'),
      flagged('1girl short_hair'),
      flagged(''),
      row({}), // fields version 2: no flags
    ]);
    expect(d.flaggedRows).toBe(3);
    expect(d.tagFlags.get('1girl')).toBe(2);
    expect(d.tagFlags.get('long_hair')).toBe(1);
    expect(d.tagFlags.get('2girls')).toBe(0);
  });

  it('counts Bald as bald or bald_female, once a post', () => {
    const d = count([
      flagged('bald'),
      flagged('bald_female'),
      flagged('bald bald_female'),
    ]);
    expect(d.bald).toBe(3);
  });

  it('counts untranslated: some _text tag, none of the three', () => {
    const d = count([
      flagged('japanese_text'), // yes
      flagged('chinese_text korean_text'), // yes, once
      flagged('english_text'), // english
      flagged('japanese_text', 'translated'),
      flagged('japanese_text', 'translation_request'),
      flagged('1girl'), // no text
    ]);
    expect(d.untranslated).toBe(2);
    expect(d.tagFlags.get('*_text')).toBe(5);
  });
});

import {describe, it, expect} from 'vitest';
import {buildSearchQuery} from '../src/apps/user-analytics-pie-helpers';
import type {PieDetails} from '../src/apps/user-analytics-data';

const USER = 'akaringo';

describe('buildSearchQuery — rating', () => {
  it('returns user:NAME rating:g for kind=rating', () => {
    const details: PieDetails = {kind: 'rating', rating: 'g', count: 10};
    expect(buildSearchQuery(details, 'General', USER, 'rating')).toBe(
      'user:akaringo rating:g',
    );
  });

  for (const r of ['g', 's', 'q', 'e'] as const) {
    it(`handles each canonical rating letter (${r})`, () => {
      const details: PieDetails = {kind: 'rating', rating: r, count: 1};
      expect(buildSearchQuery(details, 'X', USER, 'rating')).toBe(
        `user:akaringo rating:${r}`,
      );
    });
  }

  it('returns null when rating is empty', () => {
    const details: PieDetails = {kind: 'rating', rating: '', count: 1};
    expect(buildSearchQuery(details, 'X', USER, 'rating')).toBeNull();
  });
});

describe('buildSearchQuery — status', () => {
  it('returns user:NAME status:active', () => {
    const details: PieDetails = {kind: 'status', name: 'active', count: 5};
    expect(buildSearchQuery(details, 'Active', USER, 'status')).toBe(
      'user:akaringo status:active',
    );
  });

  it('returns null when status name is empty', () => {
    const details: PieDetails = {kind: 'status', name: '', count: 5};
    expect(buildSearchQuery(details, 'X', USER, 'status')).toBeNull();
  });
});

describe('buildSearchQuery — tag (default)', () => {
  it('uses tagName when present', () => {
    const details: PieDetails = {
      kind: 'tag',
      tagName: 'one_piece',
      count: 50,
    };
    expect(buildSearchQuery(details, 'One Piece', USER, 'copyright')).toBe(
      'user:akaringo one_piece',
    );
  });

  it('prefers originalTag over tagName when both set', () => {
    const details: PieDetails = {
      kind: 'tag',
      originalTag: 'a OR b',
      tagName: 'a',
      count: 1,
    };
    expect(buildSearchQuery(details, 'A', USER, 'gender')).toBe(
      'user:akaringo a OR b',
    );
  });

  it('expands untagged_commentary sentinel', () => {
    const details: PieDetails = {
      kind: 'tag',
      tagName: 'untagged_commentary',
      count: 1,
    };
    expect(buildSearchQuery(details, 'X', USER, 'commentary')).toBe(
      'user:akaringo has:commentary -commentary -commentary_request',
    );
  });

  it('expands untagged_translation sentinel', () => {
    const details: PieDetails = {
      kind: 'tag',
      tagName: 'untagged_translation',
      count: 1,
    };
    expect(buildSearchQuery(details, 'X', USER, 'translation')).toBe(
      'user:akaringo *_text -english_text -translation_request -translated',
    );
  });

  it('falls back to normalized label when tagName missing', () => {
    const details: PieDetails = {kind: 'tag', count: 1};
    expect(buildSearchQuery(details, 'Long Hair', USER, 'hair_length')).toBe(
      'user:akaringo long_hair',
    );
  });

  it('returns null when no tag and label empty', () => {
    const details: PieDetails = {kind: 'tag', count: 0};
    expect(buildSearchQuery(details, '', USER, 'character')).toBeNull();
  });
});

describe('buildSearchQuery — fav_copyright (special prefix)', () => {
  it('uses ordfav: prefix instead of user:', () => {
    const details: PieDetails = {
      kind: 'tag',
      tagName: 'naruto',
      count: 100,
    };
    expect(buildSearchQuery(details, 'Naruto', USER, 'fav_copyright')).toBe(
      'ordfav:akaringo naruto',
    );
  });

  it('falls back to raw label (not normalized) for fav_copyright', () => {
    const details: PieDetails = {kind: 'tag', count: 1};
    expect(
      buildSearchQuery(details, 'Some Series', USER, 'fav_copyright'),
    ).toBe('ordfav:akaringo Some Series');
  });
});

describe('buildSearchQuery — guards', () => {
  it('returns null when targetName is empty', () => {
    const details: PieDetails = {kind: 'rating', rating: 'g', count: 1};
    expect(buildSearchQuery(details, 'General', '', 'rating')).toBeNull();
  });
});

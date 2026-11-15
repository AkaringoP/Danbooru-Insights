import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  countSearchTerms,
  fitsViewerTagLimit,
  viewerTagLimit,
} from '../src/core/search-terms';

describe('countSearchTerms — PostQuery#term_count', () => {
  it('counts tag names, wildcards and non-free metatags', () => {
    expect(countSearchTerms('user:x 1girl')).toBe(2);
    expect(countSearchTerms('user:x *_text translated')).toBe(3);
    expect(countSearchTerms('user:x 1girl order:score rating:g')).toBe(3);
    expect(countSearchTerms('fav:x touhou rating:g order:score')).toBe(3);
    expect(countSearchTerms('user:x gentags:<10')).toBe(2);
  });

  it('counts ~ OR terms and - negations one each', () => {
    expect(countSearchTerms('user:x ~bald ~bald_female')).toBe(3);
    expect(
      countSearchTerms('user:x has:commentary -commentary -commentary_request'),
    ).toBe(4);
  });

  it('does not count UNLIMITED_METATAGS', () => {
    expect(
      countSearchTerms('user:x status:deleted rating:g date:2024-01-01...'),
    ).toBe(1);
    expect(
      countSearchTerms('tag id:>5 age:..1d score:>10 -status:banned'),
    ).toBe(1);
    expect(countSearchTerms('user:x tagcount:<10 Rating:s')).toBe(1);
  });

  it('a tag that only looks like a metatag still counts', () => {
    expect(countSearchTerms('re:zero_kara_hajimeru_isekai_seikatsu')).toBe(1);
  });

  it('ignores extra whitespace', () => {
    expect(countSearchTerms('  user:x   1girl ')).toBe(2);
    expect(countSearchTerms('')).toBe(0);
  });
});

describe('viewerTagLimit — <body data-current-user-level>', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function level(value: string | undefined) {
    vi.stubGlobal('document', {body: {dataset: {currentUserLevel: value}}});
  }

  it('anonymous 2, Member 3, Gold and above unlimited', () => {
    level('0');
    expect(viewerTagLimit()).toBe(2);
    level('10'); // Restricted
    expect(viewerTagLimit()).toBe(3);
    level('20');
    expect(viewerTagLimit()).toBe(3);
    level('30');
    expect(viewerTagLimit()).toBe(Infinity);
    level('50');
    expect(viewerTagLimit()).toBe(Infinity);
  });

  it('an unreadable level does not block anything', () => {
    level(undefined);
    expect(viewerTagLimit()).toBe(Infinity);
    vi.stubGlobal('document', undefined);
    expect(viewerTagLimit()).toBe(Infinity);
  });

  it('fitsViewerTagLimit compares the two', () => {
    level('20');
    expect(fitsViewerTagLimit('user:x 1girl order:score rating:g')).toBe(true);
    expect(fitsViewerTagLimit('user:x ~a ~b order:score')).toBe(false);
  });
});

/**
 * The change catch-up's page decisions (T-407), driven over a simulated
 * `order:change` list.
 */
import {describe, expect, it} from 'vitest';
import {
  afterCatchUpPage,
  startCatchUp,
  type CatchUpCursor,
  type CatchUpProgress,
} from '../src/core/change-catch-up';

const LIMIT = 3;

/**
 * Walks `list` (updated_at times, newest first) with pages of LIMIT, like
 * the real catch-up; `stopAfter` interrupts after that many pages.
 */
function walk(
  list: number[],
  watermark: number,
  saved?: CatchUpProgress,
  stopAfter = Infinity,
  maxPages = 1000,
) {
  let cursor: CatchUpCursor = startCatchUp(watermark, saved);
  const pagesRead: number[] = [];
  let progress = saved;
  for (let n = 0; n < stopAfter; n++) {
    pagesRead.push(cursor.page);
    const start = (cursor.page - 1) * LIMIT;
    const step = afterCatchUpPage(
      cursor,
      watermark,
      list.slice(start, start + LIMIT),
      LIMIT,
      maxPages,
    );
    if (step.kind !== 'next') return {pagesRead, step, progress};
    cursor = step.cursor;
    if (cursor.phase === 'tail') {
      progress = {page: cursor.page, headAt: cursor.headAt ?? watermark};
    }
  }
  return {pagesRead, step: null, progress};
}

describe('a fresh catch-up', () => {
  it('stops on the first page that reaches below the watermark', () => {
    const {pagesRead, step} = walk([90, 80, 70, 40, 30], 60);
    // Page 1 (90 80 70) is all newer; page 2 (40 30) reaches below 60.
    expect(pagesRead).toEqual([1, 2]);
    expect(step).toEqual({kind: 'done', watermark: 90});
  });

  it('reads on past rows at exactly the watermark', () => {
    const {pagesRead} = walk([90, 60, 60, 60, 50, 40], 60);
    expect(pagesRead).toEqual([1, 2]);
  });

  it('costs one page when nothing changed, and keeps the watermark', () => {
    const {pagesRead, step} = walk([50, 40, 30, 20], 60);
    expect(pagesRead).toEqual([1]);
    expect(step).toEqual({kind: 'done', watermark: 60});
  });

  it('ends at a short page', () => {
    const {step} = walk([90, 80], 10);
    expect(step).toEqual({kind: 'done', watermark: 90});
  });

  it('overflows past the page limit', () => {
    const list = Array.from({length: 30}, (_, i) => 1000 - i);
    const {step} = walk(list, 0, undefined, Infinity, 4);
    expect(step).toEqual({kind: 'overflow'});
  });
});

describe('a resumed catch-up', () => {
  it('reads the new changes from the top, then goes back one page before where it stopped', () => {
    // Run 1 started with the list headed by 90 and stopped before page 4.
    const saved = {page: 4, headAt: 90};
    // Meanwhile two posts changed (100, 95) and went to the top.
    const list = [100, 95, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81, 50];
    const {pagesRead, step} = walk(list, 60, saved);
    // Head: page 1 (100 95 90) does not reach below 90, page 2 (89 …) does;
    // the tail goes back to page 3 (= 4 − 1) and walks to the watermark.
    expect(pagesRead).toEqual([1, 2, 3, 4, 5]);
    expect(step).toEqual({kind: 'done', watermark: 100});
  });

  it('continues past the head phase when it already went beyond the saved page', () => {
    const saved = {page: 2, headAt: 90};
    const list = [99, 98, 97, 96, 95, 94, 90, 80, 70, 50];
    const {pagesRead} = walk(list, 60, saved);
    // Head phase reads pages 1–3 (reaching below 90 on page 3); the tail
    // resumes at page 4, not back at page 1.
    expect(pagesRead).toEqual([1, 2, 3, 4]);
  });

  it('saves no progress during the head phase', () => {
    const saved = {page: 5, headAt: 90};
    const list = [99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 80, 70];
    const {progress} = walk(list, 60, saved, 2);
    // Interrupted after two head pages: the older progress stays.
    expect(progress).toEqual(saved);
  });

  it('a run interrupted again resumes with what it saved in the tail', () => {
    const list = Array.from({length: 20}, (_, i) => 200 - i);
    const first = walk(list, 0, undefined, 3);
    expect(first.progress).toEqual({page: 4, headAt: 200});
    const second = walk(list, 0, first.progress);
    // No new change: page 1 already reaches below 200; back to page 3.
    expect(second.pagesRead.slice(0, 2)).toEqual([1, 3]);
    expect(second.step).toEqual({kind: 'done', watermark: 200});
  });
});

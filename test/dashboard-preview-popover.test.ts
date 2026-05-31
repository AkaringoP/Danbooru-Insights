// @vitest-environment jsdom

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {
  createDashboardPreviewPopover,
  RECENT_POSTS_LIMIT,
} from '../src/ui/dashboard-preview-popover';
import {calcPopoverPositionBelow} from '../src/ui/popover-utils';
import {getNsfwEnabled, setNsfwEnabled} from '../src/core/settings';
import * as twoStepTap from '../src/ui/two-step-tap';
import type {ActivityDistribution, PostPreview} from '../src/types';

const flush = () => new Promise(r => setTimeout(r, 0));

const NEVER = () => new Promise<never>(() => {});

function activityWith(
  recent: ActivityDistribution['recent'],
  counts: Partial<ActivityDistribution['counts']>,
  suspiciousPostIds: number[] = [],
): ActivityDistribution {
  return {
    recent,
    counts: {
      upload: 0,
      edit: 0,
      note: 0,
      wiki: 0,
      artist: 0,
      commentary: 0,
      pool: 0,
      forum: 0,
      approval: 0,
      comment: 0,
      appeal: 0,
      suspicious: 0,
      ...counts,
    },
    suspiciousPostIds,
    oldestAnchorByType: {},
  };
}

const samplePosts: PostPreview[] = [
  {
    id: 1,
    thumbUrl: 'http://x/1.webp',
    score: 10,
    generalTags: 5,
    rating: 'g',
    status: 'active',
  },
  {
    id: 2,
    thumbUrl: 'http://x/2.webp',
    score: 3,
    generalTags: 8,
    rating: 's',
    status: 'pending',
  },
  {
    id: 3,
    thumbUrl: '',
    score: 0,
    generalTags: 0,
    rating: 'e',
    status: 'deleted',
  },
];

/** A minimal touch event jsdom accepts (no TouchEvent ctor). Same coords so
 *  TapTracker sees no movement → a valid tap. */
function fakeTouch(type: 'touchstart' | 'touchmove' | 'touchend'): Event {
  const e = new Event(type, {bubbles: true});
  const touch = {clientX: 10, clientY: 10};
  Object.defineProperty(e, 'touches', {
    value: type === 'touchend' ? [] : [touch],
  });
  Object.defineProperty(e, 'changedTouches', {value: [touch]});
  return e;
}

/** A pointer event with a `pointerType` jsdom doesn't set on its own. */
function pointerEvent(
  type: 'pointerover' | 'pointerleave',
  pointerType: 'mouse' | 'touch' = 'mouse',
): Event {
  const e = new Event(type, {bubbles: true});
  Object.defineProperty(e, 'pointerType', {value: pointerType});
  return e;
}

function anchorWithRect(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('span');
  document.body.appendChild(el);
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect;
  return el;
}

describe('calcPopoverPositionBelow', () => {
  it('places the popover below the anchor with an 8px gap', () => {
    const el = anchorWithRect({left: 100, bottom: 50, width: 24});
    expect(calcPopoverPositionBelow(el, 480).top).toBe(58);
  });

  it('clamps left so a wide popover stays within the viewport', () => {
    // jsdom window.innerWidth defaults to 1024.
    const el = anchorWithRect({left: 900, bottom: 10, width: 24});
    const {left, caretLeft} = calcPopoverPositionBelow(el, 480);
    expect(left).toBe(1024 - 480 - 8); // maxLeft = 536
    expect(caretLeft).toBe(912 - 536); // caret still points at anchor centre
  });

  it('clamps the caret within the popover body', () => {
    const el = anchorWithRect({left: 0, bottom: 0, width: 0});
    expect(calcPopoverPositionBelow(el, 480).caretLeft).toBe(7);
  });
});

describe('createDashboardPreviewPopover', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders 10 skeleton cells immediately on show', () => {
    const anchor = anchorWithRect({});
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: () => new Promise<PostPreview[]>(() => {}), // never resolves
    });
    pop.show();
    expect(document.querySelectorAll('.di-preview-skeleton').length).toBe(
      RECENT_POSTS_LIMIT,
    );
    expect(RECENT_POSTS_LIMIT).toBe(10);
    pop.destroy();
  });

  it('renders a cell per post with status border and post link', async () => {
    const anchor = anchorWithRect({});
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
    });
    pop.show();
    await flush();

    const cells = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a.di-preview-cell'),
    );
    expect(cells).toHaveLength(3);
    expect(cells[0].getAttribute('href')).toContain('/posts/1');
    expect(cells[0].querySelector('.di-preview-label')?.textContent).toBe(
      'G ▲10 ◫5',
    );
    // Status border is on the thumbnail, not the cell wrapper.
    const thumb0 = cells[0].querySelector<HTMLElement>('.di-preview-thumb');
    const thumb1 = cells[1].querySelector<HTMLElement>('.di-preview-thumb');
    expect(thumb0?.style.borderColor).toBe('transparent'); // active
    expect(thumb1?.style.borderColor).not.toBe('transparent'); // pending
    expect(thumb1?.style.borderColor).not.toBe('');
    // deleted post with no thumb → placeholder div, not <img>
    expect(cells[2].querySelector('img')).toBeNull();
    expect(cells[2].querySelector('.di-preview-thumb--empty')).not.toBeNull();
    pop.destroy();
  });

  it('flags low-score or under-tagged uploads with a red label', async () => {
    const anchor = anchorWithRect({});
    const posts: PostPreview[] = [
      {
        id: 1,
        thumbUrl: 't',
        score: -5,
        generalTags: 20,
        rating: 'g',
        status: 'active',
      }, // low score
      {
        id: 2,
        thumbUrl: 't',
        score: 99,
        generalTags: 3,
        rating: 'g',
        status: 'active',
      }, // under-tagged
      {
        id: 3,
        thumbUrl: 't',
        score: 99,
        generalTags: 20,
        rating: 'g',
        status: 'active',
      }, // clean
    ];
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => posts,
    });
    pop.show();
    await flush();
    const cells = document.querySelectorAll<HTMLElement>('a.di-preview-cell');
    expect(cells[0].querySelector('.di-preview-label--flag')).not.toBeNull();
    expect(cells[1].querySelector('.di-preview-label--flag')).not.toBeNull();
    expect(cells[2].querySelector('.di-preview-label--flag')).toBeNull();
    pop.destroy();
  });

  it('labels both sections', async () => {
    const anchor = anchorWithRect({});
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
      fetchActivity: async () => activityWith([], {}),
    });
    pop.show();
    const labels = Array.from(
      document.querySelectorAll('.di-preview-section-label'),
    ).map(e => e.textContent);
    expect(labels).toEqual(['Recent uploads', 'Activity']);
    pop.destroy();
  });

  it('shows an empty message when there are no posts', async () => {
    const anchor = anchorWithRect({});
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => [],
    });
    pop.show();
    await flush();
    expect(document.querySelector('.di-preview-msg')?.textContent).toMatch(
      /no recent/i,
    );
    pop.destroy();
  });

  it('shows an error message when the fetch rejects', async () => {
    const anchor = anchorWithRect({});
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => {
        throw new Error('boom');
      },
    });
    pop.show();
    await flush();
    expect(document.querySelector('.di-preview-msg')?.textContent).toMatch(
      /failed/i,
    );
    pop.destroy();
  });

  it('reuses a single in-flight fetch across rapid show calls', async () => {
    const anchor = anchorWithRect({});
    const fetchPosts = vi.fn(async () => samplePosts);
    const pop = createDashboardPreviewPopover({anchor, fetchPosts});
    pop.show();
    pop.show(); // second show before the first resolves
    await flush();
    expect(fetchPosts).toHaveBeenCalledTimes(1);
    pop.destroy();
  });

  it('serves cached posts without refetching on re-show within the TTL', async () => {
    const anchor = anchorWithRect({});
    const fetchPosts = vi.fn(async () => samplePosts);
    const pop = createDashboardPreviewPopover({anchor, fetchPosts});
    pop.show();
    await flush();
    expect(fetchPosts).toHaveBeenCalledTimes(1);

    pop.hide();
    pop.show(); // within 30s → cache hit: no skeleton, no refetch
    expect(document.querySelectorAll('.di-preview-skeleton')).toHaveLength(0);
    expect(document.querySelectorAll('a.di-preview-cell')).toHaveLength(3);
    expect(fetchPosts).toHaveBeenCalledTimes(1);
    pop.destroy();
  });

  it('blurs q/e thumbnails by default and the checkbox toggles the filter', async () => {
    setNsfwEnabled(false); // default: NSFW hidden → filter on
    const posts: PostPreview[] = (['g', 'q', 'e'] as const).map(
      (rating, i) => ({
        id: i + 1,
        thumbUrl: `http://x/${rating}.webp`,
        score: 1,
        generalTags: 5,
        rating,
        status: 'active',
      }),
    );
    const pop = createDashboardPreviewPopover({
      anchor: anchorWithRect({}),
      fetchPosts: async () => posts,
    });
    pop.show();
    await flush();
    const thumbs = Array.from(
      document.querySelectorAll<HTMLElement>('.di-preview-grid [data-rating]'),
    );
    const blurred = (r: string) =>
      thumbs
        .find(t => t.dataset.rating === r)!
        .classList.contains('di-preview-thumb--nsfw');
    expect(blurred('g')).toBe(false);
    expect(blurred('q')).toBe(true);
    expect(blurred('e')).toBe(true);

    // Check "NSFW" (Enable-NSFW polarity) → flag flips to show, blur clears.
    const cb = document.querySelector<HTMLInputElement>(
      '.di-preview-nsfw-toggle input',
    )!;
    expect(cb.checked).toBe(false); // NSFW disabled by default → unchecked
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(getNsfwEnabled()).toBe(true);
    expect(blurred('q')).toBe(false);
    expect(blurred('e')).toBe(false);

    pop.destroy();
    setNsfwEnabled(false); // reset for other tests
  });

  it('mirrors a dark dashboard theme onto the body-level popover', async () => {
    // 'auto' pref (default) + Danbooru's dark page theme → effective dark.
    document.body.setAttribute('data-current-user-theme', 'dark');
    try {
      const pop = createDashboardPreviewPopover({
        anchor: anchorWithRect({}),
        fetchPosts: async () => samplePosts,
      });
      pop.show();
      const el = document.querySelector('.di-preview-popover')!;
      expect(el.getAttribute('data-di-theme')).toBe('dark');
      pop.destroy();
    } finally {
      document.body.removeAttribute('data-current-user-theme');
    }
  });

  it('drops the dark theme attr when the dashboard is light', () => {
    document.body.removeAttribute('data-current-user-theme'); // light
    const pop = createDashboardPreviewPopover({
      anchor: anchorWithRect({}),
      fetchPosts: async () => samplePosts,
    });
    pop.show();
    const el = document.querySelector('.di-preview-popover')!;
    expect(el.getAttribute('data-di-theme')).toBeNull();
    pop.destroy();
  });

  it('hides on Escape when pinned', () => {
    const anchor = anchorWithRect({});
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
    });
    pop.show({pinned: true});
    const el = document.querySelector<HTMLElement>('.di-preview-popover');
    expect(el?.style.display).toBe('block');
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    expect(el?.style.display).toBe('none');
    pop.destroy();
  });

  it('lingers then fades out (not instant) when the cursor leaves (transient)', async () => {
    const pop = createDashboardPreviewPopover({
      anchor: anchorWithRect({}),
      fetchPosts: async () => samplePosts,
    });
    pop.show(); // transient (hover)
    await flush();
    const el = document.querySelector<HTMLElement>('.di-preview-popover')!;
    expect(el.style.display).toBe('block');

    vi.useFakeTimers();
    try {
      el.dispatchEvent(new MouseEvent('mouseleave', {bubbles: true}));
      // During the grace period it stays fully visible — no fade, no hide.
      expect(el.classList.contains('di-preview-popover--fading')).toBe(false);
      expect(el.style.display).toBe('block');
      // Grace elapses → fade begins, still mounted (not display:none yet).
      vi.runOnlyPendingTimers();
      expect(el.classList.contains('di-preview-popover--fading')).toBe(true);
      expect(el.style.display).toBe('block');
      // Fade elapses → finally hidden, and the fade class is reset.
      vi.runOnlyPendingTimers();
      expect(el.style.display).toBe('none');
      expect(el.classList.contains('di-preview-popover--fading')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    pop.destroy();
  });

  it('cancels the pending fade when the cursor returns to the popover', async () => {
    const pop = createDashboardPreviewPopover({
      anchor: anchorWithRect({}),
      fetchPosts: async () => samplePosts,
    });
    pop.show();
    await flush();
    const el = document.querySelector<HTMLElement>('.di-preview-popover')!;

    vi.useFakeTimers();
    try {
      el.dispatchEvent(new MouseEvent('mouseleave', {bubbles: true}));
      vi.runOnlyPendingTimers(); // fade started
      expect(el.classList.contains('di-preview-popover--fading')).toBe(true);
      // Cursor comes back: fade aborts, popover restored.
      el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
      expect(el.classList.contains('di-preview-popover--fading')).toBe(false);
      expect(el.style.display).toBe('block');
      // No pending timers remain → it does not hide on its own.
      vi.runOnlyPendingTimers();
      expect(el.style.display).toBe('block');
    } finally {
      vi.useRealTimers();
    }
    pop.destroy();
  });
});

describe('createDashboardPreviewPopover — section B (activity)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // jsdom reports `ontouchstart in window` → default to desktop so the
    // hover/click path is wired; touch tests override per-case.
    vi.spyOn(twoStepTap, 'isTouchDevice').mockReturnValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not build section B when fetchActivity is omitted', () => {
    const anchor = anchorWithRect({});
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
    });
    pop.show();
    expect(document.querySelector('.di-activity-strip')).toBeNull();
    pop.destroy();
  });

  it('renders the strip + legend, splitting uploads from tag edits', async () => {
    const anchor = anchorWithRect({});
    const now = Date.now();
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
      fetchActivity: async () =>
        activityWith(
          [
            {type: 'upload', ts: now - 1000},
            {type: 'edit', ts: now - 2000},
            {type: 'note', ts: now - 3000},
            {type: 'upload', ts: now - 4000},
          ],
          {upload: 2, edit: 1, note: 1},
        ),
    });
    pop.show();
    await flush();

    expect(document.querySelectorAll('.di-activity-seg')).toHaveLength(4);
    const legendItems = Array.from(
      document.querySelectorAll('.di-activity-legend-item'),
    );
    // Only the types that appear, in canonical order (upload → post → note).
    expect(legendItems.map(i => i.textContent)).toEqual([
      'Uploads 2',
      'Tag edits 1',
      'Notes 1',
    ]);
    pop.destroy();
  });

  it('lays many segments out as balanced full rows (no ragged tail)', async () => {
    const anchor = anchorWithRect({});
    const now = Date.now();
    const recent = Array.from({length: 170}, (_, i) => ({
      type: 'upload' as const,
      ts: now - i * 1000,
    }));
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
      fetchActivity: async () => activityWith(recent, {upload: 170}),
    });
    pop.show();
    await flush();

    const rows = Array.from(document.querySelectorAll('.di-activity-row'));
    expect(rows.length).toBeGreaterThan(1); // wrapped to multiple rows
    // Every segment present, and rows balanced (sizes differ by ≤ 1).
    const sizes = rows.map(r => r.querySelectorAll('.di-activity-seg').length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(170);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    pop.destroy();
  });

  it('renders suspicious segments with the alert style + legend entry', async () => {
    const anchor = anchorWithRect({});
    const now = Date.now();
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
      fetchActivity: async () =>
        activityWith(
          [
            {type: 'upload', ts: now - 1000},
            {type: 'suspicious', ts: now - 2000},
          ],
          {upload: 1, suspicious: 1},
        ),
    });
    pop.show();
    await flush();
    expect(
      document.querySelectorAll('.di-activity-seg--flag').length,
    ).toBeGreaterThanOrEqual(1); // segment (and legend swatch) get the style
    const legend = Array.from(
      document.querySelectorAll('.di-activity-legend-item'),
    ).map(e => e.textContent);
    expect(legend).toContain('Suspicious 1');
    pop.destroy();
  });

  it('peer-highlights same-type segments on hover (mutes the rest)', async () => {
    const anchor = anchorWithRect({});
    const now = Date.now();
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
      fetchActivity: async () =>
        activityWith(
          [
            {type: 'upload', ts: now - 1},
            {type: 'note', ts: now - 2},
            {type: 'upload', ts: now - 3},
          ],
          {upload: 2, note: 1},
        ),
    });
    pop.show();
    await flush();
    const segs = Array.from(
      document.querySelectorAll<HTMLElement>('.di-activity-seg'),
    );
    const note = segs.find(s => s.dataset.type === 'note')!;
    note.dispatchEvent(pointerEvent('pointerover'));
    // Hovering the note seg mutes the two uploads, not the note itself.
    const muted = segs.filter(s =>
      s.classList.contains('di-activity-seg--mute'),
    );
    expect(muted.every(s => s.dataset.type !== 'note')).toBe(true);
    expect(muted.length).toBe(2);
    pop.destroy();
  });

  it('bolds the matching legend label on strip hover and on legend hover', async () => {
    const now = Date.now();
    const pop = createDashboardPreviewPopover({
      anchor: anchorWithRect({}),
      fetchPosts: async () => samplePosts,
      fetchActivity: async () =>
        activityWith(
          [
            {type: 'upload', ts: now - 1},
            {type: 'note', ts: now - 2},
          ],
          {upload: 1, note: 1},
        ),
    });
    pop.show();
    await flush();
    const legendItem = (t: string) =>
      Array.from(
        document.querySelectorAll<HTMLElement>('.di-activity-legend-item'),
      ).find(i => i.dataset.type === t)!;
    const active = (t: string) =>
      legendItem(t).classList.contains('di-activity-legend-item--active');
    const strip = document.querySelector<HTMLElement>('.di-activity-strip')!;
    const legend = document.querySelector<HTMLElement>('.di-activity-legend')!;

    // Hover a strip segment → only its legend label bolds.
    strip
      .querySelector<HTMLElement>('.di-activity-seg[data-type="upload"]')!
      .dispatchEvent(pointerEvent('pointerover'));
    expect(active('upload')).toBe(true);
    expect(active('note')).toBe(false);
    strip.dispatchEvent(pointerEvent('pointerleave'));
    expect(active('upload')).toBe(false);

    // Hover the legend label itself → it bolds; pointerleave clears.
    legendItem('note').dispatchEvent(pointerEvent('pointerover'));
    expect(active('note')).toBe(true);
    legend.dispatchEvent(pointerEvent('pointerleave'));
    expect(active('note')).toBe(false);

    // Moving onto a gap inside the legend (bare container, no leave event yet)
    // also clears — otherwise the bold would stick while :hover already cleared.
    legendItem('note').dispatchEvent(pointerEvent('pointerover'));
    expect(active('note')).toBe(true);
    legend.dispatchEvent(pointerEvent('pointerover')); // target = container
    expect(active('note')).toBe(false);
    pop.destroy();
  });

  it('opens the type list page when a legend item is clicked', async () => {
    const opened: string[] = [];
    const origOpen = window.open;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
    try {
      const pop = createDashboardPreviewPopover({
        anchor: anchorWithRect({}),
        fetchPosts: async () => samplePosts,
        fetchActivity: async () =>
          activityWith([{type: 'upload', ts: Date.now()}], {upload: 1}),
        activityHref: t => (t === 'upload' ? '/posts?tags=user:x' : undefined),
      });
      pop.show();
      await flush();
      const item = document.querySelector<HTMLElement>(
        '.di-activity-legend-item--link',
      );
      expect(item).not.toBeNull();
      item!.click();
      expect(opened).toContain('/posts?tags=user:x');
      pop.destroy();
    } finally {
      window.open = origOpen;
    }
  });

  it('passes the distribution to activityHref (suspicious id: link-out)', async () => {
    const origOpen = window.open;
    let opened = '';
    window.open = ((url?: string | URL) => {
      opened = String(url ?? '');
      return null;
    }) as typeof window.open;
    try {
      const pop = createDashboardPreviewPopover({
        anchor: anchorWithRect({}),
        fetchPosts: async () => samplePosts,
        fetchActivity: async () =>
          activityWith(
            [{type: 'suspicious', ts: Date.now(), postId: 42}],
            {suspicious: 1},
            [42, 99],
          ),
        // Mirrors the app: suspicious resolves its href from dist ids.
        activityHref: (type, dist) =>
          type === 'suspicious'
            ? `/posts?tags=id:${dist.suspiciousPostIds.join(',')}`
            : undefined,
      });
      pop.show();
      await flush();
      const item = document.querySelector<HTMLElement>(
        '.di-activity-legend-item--link',
      );
      expect(item).not.toBeNull();
      item!.click();
      expect(opened).toBe('/posts?tags=id:42,99');
      pop.destroy();
    } finally {
      window.open = origOpen;
    }
  });

  it('peer-highlights from the legend too (hover a legend item)', async () => {
    const anchor = anchorWithRect({});
    const now = Date.now();
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
      fetchActivity: async () =>
        activityWith(
          [
            {type: 'upload', ts: now - 1},
            {type: 'note', ts: now - 2},
            {type: 'upload', ts: now - 3},
          ],
          {upload: 2, note: 1},
        ),
    });
    pop.show();
    await flush();
    const noteItem = Array.from(
      document.querySelectorAll<HTMLElement>('.di-activity-legend-item'),
    ).find(i => i.dataset.type === 'note')!;
    noteItem.dispatchEvent(pointerEvent('pointerover'));
    const muted = Array.from(
      document.querySelectorAll<HTMLElement>('.di-activity-seg--mute'),
    );
    expect(muted.length).toBe(2); // the two uploads dim; the note stays lit
    expect(muted.every(s => s.dataset.type === 'upload')).toBe(true);
    pop.destroy();
  });

  it('mouse hover highlight clears on leave even on a touch-capable device', async () => {
    // Regression: a mouse machine that reports touch must still get hover +
    // leave-clear (pointer events filter touch by type, so both are wired).
    vi.mocked(twoStepTap.isTouchDevice).mockReturnValue(true);
    const pop = createDashboardPreviewPopover({
      anchor: anchorWithRect({}),
      fetchPosts: async () => samplePosts,
      fetchActivity: async () =>
        activityWith([{type: 'upload', ts: Date.now()}], {upload: 1}),
    });
    pop.show();
    await flush();
    const legend = document.querySelector<HTMLElement>('.di-activity-legend')!;
    const item = legend.querySelector<HTMLElement>(
      '.di-activity-legend-item[data-type="upload"]',
    )!;
    item.dispatchEvent(pointerEvent('pointerover'));
    expect(item.classList.contains('di-activity-legend-item--active')).toBe(
      true,
    );
    legend.dispatchEvent(pointerEvent('pointerleave'));
    expect(item.classList.contains('di-activity-legend-item--active')).toBe(
      false,
    );
    // A touch-typed pointer is ignored by the hover handler (two-step owns it).
    item.dispatchEvent(pointerEvent('pointerover', 'touch'));
    expect(item.classList.contains('di-activity-legend-item--active')).toBe(
      false,
    );
    pop.destroy();
  });

  it('legend two-step tap on touch: first tap highlights, second opens', async () => {
    vi.mocked(twoStepTap.isTouchDevice).mockReturnValue(true); // override default
    const origOpen = window.open;
    let opened = '';
    window.open = ((url?: string | URL) => {
      opened = String(url ?? '');
      return null;
    }) as typeof window.open;
    try {
      const pop = createDashboardPreviewPopover({
        anchor: anchorWithRect({}),
        fetchPosts: async () => samplePosts,
        fetchActivity: async () =>
          activityWith([{type: 'upload', ts: Date.now()}], {upload: 1}),
        activityHref: t => (t === 'upload' ? '/posts?tags=user:x' : undefined),
      });
      pop.show({pinned: true});
      await flush();
      const item = document.querySelector<HTMLElement>(
        '.di-activity-legend-item[data-type="upload"]',
      )!;
      // No desktop click handler on touch — a bare click must not navigate.
      item.click();
      expect(opened).toBe('');
      const tap = () => {
        item.dispatchEvent(fakeTouch('touchstart'));
        item.dispatchEvent(fakeTouch('touchend'));
      };
      // First tap highlights, does not navigate.
      tap();
      expect(item.classList.contains('di-activity-legend-item--active')).toBe(
        true,
      );
      expect(opened).toBe('');
      // Second tap on the same label opens the page.
      tap();
      expect(opened).toBe('/posts?tags=user:x');
      pop.destroy();
    } finally {
      window.open = origOpen;
    }
  });

  it('touch + pinned shows one unified spinner, then renders A+B together', async () => {
    vi.mocked(twoStepTap.isTouchDevice).mockReturnValue(true);
    let resolvePosts!: (p: PostPreview[]) => void;
    let resolveAct!: (d: ActivityDistribution) => void;
    const pop = createDashboardPreviewPopover({
      anchor: anchorWithRect({}),
      fetchPosts: () => new Promise<PostPreview[]>(r => (resolvePosts = r)),
      fetchActivity: () =>
        new Promise<ActivityDistribution>(r => (resolveAct = r)),
    });
    pop.show({pinned: true});
    await flush();
    // One spinner, no per-section skeleton churn while both load.
    expect(document.querySelectorAll('.di-preview-loading')).toHaveLength(1);
    expect(document.querySelectorAll('.di-preview-skeleton')).toHaveLength(0);
    expect(
      document
        .querySelector('.di-activity-strip')
        ?.classList.contains('di-activity-loading'),
    ).toBe(false);
    // Both settle → spinner gone, both sections rendered in one shot.
    resolvePosts(samplePosts);
    resolveAct(activityWith([{type: 'upload', ts: Date.now()}], {upload: 1}));
    await flush();
    expect(document.querySelectorAll('.di-preview-loading')).toHaveLength(0);
    expect(document.querySelectorAll('a.di-preview-cell')).toHaveLength(3);
    expect(
      document.querySelectorAll('.di-activity-legend-item').length,
    ).toBeGreaterThan(0);
    pop.destroy();
  });

  it('fills section A immediately while activity is still loading (background)', async () => {
    const anchor = anchorWithRect({});
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
      fetchActivity: NEVER, // never resolves
    });
    pop.show();
    await flush();
    // A rendered…
    expect(document.querySelectorAll('a.di-preview-cell')).toHaveLength(3);
    // …while B is still showing its loading state (not blocked on activity).
    const strip = document.querySelector('.di-activity-strip');
    expect(strip?.classList.contains('di-activity-loading')).toBe(true);
    pop.destroy();
  });

  it('shows an empty message when there is no activity', async () => {
    const anchor = anchorWithRect({});
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
      fetchActivity: async () => activityWith([], {}),
    });
    pop.show();
    await flush();
    expect(document.querySelector('.di-activity-empty')?.textContent).toMatch(
      /no recent activity/i,
    );
    pop.destroy();
  });

  it('shows an error message when the activity fetch rejects', async () => {
    const anchor = anchorWithRect({});
    const pop = createDashboardPreviewPopover({
      anchor,
      fetchPosts: async () => samplePosts,
      fetchActivity: async () => {
        throw new Error('boom');
      },
    });
    pop.show();
    await flush();
    expect(document.querySelector('.di-activity-empty')?.textContent).toMatch(
      /unavailable/i,
    );
    pop.destroy();
  });
});

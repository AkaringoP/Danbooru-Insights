// @vitest-environment jsdom

import {describe, it, expect, vi, afterEach} from 'vitest';

// renderMilestones builds plain DOM; d3 is only needed by the other charts.
vi.mock('d3', () => ({}));

import {TagAnalyticsChartRenderer} from '../src/apps/tag-analytics-charts';
import {THUMB_FALLBACK_CLASS} from '../src/ui/thumb-fallback';
import type {MilestoneEntry} from '../src/types';

const MILESTONE: MilestoneEntry = {
  milestone: 1,
  post: {
    id: 5,
    created_at: '2020-01-01T00:00:00Z',
    uploader_id: 9,
    rating: 'g',
    preview_file_url: '/broken.jpg',
  },
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TagAnalyticsChartRenderer.renderMilestones - thumbnail fallback', () => {
  // Danbooru's CSP (2026-11-11) blocks the inline `onerror` these cards
  // used to carry; the fallback now comes from ui/thumb-fallback.
  it('falls back to the favicon through a listener, not an inline handler', () => {
    document.body.innerHTML =
      '<div id="tag-analytics-milestones"><div class="milestones-grid"></div></div>';
    new TagAnalyticsChartRenderer().renderMilestones([MILESTONE], () => {});

    const img = document.querySelector('#tag-analytics-milestones img')!;
    expect(img).not.toBeNull();
    expect(img.classList.contains(THUMB_FALLBACK_CLASS)).toBe(true);
    expect(img.hasAttribute('onerror')).toBe(false);

    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe('/favicon.ico');
  });
});

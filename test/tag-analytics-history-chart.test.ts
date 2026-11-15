// @vitest-environment jsdom
/**
 * The tag page's monthly chart in UTC months (T-305). The bars count UTC
 * calendar months (T-302/T-303); the month a click opens, the year ticks
 * and the milestone stars must follow the same months whatever the
 * browser's time zone, and the search must not leave the month to the
 * viewer's Danbooru time zone either.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TagAnalyticsChartRenderer} from '../src/apps/tag-analytics-charts';
import type {HistoryEntry, MilestoneEntry} from '../src/types';

const ORIGINAL_TZ = process.env.TZ;

/** Runs `fn` with the process in `tz`, checking the switch took effect. */
function inTimeZone(tz: string, fn: () => void): void {
  process.env.TZ = tz;
  try {
    // Guard against a vacuous pass: the local calendar must really move.
    const localDay = new Date('2024-03-01T00:00:00Z').getDate();
    expect(localDay).toBe(tz === 'America/Los_Angeles' ? 29 : 1);
    fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

const history = (dates: string[]): HistoryEntry[] => {
  let cumulative = 0;
  return dates.map(date => {
    cumulative += 5;
    return {date, count: 5, cumulative};
  });
};

function render(data: HistoryEntry[], milestones?: MilestoneEntry[]) {
  document.body.innerHTML = '<div id="chart"></div>';
  new TagAnalyticsChartRenderer().renderBarChart(
    data,
    '#chart',
    'Monthly Posts',
    'fate/grand_order',
    milestones,
  );
  return document.getElementById('chart')!;
}

beforeEach(() => {
  vi.useFakeTimers({toFake: ['setTimeout']});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const months = ['2023-12-01', '2024-01-01', '2024-02-01', '2024-03-01'];

describe('monthly chart click', () => {
  for (const tz of ['America/Los_Angeles', 'Asia/Seoul', 'UTC']) {
    it(`opens exactly the UTC month of the bar (${tz})`, () => {
      inTimeZone(tz, () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        const chart = render(history(months));

        const overlays = chart.querySelectorAll('.monthly-overlays rect');
        expect(overlays).toHaveLength(4);
        overlays[3].dispatchEvent(new MouseEvent('click'));

        expect(open).toHaveBeenCalledWith(
          `/posts?tags=${encodeURIComponent(
            'fate/grand_order date:2024-03-01T00:00:00Z...2024-04-01T00:00:00Z',
          )}`,
          '_blank',
        );
      });
    });
  }

  it('rolls over the year for December', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const chart = render(history(months));
    chart
      .querySelectorAll('.monthly-overlays rect')[0]
      .dispatchEvent(new MouseEvent('click'));
    expect(decodeURIComponent(String(open.mock.calls[0][0]))).toContain(
      'date:2023-12-01T00:00:00Z...2024-01-01T00:00:00Z',
    );
  });
});

describe('monthly chart axis and title', () => {
  it('puts the year ticks on January west of UTC too', () => {
    inTimeZone('America/Los_Angeles', () => {
      const chart = render(history(months));
      // The x axis lives in the scrolling part; the grid there has no text.
      const labelled = [
        ...chart.querySelectorAll('.scroll-wrapper .tick'),
      ].filter(g => g.textContent);
      expect(labelled.map(g => g.textContent)).toEqual(['2024']);

      // ...and it stands on the January bar (it used to be February's).
      const tickX = Number(
        /translate\(([\d.]+)/.exec(labelled[0].getAttribute('transform')!)![1],
      );
      const centers = [...chart.querySelectorAll('.monthly-overlays rect')].map(
        r => Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2,
      );
      const nearest = centers.findIndex(c => Math.abs(c - tickX) <= 1);
      expect(months[nearest]).toBe('2024-01-01');
    });
  });

  it('marks the title as UTC', () => {
    const chart = render(history(months));
    expect(chart.textContent).toContain('Monthly Posts');
    expect(chart.textContent).toContain('UTC');
  });
});

describe('milestone stars', () => {
  const star = (createdAt: string): MilestoneEntry => ({
    milestone: 1,
    post: {id: 1, created_at: createdAt, uploader_id: 1, rating: 'g'},
  });

  it('sits on the UTC month of the post east of UTC', () => {
    // March 31 23:30 UTC is already April 1 in Seoul; there is no April bar.
    inTimeZone('Asia/Seoul', () => {
      const chart = render(history(months), [star('2024-03-31T23:30:00Z')]);
      expect(chart.querySelectorAll('.di-milestone-stars text')).toHaveLength(
        1,
      );
    });
  });

  it('sits on the UTC month of the post west of UTC', () => {
    // March 1 03:00 UTC is still February 29 in Los Angeles; with no
    // February bar the star would have vanished.
    inTimeZone('America/Los_Angeles', () => {
      const chart = render(history(['2024-01-01', '2024-03-01']), [
        star('2024-03-01T03:00:00Z'),
      ]);
      expect(chart.querySelectorAll('.di-milestone-stars text')).toHaveLength(
        1,
      );
    });
  });

  it('names the UTC date in its tooltip, as the milestone card does', () => {
    // March 1 03:00 UTC is February 29 in Los Angeles: the browser's date
    // would disagree with the card for the same post.
    inTimeZone('America/Los_Angeles', () => {
      const chart = render(history(['2024-01-01', '2024-03-01']), [
        star('2024-03-01T03:00:00Z'),
      ]);
      expect(
        chart.querySelector('.di-milestone-stars title')?.textContent,
      ).toBe('Milestone #1 (2024-03-01)');
    });
  });
});

// @vitest-environment jsdom
import {beforeEach, describe, expect, it} from 'vitest';
import {
  mountProfileSummaryCard,
  renderSummaryText,
  updateProfileSummaryCard,
} from '../src/ui/profile-summary-view';
import type {ProfileSummary} from '../src/types';

const summary: ProfileSummary = {
  lines: [
    [
      {text: 'Uploading since 2021-03. Across all 1,000 uploads: '},
      {
        text: '25% deleted',
        href: '/posts?tags=user%3Ax%20status%3Adeleted',
        severity: 'bad',
        title: 'slots',
      },
      {text: ' (+1 more)', title: '10% heavily downvoted'},
      {text: '.'},
    ],
    [
      {text: 'Still centred on '},
      {
        text: 'blue archive',
        href: '/posts?tags=user%3Ax%20blue_archive',
        category: 'copyright',
      },
      {text: '; '},
      {text: 'on a 9-day streak', severity: 'good'},
      {text: '.'},
    ],
  ],
  overflow: [],
};

describe('mountProfileSummaryCard', () => {
  let parent: HTMLElement;
  beforeEach(() => {
    parent = document.createElement('div');
    parent.innerHTML = '<div class="di-summary-grid"></div>';
  });

  it('inserts the card above the summary grid', () => {
    const card = mountProfileSummaryCard(parent, summary);
    expect(parent.firstElementChild).toBe(card);
    expect(card?.nextElementSibling?.className).toBe('di-summary-grid');
    expect(card?.querySelector('.di-ps-label')?.textContent).toBe(
      'At a glance',
    );
  });

  it('skips an empty summary', () => {
    expect(mountProfileSummaryCard(parent, {lines: [], overflow: []})).toBe(
      null,
    );
    expect(parent.querySelector('.di-ps-card')).toBeNull();
  });

  it('updates the mounted card in place', () => {
    const card = mountProfileSummaryCard(parent, summary);
    updateProfileSummaryCard(parent, {
      lines: [[{text: 'Fresh.'}]],
      overflow: [],
    });
    expect(parent.querySelector('.di-ps-card')).toBe(card);
    expect(parent.querySelector('.di-ps-text')?.textContent).toBe('Fresh.');
  });
});

describe('renderSummaryText', () => {
  let box: HTMLElement;
  beforeEach(() => {
    box = document.createElement('div');
    renderSummaryText(box, summary);
  });

  it('renders one line per summary line, never clamped behind a tooltip', () => {
    expect(box.querySelectorAll('br')).toHaveLength(1);
    expect(box.title).toBe('');
  });

  it('renders flags as toned links that open in a new tab', () => {
    const flag = box.querySelector('a.di-ps-flag.di-ps-tone--bad');
    expect(flag?.textContent).toBe('25% deleted');
    expect(flag?.getAttribute('href')).toBe(
      '/posts?tags=user%3Ax%20status%3Adeleted',
    );
    expect(flag?.getAttribute('target')).toBe('_blank');
    expect(flag?.getAttribute('rel')).toBe('noopener');
    expect((flag as HTMLElement).title).toBe('slots');
  });

  it('colours tag links by category and plain toned parts by tone', () => {
    expect(
      box.querySelector('a.di-ps-link.di-ps-tag--copyright')?.textContent,
    ).toBe('blue archive');
    const good = box.querySelector('span.di-ps-tone--good');
    expect(good?.textContent).toBe('on a 9-day streak');
    const more = [...box.querySelectorAll('span')].find(s =>
      s.textContent?.includes('+1 more'),
    );
    expect(more?.title).toBe('10% heavily downvoted');
  });

  it('never parses part text as markup', () => {
    renderSummaryText(box, {
      lines: [
        [{text: '<img src=x onerror=alert(1)>', href: '/x', title: '"q'}],
      ],
      overflow: [],
    });
    const a = box.querySelector('a') as HTMLAnchorElement;
    expect(a.querySelector('img')).toBeNull();
    expect(a.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(a.title).toBe('"q');
  });
});

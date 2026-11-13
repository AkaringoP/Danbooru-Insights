// @vitest-environment jsdom
// (escapeHtml builds a DOM element.)
import {describe, expect, it} from 'vitest';
import {dashboardFooterHtml} from '../src/ui/dashboard-footer';

describe('dashboardFooterHtml', () => {
  it('has no note line unless one is given (the user dashboard)', () => {
    expect(dashboardFooterHtml()).not.toContain('di-dashboard-footer-note');
  });

  it('adds the note as escaped text (the tag dashboard UTC line)', () => {
    const html = dashboardFooterHtml('Months are UTC <b>calendar</b> months');
    expect(html).toContain('di-dashboard-footer-note');
    expect(html).toContain('Months are UTC &lt;b&gt;calendar&lt;/b&gt; months');
  });
});

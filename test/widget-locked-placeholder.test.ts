// @vitest-environment jsdom
/**
 * Unit tests for the reusable widget-locked placeholder (T-37).
 * Covers DOM structure, progress percent math, edge cases (current >=
 * required, current = 0), and a11y attributes.
 */
import {describe, it, expect, beforeEach} from 'vitest';
import {renderWidgetLockedPlaceholder} from '../src/ui/widget-locked-placeholder';

let container: HTMLDivElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

function render(
  opts: Partial<Parameters<typeof renderWidgetLockedPlaceholder>[1]> = {},
) {
  renderWidgetLockedPlaceholder(container, {
    widgetTitle: 'Tag Cloud',
    icon: '🏷️',
    currentCount: 62,
    requiredCount: 100,
    unlockMessage: 'Tag cloud unlocks at 100 uploads.',
    ...opts,
  });
}

describe('renderWidgetLockedPlaceholder', () => {
  it('renders title, icon, and counter text', () => {
    render();
    expect(
      container.querySelector('.di-widget-locked-title')?.textContent,
    ).toBe('Tag Cloud');
    expect(container.querySelector('.di-widget-locked-icon')?.textContent).toBe(
      '🏷️',
    );
    expect(
      container.querySelector('.di-widget-locked-counter')?.textContent,
    ).toBe('62 / 100');
  });

  it('omits the icon element when icon is not provided', () => {
    render({icon: undefined});
    expect(container.querySelector('.di-widget-locked-icon')).toBeNull();
    expect(
      container.querySelector('.di-widget-locked-title')?.textContent,
    ).toBe('Tag Cloud');
  });

  it('renders progress bar with correct width percentage', () => {
    render({currentCount: 62, requiredCount: 100});
    const fill = container.querySelector<HTMLElement>(
      '.di-widget-locked-progress-fill',
    );
    expect(fill?.style.width).toBe('62%');
  });

  it('caps progress at 100% when currentCount exceeds requiredCount', () => {
    render({currentCount: 250, requiredCount: 100});
    const fill = container.querySelector<HTMLElement>(
      '.di-widget-locked-progress-fill',
    );
    expect(fill?.style.width).toBe('100%');
  });

  it('floors progress at 0% when currentCount is negative', () => {
    render({currentCount: -5, requiredCount: 100});
    const fill = container.querySelector<HTMLElement>(
      '.di-widget-locked-progress-fill',
    );
    expect(fill?.style.width).toBe('0%');
  });

  it('renders 0/N counter at zero progress', () => {
    render({currentCount: 0, requiredCount: 100});
    expect(
      container.querySelector('.di-widget-locked-counter')?.textContent,
    ).toBe('0 / 100');
  });

  it('shows the raw (uncapped) currentCount in the counter text', () => {
    // UX choice: progress bar caps at 100% but the textual counter shows raw
    // input so the user sees their actual upload count.
    render({currentCount: 250, requiredCount: 100});
    expect(
      container.querySelector('.di-widget-locked-counter')?.textContent,
    ).toBe('250 / 100');
  });

  it('sets aria progressbar attributes', () => {
    render({currentCount: 62, requiredCount: 100});
    const bar = container.querySelector('.di-widget-locked-progress');
    expect(bar?.getAttribute('role')).toBe('progressbar');
    expect(bar?.getAttribute('aria-valuenow')).toBe('62');
    expect(bar?.getAttribute('aria-valuemin')).toBe('0');
    expect(bar?.getAttribute('aria-valuemax')).toBe('100');
  });

  it('renders the unlock message', () => {
    render({unlockMessage: 'Scatter plot unlocks at 300 uploads.'});
    expect(
      container.querySelector('.di-widget-locked-message')?.textContent,
    ).toBe('Scatter plot unlocks at 300 uploads.');
  });

  it('adds the di-widget-locked class to the container', () => {
    render();
    expect(container.classList.contains('di-widget-locked')).toBe(true);
  });

  it('replaces previous content when called twice', () => {
    container.appendChild(document.createTextNode('old content'));
    render();
    expect(container.textContent).not.toContain('old content');
    expect(container.querySelector('.di-widget-locked-title')).not.toBeNull();
  });

  it('is a no-op when requiredCount is 0 or negative', () => {
    render({requiredCount: 0});
    expect(container.querySelector('.di-widget-locked-card')).toBeNull();
    render({requiredCount: -1});
    expect(container.querySelector('.di-widget-locked-card')).toBeNull();
  });

  it('uses textContent (XSS-safe) for title and message', () => {
    render({
      widgetTitle: '<script>alert(1)</script>',
      unlockMessage: '<img src=x onerror=alert(1)>',
    });
    expect(container.innerHTML).not.toContain('<script>');
    expect(container.innerHTML).not.toContain('<img');
    expect(
      container.querySelector('.di-widget-locked-title')?.textContent,
    ).toBe('<script>alert(1)</script>');
  });
});

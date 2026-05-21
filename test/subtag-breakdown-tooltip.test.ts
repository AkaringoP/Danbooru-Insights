// @vitest-environment jsdom
/**
 * DOM tests for the sub-tag breakdown tooltip (T-45).
 *
 * Covers:
 *  - Heading + clickable items + Others bucket DOM structure
 *  - XSS-safe rendering (textContent paths)
 *  - href format and target="_blank"
 *  - show → hide lifecycle (single-instance, idempotent hide)
 *  - buildSubtagTooltipItems URL prefix swap (user: vs ordfav:)
 */
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {
  hideSubtagTooltip,
  isSubtagTooltipVisible,
  showSubtagTooltip,
  type SubtagTooltipItem,
} from '../src/ui/subtag-breakdown-tooltip';
import * as twoStepTap from '../src/ui/two-step-tap';

function makeAnchor(): HTMLElement {
  const el = document.createElement('div');
  el.textContent = 'idolmaster';
  document.body.appendChild(el);
  return el;
}

function items(): SubtagTooltipItem[] {
  return [
    {
      tagName: 'deremas',
      displayName: 'deremas',
      count: 60,
      share: 0.6,
      href: '/posts?tags=user%3Aalice+deremas',
      isOther: false,
    },
    {
      tagName: 'milimas',
      displayName: 'milimas',
      count: 30,
      share: 0.3,
      href: '/posts?tags=user%3Aalice+milimas',
      isOther: false,
    },
    {
      tagName: 'Others',
      displayName: 'Others',
      count: 10,
      share: 0.1,
      href: '',
      isOther: true,
    },
  ];
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  hideSubtagTooltip();
  document.body.innerHTML = '';
});

describe('showSubtagTooltip', () => {
  it('renders heading + items into a body-attached tooltip', () => {
    const anchor = makeAnchor();
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
    });

    const tooltip = document.querySelector('.di-subtag-tooltip');
    expect(tooltip).not.toBeNull();
    expect(
      tooltip!.querySelector('.di-subtag-tooltip-heading')!.textContent,
    ).toBe('idolmaster');
    const rows = tooltip!.querySelectorAll('.di-subtag-tooltip-item');
    expect(rows).toHaveLength(3);
  });

  it('renders clickable rows as <a target="_blank">', () => {
    const anchor = makeAnchor();
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
    });

    const rows = document.querySelectorAll('.di-subtag-tooltip-item');
    expect(rows[0].tagName).toBe('A');
    expect((rows[0] as HTMLAnchorElement).href).toContain('deremas');
    expect((rows[0] as HTMLAnchorElement).target).toBe('_blank');
    expect((rows[0] as HTMLAnchorElement).rel).toContain('noopener');
  });

  it('renders Others rows as non-clickable <span>', () => {
    const anchor = makeAnchor();
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(), // Others row has href=''
      anchor,
    });

    const rows = document.querySelectorAll('.di-subtag-tooltip-item');
    expect(rows[2].tagName).toBe('SPAN');
    expect(rows[2].classList.contains('di-subtag-tooltip-item--other')).toBe(
      true,
    );
  });

  it('formats share as percentage and count with locale separators', () => {
    const anchor = makeAnchor();
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: [
        {
          tagName: 'deremas',
          displayName: 'deremas',
          count: 12345,
          share: 0.6234,
          href: '/posts?tags=user%3Aalice+deremas',
          isOther: false,
        },
      ],
      anchor,
    });

    const share = document.querySelector('.di-subtag-tooltip-item-share');
    const count = document.querySelector('.di-subtag-tooltip-item-count');
    expect(share!.textContent).toBe('62.3%');
    // toLocaleString — JSDOM default locale formats with commas.
    expect(count!.textContent).toMatch(/12[,.]345/);
  });

  it('does not render when items array is empty', () => {
    const anchor = makeAnchor();
    showSubtagTooltip({parentDisplayName: 'idolmaster', items: [], anchor});
    expect(isSubtagTooltipVisible()).toBe(false);
  });

  it('escapes tag names via textContent (XSS safety)', () => {
    const anchor = makeAnchor();
    showSubtagTooltip({
      parentDisplayName: '<script>x</script>',
      items: [
        {
          tagName: 'a<b>',
          displayName: 'a<b>',
          count: 1,
          share: 1.0,
          href: '/posts?tags=foo',
          isOther: false,
        },
      ],
      anchor,
    });

    const heading = document.querySelector('.di-subtag-tooltip-heading');
    expect(heading!.textContent).toBe('<script>x</script>');
    // No script element actually injected.
    expect(document.querySelectorAll('script')).toHaveLength(0);
    const name = document.querySelector('.di-subtag-tooltip-item-name');
    expect(name!.textContent).toBe('a<b>');
    // <b> not interpreted as markup.
    expect(name!.querySelectorAll('b')).toHaveLength(0);
  });

  it('sets title=displayName on each row so truncated names surface on hover', () => {
    const anchor = makeAnchor();
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: [
        {
          tagName: 'antonio_salieri_(second_ascension)',
          displayName: 'antonio salieri (second ascension)',
          count: 156,
          share: 0.761,
          href: '/posts?tags=foo',
          isOther: false,
        },
      ],
      anchor,
    });
    const row = document.querySelector<HTMLElement>('.di-subtag-tooltip-item');
    expect(row?.title).toBe('antonio salieri (second ascension)');
  });

  it('replaces previous tooltip content when called again', () => {
    const anchor = makeAnchor();
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
    });
    showSubtagTooltip({
      parentDisplayName: 'gundam',
      items: [
        {
          tagName: 'gundam_seed',
          displayName: 'gundam seed',
          count: 5,
          share: 1.0,
          href: '/posts?tags=user%3Aalice+gundam_seed',
          isOther: false,
        },
      ],
      anchor,
    });

    const heading = document.querySelector('.di-subtag-tooltip-heading');
    expect(heading!.textContent).toBe('gundam');
    expect(document.querySelectorAll('.di-subtag-tooltip-item')).toHaveLength(
      1,
    );
  });
});

describe('onShow / onHide hooks (v9.7+)', () => {
  it('fires onShow synchronously after the tooltip mounts', () => {
    const anchor = makeAnchor();
    let mountedWhenShown = false;
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
      onShow: () => {
        mountedWhenShown =
          document.querySelector('.di-subtag-tooltip') !== null;
      },
    });
    expect(mountedWhenShown).toBe(true);
  });

  it('fires onHide exactly once when hideSubtagTooltip is called', () => {
    const anchor = makeAnchor();
    let hideCount = 0;
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
      onHide: () => hideCount++,
    });
    hideSubtagTooltip();
    hideSubtagTooltip();
    expect(hideCount).toBe(1);
  });

  it('fires previous onHide when a second show replaces the tooltip', () => {
    const anchor = makeAnchor();
    let firstHide = 0;
    let secondHide = 0;
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
      onHide: () => firstHide++,
    });
    showSubtagTooltip({
      parentDisplayName: 'gundam',
      items: items(),
      anchor,
      onHide: () => secondHide++,
    });
    expect(firstHide).toBe(1);
    expect(secondHide).toBe(0);

    hideSubtagTooltip();
    expect(secondHide).toBe(1);
  });
});

describe('onPointerEnter / onPointerLeave hooks (v9.8+)', () => {
  it('fires onPointerEnter when cursor enters tooltip body', () => {
    const anchor = makeAnchor();
    let enterCount = 0;
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
      onPointerEnter: () => enterCount++,
    });
    const el = document.querySelector<HTMLElement>('.di-subtag-tooltip')!;
    // jsdom doesn't dispatch hover events on its own — invoke the handler
    // the module assigned to el.onmouseenter to verify the wiring.
    el.onmouseenter!.call(el, new MouseEvent('mouseenter'));
    expect(enterCount).toBe(1);
  });

  it('fires onPointerLeave when cursor leaves tooltip body', () => {
    const anchor = makeAnchor();
    let leaveCount = 0;
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
      onPointerLeave: () => leaveCount++,
    });
    const el = document.querySelector<HTMLElement>('.di-subtag-tooltip')!;
    el.onmouseleave!.call(el, new MouseEvent('mouseleave'));
    expect(leaveCount).toBe(1);
  });

  it('schedules (not immediately fires) tooltip hide on pointer leave', () => {
    // Behavior change: el.onmouseleave used to call hideSubtagTooltip
    // synchronously, leaving no window for cursor → row return. v9.8
    // routes it through scheduleSubtagTooltipHide instead (120ms grace),
    // matching the comment that's been there since the start.
    const anchor = makeAnchor();
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
    });
    expect(isSubtagTooltipVisible()).toBe(true);
    const el = document.querySelector<HTMLElement>('.di-subtag-tooltip')!;
    el.onmouseleave!.call(el, new MouseEvent('mouseleave'));
    // Still visible immediately after — the hide is scheduled, not synchronous.
    expect(isSubtagTooltipVisible()).toBe(true);
  });
});

describe('placement: touch device branch (v10+)', () => {
  let origInnerWidth: number;
  let origGetRect: typeof Element.prototype.getBoundingClientRect;
  let isTouchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    origInnerWidth = window.innerWidth;
    origGetRect = Element.prototype.getBoundingClientRect;
    isTouchSpy = vi.spyOn(twoStepTap, 'isTouchDevice').mockReturnValue(true);
    Object.defineProperty(window, 'innerWidth', {
      value: 390,
      configurable: true,
    });
    // Stub getBoundingClientRect so the test asserts deterministic
    // coordinates instead of jsdom's zero-rect default. Anchor is placed
    // at (left=20, bottom=120); tooltip measures 220px wide.
    Element.prototype.getBoundingClientRect = function () {
      if (this instanceof HTMLElement && this.classList.contains('anchor')) {
        return {
          top: 100,
          bottom: 120,
          left: 20,
          right: 140,
          width: 120,
          height: 20,
          x: 20,
          y: 100,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (
        this instanceof HTMLElement &&
        this.classList.contains('di-subtag-tooltip')
      ) {
        return {
          top: 0,
          bottom: 200,
          left: 0,
          right: 220,
          width: 220,
          height: 200,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return origGetRect.call(this);
    };
  });

  afterEach(() => {
    isTouchSpy.mockRestore();
    Object.defineProperty(window, 'innerWidth', {
      value: origInnerWidth,
      configurable: true,
    });
    Element.prototype.getBoundingClientRect = origGetRect;
  });

  it('places the tooltip below the anchor and horizontally centred', () => {
    const anchor = makeAnchor();
    anchor.classList.add('anchor');
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
    });
    const el = document.querySelector<HTMLElement>('.di-subtag-tooltip')!;
    // top = anchor.bottom(120) + scrollY(0) + 8gap = 128
    expect(el.style.top).toBe('128px');
    // left = scrollX(0) + max(8, (innerWidth(390) - width(220))/2) = 85
    expect(el.style.left).toBe('85px');
  });

  it('clamps left to 8px when tooltip width exceeds viewport', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 200,
      configurable: true,
    });
    const anchor = makeAnchor();
    anchor.classList.add('anchor');
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
    });
    const el = document.querySelector<HTMLElement>('.di-subtag-tooltip')!;
    // centeredLeft = (200 - 220)/2 = -10, max(8, -10) = 8
    expect(el.style.left).toBe('8px');
  });
});

describe('placement: desktop branch', () => {
  let origGetRect: typeof Element.prototype.getBoundingClientRect;
  let isTouchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    isTouchSpy = vi.spyOn(twoStepTap, 'isTouchDevice').mockReturnValue(false);
    origGetRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this instanceof HTMLElement && this.classList.contains('anchor')) {
        return {
          top: 100,
          bottom: 120,
          left: 20,
          right: 140,
          width: 120,
          height: 20,
          x: 20,
          y: 100,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return origGetRect.call(this);
    };
  });

  afterEach(() => {
    isTouchSpy.mockRestore();
    Element.prototype.getBoundingClientRect = origGetRect;
  });

  it('keeps right-of-anchor placement (calcPopoverPosition formula)', () => {
    const anchor = makeAnchor();
    anchor.classList.add('anchor');
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
    });
    const el = document.querySelector<HTMLElement>('.di-subtag-tooltip')!;
    // top = anchor.top(100), left = anchor.right(140) + 10 = 150
    expect(el.style.top).toBe('100px');
    expect(el.style.left).toBe('150px');
  });
});

describe('hideSubtagTooltip', () => {
  it('sets opacity to 0 and is idempotent', () => {
    const anchor = makeAnchor();
    showSubtagTooltip({
      parentDisplayName: 'idolmaster',
      items: items(),
      anchor,
    });
    expect(isSubtagTooltipVisible()).toBe(true);

    hideSubtagTooltip();
    expect(isSubtagTooltipVisible()).toBe(false);
    const el = document.querySelector<HTMLElement>('.di-subtag-tooltip');
    expect(el!.style.opacity).toBe('0');

    // Second hide is a no-op
    hideSubtagTooltip();
    expect(isSubtagTooltipVisible()).toBe(false);
  });
});

// buildSubtagTooltipItems was removed in the chart/tooltip-unification
// pass (Fix C). The tooltip's items are now built by
// `subSlicesToTooltipItems` in [user-analytics-charts.ts] from the same
// PieSlice[] the chart renders, so url-prefix / underscore-conversion
// logic lives there and is covered by the sub-chart-slices tests.

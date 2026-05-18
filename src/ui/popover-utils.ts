/**
 * Shared chrome utilities for body-attached popovers.
 *
 * These were extracted from inline implementations that lived in two app
 * orchestration files plus two ui/ popovers. The position formula and the
 * click-outside listener shape were near-identical across sites; the only
 * meaningful per-site differences are (a) which neighbouring elements
 * should be treated as "inside" (the toggle button, sibling popovers) and
 * (b) which event to listen on (`click` vs `mousedown`). Both are exposed
 * as caller-provided knobs so each call site keeps its native behaviour.
 *
 * No external imports: this module only consumes DOM APIs.
 */

/**
 * Document-coordinate position for a popover anchored to the right edge
 * of `target`, with a 10px gap. The returned `top`/`left` already include
 * page scroll offset, so they can be assigned directly to `style.top` /
 * `style.left`.
 */
export function calcPopoverPosition(target: Element): {
  top: number;
  left: number;
} {
  const rect = target.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  return {
    top: rect.top + scrollTop,
    left: rect.right + scrollLeft + 10,
  };
}

export interface ClickOutsideOptions {
  /**
   * Elements (in addition to `container`) whose clicks should NOT trigger
   * `onClose`. Typically the toggle button that opened the popover, or a
   * sibling popover that should share the same outside region. A single
   * element or an array.
   */
  ignore?: Element | Element[] | null;
}

/**
 * Builds (but does not attach) a `(MouseEvent) => void` handler that
 * invokes `onClose` when the click target is outside `container` and any
 * `ignore` elements. The caller is responsible for `document.addEventListener`
 * and `document.removeEventListener`.
 *
 * Why the caller manages attachment: the existing inline sites do this in
 * different ways — some defer with `setTimeout(0)` to avoid an immediate
 * self-close from the opening click, some use a longer delay (100ms),
 * some use `mousedown` instead of `click`. Centralising attachment would
 * force a single policy and break those nuances.
 */
export function createClickOutsideHandler(
  container: Element,
  onClose: () => void,
  options: ClickOutsideOptions = {},
): (e: MouseEvent) => void {
  const ignore = options.ignore;
  const ignoreList: Element[] = !ignore
    ? []
    : Array.isArray(ignore)
      ? ignore
      : [ignore];

  return (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target) return;
    if (container.contains(target)) return;
    for (const el of ignoreList) {
      if (el.contains(target)) return;
    }
    onClose();
  };
}

export interface PopoverChromeOptions {
  /** CSS width for the popover. Default '220px'. */
  width?: string;
  /** CSS z-index. Default '10001'. */
  zIndex?: string;
}

/**
 * Applies the standard di-popover chrome (position, background, border,
 * shadow, padding, font, color, width, z-index) directly on the element's
 * style. The two existing popovers (showSyncSettingsPopover and
 * showSettingsPopover) differed only in `width` and `zIndex`; those are
 * the exposed knobs. Callers still own placement (top/left) via
 * `calcPopoverPosition`.
 */
export function applyPopoverChrome(
  popover: HTMLElement,
  options: PopoverChromeOptions = {},
): void {
  popover.style.position = 'absolute';
  popover.style.zIndex = options.zIndex ?? '10001';
  popover.style.background = 'var(--di-bg, #fff)';
  popover.style.border = '1px solid var(--di-border, #e1e4e8)';
  popover.style.borderRadius = '6px';
  popover.style.padding = '12px';
  popover.style.boxShadow =
    '0 2px 10px var(--di-shadow-light, rgba(0,0,0,0.1))';
  popover.style.fontSize = '11px';
  popover.style.color = 'var(--di-text, #333)';
  popover.style.width = options.width ?? '220px';
}

/**
 * Shared HTML fragment for the "Dashboard Theme" select block used by
 * both settings popovers. Uses inline styles (rather than CSS classes
 * scoped to a specific popover id) so it works as a standalone snippet
 * inside any popover's innerHTML.
 *
 * Pair with `bindDashboardThemeSelect` to wire the change handler.
 */
export const DASHBOARD_THEME_SELECT_HTML = `
  <div style="margin-top:10px; padding-top:8px; border-top:1px solid var(--di-border-light, #eee);">
    <strong>Dashboard Theme</strong>
    <select id="dark-mode-select" style="width:100%; margin-top:4px; padding:3px; border:1px solid var(--di-border-input, #ddd); border-radius:3px; background:var(--di-bg, #fff); color:var(--di-text, #333); font-size:11px;">
      <option value="auto">Auto (follow Danbooru)</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </div>
`;

/**
 * Wires the `#dark-mode-select` inside `popover` to read/write the user's
 * dark-mode preference. Decoupled from SettingsManager and the theme
 * applier so the helper does not have to import either: callers pass
 * `getValue`/`setValue` closures.
 */
export function bindDashboardThemeSelect(
  popover: HTMLElement,
  getValue: () => string,
  setValue: (pref: 'auto' | 'light' | 'dark') => void,
): void {
  const select = popover.querySelector(
    '#dark-mode-select',
  ) as HTMLSelectElement | null;
  if (!select) return;
  select.value = getValue();
  select.addEventListener('change', () => {
    setValue(select.value as 'auto' | 'light' | 'dark');
  });
}

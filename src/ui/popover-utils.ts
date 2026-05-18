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

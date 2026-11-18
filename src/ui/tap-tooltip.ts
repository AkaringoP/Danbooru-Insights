/** Closers of the tap-toggled "?" tooltips, keyed by their wrap element. */
const tapTooltipClosers = new WeakMap<Element, () => void>();

/**
 * Touch behaviour for a "?" tooltip (desktop reveals it on hover/focus in
 * CSS, gated to `(hover: hover)` so a phone's sticky hover / tap focus can't
 * pin it open). A tap on `icon` toggles `openClass` on `wrap`; while open, a
 * tap anywhere else — the note itself, the rest of the page — closes it. The
 * outside-tap listener is attached only while open, in the capture phase so
 * taps whose handlers stop propagation still close it, and it drops itself
 * once `wrap` has been re-rendered away. {@link closeTapTooltips} closes it
 * from outside (e.g. a popover's `hide()`).
 */
export function attachTapTooltip(
  wrap: HTMLElement,
  icon: HTMLElement,
  openClass: string,
): void {
  let onDocClick: ((e: MouseEvent) => void) | null = null;
  const close = () => {
    wrap.classList.remove(openClass);
    if (onDocClick) {
      document.removeEventListener('click', onDocClick, true);
      onDocClick = null;
    }
  };
  icon.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    if (onDocClick) {
      close();
      return;
    }
    wrap.classList.add(openClass);
    // Added during this click's target phase, so it only sees later taps.
    onDocClick = ev => {
      if (!wrap.isConnected || !icon.contains(ev.target as Node)) close();
    };
    document.addEventListener('click', onDocClick, true);
  });
  tapTooltipClosers.set(wrap, close);
}

/** Closes every open tap tooltip whose wrap inside `root` matches `selector`. */
export function closeTapTooltips(root: Element, selector: string): void {
  root.querySelectorAll(selector).forEach(w => tapTooltipClosers.get(w)?.());
}

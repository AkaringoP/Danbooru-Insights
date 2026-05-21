/**
 * Shared chrome for full-screen overlay modals.
 *
 * Both `UserAnalyticsApp` and `TagAnalyticsApp` previously hand-rolled
 * near-identical lifecycle plumbing: history.pushState on open, popstate
 * to close on browser back, Escape key to close, click-outside on the
 * backdrop to close, lockBodyScroll/unlockBodyScroll. The DOM content
 * inside the overlay differs per app (and stays caller-owned via
 * `innerHtml`), but the lifecycle is identical.
 *
 * One nuance preserved as a knob: `UserAnalyticsApp` fades the overlay
 * via `.visible` CSS class with a 200ms transition, while `TagAnalyticsApp`
 * toggles `display` directly. The helper carries both flows behind
 * `useFadeTransition`.
 */
import {lockBodyScroll, unlockBodyScroll} from '../core/scroll-lock';

export interface ModalOptions {
  /**
   * Overlay element id. Also used as the `history.state.diModalOpen`
   * sentinel so multiple modals on the same page can each route their
   * own browser-back close.
   */
  id: string;

  /** HTML inserted into the overlay (window, close button, content area). */
  innerHtml: string;

  /**
   * Returns the effective theme for `data-di-theme`. Called once at
   * create-time. Omit to skip theme attribution.
   */
  resolveTheme?: () => 'light' | 'dark';

  /**
   * Use the `.visible` CSS-class fade transition (200ms) instead of
   * toggling `style.display` directly. Default: false.
   */
  useFadeTransition?: boolean;

  /** Synchronous hook fired before the hide path begins. */
  onBeforeClose?: () => void;

  /**
   * Hook fired after the hide completes (after the fade delay when
   * `useFadeTransition` is set).
   */
  onAfterClose?: () => void;
}

export interface ModalHandle {
  overlay: HTMLElement;
  toggle: (show: boolean) => void;
}

const FADE_MS = 200;
const handles = new WeakMap<HTMLElement, ModalHandle>();

/**
 * Creates (or returns) the overlay for a modal with the given options.
 * Idempotent: subsequent calls for the same `id` reuse the existing
 * handle, so wiring listeners or duplicate elements is impossible.
 */
export function createModal(options: ModalOptions): ModalHandle {
  const existingEl = document.getElementById(options.id);
  if (existingEl) {
    const existingHandle = handles.get(existingEl);
    if (existingHandle) return existingHandle;
  }

  const overlay =
    (existingEl as HTMLElement | null) ?? document.createElement('div');
  if (!existingEl) {
    overlay.id = options.id;
    if (options.resolveTheme?.() === 'dark') {
      overlay.setAttribute('data-di-theme', 'dark');
    }
    overlay.innerHTML = options.innerHtml;
    document.body.appendChild(overlay);
  }

  const isCurrentlyVisible = (): boolean =>
    options.useFadeTransition
      ? overlay.classList.contains('visible')
      : overlay.style.display !== 'none' && overlay.style.display !== '';

  const toggle = (show: boolean): void => {
    if (show) {
      if (history.state?.diModalOpen !== options.id) {
        history.pushState({diModalOpen: options.id}, '', location.href);
      }
      overlay.style.display = 'flex';
      if (options.useFadeTransition) {
        requestAnimationFrame(() => overlay.classList.add('visible'));
      }
      lockBodyScroll();
      return;
    }

    // Route through history.back() so the URL stays in sync; the
    // popstate listener re-enters this branch with state cleared.
    if (history.state?.diModalOpen === options.id) {
      history.back();
      return;
    }

    options.onBeforeClose?.();

    if (options.useFadeTransition) {
      overlay.classList.remove('visible');
      setTimeout(() => {
        overlay.style.display = 'none';
        unlockBodyScroll();
        options.onAfterClose?.();
      }, FADE_MS);
    } else {
      overlay.style.display = 'none';
      unlockBodyScroll();
      options.onAfterClose?.();
    }
  };

  // Close when the backdrop itself receives the click (children pass through).
  overlay.addEventListener('click', e => {
    if (e.target === overlay) toggle(false);
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isCurrentlyVisible()) toggle(false);
  });

  window.addEventListener('popstate', () => {
    if (isCurrentlyVisible() && history.state?.diModalOpen !== options.id) {
      toggle(false);
    }
  });

  const handle: ModalHandle = {overlay, toggle};
  handles.set(overlay, handle);
  return handle;
}

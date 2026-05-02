/**
 * Cross-browser body scroll lock used by full-screen modals.
 *
 * Plain `document.body.style.overflow = 'hidden'` is unreliable on iOS
 * Safari and some Android Chrome builds — the user can still rubber-band
 * past the modal or trigger underlying page scroll. The standard
 * workaround is to set `position: fixed` on the body with the saved
 * scrollY as a negative `top`, which freezes the page underneath.
 *
 * The lock supports nesting (e.g. UserAnalytics modal opens, then a
 * sub-modal opens) via a refcount — the outermost lock/unlock pair is
 * the one that actually toggles the styles.
 */

let savedScrollY = 0;
let lockCount = 0;
let savedBody: {
  position: string;
  top: string;
  width: string;
  overflow: string;
} | null = null;
let savedHtml: {overflow: string} | null = null;

export function lockBodyScroll(): void {
  if (lockCount++ > 0) return;
  savedScrollY = window.scrollY;
  savedBody = {
    position: document.body.style.position,
    top: document.body.style.top,
    width: document.body.style.width,
    overflow: document.body.style.overflow,
  };
  savedHtml = {overflow: document.documentElement.style.overflow};
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollY}px`;
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
}

export function unlockBodyScroll(): void {
  if (lockCount === 0) return;
  if (--lockCount > 0) return;
  if (savedBody) {
    document.body.style.position = savedBody.position;
    document.body.style.top = savedBody.top;
    document.body.style.width = savedBody.width;
    document.body.style.overflow = savedBody.overflow;
  }
  if (savedHtml) {
    document.documentElement.style.overflow = savedHtml.overflow;
  }
  window.scrollTo(0, savedScrollY);
  savedBody = null;
  savedHtml = null;
}

/** Test-only helper: reset the module's lockCount/state. */
export function _resetScrollLockForTests(): void {
  lockCount = 0;
  savedBody = null;
  savedHtml = null;
  savedScrollY = 0;
}

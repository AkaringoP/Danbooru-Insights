/**
 * Favicon fallback for thumbnails that fail to load.
 *
 * Danbooru enforces a Content-Security-Policy without `unsafe-inline` in
 * `script-src` since 2026-11-11 (danbooru commit e0f459e), so an inline
 * `onerror="…"` attribute in HTML we inject no longer runs. Instead, mark
 * the `<img>` with {@link THUMB_FALLBACK_CLASS} and call
 * {@link installThumbFallback} on a container that outlives its innerHTML.
 */

/** Class marking an `<img>` that should fall back to the site favicon. */
export const THUMB_FALLBACK_CLASS = 'di-thumb-fallback';

const FALLBACK_SRC = '/favicon.ico';

/** Containers that already carry the listener. */
const installed = new WeakSet<EventTarget>();

/**
 * Swaps a failed thumbnail for the favicon, once. A second `error` (the
 * favicon itself failing) leaves the image alone instead of looping.
 */
export function applyThumbFallback(img: HTMLImageElement): void {
  if (img.dataset.diFallback === '1') return;
  img.dataset.diFallback = '1';
  img.src = FALLBACK_SRC;
  img.style.objectFit = 'contain';
  img.style.padding = '4px';
}

/**
 * Installs one capture-phase `error` listener on `root` that applies the
 * fallback to any failed `img.di-thumb-fallback` inside it. An `<img>`'s
 * `error` event does not bubble, so the capture phase is required. Install
 * it before assigning the container's innerHTML; the listener survives
 * later innerHTML replacements. Idempotent per container.
 */
export function installThumbFallback(root: HTMLElement): void {
  if (installed.has(root)) return;
  installed.add(root);
  root.addEventListener(
    'error',
    e => {
      const target = e.target;
      if (
        target instanceof HTMLImageElement &&
        target.classList.contains(THUMB_FALLBACK_CLASS)
      ) {
        applyThumbFallback(target);
      }
    },
    true,
  );
}

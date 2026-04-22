/**
 * Toast notification component for Danbooru Insights.
 *
 * Displays non-blocking, auto-dismissing messages in the bottom-right corner.
 * Replaces alert() calls with a consistent in-page notification system.
 *
 * Usage:
 *   import { showToast } from '../ui/toast';
 *   showToast({ type: 'success', message: 'Settings saved.' });
 *   showToast({ type: 'error', message: 'Sync failed.', duration: 8000 });
 */

export type ToastType = 'success' | 'error' | 'warn' | 'info';

export interface ToastOptions {
  type: ToastType;
  message: string;
  /** Override auto-dismiss duration in ms. Set 0 to disable auto-dismiss. */
  duration?: number;
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  warn: 5000,
  error: 10000,
};

const MAX_TOASTS = 5;

/** Active toast elements, oldest first. */
const activeToasts: HTMLElement[] = [];

let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.className = 'di-toast-container';
  document.body.appendChild(container);
  return container;
}

function removeToast(el: HTMLElement): void {
  el.classList.remove('di-toast-visible');
  el.classList.add('di-toast-exit');
  const onEnd = () => {
    el.removeEventListener('transitionend', onEnd);
    el.remove();
    const idx = activeToasts.indexOf(el);
    if (idx !== -1) activeToasts.splice(idx, 1);
  };
  el.addEventListener('transitionend', onEnd);
  // Fallback removal if transitionend doesn't fire (e.g. display:none)
  setTimeout(onEnd, 350);
}

/**
 * Show a toast notification.
 */
export function showToast(options: ToastOptions): void {
  const {type, message} = options;
  const duration = options.duration ?? DEFAULT_DURATIONS[type];

  const parent = getContainer();

  // Evict oldest toasts beyond the max.
  while (activeToasts.length >= MAX_TOASTS) {
    const oldest = activeToasts.shift();
    if (oldest) removeToast(oldest);
  }

  const el = document.createElement('div');
  el.className = `di-toast di-toast-${type}`;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'di-toast-message';
  msgSpan.textContent = message;
  el.appendChild(msgSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'di-toast-close';
  closeBtn.textContent = '\u00d7'; // ×
  closeBtn.addEventListener('click', () => removeToast(el));
  el.appendChild(closeBtn);

  parent.appendChild(el);
  activeToasts.push(el);

  // Trigger enter animation on next frame.
  requestAnimationFrame(() => {
    el.classList.add('di-toast-visible');
  });

  // Auto-dismiss.
  if (duration > 0) {
    setTimeout(() => {
      if (document.body.contains(el)) {
        removeToast(el);
      }
    }, duration);
  }
}

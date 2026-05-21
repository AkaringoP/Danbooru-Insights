/**
 * Reusable "widget locked — more uploads needed" placeholder.
 *
 * Drawn in place of a real widget when the target user has fewer uploads
 * than the widget's `requiredCount` threshold. Shows the current/required
 * progress, a progress bar, and a short explanation.
 *
 * v9.6.0 callers: Tag Cloud (threshold 100) and Scatter Plot (threshold 300)
 * in [src/apps/user-analytics-app.ts]. v10 work will extend this to other
 * widgets — see `docs/v10/` for the customization roadmap.
 */
import {createLogger} from '../core/logger';

const log = createLogger('WidgetLocked');

export interface WidgetLockedPlaceholderOptions {
  /** Human-readable widget name (e.g. "Tag Cloud"). */
  widgetTitle: string;
  /** Optional emoji/icon shown next to the title (e.g. "🏷️"). */
  icon?: string;
  /** The user's current upload count. */
  currentCount: number;
  /** Upload count required to unlock the widget. */
  requiredCount: number;
  /** Short message explaining what unlocks at the threshold. */
  unlockMessage: string;
}

/**
 * Replaces the contents of `container` with a locked-widget placeholder.
 * The container is expected to be a sibling-level widget container that the
 * caller would otherwise fill with a real widget body.
 */
export function renderWidgetLockedPlaceholder(
  container: HTMLElement,
  options: WidgetLockedPlaceholderOptions,
): void {
  const {widgetTitle, icon, currentCount, requiredCount, unlockMessage} =
    options;
  if (requiredCount <= 0) {
    log.warn(
      'renderWidgetLockedPlaceholder called with non-positive required',
      {
        requiredCount,
      },
    );
    return;
  }

  const cappedCurrent = Math.max(0, Math.min(currentCount, requiredCount));
  const percent = Math.round((cappedCurrent / requiredCount) * 100);

  container.replaceChildren();
  container.classList.add('di-widget-locked');

  const card = document.createElement('div');
  card.className = 'di-widget-locked-card';

  const header = document.createElement('div');
  header.className = 'di-widget-locked-header';
  if (icon) {
    const iconEl = document.createElement('span');
    iconEl.className = 'di-widget-locked-icon';
    iconEl.textContent = icon;
    header.appendChild(iconEl);
  }
  const title = document.createElement('span');
  title.className = 'di-widget-locked-title';
  title.textContent = widgetTitle;
  header.appendChild(title);
  card.appendChild(header);

  const state = document.createElement('div');
  state.className = 'di-widget-locked-state';
  state.textContent = '⏳ More uploads needed';
  card.appendChild(state);

  const progressTrack = document.createElement('div');
  progressTrack.className = 'di-widget-locked-progress';
  progressTrack.setAttribute('role', 'progressbar');
  progressTrack.setAttribute('aria-valuenow', String(cappedCurrent));
  progressTrack.setAttribute('aria-valuemin', '0');
  progressTrack.setAttribute('aria-valuemax', String(requiredCount));
  const progressFill = document.createElement('div');
  progressFill.className = 'di-widget-locked-progress-fill';
  progressFill.style.width = `${percent}%`;
  progressTrack.appendChild(progressFill);
  card.appendChild(progressTrack);

  const counter = document.createElement('div');
  counter.className = 'di-widget-locked-counter';
  counter.textContent = `${currentCount} / ${requiredCount}`;
  card.appendChild(counter);

  const message = document.createElement('div');
  message.className = 'di-widget-locked-message';
  message.textContent = unlockMessage;
  card.appendChild(message);

  container.appendChild(card);
}

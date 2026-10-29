/**
 * "At a glance" rendering, shared by two hosts:
 *  - the dashboard card ({@link mountProfileSummaryCard}) — a full-width card
 *    above the summary grid, built from every synced upload;
 *  - the preview popover's top section — the newest-200 view (the popover
 *    calls {@link renderSummaryText} into its own container).
 *
 * Built with DOM nodes (textContent / setAttribute), never HTML strings, so
 * tag names and titles cannot inject markup.
 */
import type {ProfileSummary, SummaryPart} from '../types';

const CARD_CLASS = 'di-ps-card';

function renderPart(part: SummaryPart): Node {
  if (!part.href && !part.title && !part.severity) {
    return document.createTextNode(part.text);
  }
  const el = document.createElement(part.href ? 'a' : 'span');
  el.textContent = part.text;
  if (part.title) el.setAttribute('title', part.title);
  if (part.href) {
    el.setAttribute('href', part.href);
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener');
    el.className = part.severity
      ? `di-ps-flag di-ps-tone--${part.severity}`
      : part.category
        ? `di-ps-link di-ps-tag--${part.category}`
        : 'di-ps-link';
  } else if (part.severity) {
    el.className = `di-ps-tone--${part.severity}`;
  }
  return el;
}

/** Replaces `container`'s content with the summary lines (one per line). */
export function renderSummaryText(
  container: HTMLElement,
  summary: ProfileSummary,
): void {
  container.textContent = '';
  summary.lines.forEach((line, i) => {
    if (i) container.appendChild(document.createElement('br'));
    for (const part of line) container.appendChild(renderPart(part));
  });
}

/**
 * Inserts the dashboard card as the first child of `parent` (above the
 * summary grid). Returns the card, or null for an empty summary.
 */
export function mountProfileSummaryCard(
  parent: HTMLElement,
  summary: ProfileSummary,
): HTMLElement | null {
  if (!summary.lines.length) return null;
  const card = document.createElement('div');
  card.className = CARD_CLASS;

  const icon = document.createElement('div');
  icon.className = 'di-ps-icon';
  icon.textContent = '🔎';
  const body = document.createElement('div');
  body.className = 'di-ps-body';
  const label = document.createElement('div');
  label.className = 'di-ps-label';
  label.textContent = 'At a glance';
  const text = document.createElement('div');
  text.className = 'di-ps-text';
  renderSummaryText(text, summary);

  body.append(label, text);
  card.append(icon, body);
  parent.insertBefore(card, parent.firstChild);
  return card;
}

/** Re-renders an already-mounted dashboard card in place. */
export function updateProfileSummaryCard(
  root: ParentNode,
  summary: ProfileSummary,
): void {
  const text = root.querySelector<HTMLElement>(`.${CARD_CLASS} .di-ps-text`);
  if (text && summary.lines.length) renderSummaryText(text, summary);
}

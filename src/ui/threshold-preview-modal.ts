/**
 * Preview modal for the auto-tune button. Shows a per-level Before/After
 * comparison for a single metric, then applies via the supplied callback
 * when the user confirms.
 */

import {applyPopoverPalette} from './settings-popover';
import type {Metric, Threshold4} from '../types';

export interface ThresholdPreviewArgs {
  metric: Metric;
  current: Threshold4;
  proposed: Threshold4;
  /** Active grass theme key, used to pick the modal's light/dark palette. */
  themeKey: string;
  onApply: (values: Threshold4) => void;
}

const METRIC_LABEL: Record<Metric, string> = {
  uploads: 'Uploads',
  approvals: 'Approvals',
  notes: 'Notes',
};

/** Same swatch colors used by the threshold input rows in the popover. */
const LEVEL_COLORS = ['#9be9a8', '#40c463', '#30a14e', '#216e39'];

/**
 * Tuning anchor per level — the source of each row's "New" value.
 * Mirrors the percentiles used in `computeAutoThresholds`
 * ([src/core/threshold-tuner.ts](../core/threshold-tuner.ts)). Update both
 * sides together if the percentile mapping ever changes.
 */
const LEVEL_TUNING_LABEL = ['≥1', 'P40', 'P70', 'P90'];

/**
 * Shows the preview modal. Returns nothing — the modal manages its own
 * lifecycle (ESC, backdrop click, Apply, Cancel all dismiss it).
 */
export function showThresholdPreviewModal(args: ThresholdPreviewArgs): void {
  const {metric, current, proposed, themeKey, onApply} = args;

  const backdrop = document.createElement('div');
  backdrop.className = 'di-tt-modal-backdrop';

  const card = document.createElement('div');
  card.className = 'di-tt-modal';

  const header = document.createElement('div');
  header.className = 'di-tt-modal-header';
  header.textContent = `Auto-tune ${METRIC_LABEL[metric]}`;
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'di-tt-modal-body';

  const intro = document.createElement('div');
  intro.className = 'di-tt-modal-intro';
  intro.textContent = "Based on this user's last 180 days of activity:";
  body.appendChild(intro);

  const table = document.createElement('div');
  table.className = 'di-tt-modal-table';

  const headerRow = document.createElement('div');
  headerRow.className = 'di-tt-modal-trow di-tt-modal-trow-head';
  headerRow.innerHTML =
    '<div class="di-tt-modal-tcol-swatch"></div>' +
    '<div class="di-tt-modal-tcol-label"></div>' +
    '<div class="di-tt-modal-tcol-val">Now</div>' +
    '<div class="di-tt-modal-tcol-arrow"></div>' +
    '<div class="di-tt-modal-tcol-val">New</div>';
  table.appendChild(headerRow);

  for (let i = 0; i < 4; i++) {
    const row = document.createElement('div');
    row.className = 'di-tt-modal-trow';
    const changed = current[i] !== proposed[i];
    if (!changed) row.classList.add('di-tt-modal-trow-unchanged');

    const swatch = document.createElement('div');
    swatch.className = 'di-tt-modal-tcol-swatch';
    const sw = document.createElement('span');
    sw.className = 'di-tt-modal-swatch';
    sw.style.background = LEVEL_COLORS[i];
    swatch.appendChild(sw);

    const label = document.createElement('div');
    label.className = 'di-tt-modal-tcol-label';
    const levelText = document.createElement('span');
    levelText.textContent = `Level ${i + 1}`;
    const tuneText = document.createElement('span');
    tuneText.className = 'di-tt-modal-tcol-tune';
    tuneText.textContent = ` (${LEVEL_TUNING_LABEL[i]})`;
    label.appendChild(levelText);
    label.appendChild(tuneText);

    const before = document.createElement('div');
    before.className = 'di-tt-modal-tcol-val di-tt-modal-tcol-before';
    before.textContent = String(current[i]);

    const arrow = document.createElement('div');
    arrow.className = 'di-tt-modal-tcol-arrow';
    if (!changed) {
      arrow.textContent = '=';
    } else if (proposed[i] > current[i]) {
      arrow.textContent = '↑';
      arrow.classList.add('di-tt-modal-arrow-up');
    } else {
      arrow.textContent = '↓';
      arrow.classList.add('di-tt-modal-arrow-down');
    }

    const after = document.createElement('div');
    after.className = 'di-tt-modal-tcol-val di-tt-modal-tcol-after';
    after.textContent = String(proposed[i]);

    row.appendChild(swatch);
    row.appendChild(label);
    row.appendChild(before);
    row.appendChild(arrow);
    row.appendChild(after);
    table.appendChild(row);
  }

  body.appendChild(table);

  const foot = document.createElement('div');
  foot.className = 'di-tt-modal-foot';
  foot.textContent = 'Px = x-th percentile of active-day counts.';
  body.appendChild(foot);

  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'di-tt-modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'di-tt-modal-btn di-tt-modal-btn-secondary';
  cancelBtn.textContent = 'Cancel';

  const applyBtn = document.createElement('button');
  applyBtn.className = 'di-tt-modal-btn di-tt-modal-btn-primary';
  applyBtn.textContent = 'Apply';

  actions.appendChild(cancelBtn);
  actions.appendChild(applyBtn);
  card.appendChild(actions);

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  // Mirror the popover's theme palette onto the modal so it doesn't appear
  // as a stark white card on top of dark grass themes.
  applyPopoverPalette([backdrop, card], themeKey);

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  // Stop click events from reaching document — the settings popover's
  // "close on outside click" handler would otherwise dismiss the popover
  // along with the modal.
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) close();
    e.stopPropagation();
  });
  card.addEventListener('click', e => {
    e.stopPropagation();
  });

  cancelBtn.addEventListener('click', close);
  applyBtn.addEventListener('click', () => {
    onApply(proposed);
    close();
  });

  applyBtn.focus();
}

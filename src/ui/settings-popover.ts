import {CONFIG} from '../config';
import {DataManager} from '../core/data-manager';
import {createClickOutsideHandler} from './popover-utils';
import {showToast} from './toast';
import {showThresholdPreviewModal} from './threshold-preview-modal';
import {
  computeAutoThresholds,
  dismissSuggestion,
  fetchActiveDayCounts,
  MIN_ACTIVE_DAYS,
} from '../core/threshold-tuner';
import type {SettingsManager} from '../core/settings';
import type {Metric, GrassOption, ScheduleInterval, Threshold4} from '../types';
import type {Database} from '../core/database';

/** Display labels for the toast/modal copy (capitalized metric names). */
const METRIC_LABEL: Record<Metric, string> = {
  uploads: 'Uploads',
  approvals: 'Approvals',
  notes: 'Notes',
};

/** Light palette for popover elements (when a light grass theme is selected). */
const POPOVER_LIGHT: Record<string, string> = {
  '--di-bg': '#ffffff',
  '--di-text': '#333',
  '--di-text-heading': '#444',
  '--di-text-muted': '#888',
  '--di-btn-text': '#555',
  '--di-border-input': '#ddd',
  '--di-border-light': '#eee',
  '--di-shadow': 'rgba(0,0,0,0.2)',
  '--di-shadow-light': 'rgba(0,0,0,0.1)',
  '--di-link': '#007bff',
  '--di-bg-tertiary': '#f0f0f0',
};

/** Dark palette for popover elements (when a dark grass theme is selected). */
const POPOVER_DARK: Record<string, string> = {
  '--di-bg': '#1a1a2e',
  '--di-text': '#e0e0e0',
  '--di-text-heading': '#d0d0d0',
  '--di-text-muted': '#888',
  '--di-btn-text': '#ccc',
  '--di-border-input': '#444466',
  '--di-border-light': '#2e2e48',
  '--di-shadow': 'rgba(0,0,0,0.5)',
  '--di-shadow-light': 'rgba(0,0,0,0.3)',
  '--di-link': '#58a6ff',
  '--di-bg-tertiary': '#2a2a44',
};

/** Dark grass theme keys (bottom row in the theme grid). */
const DARK_THEMES = new Set([
  'midnight',
  'solarized_dark',
  'newspaper',
  'ocean',
  'monokai',
  'ember',
]);

/** Apply popover palette based on the selected grass theme. */
export function applyPopoverPalette(
  elements: HTMLElement[],
  themeKey: string,
): void {
  const palette = DARK_THEMES.has(themeKey) ? POPOVER_DARK : POPOVER_LIGHT;
  for (const el of elements) {
    for (const [prop, val] of Object.entries(palette)) {
      el.style.setProperty(prop, val);
    }
  }
}

/** Options for constructing the settings popover. */
export interface SettingsPopoverOptions {
  settingsManager: SettingsManager;
  db: Database;
  metric: string;
  settingsBtn: HTMLElement;
  /**
   * The viewed profile's userId (or username fallback). Used by the
   * auto-tune button to write per-profile threshold overrides.
   */
  targetUserId: string;
  /** Called when settings have changed and the graph should re-render. */
  closeSettings: () => void;
  onRefresh: () => void;
}

/** Return value of createSettingsPopover. */
export interface SettingsPopoverResult {
  popover: HTMLElement;
  /** Close the popover, validating thresholds first. */
  close: () => void;
  /**
   * Re-render the threshold editor inputs from the current settings, and
   * (when `metric` is supplied) align the metric dropdown to it. Call
   * just before showing the popover so external changes (e.g. the
   * auto-tune suggestion toast writing per-profile values while the
   * popover is closed) and main-metric switches are visible on next open.
   */
  refresh: (metric?: string) => void;
}

/**
 * Creates the settings popover element with theme picker, thresholds editor,
 * and cache info section.
 * @param {SettingsPopoverOptions} options Construction options.
 * @return {SettingsPopoverResult} The popover element and its close function.
 */
export function createSettingsPopover(
  options: SettingsPopoverOptions,
): SettingsPopoverResult {
  const {
    settingsManager,
    db,
    metric,
    settingsBtn,
    targetUserId,
    closeSettings,
    onRefresh,
  } = options;

  let settingsChanged = false;

  const validateThresholds = (): {valid: boolean; msg?: string} => {
    const modes: Metric[] = ['uploads', 'approvals', 'notes'];
    for (const m of modes) {
      const vals = settingsManager.getThresholdsForView(targetUserId, m);
      for (let i = 0; i < vals.length - 1; i++) {
        if (vals[i] >= vals[i + 1]) {
          return {
            valid: false,
            msg: `Invalid in [${m}]: Level ${i + 1} (${vals[i]}) must be smaller than Level ${i + 2} (${vals[i + 1]})`,
          };
        }
      }
    }
    return {valid: true};
  };

  const handleClose = (): void => {
    const check = validateThresholds();
    if (!check.valid) {
      showToast({type: 'warn', message: check.msg ?? 'Invalid settings.'});
      return;
    }
    popover.style.display = 'none';
    const gf = document.getElementById('danbooru-grass-flyout');
    if (gf) gf.style.display = 'none';
    if (settingsChanged) {
      settingsChanged = false;
      closeSettings();
    }
  };

  // Build popover element
  const popover = document.createElement('div');
  popover.id = 'danbooru-grass-settings-popover';

  // Reposition popover on page scroll to stay anchored to settings button
  const repositionPopover = () => {
    if (popover.style.display !== 'block') return;
    const btnRect = settingsBtn.getBoundingClientRect();
    popover.style.left = btnRect.left + 'px';
    popover.style.top = btnRect.bottom + 4 + 'px';
  };
  window.addEventListener(
    'scroll',
    e => {
      if (
        popover.style.display === 'block' &&
        !popover.contains(e.target as Node)
      ) {
        repositionPopover();
      }
    },
    true,
  );

  // --- 1. Color Themes Section ---
  const themeHeaderRow = document.createElement('div');
  themeHeaderRow.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
  const themeHeader = document.createElement('div');
  themeHeader.className = 'popover-header';
  themeHeader.style.margin = '0';
  themeHeader.textContent = 'Color Themes';
  const previewLink = document.createElement('a');
  previewLink.href =
    'https://akaringop.github.io/Danbooru-Insights/theme-preview.html';
  previewLink.target = '_blank';
  previewLink.rel = 'noopener';
  previewLink.textContent = 'Preview all';
  previewLink.style.cssText =
    'font-size:11px;color:var(--di-link,#007bff);text-decoration:none;opacity:0.7;';
  previewLink.onmouseenter = () => {
    previewLink.style.opacity = '1';
  };
  previewLink.onmouseleave = () => {
    previewLink.style.opacity = '0.7';
  };
  themeHeaderRow.appendChild(themeHeader);
  themeHeaderRow.appendChild(previewLink);
  popover.appendChild(themeHeaderRow);

  const grid = document.createElement('div');
  grid.className = 'theme-grid';

  const currentTheme = settingsManager.getTheme();

  Object.entries(CONFIG.THEMES).forEach(([key, theme]) => {
    const icon = document.createElement('div');
    icon.className = 'theme-icon';
    if (key === currentTheme) icon.classList.add('active'); // Highlight active theme
    icon.title = theme.name;
    icon.style.background = theme.bg;

    // Inner Circle (Empty Cell Color)
    const inner = document.createElement('div');
    inner.className = 'theme-icon-inner';
    inner.style.background = theme.empty;
    icon.appendChild(inner);

    icon.onclick = () => {
      const wasActive = icon.classList.contains('active');
      if (!wasActive) {
        settingsManager.applyTheme(key);
        document
          .querySelectorAll('.theme-icon')
          .forEach(el => el.classList.remove('active'));
        icon.classList.add('active');
        // Update popover palette to match the selected grass theme
        applyPopoverPalette([popover, grassFlyout, schedHelpTip], key);
      }
      // Toggle grass flyout (show on click of active theme, or on first apply)
      toggleGrassFlyout(icon, key);
    };
    grid.appendChild(icon);
  });
  popover.appendChild(grid);

  // --- 1b. Grass Color Flyout ---
  const grassFlyout = document.createElement('div');
  grassFlyout.id = 'danbooru-grass-flyout';
  grassFlyout.style.cssText =
    'position:fixed;display:none;background:var(--di-bg, #fff);border:1px solid var(--di-border-input, #ddd);border-radius:8px;box-shadow:0 4px 12px var(--di-shadow, rgba(0,0,0,0.2));padding:8px;z-index:10001;flex-direction:column;gap:6px;';
  document.body.appendChild(grassFlyout);

  // Close on click outside. Guarded by display:block so the listener stays
  // attached for the page lifetime (popover is built once and toggled).
  document.addEventListener(
    'click',
    createClickOutsideHandler(
      popover,
      () => {
        if (popover.style.display === 'block') handleClose();
      },
      {ignore: [settingsBtn, grassFlyout]},
    ),
  );

  let currentFlyoutKey = '';

  const toggleGrassFlyout = (anchorEl: HTMLElement, themeKey: string) => {
    if (grassFlyout.style.display !== 'none' && currentFlyoutKey === themeKey) {
      grassFlyout.style.display = 'none';
      return;
    }
    currentFlyoutKey = themeKey;

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      // Anchor flyout directly under the selected theme button on mobile
      const btnRect = anchorEl.getBoundingClientRect();
      grassFlyout.style.left = '10px';
      grassFlyout.style.right = '10px';
      grassFlyout.style.top = btnRect.bottom + 4 + 'px';
      grassFlyout.style.maxWidth = 'calc(100vw - 20px)';
    } else {
      // Position flyout to the right of the popover on desktop
      const popoverRect = popover.getBoundingClientRect();
      grassFlyout.style.left = popoverRect.right + 8 + 'px';
      grassFlyout.style.top = popoverRect.top + 'px';
      grassFlyout.style.right = '';
      grassFlyout.style.maxWidth = '';
    }

    renderGrassFlyout(themeKey);
    grassFlyout.style.display = 'flex';
  };

  const renderGrassFlyout = (themeKey: string) => {
    grassFlyout.innerHTML = '';
    const theme = CONFIG.THEMES[themeKey] || CONFIG.THEMES.light;
    const options: GrassOption[] | undefined = theme.grassOptions;
    if (!options || !Array.isArray(options)) {
      grassFlyout.style.display = 'none';
      return;
    }

    const currentIdx = settingsManager.getGrassIndex(themeKey);

    const title = document.createElement('div');
    title.style.cssText =
      'font-size:10px;color:var(--di-text-muted, #888);font-weight:600;margin-bottom:2px;';
    title.textContent = 'Grass Color';
    grassFlyout.appendChild(title);

    options.forEach((opt: GrassOption, idx: number) => {
      const row = document.createElement('div');
      row.style.cssText =
        'cursor:pointer;display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;border:2px solid transparent;transition:all 0.15s;';
      if (idx === currentIdx) row.style.borderColor = 'var(--di-link, #007bff)';

      // Mini heatmap (4 cells)
      const preview = document.createElement('div');
      preview.style.cssText = 'display:flex;gap:2px;';
      for (let i = 1; i < opt.levels.length; i++) {
        const cell = document.createElement('div');
        cell.style.cssText = `width:12px;height:12px;border-radius:2px;background:${opt.levels[i]};`;
        preview.appendChild(cell);
      }
      row.appendChild(preview);

      const label = document.createElement('div');
      label.style.cssText =
        'font-size:10px;color:var(--di-btn-text, #555);white-space:nowrap;';
      label.textContent = idx === 0 ? `★ ${opt.name}` : opt.name;
      row.appendChild(label);

      row.onmouseover = () => {
        if (idx !== currentIdx)
          row.style.background = 'var(--di-bg-tertiary, #f0f0f0)';
      };
      row.onmouseout = () => {
        row.style.background = '';
      };

      row.onclick = e => {
        e.stopPropagation();
        settingsManager.setGrassIndex(themeKey, idx);
        settingsManager.applyTheme(themeKey);
        grassFlyout.style.display = 'none';
      };

      grassFlyout.appendChild(row);
    });
  };

  // Close flyout when clicking outside
  popover.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (!grassFlyout.contains(target) && !target.closest('.theme-icon')) {
      grassFlyout.style.display = 'none';
    }
  });

  // --- 1c. Snap-to-Edge Toggle (lives between the theme grid and the
  // thresholds section per user preference — the threshold-related
  // controls below stay grouped together). ---
  const snapRow = document.createElement('div');
  snapRow.style.cssText =
    'display:flex;align-items:center;gap:6px;margin-top:12px;';
  const snapCheckbox = document.createElement('input');
  snapCheckbox.type = 'checkbox';
  snapCheckbox.id = 'di-snap-to-edge';
  snapCheckbox.checked = settingsManager.getSnapToEdge();
  snapCheckbox.style.cssText = 'margin:0;cursor:pointer;';
  const snapLabel = document.createElement('label');
  snapLabel.htmlFor = 'di-snap-to-edge';
  snapLabel.textContent = 'Snap to edge when resizing';
  snapLabel.style.cssText =
    'font-size:11px;color:var(--di-text, #333);cursor:pointer;user-select:none;';
  snapCheckbox.onchange = () => {
    settingsManager.setSnapToEdge(snapCheckbox.checked);
  };
  snapRow.appendChild(snapCheckbox);
  snapRow.appendChild(snapLabel);
  popover.appendChild(snapRow);

  // --- 2. Thresholds Section ---
  // Divider above visually separates the general UI options (snap-to-edge)
  // from the threshold-related controls below.
  const threshHeaderRow = document.createElement('div');
  threshHeaderRow.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;' +
    'margin-top:14px;padding-top:12px;margin-bottom:6px;' +
    'border-top:1px solid var(--di-border-input, #ddd);';
  const threshHeader = document.createElement('div');
  threshHeader.className = 'popover-header';
  threshHeader.style.margin = '0';
  threshHeader.textContent = 'Set thresholds';
  threshHeaderRow.appendChild(threshHeader);

  const autoTuneBtn = document.createElement('button');
  autoTuneBtn.className = 'di-autotune-btn';
  autoTuneBtn.title = "Auto-tune from this user's recent 180-day activity";
  autoTuneBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/>' +
    '</svg>';
  threshHeaderRow.appendChild(autoTuneBtn);
  popover.appendChild(threshHeaderRow);

  // Mode Selector
  const modeSelect = document.createElement('select');
  modeSelect.className = 'popover-select';
  ['uploads', 'approvals', 'notes'].forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m.charAt(0).toUpperCase() + m.slice(1);
    if (m === metric.toLowerCase() || (m === 'uploads' && !metric))
      opt.selected = true;
    modeSelect.appendChild(opt);
  });
  popover.appendChild(modeSelect);

  // Editor Container
  const editor = document.createElement('div');
  popover.appendChild(editor);

  const renderEditor = (mode: string): void => {
    editor.innerHTML = '';
    const metricMode = mode as Metric;
    // WYSIWYG: show whatever is currently active for this profile/metric
    // (per-profile override if set, else global). Edits write back to the
    // same layer, so the inputs and the rendered grass never diverge.
    const vals = settingsManager.getThresholdsForView(targetUserId, metricMode);
    const inputColors = ['#9be9a8', '#40c463', '#30a14e', '#216e39'];

    vals.forEach((val, idx) => {
      const row = document.createElement('div');
      row.className = 'threshold-row';

      const label = document.createElement('span');
      label.textContent = `Level ${idx + 1}:`;
      label.style.width = '50px';

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'threshold-input';
      input.value = String(val);

      // Styling
      input.style.backgroundColor = inputColors[idx];
      input.style.color = '#ffffff';
      input.style.textShadow = '0px 1px 2px rgba(0,0,0,0.8)';
      input.style.fontWeight = 'bold';
      input.style.border = '1px solid var(--di-border-input, #ddd)';
      input.style.borderRadius = '4px';

      input.onchange = () => {
        const newVals: Threshold4 = [vals[0], vals[1], vals[2], vals[3]];
        newVals[idx] = parseInt(input.value);
        if (settingsManager.hasProfileThresholds(targetUserId, metricMode)) {
          settingsManager.setProfileThresholds(
            targetUserId,
            metricMode,
            newVals,
          );
        } else {
          settingsManager.setThresholds(metricMode, newVals);
        }
        settingsChanged = true;
        vals[idx] = newVals[idx];
      };

      row.appendChild(label);
      row.appendChild(input);
      editor.appendChild(row);
    });
  };

  modeSelect.addEventListener('change', () => renderEditor(modeSelect.value));
  renderEditor(modeSelect.value); // Initial Render

  autoTuneBtn.addEventListener('click', async () => {
    const currentMetric = modeSelect.value as Metric;
    autoTuneBtn.disabled = true;
    try {
      const samples = await fetchActiveDayCounts(
        db,
        targetUserId,
        currentMetric,
      );
      const proposed = computeAutoThresholds(samples);
      if (proposed === null) {
        showToast({
          type: 'warn',
          message: `Not enough activity data for ${currentMetric} (need ≥${MIN_ACTIVE_DAYS} active days in last 180).`,
        });
        return;
      }
      const current = settingsManager.getThresholdsForView(
        targetUserId,
        currentMetric,
      );
      // Skip the modal entirely when the proposed values match what's
      // already active — applying would be a no-op.
      if (proposed.every((v, i) => v === current[i])) {
        showToast({
          type: 'info',
          message: `${METRIC_LABEL[currentMetric]} thresholds already match the recent activity — nothing to change.`,
        });
        return;
      }
      showThresholdPreviewModal({
        metric: currentMetric,
        current,
        proposed,
        themeKey: settingsManager.getTheme(),
        onApply: values => {
          applyAndOfferUndo(currentMetric, current, values);
        },
      });
    } finally {
      autoTuneBtn.disabled = false;
    }
  });

  /**
   * Persists the new per-profile thresholds, refreshes the popover inputs,
   * triggers a graph re-render *without closing the popover*, and shows an
   * Undo toast that restores the prior state (either the previous override
   * or the bare global fallback) if clicked within the toast duration.
   */
  function applyAndOfferUndo(
    metric: Metric,
    previousValues: Threshold4,
    nextValues: Threshold4,
  ): void {
    const hadOverride = settingsManager.hasProfileThresholds(
      targetUserId,
      metric,
    );

    settingsManager.setProfileThresholds(targetUserId, metric, nextValues);
    settingsManager.setProfileTuneTime(targetUserId, metric, Date.now());
    renderEditor(modeSelect.value);
    // Notify the host (grass-app) to re-render the graph immediately. The
    // popover stays open; settingsChanged is intentionally NOT set so
    // closing the popover later doesn't trigger a redundant re-render.
    closeSettings();

    showToast({
      type: 'success',
      message: `${METRIC_LABEL[metric]} thresholds tuned for this profile.`,
      duration: 8000,
      actions: [
        {
          label: 'Undo',
          onClick: () => {
            if (hadOverride) {
              settingsManager.setProfileThresholds(
                targetUserId,
                metric,
                previousValues,
              );
            } else {
              settingsManager.clearProfileThreshold(targetUserId, metric);
            }
            // Suppress the auto-detect toast for the rest of this session
            // — the user consciously rejected the tuning.
            dismissSuggestion(targetUserId);
            renderEditor(modeSelect.value);
            closeSettings();
          },
        },
      ],
    });
  }

  // --- 2b. Auto-tune Schedule ---
  const scheduleRow = document.createElement('div');
  scheduleRow.style.cssText =
    'display:flex;align-items:center;gap:6px;margin-top:12px;';
  const schedCheckbox = document.createElement('input');
  schedCheckbox.type = 'checkbox';
  schedCheckbox.id = 'di-autotune-schedule';
  schedCheckbox.style.cssText = 'margin:0;cursor:pointer;';
  const schedLabelLeft = document.createElement('label');
  schedLabelLeft.htmlFor = 'di-autotune-schedule';
  schedLabelLeft.textContent = 'Auto-tune every';
  schedLabelLeft.style.cssText =
    'font-size:11px;color:var(--di-text, #333);cursor:pointer;user-select:none;';
  const schedSelect = document.createElement('select');
  // Intentionally NOT using `popover-select` — that class forces width:100%
  // and a bottom margin which break this row's checkbox / label / dropdown
  // alignment. Inline styles match the surrounding 11px text height.
  schedSelect.style.cssText =
    'font-size:11px;line-height:1;padding:2px 4px;margin:0;height:20px;' +
    'border:1px solid var(--di-border-input, #ddd);border-radius:4px;' +
    'background:var(--di-bg-tertiary, #f0f0f0);color:var(--di-text, #333);' +
    'flex:0 0 auto;cursor:pointer;';
  const intervalOptions: Array<[ScheduleInterval, string]> = [
    ['monthly', 'Month'],
    ['quarterly', 'Quarter'],
    ['semiannual', 'Half year'],
    ['yearly', 'Year'],
  ];
  for (const [value, label] of intervalOptions) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    schedSelect.appendChild(opt);
  }

  const initialSchedule = settingsManager.getAutoTuneSchedule();
  schedCheckbox.checked = initialSchedule.enabled;
  schedSelect.value = initialSchedule.interval;
  schedSelect.disabled = !initialSchedule.enabled;

  const persistSchedule = (): void => {
    settingsManager.setAutoTuneSchedule({
      enabled: schedCheckbox.checked,
      interval: schedSelect.value as ScheduleInterval,
    });
  };
  schedCheckbox.onchange = () => {
    schedSelect.disabled = !schedCheckbox.checked;
    persistSchedule();
  };
  schedSelect.onchange = () => {
    persistSchedule();
  };

  // Help icon — clarifies that each interval triggers on the 1st of the
  // relevant period rather than counting forward from when the toggle was
  // turned on. Custom tooltip (not native `title`) so it works on touch
  // devices via tap.
  const schedHelp = document.createElement('span');
  schedHelp.textContent = '?';
  schedHelp.setAttribute('role', 'button');
  schedHelp.setAttribute('aria-label', 'Schedule interval reference');
  schedHelp.setAttribute('tabindex', '0');
  schedHelp.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;' +
    'width:14px;height:14px;border-radius:50%;' +
    'background:var(--di-bg-tertiary, #f0f0f0);' +
    'color:var(--di-text-muted, #888);' +
    'font-size:10px;font-weight:600;cursor:help;' +
    'border:1px solid var(--di-border-input, #ddd);' +
    'flex:0 0 auto;user-select:none;';

  const schedHelpTip = document.createElement('div');
  schedHelpTip.style.cssText =
    'position:fixed;display:none;z-index:10005;' +
    'background:var(--di-bg, #fff);color:var(--di-text, #333);' +
    'border:1px solid var(--di-border-input, #ddd);border-radius:6px;' +
    'padding:8px 10px;font-size:11px;line-height:1.55;' +
    'box-shadow:0 4px 12px var(--di-shadow, rgba(0,0,0,0.2));' +
    'max-width:240px;';
  schedHelpTip.innerHTML =
    '<div><strong>Monthly</strong> · 1st of every month</div>' +
    '<div><strong>Quarterly</strong> · 1st of Jan / Apr / Jul / Oct</div>' +
    '<div><strong>Half year</strong> · 1st of Jan / Jul</div>' +
    '<div><strong>Yearly</strong> · 1st of Jan</div>';
  document.body.appendChild(schedHelpTip);

  const positionSchedHelpTip = (): void => {
    const r = schedHelp.getBoundingClientRect();
    schedHelpTip.style.visibility = 'hidden';
    schedHelpTip.style.display = 'block';
    const tw = schedHelpTip.offsetWidth;
    const vw = window.innerWidth;
    let left = r.right - tw;
    if (left < 8) left = 8;
    if (left + tw > vw - 8) left = vw - tw - 8;
    schedHelpTip.style.left = left + 'px';
    schedHelpTip.style.top = r.bottom + 6 + 'px';
    schedHelpTip.style.visibility = 'visible';
  };
  const showSchedHelpTip = (): void => {
    positionSchedHelpTip();
  };
  const hideSchedHelpTip = (): void => {
    schedHelpTip.style.display = 'none';
  };

  // Stop tooltip clicks from bubbling — otherwise the popover's
  // "close on outside click" handler treats them as outside (the tooltip
  // lives in document.body) and dismisses the popover with the tooltip.
  schedHelpTip.addEventListener('click', e => {
    e.stopPropagation();
  });

  schedHelp.addEventListener('mouseenter', showSchedHelpTip);
  schedHelp.addEventListener('mouseleave', hideSchedHelpTip);
  schedHelp.addEventListener('click', e => {
    e.stopPropagation();
    if (schedHelpTip.style.display === 'block') {
      hideSchedHelpTip();
    } else {
      showSchedHelpTip();
    }
  });
  schedHelp.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      showSchedHelpTip();
    } else if (e.key === 'Escape') {
      hideSchedHelpTip();
    }
  });
  // Tap outside to dismiss (mobile + desktop click).
  document.addEventListener('click', e => {
    if (schedHelpTip.style.display !== 'block') return;
    const t = e.target as Node;
    if (t !== schedHelp && !schedHelpTip.contains(t)) hideSchedHelpTip();
  });

  scheduleRow.appendChild(schedCheckbox);
  scheduleRow.appendChild(schedLabelLeft);
  scheduleRow.appendChild(schedSelect);
  scheduleRow.appendChild(schedHelp);
  popover.appendChild(scheduleRow);

  // --- 3. Cache Info Section ---
  const cacheSection = document.createElement('div');
  cacheSection.style.marginTop = '15px';
  cacheSection.style.borderTop = '1px solid var(--di-border-input, #ddd)';
  cacheSection.style.paddingTop = '10px';

  // Header with Purge Button
  const cacheHeader = document.createElement('div');
  cacheHeader.style.display = 'flex';
  cacheHeader.style.justifyContent = 'space-between';
  cacheHeader.style.alignItems = 'center';
  cacheHeader.style.marginBottom = '5px';
  cacheHeader.innerHTML = `
          <div style="font-weight:bold; color:var(--di-text-heading, #444);">Cache Info</div>
          <button id="grass-purge-btn" title="Purge Cache" style="
            padding: 2px 6px;
            background-color: #ffebe9;
            border: 1px solid #ff818266;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            color: #cf222e;
            line-height: 1;
          ">↺</button>
        `;
  cacheSection.appendChild(cacheHeader);

  // Stats Container (Toggleable)
  const cacheStatsContainer = document.createElement('div');
  cacheStatsContainer.id = 'grass-cache-container';
  cacheStatsContainer.innerHTML = `
          <div style="font-size:12px; margin-bottom:10px;">
            <a href="#" id="grass-cache-trigger" style="color:var(--di-link, #007bff); text-decoration:none;">[ Show Stats ]</a>
          </div>
          <div id="grass-cache-content" style="display:none;"></div>
        `;
  cacheSection.appendChild(cacheStatsContainer);
  popover.appendChild(cacheSection);

  // Logic
  const trigger = cacheSection.querySelector('#grass-cache-trigger');
  const contentDiv = cacheSection.querySelector('#grass-cache-content');
  const purgeBtn = cacheSection.querySelector('#grass-purge-btn');

  const formatBytes = (bytes: number, decimals: number = 2): string => {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  let isStatsVisible = false;
  let statsInterval: ReturnType<typeof setInterval> | null = null;

  const updateMyStats = async (): Promise<void> => {
    const dataManager = new DataManager(db);
    const stats = await dataManager.getCacheStats();
    (contentDiv as HTMLElement).innerHTML = `
            <table style="width:100%; border-collapse:collapse; font-size:11px;">
              <tr style="border-bottom:1px solid var(--di-border-light, #eee);">
                <th style="text-align:left; padding:2px;">Source</th>
                <th style="text-align:right; padding:2px;">Items</th>
                <th style="text-align:right; padding:2px;">Size</th>
              </tr>
              <tr>
                <td style="padding:2px;">IndexedDB</td>
                <td style="text-align:right; padding:2px;">${stats.indexedDB.count}</td>
                <td style="text-align:right; padding:2px;">${formatBytes(stats.indexedDB.size)}</td>
              </tr>
              <tr>
                <td style="padding:2px;">Settings</td>
                <td style="text-align:right; padding:2px;">${stats.localStorage.count}</td>
                <td style="text-align:right; padding:2px;">${formatBytes(stats.localStorage.size)}</td>
              </tr>
            </table>
          `;
  };

  (trigger as HTMLElement).onclick = async e => {
    e.preventDefault();

    if (isStatsVisible) {
      // Hide
      (contentDiv as HTMLElement).style.display = 'none';
      (trigger as HTMLElement).textContent = '[ Show Stats ]';
      isStatsVisible = false;
      if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }
    } else {
      // Show
      (trigger as HTMLElement).textContent = 'Calculating...';
      (contentDiv as HTMLElement).style.display = 'block';
      await updateMyStats(); // Initial load
      (trigger as HTMLElement).textContent = '[ Hide Stats ]';
      isStatsVisible = true;

      // Start Polling (Real-time updates)
      if (statsInterval) clearInterval(statsInterval);
      statsInterval = setInterval(() => {
        if (isStatsVisible && popover.style.display === 'block') {
          // Fire-and-forget: polling UI refresh tick.
          void updateMyStats();
        } else {
          // Safety clear
          if (statsInterval) clearInterval(statsInterval);
        }
      }, 100);
    }
  };

  (purgeBtn as HTMLElement).onclick = () => {
    if (
      confirm(
        'Are you sure you want to clear all cached data? This will trigger a full re-fetch.',
      )
    ) {
      onRefresh();
    }
  };

  // Apply initial popover palette based on current grass theme
  applyPopoverPalette(
    [popover, grassFlyout, schedHelpTip],
    settingsManager.getTheme(),
  );

  return {
    popover,
    close: handleClose,
    refresh: (mainMetric?: string) => {
      if (
        mainMetric &&
        ['uploads', 'approvals', 'notes'].includes(mainMetric) &&
        modeSelect.value !== mainMetric
      ) {
        modeSelect.value = mainMetric;
      }
      renderEditor(modeSelect.value);
    },
  };
}

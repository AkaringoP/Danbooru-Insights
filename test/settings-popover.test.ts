// @vitest-environment jsdom

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

// Mocks for downstream side-effecting deps that would otherwise drag in
// IndexedDB / d3 / toast DOM that's irrelevant to popover structure.
vi.mock('../src/ui/toast', () => ({
  showToast: vi.fn(),
}));
vi.mock('../src/ui/threshold-preview-modal', () => ({
  showThresholdPreviewModal: vi.fn(),
}));
vi.mock('../src/core/threshold-tuner', () => ({
  computeAutoThresholds: vi.fn(() => [1, 5, 10, 20]),
  dismissSuggestion: vi.fn(),
  fetchActiveDayCounts: vi.fn(async () => []),
  MIN_ACTIVE_DAYS: 14,
}));

import {createSettingsPopover} from '../src/ui/settings-popover';
import {SettingsManager} from '../src/core/settings';
import {CONFIG} from '../src/config';
import {showToast} from '../src/ui/toast';
import type {Database} from '../src/core/database';

const TARGET_USER_ID = '999';

function makeSettingsBtn(): HTMLElement {
  const btn = document.createElement('button');
  btn.id = 'di-test-settings-btn';
  document.body.appendChild(btn);
  return btn;
}

function makePopover(metric = 'uploads') {
  const settingsManager = new SettingsManager();
  const closeSettings = vi.fn();
  const onRefresh = vi.fn();
  const settingsBtn = makeSettingsBtn();
  const result = createSettingsPopover({
    settingsManager,
    // The popover only forwards `db` into fetchActiveDayCounts, which is
    // mocked above. A plain cast lets us avoid a Dexie instance in the
    // JSDOM environment.
    db: {} as Database,
    metric,
    settingsBtn,
    targetUserId: TARGET_USER_ID,
    closeSettings,
    onRefresh,
  });
  document.body.appendChild(result.popover);
  return {...result, settingsManager, closeSettings, onRefresh, settingsBtn};
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createSettingsPopover - DOM structure', () => {
  it('creates the popover with the canonical id', () => {
    const {popover} = makePopover();
    expect(popover.id).toBe('danbooru-grass-settings-popover');
    expect(document.getElementById('danbooru-grass-settings-popover')).toBe(
      popover,
    );
  });

  it('renders one theme icon per CONFIG.THEMES entry', () => {
    const {popover} = makePopover();
    const icons = popover.querySelectorAll('.theme-icon');
    expect(icons.length).toBe(Object.keys(CONFIG.THEMES).length);
  });

  it('marks the currently selected theme as active', () => {
    const sm = new SettingsManager();
    sm.applyTheme('ocean');
    const settingsBtn = makeSettingsBtn();
    const {popover} = createSettingsPopover({
      settingsManager: sm,
      db: {} as Database,
      metric: 'uploads',
      settingsBtn,
      targetUserId: TARGET_USER_ID,
      closeSettings: () => {},
      onRefresh: () => {},
    });
    document.body.appendChild(popover);

    const active = popover.querySelectorAll('.theme-icon.active');
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).title).toBe(CONFIG.THEMES.ocean.name);
  });

  it('renders a metric <select> with the three canonical options', () => {
    const {popover} = makePopover();
    const select = popover.querySelector(
      'select.popover-select',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    const optionValues = Array.from(select.options).map(o => o.value);
    expect(optionValues).toEqual(['uploads', 'approvals', 'notes']);
  });

  it('preselects the metric option matching the metric prop', () => {
    const {popover} = makePopover('approvals');
    const select = popover.querySelector(
      'select.popover-select',
    ) as HTMLSelectElement;
    expect(select.value).toBe('approvals');
  });

  it('renders four threshold inputs for the initial metric', () => {
    const {popover} = makePopover();
    const inputs = popover.querySelectorAll('input.threshold-input');
    expect(inputs.length).toBe(4);
  });

  it('renders a snap-to-edge checkbox', () => {
    const {popover} = makePopover();
    const snap = popover.querySelector(
      '#di-snap-to-edge',
    ) as HTMLInputElement | null;
    expect(snap).not.toBeNull();
    expect(snap!.type).toBe('checkbox');
  });
});

describe('createSettingsPopover - threshold editor behaviour', () => {
  it('writes back to global thresholds when no per-profile override exists', () => {
    const {settingsManager, popover} = makePopover();
    const input = popover.querySelectorAll(
      'input.threshold-input',
    )[0] as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('change'));

    const stored = settingsManager.getThresholds('uploads');
    expect(stored[0]).toBe(7);
    // No per-profile entry should have been written.
    expect(
      settingsManager.hasProfileThresholds(TARGET_USER_ID, 'uploads'),
    ).toBe(false);
  });

  it('writes back to per-profile thresholds when an override is already set', () => {
    const sm = new SettingsManager();
    sm.setProfileThresholds(TARGET_USER_ID, 'uploads', [2, 8, 16, 32]);
    const settingsBtn = makeSettingsBtn();
    const {popover} = createSettingsPopover({
      settingsManager: sm,
      db: {} as Database,
      metric: 'uploads',
      settingsBtn,
      targetUserId: TARGET_USER_ID,
      closeSettings: () => {},
      onRefresh: () => {},
    });
    document.body.appendChild(popover);

    const input = popover.querySelectorAll(
      'input.threshold-input',
    )[2] as HTMLInputElement;
    input.value = '99';
    input.dispatchEvent(new Event('change'));

    expect(sm.getThresholdsForView(TARGET_USER_ID, 'uploads')[2]).toBe(99);
    // Global default for uploads should remain untouched.
    expect(sm.getThresholds('uploads')[2]).toBe(25);
  });

  it('re-renders threshold inputs when the metric select changes', () => {
    const {settingsManager, popover} = makePopover('uploads');
    // Seed distinct thresholds so we can spot the swap.
    settingsManager.setThresholds('approvals', [3, 9, 18, 27]);

    const select = popover.querySelector(
      'select.popover-select',
    ) as HTMLSelectElement;
    select.value = 'approvals';
    select.dispatchEvent(new Event('change'));

    const inputs = popover.querySelectorAll(
      'input.threshold-input',
    ) as NodeListOf<HTMLInputElement>;
    expect(Array.from(inputs).map(i => i.value)).toEqual([
      '3',
      '9',
      '18',
      '27',
    ]);
  });
});

describe('createSettingsPopover - close() validation', () => {
  it('hides the popover and fires closeSettings when thresholds are valid', () => {
    const {popover, close, closeSettings} = makePopover();
    popover.style.display = 'block';

    // Mark settings dirty by editing a threshold so closeSettings is invoked.
    const input = popover.querySelectorAll(
      'input.threshold-input',
    )[0] as HTMLInputElement;
    input.value = String(parseInt(input.value) + 0); // no-op edit
    input.dispatchEvent(new Event('change'));

    close();

    expect(popover.style.display).toBe('none');
    expect(closeSettings).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('keeps the popover open and toasts when thresholds are invalid', () => {
    const {settingsManager, popover, close, closeSettings} = makePopover();
    popover.style.display = 'block';

    // Inject an invalid threshold tuple (non-monotonic) directly so the
    // close() validator trips on the way out.
    settingsManager.setThresholds('uploads', [10, 5, 6, 7]);

    close();

    expect(popover.style.display).toBe('block');
    expect(closeSettings).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    const call = (showToast as unknown as {mock: {calls: unknown[][]}}).mock
      .calls[0][0] as {type: string; message: string};
    expect(call.type).toBe('warn');
    expect(call.message).toMatch(/uploads/);
  });
});

describe('createSettingsPopover - refresh()', () => {
  it('repaints input values from the latest settings', () => {
    const {settingsManager, popover, refresh} = makePopover('uploads');

    // External mutation while popover is "closed" — refresh() must pick it up.
    settingsManager.setProfileThresholds(
      TARGET_USER_ID,
      'uploads',
      [4, 14, 24, 34],
    );

    refresh();

    const inputs = popover.querySelectorAll(
      'input.threshold-input',
    ) as NodeListOf<HTMLInputElement>;
    expect(Array.from(inputs).map(i => i.value)).toEqual([
      '4',
      '14',
      '24',
      '34',
    ]);
  });

  it('switches the metric select when a metric argument is given', () => {
    const {popover, refresh} = makePopover('uploads');
    refresh('notes');
    const select = popover.querySelector(
      'select.popover-select',
    ) as HTMLSelectElement;
    expect(select.value).toBe('notes');
  });
});

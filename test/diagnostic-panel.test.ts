// @vitest-environment jsdom

import {describe, it, expect, beforeEach} from 'vitest';
import {showDiagnostic} from '../src/dev/diagnostic';
import {clearCapturedLogs, installLogCapture} from '../src/dev/log-capture';

// jsdom has no indexedDB, so the panel takes its "DB open failed" path and
// builds only the System + Logs sections — exactly the DB-independent part
// this spec covers.

function button(label: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll('button')).find(
    b => b.textContent === label,
  );
  if (!btn) throw new Error(`no ${label} button`);
  return btn;
}

function sectionTitles(): string[] {
  const content = document.querySelector('.di-diag-panel')!.children[1];
  return Array.from(content.children).map(w =>
    (w.children[0].textContent ?? '').replace(/^[▶▼]\s*/, ''),
  );
}

describe('diagnostic panel Logs section', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    installLogCapture();
    clearCapturedLogs();
  });

  it('shows warnings logged after the panel was built, on reopen', async () => {
    await showDiagnostic();
    console.warn('[DI:Analytics:Worker] WARN Page fetch attempt failed', {
      page: 210,
      error: 'HTTP 429',
    });

    button('DI').click(); // reopen → refreshers run
    const text = document.querySelector('.di-diag-panel')!.textContent ?? '';
    expect(text).toContain('Captured: 1 lines (0 error, 1 warn)');
    expect(text).toContain('{"page":210,"error":"HTTP 429"}');
  });

  it('Refresh rebuilds sections without duplicating them', async () => {
    await showDiagnostic();
    const before = sectionTitles();
    expect(before).toContain('Logs');

    const refresh = button('Refresh');
    refresh.click();
    expect(refresh.textContent).toBe('Refreshing…');
    await waitFor(() => !refresh.disabled);

    expect(sectionTitles()).toEqual(before);
  });
});

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !cond(); i++) {
    await new Promise(r => setTimeout(r, 0));
  }
}

/**
 * P2 — multi-tab DB coordination handlers.
 *
 * Validates the `versionchange` and `blocked` handlers added to
 * `src/core/database.ts`. The handlers themselves are exported as
 * standalone functions so they can be tested without instantiating
 * Dexie (the vitest env is `node`, so `window` and IndexedDB are
 * unavailable by default).
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import type Dexie from 'dexie';
import {onVersionChange, onBlocked} from '../src/core/database';

describe('Database multi-tab handlers (P2)', () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reloadMock = vi.fn();
    vi.stubGlobal('window', {location: {reload: reloadMock}});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('onVersionChange', () => {
    it('closes the db and triggers a page reload', () => {
      const closeMock = vi.fn();
      onVersionChange({close: closeMock} as unknown as Dexie);

      expect(closeMock).toHaveBeenCalledOnce();
      expect(reloadMock).toHaveBeenCalledOnce();
    });

    it('closes before reloading to release the connection first', () => {
      const order: string[] = [];
      const closeMock = vi.fn(() => order.push('close'));
      const localReload = vi.fn(() => order.push('reload'));
      vi.stubGlobal('window', {location: {reload: localReload}});

      onVersionChange({close: closeMock} as unknown as Dexie);

      expect(order).toEqual(['close', 'reload']);
    });
  });

  describe('onBlocked', () => {
    it('emits a warn-level diagnostic log', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      onBlocked();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // The logger formats messages with a "[DI:Database] WARN" prefix and
      // the message body — match on the body keyword.
      const firstArg = warnSpy.mock.calls[0][0];
      expect(typeof firstArg).toBe('string');
      expect(firstArg as string).toMatch(/blocked/);
      warnSpy.mockRestore();
    });
  });
});

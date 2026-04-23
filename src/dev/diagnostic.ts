/**
 * Mobile diagnostic overlay for Danbooru Insights.
 *
 * Provides an in-page panel that collects DB, localStorage, and remote API
 * state for all three apps (GrassApp, UserAnalyticsApp, TagAnalyticsApp).
 *
 * Design principles:
 *   - ZERO app dependencies: does not import ProfileContext, Database,
 *     DataManager, or any app class. Uses native indexedDB + raw cursor API
 *     so that diagnostics work even when the app itself is broken.
 *   - Each section wrapped in its own try/catch — one failure doesn't kill the panel.
 *   - Gate: URL hash `#di_diag` or localStorage `di.diag.enabled` === '1'.
 *
 * Activated from main.ts BEFORE the body-class early-return guard.
 */

import {APP_VERSION} from '../version';

// ─── Constants ───────────────────────────────────────────────────────

const DB_NAME = 'DanbooruGrassDB';
const DIAG_GATE_KEY = 'di.diag.enabled';

// ─── Gate ────────────────────────────────────────────────────────────

/** Should the diagnostic panel run on this page load? */
export function shouldRunDiagnostic(): boolean {
  if (window.location.hash.includes('di_diag')) return true;
  try {
    return localStorage.getItem(DIAG_GATE_KEY) === '1';
  } catch {
    return false;
  }
}

// ─── User / Tag extraction (DOM scraping, no app imports) ────────────

function extractUserId(): string | null {
  // 1. body dataset
  const ds = document.body.dataset.currentUserId;
  if (ds) return ds;

  // 2. meta tag
  const meta = document.querySelector('meta[name="current-user-id"]');
  if (meta) return meta.getAttribute('content');

  // 3. edit link
  const editLink = document.querySelector(
    'a[href*="/users/"][href*="/edit"]',
  ) as HTMLAnchorElement | null;
  if (editLink) {
    const m = editLink.href.match(/\/users\/(\d+)/);
    if (m) return m[1];
  }

  // 4. messages link
  const msgLink = document.querySelector(
    'a[href*="/dmails"]',
  ) as HTMLAnchorElement | null;
  if (msgLink) {
    const parent = msgLink.closest('[data-user-id]') as HTMLElement | null;
    if (parent?.dataset.userId) return parent.dataset.userId;
  }

  return null;
}

/** Extract profile page target user ID from the URL path. */
function extractProfileUserId(): string | null {
  const path = window.location.pathname;
  // /users/12345 or /users/12345/...
  const m = path.match(/^\/users\/(\d+)/);
  return m ? m[1] : null;
}

function extractTagName(): string | null {
  const path = window.location.pathname;

  // /wiki_pages/TAG_NAME
  if (path.startsWith('/wiki_pages/')) {
    const segs = path.split('/').filter(Boolean);
    if (
      segs.length === 2 &&
      !['search', 'show_or_new', 'new'].includes(segs[1])
    ) {
      return decodeURIComponent(segs[1]);
    }
  }

  // /artists/ID — get from body dataset
  if (path.startsWith('/artists/')) {
    return document.body.dataset.artistName ?? null;
  }

  return null;
}

function detectPageType(): 'profile' | 'tag' | 'unknown' {
  const path = window.location.pathname;
  if (path.startsWith('/users/') || path === '/profile') return 'profile';
  if (path.startsWith('/wiki_pages/') || path.startsWith('/artists/'))
    return 'tag';
  return 'unknown';
}

// ─── Raw IDB helpers ─────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch {
      resolve(undefined);
    }
  });
}

function idbGetAll(
  db: IDBDatabase,
  store: string,
  query?: IDBValidKey | IDBKeyRange,
  count?: number,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll(query, count);
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    } catch {
      resolve([]);
    }
  });
}

function idbCursorCollect(
  db: IDBDatabase,
  store: string,
  indexName: string,
  range: IDBKeyRange,
  limit: number,
  direction: IDBCursorDirection = 'prev',
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const idx = tx.objectStore(store).index(indexName);
      const req = idx.openCursor(range, direction);
      const results: unknown[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || results.length >= limit) {
          resolve(results);
          return;
        }
        results.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    } catch {
      resolve([]);
    }
  });
}

/** Get distinct userId values from a table's userId index. */
function idbDistinctUserIds(db: IDBDatabase, store: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const idx = tx.objectStore(store).index('userId');
      const req = idx.openKeyCursor(null, 'nextunique');
      const ids: string[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(ids);
          return;
        }
        ids.push(String(cursor.key));
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    } catch {
      resolve([]);
    }
  });
}

// ─── Remote API helpers (raw fetch, no RateLimitedFetch) ─────────────

async function fetchRemoteCount(tags: string): Promise<number | null> {
  try {
    const url = `/counts/posts.json?tags=${encodeURIComponent(tags)}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = (await resp.json()) as {counts?: {posts?: number}};
    return data.counts?.posts ?? null;
  } catch {
    return null;
  }
}

// ─── Panel UI ────────────────────────────────────────────────────────

interface DiagPanel {
  container: HTMLElement;
  content: HTMLElement;
  addSection(title: string, expanded: boolean): HTMLElement;
  addLine(section: HTMLElement, label: string, value: string): void;
  addTable(section: HTMLElement, headers: string[], rows: string[][]): void;
  show(): void;
  hide(): void;
  getText(): string;
}

function createPanel(): DiagPanel {
  // Main container
  const container = document.createElement('div');
  container.className = 'di-diag-panel';
  container.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;max-height:60vh;overflow-y:auto;' +
    'z-index:2147483647;background:#1a1a2e;color:#e0e0e0;font-family:monospace;' +
    'font-size:12px;line-height:1.5;border-top:2px solid #4a9eff;display:none;';

  // Header bar
  const header = document.createElement('div');
  header.style.cssText =
    'position:sticky;top:0;background:#1a1a2e;padding:6px 10px;' +
    'display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;';
  header.innerHTML =
    '<span style="font-weight:bold;color:#4a9eff;">DI Diagnostic</span>';

  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex;gap:8px;';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.style.cssText = btnStyle('#2d8a4e');
  copyBtn.onclick = () => {
    const text = panel.getText();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  };

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = btnStyle('#c93c37');
  closeBtn.onclick = () => panel.hide();

  btnGroup.append(copyBtn, closeBtn);
  header.appendChild(btnGroup);
  container.appendChild(header);

  // Content area
  const content = document.createElement('div');
  content.style.cssText = 'padding:6px 10px;';
  container.appendChild(content);

  // Reopen button (shown when panel is hidden)
  const reopenBtn = document.createElement('button');
  reopenBtn.textContent = 'DI';
  reopenBtn.title = 'Reopen Diagnostic Panel';
  reopenBtn.style.cssText =
    'position:fixed;bottom:10px;right:10px;z-index:2147483647;' +
    'width:36px;height:36px;border-radius:50%;border:2px solid #4a9eff;' +
    'background:#1a1a2e;color:#4a9eff;font-family:monospace;font-size:11px;' +
    'font-weight:bold;cursor:pointer;display:none;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
  reopenBtn.onclick = () => panel.show();

  document.body.appendChild(container);
  document.body.appendChild(reopenBtn);

  const panel: DiagPanel = {
    container,
    content,

    addSection(title: string, expanded: boolean): HTMLElement {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'margin-bottom:8px;';

      const hdr = document.createElement('div');
      hdr.style.cssText =
        'cursor:pointer;padding:4px 6px;background:#22223a;border-radius:3px;' +
        'font-weight:bold;user-select:none;';
      const arrow = expanded ? '\u25BC' : '\u25B6';
      hdr.textContent = `${arrow} ${title}`;

      const body = document.createElement('div');
      body.style.cssText = `padding:4px 6px;${expanded ? '' : 'display:none;'}`;

      hdr.onclick = () => {
        const visible = body.style.display !== 'none';
        body.style.display = visible ? 'none' : '';
        hdr.textContent = `${visible ? '\u25B6' : '\u25BC'} ${title}`;
      };

      wrapper.append(hdr, body);
      content.appendChild(wrapper);
      return body;
    },

    addLine(section: HTMLElement, label: string, value: string): void {
      const line = document.createElement('div');
      line.innerHTML = `<span style="color:#888;">${esc(label)}:</span> ${esc(value)}`;
      section.appendChild(line);
    },

    addTable(section: HTMLElement, headers: string[], rows: string[][]): void {
      const tbl = document.createElement('table');
      tbl.style.cssText =
        'width:100%;border-collapse:collapse;margin:4px 0;font-size:11px;';

      const thead = document.createElement('tr');
      for (const h of headers) {
        const th = document.createElement('th');
        th.textContent = h;
        th.style.cssText =
          'text-align:left;padding:2px 6px;border-bottom:1px solid #444;color:#4a9eff;';
        thead.appendChild(th);
      }
      tbl.appendChild(thead);

      for (const row of rows) {
        const tr = document.createElement('tr');
        for (const cell of row) {
          const td = document.createElement('td');
          td.textContent = cell;
          td.style.cssText = 'padding:2px 6px;border-bottom:1px solid #2a2a44;';
          tr.appendChild(td);
        }
        tbl.appendChild(tr);
      }

      section.appendChild(tbl);
    },

    show(): void {
      container.style.display = '';
      reopenBtn.style.display = 'none';
    },

    hide(): void {
      container.style.display = 'none';
      reopenBtn.style.display = '';
    },

    getText(): string {
      // Collect plain-text from all sections
      const lines: string[] = ['=== Danbooru Insights Diagnostic ===', ''];
      for (const wrapper of content.children) {
        const hdr = wrapper.children[0] as HTMLElement;
        const body = wrapper.children[1] as HTMLElement;
        if (!hdr || !body) continue;

        // Section title (strip arrow)
        lines.push(`--- ${hdr.textContent?.replace(/^[▶▼]\s*/, '') ?? ''} ---`);

        // Tables
        for (const child of body.children) {
          if (child.tagName === 'TABLE') {
            const tableRows = child.querySelectorAll('tr');
            for (const tr of tableRows) {
              const cells = tr.querySelectorAll('th, td');
              lines.push(
                Array.from(cells)
                  .map(c => (c.textContent ?? '').padEnd(20))
                  .join(''),
              );
            }
          } else {
            lines.push(child.textContent ?? '');
          }
        }
        lines.push('');
      }
      return lines.join('\n');
    },
  };

  return panel;
}

function btnStyle(bg: string): string {
  return (
    `background:${bg};color:#fff;border:none;padding:3px 10px;border-radius:3px;` +
    'cursor:pointer;font-size:11px;font-family:monospace;'
  );
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtAge(isoStr: string | null | undefined): string {
  if (!isoStr) return 'N/A';
  const ms = Date.now() - new Date(isoStr).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return `${Math.floor(ms / 60000)}m ago`;
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Section builders ────────────────────────────────────────────────

function buildSystemSection(panel: DiagPanel, db: IDBDatabase | null): void {
  const sec = panel.addSection('System', true);
  panel.addLine(sec, 'Script version', APP_VERSION);
  panel.addLine(sec, 'Page URL', window.location.href);
  panel.addLine(sec, 'User-Agent', navigator.userAgent);
  panel.addLine(sec, 'Timestamp', new Date().toISOString());
  panel.addLine(sec, 'Page type', detectPageType());

  if (db) {
    panel.addLine(sec, 'DB version', String(db.version));
    panel.addLine(sec, 'DB stores', Array.from(db.objectStoreNames).join(', '));
  } else {
    panel.addLine(sec, 'DB', 'Failed to open');
  }

  // localStorage keys
  const diKeys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('di') || k.startsWith('danbooru'))) {
        diKeys.push(k);
      }
    }
  } catch {
    /* ignore */
  }
  panel.addLine(sec, 'DI localStorage keys', String(diKeys.length));
  if (diKeys.length > 0 && diKeys.length <= 30) {
    for (const k of diKeys.sort()) {
      const v = localStorage.getItem(k) ?? '';
      panel.addLine(sec, `  ${k}`, v.length > 60 ? v.slice(0, 60) + '...' : v);
    }
  }
}

async function buildGrassSection(
  panel: DiagPanel,
  db: IDBDatabase,
  userId: string,
  userName: string | null,
): Promise<void> {
  const sec = panel.addSection('GrassApp', detectPageType() === 'profile');

  // Distinct userIds in DB
  try {
    const ids = await idbDistinctUserIds(db, 'uploads');
    panel.addLine(sec, 'Cached userIds', ids.join(', ') || 'none');
  } catch {
    panel.addLine(sec, 'Cached userIds', 'error');
  }

  const today = fmtDate(new Date());
  const year = new Date().getFullYear();

  for (const metric of ['uploads', 'approvals', 'notes'] as const) {
    const mSec = document.createElement('div');
    mSec.style.cssText = 'margin:6px 0 2px;font-weight:bold;color:#4a9eff;';
    mSec.textContent = `[${metric}]`;
    sec.appendChild(mSec);

    // Today row
    const todayKey = `${userId}_${today}`;
    const todayRow = (await idbGet(db, metric, todayKey)) as
      | {count?: number}
      | undefined;
    panel.addLine(
      sec,
      `  Today (${today})`,
      String(todayRow?.count ?? 'not cached'),
    );

    // Last 7 days
    const last7: string[][] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date();
      dt.setDate(dt.getDate() - d);
      const dateStr = fmtDate(dt);
      const key = `${userId}_${dateStr}`;
      const row = (await idbGet(db, metric, key)) as
        | {count?: number}
        | undefined;
      last7.push([dateStr, String(row?.count ?? '-')]);
    }
    panel.addTable(sec, ['Date', 'Count'], last7);

    // Current year local sum
    let localSum = 0;
    const yearRows = (await idbGetAll(db, metric)) as Array<{
      id?: string;
      userId?: string;
      count?: number;
    }>;
    for (const r of yearRows) {
      if (String(r.userId) === userId && r.id && r.id.includes(`_${year}-`)) {
        localSum += r.count ?? 0;
      }
    }
    panel.addLine(sec, `  Local ${year} total`, String(localSum));

    // Remote comparison
    if (metric === 'uploads' && userName) {
      const remoteToday = await fetchRemoteCount(
        `user:${userName} date:${today}`,
      );
      const remoteYear = await fetchRemoteCount(
        `user:${userName} date:${year}-01-01..${year}-12-31`,
      );
      panel.addLine(
        sec,
        '  Remote today',
        String(remoteToday ?? 'fetch failed'),
      );
      panel.addLine(
        sec,
        `  Remote ${year} total`,
        String(remoteYear ?? 'fetch failed'),
      );

      if (remoteToday !== null && todayRow?.count !== undefined) {
        const match = remoteToday === todayRow.count;
        panel.addLine(
          sec,
          '  Today match',
          match
            ? 'OK'
            : `MISMATCH (local=${todayRow.count}, remote=${remoteToday})`,
        );
      }
      if (remoteYear !== null) {
        const match = remoteYear === localSum;
        panel.addLine(
          sec,
          `  ${year} match`,
          match ? 'OK' : `MISMATCH (local=${localSum}, remote=${remoteYear})`,
        );
      }
    }

    // completed_years flag
    const cyKey = `${userId}_${metric}_${year}`;
    const cy = await idbGet(db, 'completed_years', cyKey);
    panel.addLine(sec, `  completed_years[${year}]`, cy ? 'yes' : 'no');
  }

  // grass_settings
  try {
    const gs = await idbGet(db, 'grass_settings', userId);
    panel.addLine(sec, 'grass_settings', gs ? JSON.stringify(gs) : 'not set');
  } catch {
    panel.addLine(sec, 'grass_settings', 'error reading');
  }

  // Last sync timestamp
  try {
    const lsKey = `danbooru_grass_last_sync_${userId}`;
    const ls = localStorage.getItem(lsKey);
    panel.addLine(sec, 'Last sync', ls ? `${ls} (${fmtAge(ls)})` : 'never');
  } catch {
    panel.addLine(sec, 'Last sync', 'error reading');
  }

  // Sample rows (first 5)
  try {
    const samples = await idbGetAll(db, 'uploads', undefined, 5);
    if (samples.length > 0) {
      const rows = samples.map(r => {
        const rec = r as Record<string, unknown>;
        return [
          String(rec.id ?? ''),
          String(rec.userId ?? ''),
          String(rec.date ?? ''),
          String(rec.count ?? ''),
        ];
      });
      panel.addTable(sec, ['ID', 'userId', 'date', 'count'], rows);
    }
  } catch {
    panel.addLine(sec, 'Sample rows', 'error');
  }
}

async function buildUserAnalyticsSection(
  panel: DiagPanel,
  db: IDBDatabase,
  userId: string,
): Promise<void> {
  const sec = panel.addSection(
    'UserAnalyticsApp',
    detectPageType() === 'profile',
  );

  // posts count for this user
  try {
    if (db.objectStoreNames.contains('posts')) {
      const tx = db.transaction('posts', 'readonly');
      const idx = tx.objectStore('posts').index('uploader_id');
      const countReq = idx.count(IDBKeyRange.only(Number(userId)));
      const count = await new Promise<number>((resolve, reject) => {
        countReq.onsuccess = () => resolve(countReq.result as number);
        countReq.onerror = () => reject(countReq.error);
      });
      panel.addLine(sec, 'Posts in DB', String(count));
      panel.addLine(
        sec,
        'Sync path',
        count <= 1200 ? 'Quick Sync (<=1200)' : 'Full Sync',
      );

      // Recent 5 posts
      const recent = (await idbCursorCollect(
        db,
        'posts',
        'uploader_id',
        IDBKeyRange.only(Number(userId)),
        5,
      )) as Array<Record<string, unknown>>;

      if (recent.length > 0) {
        const rows = recent.map(p => [
          String(p.id ?? ''),
          String(p.created_at ?? '').slice(0, 10),
          String(p.score ?? ''),
          String(p.rating ?? ''),
        ]);
        panel.addTable(sec, ['Post ID', 'Date', 'Score', 'Rating'], rows);
      }
    }
  } catch {
    panel.addLine(sec, 'Posts', 'error reading');
  }

  // piestats cache
  try {
    if (db.objectStoreNames.contains('piestats')) {
      const all = (await idbGetAll(db, 'piestats')) as Array<
        Record<string, unknown>
      >;
      const userPie = all.filter(
        r =>
          String(r.userId) === userId ||
          String((r as Record<string, unknown>).userId) === userId,
      );
      panel.addLine(sec, 'piestats entries', String(userPie.length));

      if (userPie.length > 0) {
        const rows = userPie.slice(0, 10).map(r => {
          const updatedAt = r.updated_at ? fmtAge(String(r.updated_at)) : 'N/A';
          return [String(r.key ?? ''), updatedAt];
        });
        panel.addTable(sec, ['Key', 'Age'], rows);
      }
    }
  } catch {
    panel.addLine(sec, 'piestats', 'error reading');
  }

  // hourly_stats
  try {
    if (db.objectStoreNames.contains('hourly_stats')) {
      const hs = (await idbGet(db, 'hourly_stats', userId)) as
        | Record<string, unknown>
        | undefined;
      panel.addLine(sec, 'hourly_stats', hs ? 'exists' : 'not cached');
    }
  } catch {
    panel.addLine(sec, 'hourly_stats', 'error');
  }

  // user_stats
  try {
    if (db.objectStoreNames.contains('user_stats')) {
      const us = (await idbGet(db, 'user_stats', userId)) as
        | Record<string, unknown>
        | undefined;
      panel.addLine(sec, 'user_stats', us ? 'exists' : 'not cached');
    }
  } catch {
    panel.addLine(sec, 'user_stats', 'error');
  }
}

async function buildTagAnalyticsSection(
  panel: DiagPanel,
  db: IDBDatabase,
  tagName: string,
): Promise<void> {
  const sec = panel.addSection('TagAnalyticsApp', detectPageType() === 'tag');

  panel.addLine(sec, 'Tag name', tagName);

  // tag_analytics cache entry
  try {
    if (db.objectStoreNames.contains('tag_analytics')) {
      const entry = (await idbGet(db, 'tag_analytics', tagName)) as
        | Record<string, unknown>
        | undefined;

      if (entry) {
        panel.addLine(sec, 'Cache exists', 'yes');
        const updatedAt = entry.updatedAt ? String(entry.updatedAt) : 'unknown';
        panel.addLine(sec, 'Updated at', `${updatedAt} (${fmtAge(updatedAt)})`);

        // 24h expiry check
        if (entry.updatedAt) {
          const age = Date.now() - new Date(String(entry.updatedAt)).getTime();
          const expired = age > 24 * 3600 * 1000;
          panel.addLine(sec, 'Cache expired (24h)', expired ? 'YES' : 'no');
        }

        // Cached post count
        const meta = entry.meta as Record<string, unknown> | undefined;
        const cachedCount = meta?.post_count ?? entry.postCount ?? 'unknown';
        panel.addLine(sec, 'Cached post count', String(cachedCount));

        // Remote comparison
        const remoteCount = await fetchRemoteCount(tagName);
        panel.addLine(
          sec,
          'Remote post count',
          String(remoteCount ?? 'fetch failed'),
        );
        if (remoteCount !== null && cachedCount !== 'unknown') {
          const match = remoteCount === Number(cachedCount);
          panel.addLine(
            sec,
            'Count match',
            match
              ? 'OK'
              : `DIFF (cached=${cachedCount}, remote=${remoteCount})`,
          );
        }

        // Small tag optimization threshold
        if (remoteCount !== null) {
          panel.addLine(
            sec,
            'Small tag optimization',
            remoteCount <= 1200
              ? `YES (${remoteCount} <= 1200)`
              : 'no (full sync)',
          );
        }
      } else {
        panel.addLine(sec, 'Cache exists', 'no (not yet loaded)');
      }

      // List recent cached tags (up to 10)
      const allTags = (await idbGetAll(db, 'tag_analytics')) as Array<
        Record<string, unknown>
      >;
      allTags.sort((a, b) => {
        const tA = new Date(String(a.updatedAt ?? 0)).getTime();
        const tB = new Date(String(b.updatedAt ?? 0)).getTime();
        return tB - tA;
      });
      const recentTags = allTags.slice(0, 10);
      if (recentTags.length > 0) {
        const rows = recentTags.map(t => [
          String(t.tagName ?? t.id ?? ''),
          fmtAge(String(t.updatedAt ?? '')),
        ]);
        panel.addTable(sec, ['Tag', 'Age'], rows);
      }
    }
  } catch {
    panel.addLine(sec, 'tag_analytics', 'error reading');
  }
}

// ─── Main entry ──────────────────────────────────────────────────────

export async function showDiagnostic(): Promise<void> {
  // 1. Create panel first (even if everything else fails)
  let panel: DiagPanel;
  try {
    panel = createPanel();
  } catch (e) {
    // Last resort if panel creation fails
    alert(`DI Diagnostic: panel creation failed: ${e}`);
    return;
  }

  // Start closed so the panel doesn't pop in mid-page-load and startle
  // the user — `panel.hide()` also reveals the fixed "DI" reopen button
  // in the corner, so the entry point stays discoverable.
  panel.hide();

  // 2. Open DB
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
  } catch {
    // DB open failed — continue with null db
  }

  // 3. System section (always)
  try {
    buildSystemSection(panel, db);
  } catch {
    const sec = panel.addSection('System', true);
    panel.addLine(sec, 'Error', 'Failed to collect system info');
  }

  if (!db) return;

  // 4. Determine context
  const pageType = detectPageType();
  const profileUserId = extractProfileUserId();
  const currentUserId = extractUserId();
  const tagName = extractTagName();

  // Resolve which userId to diagnose
  const userId = profileUserId ?? currentUserId;

  // Extract username from page for remote API calls
  let userName: string | null = null;
  try {
    const h1 = document.querySelector('h1 a[href*="/users/"]');
    if (h1) userName = h1.textContent?.trim()?.replace(/ /g, '_') ?? null;
  } catch {
    /* ignore */
  }

  // 5. Build sections based on page context (relevant sections first)
  if (pageType === 'profile' && userId) {
    try {
      await buildGrassSection(panel, db, userId, userName);
    } catch {
      const sec = panel.addSection('GrassApp', true);
      panel.addLine(sec, 'Error', 'Failed to collect GrassApp diagnostics');
    }

    try {
      await buildUserAnalyticsSection(panel, db, userId);
    } catch {
      const sec = panel.addSection('UserAnalyticsApp', true);
      panel.addLine(
        sec,
        'Error',
        'Failed to collect UserAnalytics diagnostics',
      );
    }

    if (tagName) {
      try {
        await buildTagAnalyticsSection(panel, db, tagName);
      } catch {
        const sec = panel.addSection('TagAnalyticsApp', false);
        panel.addLine(
          sec,
          'Error',
          'Failed to collect TagAnalytics diagnostics',
        );
      }
    }
  } else if (pageType === 'tag' && tagName) {
    try {
      await buildTagAnalyticsSection(panel, db, tagName);
    } catch {
      const sec = panel.addSection('TagAnalyticsApp', true);
      panel.addLine(sec, 'Error', 'Failed to collect TagAnalytics diagnostics');
    }

    // Also show Grass/UserAnalytics if we have a userId
    if (userId) {
      try {
        await buildGrassSection(panel, db, userId, userName);
      } catch {
        const sec = panel.addSection('GrassApp', false);
        panel.addLine(sec, 'Error', 'Failed');
      }
      try {
        await buildUserAnalyticsSection(panel, db, userId);
      } catch {
        const sec = panel.addSection('UserAnalyticsApp', false);
        panel.addLine(sec, 'Error', 'Failed');
      }
    }
  } else {
    // Unknown page type — show whatever we can
    if (userId) {
      try {
        await buildGrassSection(panel, db, userId, userName);
      } catch {
        /* skip */
      }
      try {
        await buildUserAnalyticsSection(panel, db, userId);
      } catch {
        /* skip */
      }
    }
    if (tagName) {
      try {
        await buildTagAnalyticsSection(panel, db, tagName);
      } catch {
        /* skip */
      }
    }
  }

  db.close();
}

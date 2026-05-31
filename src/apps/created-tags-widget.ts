import type {CreatedTagItem} from '../types';
import type {AnalyticsDataManager} from '../core/analytics-data-manager';
import type {TargetUser} from '../types';
import {createLogger} from '../core/logger';

const log = createLogger('CreatedTags');

/** Sort mode for the created tags table. */
type SortMode = 'posts' | 'name' | 'date';
type SortDirection = 'asc' | 'desc';

const PAGE_SIZE = 20;

/** Default sort direction when switching into a mode. */
const SORT_DEFAULT_DIR: Record<SortMode, SortDirection> = {
  posts: 'desc',
  name: 'asc',
  date: 'desc',
};

/**
 * Renders the Created Tags widget with lazy loading.
 * Shows general tags created by the user, parsed from NNTBot forum reports.
 */
export function renderCreatedTagsWidget(
  container: HTMLElement,
  dataManager: AnalyticsDataManager,
  targetUser: TargetUser,
): void {
  // Closure state
  let items: CreatedTagItem[] = [];
  let sortMode: SortMode = 'posts';
  let sortDir: SortDirection = SORT_DEFAULT_DIR.posts;
  let currentPage = 0;

  // Build DOM
  container.style.background = 'var(--di-bg, #fff)';
  container.style.border = '1px solid var(--di-border, #e1e4e8)';
  container.style.borderRadius = '8px';
  container.style.padding = '15px';

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';

  const titleDiv = document.createElement('div');
  titleDiv.style.cssText =
    'font-size:0.9em;color:var(--di-text-secondary, #666);font-weight:bold;';
  titleDiv.textContent = `🏷️ Tags created by ${targetUser.name}`;

  // Sorting is driven by per-column header arrows built in renderTable()
  // (each sortable column shows a ▲/▼ pair). No standalone sort control.

  header.appendChild(titleDiv);
  container.appendChild(header);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'di-created-tags-wrap';
  container.appendChild(contentDiv);

  const getStatusHtml = (item: CreatedTagItem): string => {
    if (item.aliasedTo) {
      const aliasDisplay = item.aliasedTo.replace(/_/g, ' ');
      return `<span class="di-created-tags-status" style="color:#8250df;background:#f3e8ff;">🔀 <a href="/wiki_pages/${item.aliasedTo}" target="_blank" style="color:#8250df;">${aliasDisplay}</a></span>`;
    }
    if (item.isDeprecated) {
      return '<span class="di-created-tags-status" style="color:#cf222e;background:#ffebe9;">⚠️ Deprecated</span>';
    }
    if (item.postCount === 0) {
      return '<span class="di-created-tags-status" style="color:var(--di-text-muted, #888);background:var(--di-bg-tertiary, #f0f0f0);">➖ Empty</span>';
    }
    return '<span class="di-created-tags-status" style="color:#1a7f37;background:#dafbe1;">✅ Active</span>';
  };

  const sortItems = () => {
    const dir = sortDir === 'desc' ? -1 : 1;
    if (sortMode === 'posts') {
      items.sort((a, b) => dir * (a.postCount - b.postCount));
    } else if (sortMode === 'name') {
      items.sort((a, b) => dir * a.displayName.localeCompare(b.displayName));
    } else if (sortMode === 'date') {
      items.sort((a, b) => dir * a.reportDate.localeCompare(b.reportDate));
    }
  };

  // A clickable column header with a SINGLE ▲/▼ arrow. The active column shows
  // its current direction (always lit); an inactive column shows the direction
  // a click would apply (its default), revealed on hover. The whole header is
  // the hit target. `rightAlign` keeps the numeric Posts column flush right.
  const sortableHeader = (
    mode: SortMode,
    label: string,
    rightAlign = false,
  ): string => {
    const isActive = sortMode === mode;
    const dir = isActive ? sortDir : SORT_DEFAULT_DIR[mode];
    const glyph = dir === 'desc' ? '▼' : '▲';
    const cls = isActive ? ' di-cts-th--active' : '';
    return (
      `<span class="di-cts-th${cls}" role="button" tabindex="0" data-sort="${mode}" ` +
      `style="justify-content:${rightAlign ? 'flex-end' : 'flex-start'};" ` +
      'title="Click to sort (again to flip direction)">' +
      `<span class="di-cts-th-label">${label}</span>` +
      `<span class="di-cts-arrow${isActive ? ' di-cts-arrow--active' : ''}">${glyph}</span>` +
      '</span>'
    );
  };

  const renderTable = () => {
    const totalPages = Math.ceil(items.length / PAGE_SIZE);
    const start = currentPage * PAGE_SIZE;
    const pageItems = items.slice(start, start + PAGE_SIZE);

    let html = `<table class="di-created-tags-table">
      <thead><tr>
        <th>${sortableHeader('name', 'Tag Name')}</th>
        <th style="text-align:right;">${sortableHeader('posts', 'Posts', true)}</th>
        <th>Status</th>
        <th>${sortableHeader('date', 'Date')}</th>
      </tr></thead>
      <tbody>`;

    for (const item of pageItems) {
      // For aliased tags, link to the alias target wiki page (the original
      // tag's wiki is empty); otherwise link to the tag's own wiki page.
      const wikiTarget = item.aliasedTo ?? item.tagName;
      html += `<tr class="di-created-tags-row">
        <td><a href="/wiki_pages/${wikiTarget}" target="_blank" style="color:#0075f8;">${item.displayName}</a></td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${item.postCount.toLocaleString()}</td>
        <td>${getStatusHtml(item)}</td>
        <td style="color:var(--di-text-muted, #888);font-size:0.85em;">${item.reportDate}</td>
      </tr>`;
    }

    html += '</tbody></table>';

    // Pagination
    if (totalPages > 1) {
      html +=
        '<div style="display:flex;justify-content:center;gap:4px;margin-top:10px;">';
      for (let i = 0; i < totalPages; i++) {
        const active = i === currentPage;
        html += `<button class="di-pie-tab${active ? ' active' : ''}" data-page="${i}" style="min-width:28px;">${i + 1}</button>`;
      }
      html += '</div>';
    }

    contentDiv.innerHTML = html;

    // Header click: same column → flip direction; other column → switch to it
    // at its default direction. Reset to page 1, re-sort, re-render (repaints
    // the active arrow). The whole header span (label + arrow) is the target.
    const applySort = (mode: SortMode) => {
      if (sortMode === mode) {
        sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        sortMode = mode;
        sortDir = SORT_DEFAULT_DIR[mode];
      }
      currentPage = 0;
      sortItems();
      renderTable();
    };
    contentDiv
      .querySelectorAll<HTMLElement>('.di-cts-th[data-sort]')
      .forEach(el => {
        const mode = el.dataset.sort as SortMode;
        el.onclick = () => applySort(mode);
        el.onkeydown = e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            applySort(mode);
          }
        };
      });

    // Pagination click handlers
    contentDiv.querySelectorAll('[data-page]').forEach(btn => {
      (btn as HTMLElement).onclick = () => {
        currentPage = parseInt((btn as HTMLElement).dataset.page || '0');
        renderTable();
      };
    });
  };

  const loadData = async () => {
    const progressId = 'di-created-tags-progress';
    contentDiv.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;padding:30px;color:var(--di-text-muted, #888);">
        <div class="di-spinner" style="width:24px;height:24px;border-width:3px;margin-right:10px;"></div>
        <span id="${progressId}">Initializing...</span>
      </div>`;

    const progressEl = document.getElementById(progressId);
    const onProgress = (msg: string) => {
      if (progressEl) progressEl.textContent = msg;
    };

    try {
      items = await dataManager.getCreatedTags(targetUser, onProgress);
      if (items.length === 0) {
        contentDiv.innerHTML =
          '<div style="color:var(--di-text-muted, #888);text-align:center;padding:20px;font-size:0.9em;">No created tags found in NNTBot reports.</div>';
        return;
      }

      titleDiv.textContent = `🏷️ Tags created by ${targetUser.name} (${items.length})`;
      sortItems();
      renderTable();
    } catch (e) {
      log.debug('Created tags load failed', {error: e});
      contentDiv.innerHTML =
        '<div style="color:#c00;text-align:center;padding:20px;font-size:0.9em;">Failed to load created tags.</div>';
    }
  };

  // Initial state: load button
  contentDiv.innerHTML = `
    <div style="text-align:center;padding:20px;">
      <button id="di-load-created-tags" style="
        background:var(--di-card-bg, #f9f9f9);border:1px solid var(--di-border-input, #ddd);border-radius:6px;
        padding:8px 16px;cursor:pointer;color:var(--di-text, #333);font-size:13px;
        transition:background 0.2s;
      ">Load Created Tags</button>
      <div style="font-size:0.8em;color:var(--di-text-muted, #888);margin-top:6px;">Searches NNTBot tag reports for tags created by this user</div>
    </div>`;

  const loadBtn = contentDiv.querySelector(
    '#di-load-created-tags',
  ) as HTMLElement;
  if (loadBtn) {
    loadBtn.onmouseover = () => {
      loadBtn.style.background = 'var(--di-bg-tertiary, #f0f0f0)';
    };
    loadBtn.onmouseout = () => {
      loadBtn.style.background = 'var(--di-card-bg, #f9f9f9)';
    };
    loadBtn.onclick = () => loadData();
  }
}

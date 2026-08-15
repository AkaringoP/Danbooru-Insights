import {describe, it, expect} from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.resolve(__dirname, '../src');

/** Recursively collects all .ts files in a directory. */
function collectTsFiles(dir: string): {path: string; content: string}[] {
  const results: {path: string; content: string}[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      // Normalize to forward slashes so the '/core/'-style path matching
      // below behaves identically on Windows (path.join emits backslashes).
      results.push({
        path: full.replace(/\\/g, '/'),
        content: fs.readFileSync(full, 'utf-8'),
      });
    }
  }
  return results;
}

/**
 * Path of `filePath` relative to src/, always forward-slashed. `path.relative`
 * emits backslashes on Windows, which silently breaks `'apps/'`-style prefix
 * checks — a skipped filter reads as a passing test.
 */
function relFromSrc(filePath: string): string {
  return path.relative(SRC_DIR, filePath).replace(/\\/g, '/');
}

/** Extracts relative import paths from a file's content. */
function extractImports(content: string): string[] {
  const matches = content.matchAll(/from\s+['"](\.[^'"]+)['"]/g);
  return Array.from(matches).map(m => m[1]);
}

describe('Architecture constraints', () => {
  const allFiles = collectTsFiles(SRC_DIR);

  it('core/ should not import from apps/', () => {
    const coreFiles = allFiles.filter(f => f.path.includes('/core/'));
    const violations: string[] = [];

    for (const file of coreFiles) {
      const imports = extractImports(file.content);
      for (const imp of imports) {
        if (imp.includes('/apps/') || imp.includes('../apps/')) {
          violations.push(`${relFromSrc(file.path)} imports "${imp}"`);
        }
      }
    }

    expect(
      violations,
      'core/ must not import from apps/. Move shared code to core/ or utils.',
    ).toEqual([]);
  });

  it('core/ should not import from ui/', () => {
    const coreFiles = allFiles.filter(f => f.path.includes('/core/'));
    const violations: string[] = [];

    for (const file of coreFiles) {
      const imports = extractImports(file.content);
      for (const imp of imports) {
        if (imp.includes('/ui/') || imp.includes('../ui/')) {
          violations.push(`${relFromSrc(file.path)} imports "${imp}"`);
        }
      }
    }

    expect(
      violations,
      'core/ must not import from ui/. Data layer should not depend on UI.',
    ).toEqual([]);
  });

  it('ui/ should not import from apps/', () => {
    const uiFiles = allFiles.filter(f => f.path.includes('/ui/'));
    const violations: string[] = [];

    for (const file of uiFiles) {
      const imports = extractImports(file.content);
      for (const imp of imports) {
        if (imp.includes('/apps/') || imp.includes('../apps/')) {
          violations.push(`${relFromSrc(file.path)} imports "${imp}"`);
        }
      }
    }

    expect(
      violations,
      'ui/ must not import from apps/. UI components should not depend on app orchestration.',
    ).toEqual([]);
  });

  it('apps/ should not import from main', () => {
    const appFiles = allFiles.filter(f => f.path.includes('/apps/'));
    const violations: string[] = [];

    for (const file of appFiles) {
      const imports = extractImports(file.content);
      for (const imp of imports) {
        // Match '../main' or './main' but not '../main/...' (which would be
        // a subdirectory, currently nonexistent but kept for safety).
        if (imp === '../main' || imp === './main') {
          violations.push(`${relFromSrc(file.path)} imports "${imp}"`);
        }
      }
    }

    expect(
      violations,
      'apps/ must not back-import from src/main.ts (the entry point). Shared helpers belong in core/ or ui/.',
    ).toEqual([]);
  });

  it('should not contain [key: string]: any index signatures', () => {
    const violations: string[] = [];

    for (const file of allFiles) {
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('[key: string]: any')) {
          violations.push(`${relFromSrc(file.path)}:${i + 1}`);
        }
      }
    }

    expect(
      violations,
      'Use concrete types instead of [key: string]: any.',
    ).toEqual([]);
  });

  it('should not use raw fetch() — use RateLimitedFetch instead', () => {
    const violations: string[] = [];
    // Exclude: rate-limiter.ts uses fetch internally, dev/ uses raw IDB+fetch
    // intentionally (diagnostic module must be app-independent)
    const filesToCheck = allFiles.filter(
      f =>
        !f.path.includes('rate-limiter.ts') &&
        !f.path.includes('.test.') &&
        !f.path.includes('/dev/'),
    );

    for (const file of filesToCheck) {
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // Match standalone fetch( but not this.rateLimiter.fetch( or rateLimiter.fetch(
        const line = lines[i];
        if (
          /(?<!rateLimiter\.)(?<!this\.)(?<!\.)\bfetch\s*\(/.test(line) &&
          !line.trim().startsWith('//') &&
          !line.trim().startsWith('*')
        ) {
          violations.push(`${relFromSrc(file.path)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(
      violations,
      'Use this.rateLimiter.fetch() instead of raw fetch() to respect API rate limits.',
    ).toEqual([]);
  });

  it('should not use raw console.* — use createLogger instead', () => {
    const violations: string[] = [];
    // Allowed: logger.ts (defines the abstraction), perf-logger.ts (separate perf system),
    // dev/ (diagnostic module uses console-free panel, but may need console internally)
    const filesToCheck = allFiles.filter(
      f =>
        !f.path.includes('logger.ts') &&
        !f.path.includes('perf-logger.ts') &&
        !f.path.includes('/dev/') &&
        !f.path.includes('.test.'),
    );

    for (const file of filesToCheck) {
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          /\bconsole\.(log|error|warn|debug|info)\s*\(/.test(line) &&
          !line.trim().startsWith('//') &&
          !line.trim().startsWith('*')
        ) {
          violations.push(`${relFromSrc(file.path)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(
      violations,
      'Use createLogger() from core/logger.ts instead of raw console.*.',
    ).toEqual([]);
  });

  // ─── T-27 — pattern guards against re-duplication of audit findings ───

  it('legacy NSFW localStorage keys must only appear in core/settings.ts (T-11 migration code)', () => {
    // F-DUP-9 recurrence guard. The migration code in core/settings.ts is
    // the only place that should still reference the pre-T-11 keys; any
    // other occurrence means new code is bypassing getNsfwEnabled() /
    // setNsfwEnabled() and risks the same split-key problem that audit
    // found between user-analytics and tag-analytics.
    const LEGACY_KEYS = [
      'danbooru_grass_nsfw_enabled',
      'tag_analytics_nsfw_enabled',
    ];
    const violations: string[] = [];

    for (const file of allFiles) {
      // settings.ts owns the migration (idempotent, runs once at startup).
      if (file.path.endsWith('/core/settings.ts')) continue;
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const key of LEGACY_KEYS) {
          if (lines[i].includes(key)) {
            violations.push(
              `${relFromSrc(file.path)}:${i + 1}: ${lines[i].trim()}`,
            );
          }
        }
      }
    }

    expect(
      violations,
      'Legacy NSFW keys must only appear in core/settings.ts migration code. ' +
        'Read/write the NSFW flag via getNsfwEnabled()/setNsfwEnabled().',
    ).toEqual([]);
  });

  it('"/counts/posts.json" URL must be built by core/data-manager.ts fetchRemoteCount() helper', () => {
    // F-DUP-5 recurrence guard. 25 sites duplicated the same
    // `${baseUrl}/counts/posts.json?tags=${encodeURIComponent(...)}`
    // pattern; T-05 consolidated them into fetchRemoteCount(). Any new
    // raw URL string (outside JSDoc) means someone re-rolled the helper.
    const violations: string[] = [];

    for (const file of allFiles) {
      const rel = relFromSrc(file.path);
      // core/data-manager.ts owns the helper; dev/diagnostic.ts is
      // app-independent by design (see dev/ isolation rule above).
      if (
        file.path.endsWith('/core/data-manager.ts') ||
        file.path.includes('/dev/')
      ) {
        continue;
      }
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        // Skip pure-comment lines (line and block-comment continuation).
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*')
        ) {
          continue;
        }
        if (lines[i].includes('/counts/posts.json')) {
          violations.push(`${rel}:${i + 1}: ${trimmed}`);
        }
      }
    }

    expect(
      violations,
      'Use fetchRemoteCount(rateLimiter, tags) from core/data-manager.ts ' +
        'instead of building /counts/posts.json URLs inline.',
    ).toEqual([]);
  });

  it('"/wiki_pages/" hrefs must encode the interpolated tag name', () => {
    // M-1 recurrence guard. Unlike the many `/posts/${id}` links (numeric ids,
    // inherently safe), a wiki-page path carries a TAG NAME — third-party text
    // that really does contain `/` (fate/grand_order) and angle brackets
    // (`>_<`, `<o>_<o>`). Unencoded, those break the link and the surrounding
    // markup. Two sites shipped that way before this rule existed.
    const violations: string[] = [];
    const hrefRe = /\/wiki_pages\/\$\{([^}]*)\}/g;

    for (const file of allFiles) {
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        hrefRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = hrefRe.exec(lines[i])) !== null) {
          // Either encoded inline, or a variable an encode call already built.
          if (m[1].includes('encodeURIComponent')) continue;
          const declRe = new RegExp(
            `(?:const|let)\\s+${m[1].trim()}\\s*=[^;]*encodeURIComponent`,
          );
          if (declRe.test(file.content)) continue;
          violations.push(
            `${relFromSrc(file.path)}:${i + 1}: ${lines[i].trim()}`,
          );
        }
      }
    }

    expect(
      violations,
      'Wrap the tag name in encodeURIComponent() before putting it in a ' +
        '/wiki_pages/ href.',
    ).toEqual([]);
  });

  it('apps/ must construct DataManager subclasses with the shared rate limiter', () => {
    // H-1 recurrence guard. DataManager's constructor falls back to a brand
    // new RateLimitedFetch when none is passed (core/data-manager.ts:86), so
    // a limiter-less `new AnalyticsDataManager(db)` gets a private token
    // bucket: it ignores TabCoordinator's multi-tab rps/concurrency split and
    // keeps firing while the shared limiter is in 429 backoff. Every
    // construction under apps/ must therefore pass a second argument.
    //
    // ui/settings-popover.ts is exempt: its manager only calls getCacheStats()
    // (IndexedDB-only, no network), so its unused limiter never issues traffic.
    const violations: string[] = [];
    const ctorRe = /new\s+(?:\w*DataManager)\s*\(([^)]*)\)/g;

    for (const file of allFiles) {
      const rel = relFromSrc(file.path);
      if (!rel.startsWith('apps/')) continue;

      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*')
        ) {
          continue;
        }
        ctorRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = ctorRe.exec(lines[i])) !== null) {
          // A second constructor argument is the rate limiter.
          if (!m[1].includes(',')) {
            violations.push(`${rel}:${i + 1}: ${trimmed}`);
          }
        }
      }
    }

    expect(
      violations,
      'Pass the shared RateLimitedFetch as the second constructor argument ' +
        '(e.g. `new AnalyticsDataManager(db, this.rateLimiter)`), or reuse an ' +
        'existing manager such as `app.dataManager`.',
    ).toEqual([]);
  });

  it('popover position formula (getBoundingClientRect + pageYOffset/pageXOffset) belongs to ui/popover-utils.ts', () => {
    // F-UNDER-4 recurrence guard. Four sites originally hand-rolled the
    // "target.getBoundingClientRect() + window.pageYOffset" combo for
    // popover anchoring; T-07 extracted calcPopoverPosition(). A new
    // occurrence outside the allowlist means someone reinvented it.
    //
    // Allowlist rationale:
    // - ui/popover-utils.ts — owns the helper.
    // - ui/approval-detail-popover.ts — kept its own anchored-card math
    //   because its anchor semantics differ from the generic helper
    //   (T-07 archive explicitly did not unify it).
    // - ui/graph-renderer.ts — heatmap cell tooltip positioning relative
    //   to dynamic CalHeatmap cells; not a popover anchor.
    const ALLOWLIST = [
      '/ui/popover-utils.ts',
      '/ui/approval-detail-popover.ts',
      '/ui/graph-renderer.ts',
    ];
    const violations: string[] = [];

    for (const file of allFiles) {
      if (ALLOWLIST.some(p => file.path.endsWith(p))) continue;
      const content = file.content;
      const usesPageOffset = /\bpage[XY]Offset\b/.test(content);
      const usesBoundingRect = /\bgetBoundingClientRect\s*\(/.test(content);
      if (usesPageOffset && usesBoundingRect) {
        violations.push(
          `${relFromSrc(file.path)}: combines ` +
            'getBoundingClientRect() with pageXOffset/pageYOffset',
        );
      }
    }

    expect(
      violations,
      'Use calcPopoverPosition(target) from ui/popover-utils.ts instead of ' +
        'recomputing the page-offset + rect formula inline.',
    ).toEqual([]);
  });

  it('dev/ should not import from core/, ui/, or apps/', () => {
    const devFiles = allFiles.filter(f => f.path.includes('/dev/'));
    const violations: string[] = [];

    for (const file of devFiles) {
      const imports = extractImports(file.content);
      for (const imp of imports) {
        if (
          imp.includes('/core/') ||
          imp.includes('../core/') ||
          imp.includes('/ui/') ||
          imp.includes('../ui/') ||
          imp.includes('/apps/') ||
          imp.includes('../apps/')
        ) {
          violations.push(`${relFromSrc(file.path)} imports "${imp}"`);
        }
      }
    }

    expect(
      violations,
      'dev/ must be app-independent. Use raw browser APIs (indexedDB, fetch) instead of app modules.',
    ).toEqual([]);
  });
});

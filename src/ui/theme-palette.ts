/**
 * Runtime palette for contexts where CSS variables cannot be used directly
 * (Canvas2D fillStyle/strokeStyle, computed color checks).
 *
 * All values are resolved from the live CSS custom properties defined in
 * styles.ts, so they automatically reflect the current dark/light mode.
 * Call `getPalette()` each time you need colors — the result is a fresh
 * snapshot of the current computed values.
 */

export interface ThemePalette {
  /* Surface */
  bg: string;
  bgSecondary: string;
  bgTertiary: string;

  /* Text */
  text: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  textHeading: string;

  /* Border */
  border: string;
  borderLight: string;

  /* Interactive */
  link: string;

  /* Chart-specific */
  chartBg: string;
  chartGrid: string;
  chartAxis: string;
  chartAxisSecondary: string;

  /* Shadow */
  shadow: string;

  /* Table */
  tableRowHover: string;
}

/** Map of CSS variable name → ThemePalette key. */
const VAR_MAP: Record<keyof ThemePalette, string> = {
  bg: '--di-bg',
  bgSecondary: '--di-bg-secondary',
  bgTertiary: '--di-bg-tertiary',
  text: '--di-text',
  textSecondary: '--di-text-secondary',
  textMuted: '--di-text-muted',
  textFaint: '--di-text-faint',
  textHeading: '--di-text-heading',
  border: '--di-border',
  borderLight: '--di-border-light',
  link: '--di-link',
  chartBg: '--di-chart-bg',
  chartGrid: '--di-chart-grid',
  chartAxis: '--di-chart-axis',
  chartAxisSecondary: '--di-chart-axis-secondary',
  shadow: '--di-shadow',
  tableRowHover: '--di-table-row-hover',
};

/** Fallback light-mode values (match the var() fallbacks in styles.ts). */
const LIGHT_FALLBACK: ThemePalette = {
  bg: '#ffffff',
  bgSecondary: '#f9f9f9',
  bgTertiary: '#f0f0f0',
  text: '#333',
  textSecondary: '#666',
  textMuted: '#888',
  textFaint: '#999',
  textHeading: '#444',
  border: '#e1e4e8',
  borderLight: '#eee',
  link: '#007bff',
  chartBg: '#fff',
  chartGrid: '#eee',
  chartAxis: '#333',
  chartAxisSecondary: '#666',
  shadow: 'rgba(0,0,0,0.2)',
  tableRowHover: '#f6f8fa',
};

/**
 * Returns a snapshot of the current theme palette for a given element.
 * Resolves CSS variables from the element's computed style so the palette
 * reflects the closest ancestor's `[data-di-theme]` attribute.
 * Falls back to light-mode values when variables are unset.
 */
export function getPalette(el?: Element): ThemePalette {
  const target = el ?? document.documentElement;
  const style = getComputedStyle(target);
  const palette = {} as ThemePalette;
  for (const [key, cssVar] of Object.entries(VAR_MAP)) {
    const v = style.getPropertyValue(cssVar).trim();
    (palette as unknown as Record<string, string>)[key] =
      v || (LIGHT_FALLBACK as unknown as Record<string, string>)[key];
  }
  return palette;
}

/**
 * Convenience: returns true if the current Danbooru theme is dark.
 * Checks `data-current-user-theme` attribute on `<body>`.
 */
export function isDarkMode(): boolean {
  return document.body.getAttribute('data-current-user-theme') === 'dark';
}

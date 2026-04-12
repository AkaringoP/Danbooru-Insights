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

/**
 * Returns a snapshot of the current theme palette by resolving CSS variables.
 * Call this each render pass — it reads getComputedStyle once and returns
 * plain string values usable in Canvas2D, d3 .attr('fill'), etc.
 */
export function getPalette(): ThemePalette {
  const style = getComputedStyle(document.documentElement);
  const palette = {} as ThemePalette;
  for (const [key, cssVar] of Object.entries(VAR_MAP)) {
    (palette as unknown as Record<string, string>)[key] =
      style.getPropertyValue(cssVar).trim() || '';
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

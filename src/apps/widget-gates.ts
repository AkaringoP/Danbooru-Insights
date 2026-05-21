/**
 * v9.6.0 widget upload-count gates.
 *
 * Widgets are replaced with a locked placeholder when the target user's
 * total upload count is below the threshold, because the underlying data
 * isn't statistically meaningful at that scale.
 *
 * Shared by:
 *   - `user-analytics-app.ts` (render-time placeholder swap)
 *   - `user-analytics-data.ts` (skip the data fetch entirely when gated)
 *
 * v10 work will surface these as user-tunable settings — see
 * `docs/v10/DanbooruInsights v10: 위젯별 설정 Customizing 설계 보고서.md`.
 */
export const TAG_CLOUD_MIN_UPLOADS = 100;
export const SCATTER_MIN_UPLOADS = 300;

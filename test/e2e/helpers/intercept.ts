/**
 * Playwright route helpers that intercept Danbooru-style API endpoints and
 * reply with deterministic fixture data so visual / behavioural tests do
 * not depend on the live site.
 *
 * The fixtures themselves live in `test/e2e/fixtures/`; this module only
 * wires them to the URL patterns each app actually hits at runtime.
 *
 * Designed to be additive — call as many of these as your spec needs, in
 * any order. Each intercept matches a distinct URL pattern, so there is
 * no precedence ambiguity.
 */
import type {Page, Route} from '@playwright/test';
import {readFileSync} from 'fs';
import {fileURLToPath} from 'url';
import {dirname, resolve} from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, '..', 'fixtures');

/** Reads and parses a JSON fixture file by basename (without `.json`). */
export function loadFixture<T = unknown>(name: string): T {
  const path = resolve(FIXTURES_DIR, `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/**
 * Replies with the given JSON body on every matching request. Sets
 * `Content-Type: application/json` automatically.
 */
async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/**
 * Intercepts `/counts/posts.json` — the endpoint behind `fetchRemoteCount`.
 * Returns a single `{counts: {posts: count}}` shape for every match.
 */
export async function interceptCountsApi(
  page: Page,
  count: number = 0,
): Promise<void> {
  await page.route('**/counts/posts.json*', route =>
    fulfillJson(route, {counts: {posts: count}}),
  );
}

/**
 * Intercepts `/posts.json` (general post listing) with the given array
 * of post records. Use `loadFixture('posts-sample')` to get a default
 * batch of 10 entries.
 */
export async function interceptPostsApi(
  page: Page,
  posts: unknown[],
): Promise<void> {
  await page.route('**/posts.json*', route => fulfillJson(route, posts));
}

/**
 * Intercepts `/related_tag.json` (character / copyright distributions).
 * Pass either the full response object or just an array of items to be
 * wrapped under `related_tags`.
 */
export async function interceptRelatedTagApi(
  page: Page,
  payload: unknown,
): Promise<void> {
  await page.route('**/related_tag.json*', route =>
    fulfillJson(
      route,
      Array.isArray(payload) ? {related_tags: payload} : payload,
    ),
  );
}

/**
 * Intercepts `/tag_implications.json` — used by isTopLevelTag and the
 * batched `getTopLevelFlags` path. Empty array means "no implications,
 * tag is top-level".
 */
export async function interceptTagImplicationsApi(
  page: Page,
  implications: unknown[] = [],
): Promise<void> {
  await page.route('**/tag_implications.json*', route =>
    fulfillJson(route, implications),
  );
}

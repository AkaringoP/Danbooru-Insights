/**
 * The tags the user dashboard's secondary pies count, kept on each sync row
 * as flags (T-703, audit DA-24 stage 2). A sync page brings the post's
 * general and meta tag strings; storing them would cost hundreds of bytes a
 * row, so a row keeps only which of these tags it has: `PostRecord.tf`, the
 * sorted indices into {@link TAG_FLAG_NAMES}.
 *
 * The indices are the stored format. Changing the list (adding, removing or
 * reordering a tag) changes what every stored row means: bump
 * `POST_FIELDS_VERSION` and set `TAG_FLAGS_FIELDS_VERSION` to it, so that the
 * pies count remotely until the fields backfill has rebuilt the rows.
 */

/**
 * `*_text`: any tag whose name ends in `_text`, as the Translation pie's
 * wildcard searches. Danbooru expands a wildcard to the 100 most used
 * matching tags of any category (`MAX_WILDCARD_TAGS`,
 * `app/logical/post_query_builder.rb`); this matches every one in the
 * general and meta strings, so a post whose only `_text` tag is outside
 * those 100 counts here and not there.
 */
const ANY_TEXT_FLAG = '*_text';

/** The flagged tags, by stored index (see the module note before editing). */
export const TAG_FLAG_NAMES = [
  // Translation
  'translated',
  'translation_request',
  'english_text',
  ANY_TEXT_FLAG,
  // Commentary (its Untagged slice is `has:commentary`, not a tag)
  'commentary',
  'commentary_request',
  // Gender
  '1girl',
  '2girls',
  '3girls',
  '4girls',
  '5girls',
  '6+girls',
  '1boy',
  '2boys',
  '3boys',
  '4boys',
  '5boys',
  '6+boys',
  '1other',
  '2others',
  '3others',
  '4others',
  '5others',
  '6+others',
  'no_humans',
  // Breasts
  'flat_chest',
  'small_breasts',
  'medium_breasts',
  'large_breasts',
  'huge_breasts',
  'gigantic_breasts',
  // Hair length
  'bald',
  'bald_female',
  'very_short_hair',
  'short_hair',
  'medium_hair',
  'long_hair',
  'very_long_hair',
  'absurdly_long_hair',
  // Hair color
  'black_hair',
  'brown_hair',
  'blonde_hair',
  'red_hair',
  'orange_hair',
  'pink_hair',
  'purple_hair',
  'green_hair',
  'blue_hair',
  'aqua_hair',
  'grey_hair',
  'white_hair',
] as const;

const INDEX_BY_NAME = new Map<string, number>(
  TAG_FLAG_NAMES.map((name, i) => [name, i]),
);
const ANY_TEXT_INDEX = INDEX_BY_NAME.get(ANY_TEXT_FLAG)!;

/**
 * The flags of a post with these tag strings, or undefined when the item
 * carried neither string (a response without the fields: not "no tags").
 */
export function tagFlagsOf(
  general: string | undefined,
  meta: string | undefined,
): number[] | undefined {
  if (general === undefined && meta === undefined) return undefined;
  const found = new Set<number>();
  for (const tag of `${general ?? ''} ${meta ?? ''}`.split(/\s+/)) {
    if (!tag) continue;
    const i = INDEX_BY_NAME.get(tag);
    if (i !== undefined) found.add(i);
    if (tag.endsWith('_text')) found.add(ANY_TEXT_INDEX);
  }
  return [...found].sort((a, b) => a - b);
}

/** The tag names of stored flags (unknown indices are skipped). */
export function tagFlagNames(flags: readonly number[]): string[] {
  const names: string[] = [];
  for (const i of flags) {
    const name = TAG_FLAG_NAMES[i];
    if (name !== undefined) names.push(name);
  }
  return names;
}

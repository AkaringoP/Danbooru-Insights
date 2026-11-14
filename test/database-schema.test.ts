/**
 * Schema v13 (T-401): `posts` keeps only the indexes something reads, and
 * `sync_meta` holds per-user sync state. The schema is read from the
 * declared versions; the database is never opened (no IndexedDB in node).
 */
import {describe, expect, it} from 'vitest';
import {Database} from '../src/core/database';

const db = new Database();
const indexNames = (table: string) =>
  db
    .table(table)
    .schema.indexes.map(i => i.name)
    .sort();

describe('schema v13', () => {
  it('is the latest version', () => {
    expect(db.verno).toBe(13);
  });

  it('keeps the posts indexes the code reads, and no others', () => {
    expect(db.table('posts').schema.primKey.name).toBe('id');
    expect(indexNames('posts')).toEqual([
      '[uploader_id+created_at]',
      '[uploader_id+no]',
      'uploader_id',
    ]);
  });

  it('keys sync_meta by user id, with no other index', () => {
    expect(db.table('sync_meta').schema.primKey.name).toBe('userId');
    expect(indexNames('sync_meta')).toEqual([]);
  });

  it('leaves the other tables as they were', () => {
    expect(indexNames('tag_monthly_counts')).toEqual(['fetchedAt', 'tag']);
    expect(indexNames('piestats')).toEqual(['updated_at', 'userId']);
  });
});

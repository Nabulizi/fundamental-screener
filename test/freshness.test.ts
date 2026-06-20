import { describe, it, expect } from 'vitest';
import { rowFreshness, STALE_MS } from '@/lib/freshness';

const NOW = Date.parse('2026-06-19T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('rowFreshness', () => {
  it('fresh when just fetched and not cached', () => {
    expect(rowFreshness({ retrievedAt: iso(1000), cached: false }, NOW)).toBe('fresh');
  });
  it('cached when served from cache and recent', () => {
    expect(rowFreshness({ retrievedAt: iso(1000), cached: true }, NOW)).toBe('cached');
  });
  it('stale when older than threshold regardless of cache flag', () => {
    expect(rowFreshness({ retrievedAt: iso(STALE_MS + 1000), cached: false }, NOW)).toBe('stale');
    expect(rowFreshness({ retrievedAt: iso(STALE_MS + 1000), cached: true }, NOW)).toBe('stale');
  });
  it('treats an unparseable timestamp as fresh', () => {
    expect(rowFreshness({ retrievedAt: 'not-a-date', cached: true }, NOW)).toBe('fresh');
  });
});

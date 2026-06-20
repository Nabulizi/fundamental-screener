import { describe, it, expect } from 'vitest';
import {
  serialize,
  parseStored,
  createWatchlist,
  renameWatchlist,
  deleteWatchlist,
  addTicker,
  removeTicker,
  type Watchlist
} from '@/lib/watchlists';

const sample: Watchlist[] = [
  { id: '1', name: 'Tech', tickers: ['AAPL', 'MSFT'] },
  { id: '2', name: 'Banks', tickers: ['JPM'] }
];

describe('serialize / parseStored round-trip', () => {
  it('persists and restores watchlists with order preserved', () => {
    const restored = parseStored(serialize(sample));
    expect(restored).toEqual(sample);
    expect(restored[0].tickers).toEqual(['AAPL', 'MSFT']);
  });
});

describe('corrupt / outdated storage', () => {
  it('returns [] for null/empty', () => {
    expect(parseStored(null)).toEqual([]);
    expect(parseStored('')).toEqual([]);
  });
  it('returns [] for invalid JSON', () => {
    expect(parseStored('{not json')).toEqual([]);
  });
  it('returns [] when shape is wrong (object without watchlists array)', () => {
    expect(parseStored('{"foo":123}')).toEqual([]);
    expect(parseStored('{"watchlists":"nope"}')).toEqual([]);
  });
  it('accepts a bare legacy array', () => {
    expect(parseStored(JSON.stringify(sample))).toEqual(sample);
  });
  it('drops malformed entries but keeps valid ones', () => {
    const raw = JSON.stringify({
      version: 99,
      watchlists: [
        { id: 'a', name: 'Good', tickers: ['AAPL'] },
        { id: 5, name: 'bad id', tickers: [] },
        { name: 'missing id', tickers: [] },
        { id: 'b', name: 'bad tickers', tickers: 'AAPL' },
        { id: 'c', name: 'mixed', tickers: ['ko', 1, 'KO', '  msft '] }
      ]
    });
    const out = parseStored(raw);
    expect(out.map((w) => w.id)).toEqual(['a', 'c']);
    expect(out[1].tickers).toEqual(['KO', 'MSFT']); // normalized, deduped, non-strings dropped
  });
});

describe('CRUD operations (pure)', () => {
  it('creates with normalized tickers', () => {
    const out = createWatchlist([], 'New', ['aapl', 'AAPL', ' msft '], 'x');
    expect(out).toEqual([{ id: 'x', name: 'New', tickers: ['AAPL', 'MSFT'] }]);
  });
  it('renames without losing tickers; ignores blank rename', () => {
    expect(renameWatchlist(sample, '1', 'Technology')[0].name).toBe('Technology');
    expect(renameWatchlist(sample, '1', '   ')[0].name).toBe('Tech');
  });
  it('deletes by id', () => {
    expect(deleteWatchlist(sample, '1').map((w) => w.id)).toEqual(['2']);
  });
  it('adds a ticker (uppercased, deduped, order preserved)', () => {
    expect(addTicker(sample, '1', 'nvda')[0].tickers).toEqual(['AAPL', 'MSFT', 'NVDA']);
    expect(addTicker(sample, '1', 'aapl')[0].tickers).toEqual(['AAPL', 'MSFT']);
  });
  it('removes a ticker case-insensitively', () => {
    expect(removeTicker(sample, '1', 'aapl')[0].tickers).toEqual(['MSFT']);
  });
});

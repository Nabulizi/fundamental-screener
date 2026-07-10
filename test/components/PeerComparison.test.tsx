// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PeerComparison from '@/components/PeerComparison';
import type { ScanRow } from '@/lib/types';

function row(ticker: string, over: Partial<ScanRow> = {}): ScanRow {
  return {
    ticker, companyName: `${ticker} Inc`, industry: 'Technology', marketCap: 1e9, currency: 'USD',
    week52Low: null, week52High: null, trailingPE: null, forwardPE: null, dividendYieldPercent: null,
    ytdReturn: null, fcfYieldPercent: 5, revenueGrowthTTM: 10, debtToEquity: null, evToEbitda: 15,
    operatingMarginTTM: 20, retrievedAt: '2026-01-01T00:00:00Z', ...over,
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('PeerComparison', () => {
  it('renders pinned self, peers, an unavailable row for a failed peer, and a median at n>=3', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ rows: [row('MSFT', { evToEbitda: 10 }), row('GOOGL', { evToEbitda: 20 }), row('META', { evToEbitda: 30 })] }),
    })));
    render(<PeerComparison selected={row('AAPL')} />);
    fireEvent.change(screen.getByPlaceholderText(/peer tickers/i), { target: { value: 'MSFT, GOOGL, META, ZZZZ' } });
    fireEvent.click(screen.getByText('Compare'));

    await waitFor(() => expect(screen.getByText(/AAPL \(this company\)/)).toBeInTheDocument());
    expect(screen.getByText('MSFT')).toBeInTheDocument();
    expect(screen.getByText('ZZZZ')).toBeInTheDocument();           // requested but not returned
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Peer median .*excl\. this company, n=3/i)).toBeInTheDocument();
  });
});

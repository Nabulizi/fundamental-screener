// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ValuationPanel from '@/components/ValuationPanel';
import type { ValuationProfile, ValuationYear } from '@/lib/valuation';
import { STORAGE_KEY as CASES_KEY, serialize as serializeCases, newCase } from '@/lib/valuationCases';

const yr = (fy: number, fcf: number): ValuationYear => ({
  fiscalYear: fy, fiscalPeriodEnd: null, revenue: 1000, operatingIncome: 200, operatingCashFlow: fcf + 10,
  capex: 10, freeCashFlow: fcf, stockBasedCompensation: 20, sharesDiluted: 1000,
});
const profile: ValuationProfile = {
  ticker: 'TSLA', fcfTtm: null, sharesOutstanding: 1000, netCash: null, source: 'finnhub-reported',
  retrievedAt: '2026-01-01T00:00:00Z', history: [yr(2022, 100), yr(2023, 120), yr(2024, 140)],
};

function renderPanel() {
  return render(
    <ValuationPanel
      ticker="TSLA" retrievedAt="2026-07-08T00:00:00Z" fcf0={150} marketCap={5000} currency="USD"
      revenueGrowthTTM={12} isFinancial={false} profile={profile} sharesOutstanding={1000} drivers={null}
    />
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('ValuationPanel', () => {
  it('renders both valuation surfaces and the shared base-in-use line', () => {
    renderPanel();
    expect(screen.getByText(/Market expectations/i)).toBeInTheDocument();
    expect(screen.getByText(/What.s priced in\? \(reverse DCF\)/i)).toBeInTheDocument();
    expect(screen.getByText(/FCF base in use:/i)).toBeInTheDocument();
  });

  it('switching the FCF base updates the single shared base-in-use line', () => {
    renderPanel();
    // Default (>=3 usable years) → 3Y avg; switch to TTM.
    fireEvent.click(screen.getByRole('button', { name: 'TTM' }));
    expect(screen.getByText(/FCF base in use:/i).textContent).toMatch(/TTM/);
  });

  it('loading a saved case applies its assumptions (single owner)', () => {
    const c = newCase({
      ticker: 'TSLA', name: 'My case', note: '', retrievedAt: null, scoringVersion: 4,
      inputs: { baseKey: 'avg3', customFcf: null, discountRate: 14, terminalGrowth: 3, horizon: 10, growths: { bear: 20, base: 30, bull: 40 } },
    });
    localStorage.setItem(CASES_KEY, serializeCases([c]));
    renderPanel();
    fireEvent.click(screen.getByText('Load'));
    // Discount-rate assumption applied (default was 11%).
    expect(screen.getByText('14%')).toBeInTheDocument();
  });
});

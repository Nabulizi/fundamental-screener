// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import ChangeSincePanel from '@/components/ChangeSincePanel';
import { STORAGE_KEY, serialize, type SeenMetrics, type SeenRecord } from '@/lib/seenRecords';

const current: SeenMetrics = {
  scoringVersion: 4, tier: 'moderate', strength: 8, risk: 4,
  marketCap: 1e9, fcfYieldPercent: 5, revenueGrowthTTM: 10, evToEbitda: 15,
};

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('ChangeSincePanel', () => {
  it('first view shows the first-time message and seeds the baseline', () => {
    render(<ChangeSincePanel ticker="TSLA" current={current} />);
    expect(screen.getByText(/first time viewing/i)).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toContain('TSLA');
  });

  it('shows deltas vs a seeded prior record', () => {
    const prior: SeenRecord = { ...current, tier: 'strong', strength: 12, risk: 2, ticker: 'TSLA', seenAt: '2026-06-01T00:00:00Z' };
    localStorage.setItem(STORAGE_KEY, serialize([prior]));
    render(<ChangeSincePanel ticker="TSLA" current={current} />);
    expect(screen.getByText(/since you last viewed/i)).toBeInTheDocument();
    expect(screen.getByText(/strong → moderate/i)).toBeInTheDocument();
  });

  it('under Strict Mode the visit runs once — the delta is preserved, not wiped', () => {
    const prior: SeenRecord = { ...current, strength: 12, ticker: 'TSLA', seenAt: '2026-06-01T00:00:00Z' };
    localStorage.setItem(STORAGE_KEY, serialize([prior]));
    render(<StrictMode><ChangeSincePanel ticker="TSLA" current={current} /></StrictMode>);
    // strength 12→8: if the guard failed, the 2nd effect run would read the just-
    // written record (8==8) and render "No material change". (StrictMode double-
    // commits in the test DOM, so the delta label can appear more than once.)
    expect(screen.getAllByText(/Strength/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No material change/i)).not.toBeInTheDocument();
  });
});

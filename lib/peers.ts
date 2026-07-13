import { scoreRow, isBalanceSheetFinancial, type SignalTier } from './scoring';
import { mixedCurrency } from './comparability';
import type { ScanRow } from './types';

// User-selected peer comparison — a lightweight "peer snapshot from screener
// metrics", NOT a full valuation comp. ScanRow-only (one metric=all call per
// peer), apples-to-apples. No ranking, no verdict. Market-implied growth and
// history-derived metrics are deferred to v2 (they need per-peer profiles).

export interface PeerCell {
  marketCap: number | null;
  revenueGrowthTTM: number | null;
  operatingMarginTTM: number | null;
  evToEbitda: number | null;
  /** FCF yield %, or null. `nm` true → balance-sheet financial (show "n.m."). */
  fcfYield: number | null;
  fcfYieldNm: boolean;
  tier: SignalTier;
  strength: number;
  risk: number;
}

export interface PeerRow {
  ticker: string;
  companyName: string | null;
  selected: boolean;
  /** True for a requested peer the provider couldn't return; cell is null. */
  unavailable: boolean;
  cell: PeerCell | null;
}

export interface PeerMedians {
  marketCap: number | null;
  revenueGrowthTTM: number | null;
  operatingMarginTTM: number | null;
  evToEbitda: number | null;
  fcfYield: number | null;
  /** Count of available (successfully fetched) peers, excluding the selected company. */
  n: number;
  /** Observations behind each median (a median can rest on fewer values than n). */
  counts: { marketCap: number; revenueGrowthTTM: number; operatingMarginTTM: number; evToEbitda: number; fcfYield: number };
  /**
   * True when peers (or peers vs selected) span multiple/unknown currencies —
   * the market-cap median is then suppressed (null) because raw monetary
   * values in different currencies cannot be aggregated (P1-08).
   */
  mixedCurrency: boolean;
}

export interface PeerComparison {
  rows: PeerRow[];
  /** Per-column medians over available peers (excl. selected); null when <3 peers. */
  medians: PeerMedians | null;
}

function cellFor(row: ScanRow): PeerCell {
  const scored = scoreRow(row);
  const nm = isBalanceSheetFinancial(row.ticker, row.industry);
  return {
    marketCap: row.marketCap,
    revenueGrowthTTM: row.revenueGrowthTTM,
    operatingMarginTTM: row.operatingMarginTTM ?? null,
    evToEbitda: row.evToEbitda,
    fcfYield: nm ? null : row.fcfYieldPercent, // gated: FCF is noise for balance-sheet financials
    fcfYieldNm: nm,
    tier: scored.tier,
    strength: scored.strengthScore,
    risk: scored.riskScore,
  };
}

/** Median of a numeric list, but only when there are ≥3 values (else null). */
function median(xs: number[]): number | null {
  if (xs.length < 3) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Assemble the comparison: selected company pinned first, then unique available
 * peers (dedup, and any peer equal to the selected ticker dropped), then
 * unavailable rows for requested peers the provider couldn't return. Medians are
 * per-column over available peers ONLY (excluding the selected company), and each
 * column's median needs ≥3 values; the median row is present only with ≥3 peers.
 */
export function buildPeerComparison(
  selected: ScanRow,
  peers: ScanRow[],
  unavailableTickers: string[] = []
): PeerComparison {
  const seen = new Set([selected.ticker]);
  const uniquePeers: ScanRow[] = [];
  for (const p of peers) {
    if (seen.has(p.ticker)) continue;
    seen.add(p.ticker);
    uniquePeers.push(p);
  }
  const unavailable: string[] = [];
  for (const t of unavailableTickers) {
    if (seen.has(t)) continue;
    seen.add(t);
    unavailable.push(t);
  }

  const rows: PeerRow[] = [
    { ticker: selected.ticker, companyName: selected.companyName, selected: true, unavailable: false, cell: cellFor(selected) },
    ...uniquePeers.map((p) => ({ ticker: p.ticker, companyName: p.companyName, selected: false, unavailable: false, cell: cellFor(p) })),
    ...unavailable.map((t) => ({ ticker: t, companyName: null, selected: false, unavailable: true, cell: null })),
  ];

  const cells = uniquePeers.map(cellFor);
  const col = (pick: (c: PeerCell) => number | null) =>
    cells.map(pick).filter((v): v is number => v != null);

  // Monetary aggregation guard: the cap median is meaningless across
  // different/unknown currencies, and it is displayed in the SELECTED
  // company's currency — so the selected row participates in the check.
  const capsMixed = mixedCurrency([selected, ...uniquePeers]);

  const caps = col((c) => c.marketCap);
  const growths = col((c) => c.revenueGrowthTTM);
  const margins = col((c) => c.operatingMarginTTM);
  const evs = col((c) => c.evToEbitda);
  const fcfs = col((c) => (c.fcfYieldNm ? null : c.fcfYield));

  const medians: PeerMedians | null =
    uniquePeers.length >= 3
      ? {
          marketCap: capsMixed ? null : median(caps),
          revenueGrowthTTM: median(growths),
          operatingMarginTTM: median(margins),
          evToEbitda: median(evs),
          fcfYield: median(fcfs),
          n: uniquePeers.length,
          counts: {
            marketCap: capsMixed ? 0 : caps.length,
            revenueGrowthTTM: growths.length,
            operatingMarginTTM: margins.length,
            evToEbitda: evs.length,
            fcfYield: fcfs.length,
          },
          mixedCurrency: capsMixed,
        }
      : null;

  return { rows, medians };
}

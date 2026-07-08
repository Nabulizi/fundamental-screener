import { formatMarketCap, formatPercent } from '@/lib/format';
import { detectFundamentalFlags, type ValuationProfile, type ValuationYear, type FundamentalFlag } from '@/lib/valuation';

// Raw annual history — the transparent source of truth behind the drivers and
// the DCF. The OCF / Capex / FCF columns ARE the FCF construction bridge
// (FCF = OCF − capex), shown per year so lumpiness and one-offs are visible.
// Data-quality flags mark rows/cells to verify. No colors-as-verdict.
export default function FundamentalsTable({ profile, currency }: { profile: ValuationProfile; currency: string | null }) {
  const rows = profile.history.slice().reverse(); // newest first
  const flags = detectFundamentalFlags(profile);
  const flagFor = (year: number, field: FundamentalFlag['field']) =>
    flags.find((f) => f.fiscalYear === year && f.field === field);

  const money = (v: number | null) => formatMarketCap(v, currency);
  const marginPct = (num: number | null, den: number | null) =>
    num != null && den != null && den !== 0 ? formatPercent((num / den) * 100) : 'N/A';
  const shares = (v: number | null) => (v == null ? 'N/A' : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`);

  const cell = (y: ValuationYear, field: FundamentalFlag['field'], text: string) => {
    const f = flagFor(y.fiscalYear, field);
    return (
      <td className={f ? 'ft-flagged' : undefined} title={f?.note}>
        {text}{f && <span className="ft-flag" aria-label={f.note}> ⚠</span>}
      </td>
    );
  };

  return (
    <section className="ft">
      <h2>Annual history</h2>
      <p className="hint">
        Reported annual fundamentals — the raw numbers behind the drivers and DCF. FCF = operating
        cash flow − capex (shown per year). {flags.length > 0
          ? `${flags.length} data flag${flags.length > 1 ? 's' : ''} — hover ⚠ to verify.`
          : 'No data anomalies flagged.'} Informational only.
      </p>
      <div className="ft-scroll">
        <table className="ft-table">
          <thead>
            <tr>
              <th>FY</th><th>Revenue</th><th>Op margin</th><th>OCF</th><th>Capex</th>
              <th>FCF</th><th>FCF margin</th><th>Diluted shares</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((y) => {
              const gap = flagFor(y.fiscalYear, 'history');
              return (
                <tr key={y.fiscalYear}>
                  <th scope="row" className={gap ? 'ft-flagged' : undefined} title={gap?.note}>
                    {y.fiscalYear}{gap && <span className="ft-flag"> ⚠</span>}
                  </th>
                  {cell(y, 'revenue', money(y.revenue))}
                  <td>{marginPct(y.operatingIncome, y.revenue)}</td>
                  <td>{money(y.operatingCashFlow)}</td>
                  {cell(y, 'capex', money(y.capex))}
                  {cell(y, 'freeCashFlow', money(y.freeCashFlow))}
                  <td>{marginPct(y.freeCashFlow, y.revenue)}</td>
                  {cell(y, 'sharesDiluted', shares(y.sharesDiluted))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

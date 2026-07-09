import { describe, it, expect } from 'vitest';
import {
  newCase, serialize, parseStored, casesForTicker, buildCaseExport, parseCaseImport,
  resolveCaseLoad, prepareImport, CASE_SCHEMA_VERSION, type CaseInputs, type ValuationCase,
} from '@/lib/valuationCases';

const inputs: CaseInputs = {
  baseKey: 'avg3', customFcf: null, discountRate: 11, terminalGrowth: 3, horizon: 10,
  growths: { bear: 39, base: 49, bull: 59 },
};
const make = (over: Partial<Parameters<typeof newCase>[0]> = {}) =>
  newCase({ ticker: 'tsla', name: 'Robotaxi case', note: 'assumes AV by 2029', retrievedAt: '2026-07-08T00:00:00Z', inputs, scoringVersion: 4, ...over });

describe('valuationCases store', () => {
  it('stamps schema/scoring version, upper-cases ticker, defaults name', () => {
    const c = make({ name: '  ' });
    expect(c.schemaVersion).toBe(CASE_SCHEMA_VERSION);
    expect(c.scoringVersion).toBe(4);
    expect(c.ticker).toBe('TSLA');
    expect(c.name).toBe('Untitled');
  });

  it('serialize → parseStored round-trips; tolerates junk and drops malformed', () => {
    const cases = [make(), make({ name: 'Bear' })];
    expect(parseStored(serialize(cases))).toHaveLength(2);
    expect(parseStored('not json')).toEqual([]);
    expect(parseStored(JSON.stringify({ cases: [{ nope: 1 }, { id: 'x', ticker: 'AAPL', inputs: null }] }))).toHaveLength(1);
  });

  it('coerces a malformed inputs block to null (notes-only), never throws', () => {
    const bad = JSON.stringify({ cases: [{ id: 'x', ticker: 'AAPL', inputs: { baseKey: 'nope' } }] });
    expect(parseStored(bad)[0].inputs).toBeNull();
  });

  it('casesForTicker filters case-insensitively', () => {
    const cases = [make({ ticker: 'TSLA' }), make({ ticker: 'AAPL' })];
    expect(casesForTicker(cases, 'tsla').map((c) => c.ticker)).toEqual(['TSLA']);
  });
});

describe('export / import', () => {
  it('export carries an audit snapshot; import ignores it and reconstructs the case from inputs', () => {
    const c = make();
    const exp = buildCaseExport(c, { impliedPct: 49, note: 'this is a derived output' });
    const json = JSON.stringify(exp);
    const back = parseCaseImport(json)!;
    expect(back.inputs).toEqual(c.inputs);
    expect(back.ticker).toBe('TSLA');
    // The snapshot is NOT part of the reconstructed case.
    expect('snapshot' in (back as object)).toBe(false);
  });

  it('imports a bare case too, and rejects foreign/malformed JSON', () => {
    expect(parseCaseImport(JSON.stringify(make()))!.ticker).toBe('TSLA');
    expect(parseCaseImport('{"kind":"something-else"}')).toBeNull();
    expect(parseCaseImport('nope')).toBeNull();
  });
});

describe('resolveCaseLoad guard', () => {
  it('warns (not blocks) on a methodology-version mismatch', () => {
    const r = resolveCaseLoad(make({ scoringVersion: 3 }), 4, ['ttm', 'avg3', 'avg5'], 'ttm');
    expect(r.warnings.some((w) => w.includes('methodology v3'))).toBe(true);
    expect(r.inputs).not.toBeNull();
  });

  it('falls back to the default base with a neutral note when the saved base is unavailable', () => {
    // Case saved with avg3, but current data only offers TTM.
    const r = resolveCaseLoad(make(), 4, ['ttm'], 'ttm');
    expect(r.warnings).toContain('Saved FCF base unavailable with current data.');
    expect(r.inputs!.baseKey).toBe('ttm'); // safe fallback, not a crash
  });

  it('notes-only case (inputs null) resolves cleanly', () => {
    const r = resolveCaseLoad(make({ inputs: null }), 4, ['ttm'], 'ttm');
    expect(r.inputs).toBeNull();
    expect(r.warnings).toEqual([]);
  });
});

describe('regression fixes (#33 review)', () => {
  it('rejects out-of-range assumptions on load — never applies a crash value', () => {
    const badHorizon = make({ inputs: { ...inputs, horizon: 0 } });         // years=0 crashes DCF
    const r1 = resolveCaseLoad(badHorizon, 4, ['ttm', 'avg3', 'avg5'], 'ttm');
    expect(r1.inputs).toBeNull();
    expect(r1.warnings).toContain('Saved assumptions are out of range — not applied.');

    const badGrowth = make({ inputs: { ...inputs, growths: { bear: 999, base: 8, bull: 15 } } });
    expect(resolveCaseLoad(badGrowth, 4, ['ttm', 'avg3', 'avg5'], 'ttm').inputs).toBeNull();

    const tooTightSpread = make({ inputs: { ...inputs, discountRate: 11, terminalGrowth: 10.5 } });
    expect(resolveCaseLoad(tooTightSpread, 4, ['ttm', 'avg3', 'avg5'], 'ttm').inputs).toBeNull();
  });

  it('base fallback resolves to an actually-available key, even if the passed fallback is unavailable', () => {
    // saved base avg3; current data only offers TTM; caller wrongly passes avg5.
    const r = resolveCaseLoad(make(), 4, ['ttm'], 'avg5');
    expect(r.warnings).toContain('Saved FCF base unavailable with current data.');
    expect(r.inputs!.baseKey).toBe('ttm'); // availableBaseKeys[0], not the bad fallback
  });

  it('prepareImport rejects a ticker mismatch and malformed input, accepts a match', () => {
    const tsla = JSON.stringify(buildCaseExport(make({ ticker: 'TSLA' }), {}));
    expect(prepareImport(tsla, 'AAPL').case).toBeNull();
    expect(prepareImport(tsla, 'AAPL').error).toContain('TSLA');
    expect(prepareImport(tsla, 'tsla').case!.ticker).toBe('TSLA'); // case-insensitive match
    expect(prepareImport('not json', 'TSLA').case).toBeNull();
  });
});

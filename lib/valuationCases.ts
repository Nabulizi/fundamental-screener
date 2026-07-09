// Pure model + serialization for saved valuation cases. No DOM/localStorage here
// (the useValuationCases hook owns persistence) so it is fully unit-testable.
//
// A case stores INPUTS ONLY — never derived outputs — so re-opening always
// recomputes with the current code and can't show a stale number.

import { scenarioInputsValid } from './dcf';

export type BaseKey = 'ttm' | 'avg3' | 'avg5';

export interface CaseInputs {
  baseKey: BaseKey;
  customFcf: number | null;
  discountRate: number;   // percent
  terminalGrowth: number; // percent
  horizon: number;        // whole years
  growths: { bear: number; base: number; bull: number };
}

export interface ValuationCase {
  schemaVersion: number;
  scoringVersion: number;
  id: string;
  ticker: string;
  name: string;
  savedAt: string;
  retrievedAt: string | null;
  note: string;
  /** null → notes-only (balance-sheet financial, or no valuation). */
  inputs: CaseInputs | null;
}

export const CASE_SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'stock-scanner.valuationCases.v1';

function genId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function newCase(args: {
  ticker: string; name: string; note: string; retrievedAt: string | null;
  inputs: CaseInputs | null; scoringVersion: number; id?: string; savedAt?: string;
}): ValuationCase {
  return {
    schemaVersion: CASE_SCHEMA_VERSION,
    scoringVersion: args.scoringVersion,
    id: args.id ?? genId(),
    ticker: args.ticker.trim().toUpperCase(),
    name: args.name.trim() || 'Untitled',
    savedAt: args.savedAt ?? new Date().toISOString(),
    retrievedAt: args.retrievedAt,
    note: args.note,
    inputs: args.inputs,
  };
}

export function serialize(cases: ValuationCase[]): string {
  return JSON.stringify({ version: CASE_SCHEMA_VERSION, cases });
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function coerceInputs(x: unknown): CaseInputs | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const baseKey = o.baseKey;
  if (baseKey !== 'ttm' && baseKey !== 'avg3' && baseKey !== 'avg5') return null;
  const g = (o.growths ?? {}) as Record<string, unknown>;
  const dr = num(o.discountRate), tg = num(o.terminalGrowth), h = num(o.horizon);
  const gb = num(g.bear), gba = num(g.base), gbu = num(g.bull);
  if (dr == null || tg == null || h == null || gb == null || gba == null || gbu == null) return null;
  return {
    baseKey, customFcf: num(o.customFcf),
    discountRate: dr, terminalGrowth: tg, horizon: h,
    growths: { bear: gb, base: gba, bull: gbu },
  };
}

function coerceCase(x: unknown): ValuationCase | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.ticker !== 'string' || typeof o.id !== 'string') return null;
  return {
    schemaVersion: num(o.schemaVersion) ?? CASE_SCHEMA_VERSION,
    scoringVersion: num(o.scoringVersion) ?? 0,
    id: o.id,
    ticker: o.ticker.toUpperCase(),
    name: typeof o.name === 'string' ? o.name : 'Untitled',
    savedAt: typeof o.savedAt === 'string' ? o.savedAt : new Date().toISOString(),
    retrievedAt: typeof o.retrievedAt === 'string' ? o.retrievedAt : null,
    note: typeof o.note === 'string' ? o.note : '',
    inputs: coerceInputs(o.inputs),
  };
}

/** Parse stored JSON into cases. Never throws; drops malformed entries. */
export function parseStored(raw: string | null | undefined): ValuationCase[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const arr = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).cases : undefined;
  if (!Array.isArray(arr)) return [];
  return arr.map(coerceCase).filter((c): c is ValuationCase => c !== null);
}

export function casesForTicker(cases: ValuationCase[], ticker: string): ValuationCase[] {
  const t = ticker.toUpperCase();
  return cases.filter((c) => c.ticker === t);
}

// --- Export / import --------------------------------------------------------

export interface CaseExport {
  kind: 'valuation-case-export';
  exportedAt: string;
  case: ValuationCase;
  /** Recomputed outputs at export time — audit snapshot only; IGNORED on import. */
  snapshot: unknown;
}

export function buildCaseExport(caseObj: ValuationCase, snapshot: unknown, exportedAt = new Date().toISOString()): CaseExport {
  return { kind: 'valuation-case-export', exportedAt, case: caseObj, snapshot };
}

/** Reconstruct a case from an export/case JSON. Ignores any output snapshot.
 *  Returns null on malformed / foreign input. */
export function parseCaseImport(raw: string): ValuationCase | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  // Accept either an export envelope ({ kind, case }) or a bare case.
  const caseLike = o.kind === 'valuation-case-export' ? o.case : parsed;
  return coerceCase(caseLike);
}

/**
 * Prepare an imported case for the CURRENT ticker: parse + reject a case whose
 * ticker doesn't match (never apply a TSLA case to AAPL). Returns the case to be
 * saved/applied, or a user-facing error.
 */
export function prepareImport(raw: string, ticker: string): { case: ValuationCase | null; error: string | null } {
  const c = parseCaseImport(raw);
  if (!c) return { case: null, error: 'Not a valid valuation-case export.' };
  const t = ticker.trim().toUpperCase();
  if (c.ticker !== t) return { case: null, error: `This case is for ${c.ticker}, not ${t}.` };
  return { case: c, error: null };
}

// --- Load guard -------------------------------------------------------------

export interface ResolvedLoad {
  inputs: CaseInputs | null;
  warnings: string[];
}

/**
 * Resolve a case for loading: warn (never block) on a methodology-version
 * mismatch, and if the saved FCF base is no longer available for the current
 * data, fall back to `fallbackBaseKey` with a neutral note instead of crashing
 * or silently substituting.
 */
export function resolveCaseLoad(
  c: ValuationCase,
  currentScoringVersion: number,
  availableBaseKeys: BaseKey[],
  fallbackBaseKey: BaseKey
): ResolvedLoad {
  const warnings: string[] = [];
  if (c.scoringVersion !== currentScoringVersion) {
    warnings.push(`Saved under methodology v${c.scoringVersion}; current is v${currentScoringVersion}.`);
  }
  if (!c.inputs) return { inputs: null, warnings };

  let inputs = c.inputs;
  // Base availability: fall back to an ACTUALLY-available key (the passed
  // fallback may itself be unavailable), never a crash or silent substitution.
  if (!availableBaseKeys.includes(inputs.baseKey)) {
    const fb = availableBaseKeys.includes(fallbackBaseKey) ? fallbackBaseKey : availableBaseKeys[0];
    warnings.push('Saved FCF base unavailable with current data.');
    inputs = fb ? { ...inputs, baseKey: fb } : inputs;
  }
  // Assumption validity: never apply values that would crash the DCF (e.g. a
  // horizon of 0 → intrinsicDcf throws). Reuse the render-path validity check.
  if (!scenarioInputsValid(inputs.growths, inputs.discountRate, inputs.terminalGrowth, inputs.horizon)) {
    warnings.push('Saved assumptions are out of range — not applied.');
    return { inputs: null, warnings };
  }
  return { inputs, warnings };
}

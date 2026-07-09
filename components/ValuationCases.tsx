'use client';

import { useState } from 'react';
import { SCORING_VERSION } from '@/lib/scoring';
import { useValuationCases } from '@/lib/useValuationCases';
import {
  newCase, casesForTicker, buildCaseExport, parseCaseImport, resolveCaseLoad,
  type CaseInputs, type BaseKey, type ValuationCase, type ResolvedLoad,
} from '@/lib/valuationCases';

interface Props {
  ticker: string;
  retrievedAt: string;
  /** Current inputs, or null → notes-only (financial / no valuation). */
  currentInputs: CaseInputs | null;
  /** Recomputed outputs for the export audit snapshot (ignored on import). */
  snapshot: unknown;
  availableBaseKeys: BaseKey[];
  fallbackBaseKey: BaseKey;
  onApply: (r: ResolvedLoad) => void;
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Save / load / delete named valuation cases (localStorage), plus JSON
// export/import. Cases store INPUTS ONLY — outputs recompute on load. Financials
// save notes-only (currentInputs null). No verdict, no advice.
export default function ValuationCases({
  ticker, retrievedAt, currentInputs, snapshot, availableBaseKeys, fallbackBaseKey, onApply,
}: Props) {
  const { cases, save, remove } = useValuationCases();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [importErr, setImportErr] = useState<string | null>(null);
  const mine = casesForTicker(cases, ticker);

  const doSave = () => {
    save(newCase({ ticker, name, note, retrievedAt, inputs: currentInputs, scoringVersion: SCORING_VERSION }));
    setName('');
  };
  const doLoad = (c: ValuationCase) => {
    setNote(c.note);
    onApply(resolveCaseLoad(c, SCORING_VERSION, availableBaseKeys, fallbackBaseKey));
  };
  const doExport = () => {
    const c = newCase({ ticker, name: name || 'Current view', note, retrievedAt, inputs: currentInputs, scoringVersion: SCORING_VERSION });
    download(`${ticker}-valuation-case.json`, JSON.stringify(buildCaseExport(c, snapshot), null, 2));
  };
  const doImport = async (file: File) => {
    const c = parseCaseImport(await file.text());
    if (!c) { setImportErr('Not a valid valuation-case export.'); return; }
    setImportErr(null);
    setNote(c.note);
    onApply(resolveCaseLoad(c, SCORING_VERSION, availableBaseKeys, fallbackBaseKey));
  };

  return (
    <section className="vc">
      <h2>Cases</h2>
      <p className="hint">
        Save your assumptions + note as a named case (stored in this browser). Cases store inputs
        only — outputs recompute on load{currentInputs ? '' : '. This ticker is notes-only (no valuation inputs)'}.
      </p>

      <div className="vc-save">
        <input type="text" placeholder="Case name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="primary" onClick={doSave} disabled={!name.trim()}>Save</button>
        <button type="button" className="secondary" onClick={doExport}>Export JSON</button>
        <label className="secondary vc-import">
          Import JSON
          <input type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
        </label>
      </div>
      <textarea className="vc-note" placeholder="Note / thesis (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {importErr && <p className="dcf-warn">{importErr}</p>}

      {mine.length > 0 && (
        <ul className="vc-list">
          {mine.map((c) => (
            <li key={c.id}>
              <div className="vc-item">
                <span className="vc-name">{c.name}</span>
                <span className="vc-meta">{new Date(c.savedAt).toLocaleDateString()} · v{c.scoringVersion}{c.inputs ? '' : ' · notes-only'}</span>
                {c.note && <span className="vc-note-preview">{c.note}</span>}
              </div>
              <div className="vc-actions">
                <button type="button" className="secondary" onClick={() => doLoad(c)}>Load</button>
                <button type="button" className="danger-btn" onClick={() => remove(c.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

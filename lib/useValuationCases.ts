'use client';

import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEY, parseStored, serialize, type ValuationCase } from './valuationCases';

export interface UseValuationCases {
  cases: ValuationCase[];
  loaded: boolean;
  /** Insert or replace by id. */
  save: (c: ValuationCase) => void;
  remove: (id: string) => void;
}

// Persistence for saved valuation cases. Mirrors useWatchlists: localStorage,
// tolerant reads, quota/private-mode writes fail silently (state still updates).
export function useValuationCases(): UseValuationCases {
  const [cases, setCases] = useState<ValuationCase[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      // localStorage is client-only; hydrate after mount to keep SSR deterministic.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCases(parseStored(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      setCases([]);
    }
    setLoaded(true);
  }, []);

  // Persist a full next-state (quota/private-mode failures ignored).
  const commit = useCallback((next: ValuationCase[]) => {
    try { window.localStorage.setItem(STORAGE_KEY, serialize(next)); } catch { /* ignore */ }
    return next;
  }, []);

  const save = useCallback((c: ValuationCase) => {
    setCases((prev) => commit([...prev.filter((x) => x.id !== c.id), c]));
  }, [commit]);

  const remove = useCallback((id: string) => {
    setCases((prev) => commit(prev.filter((x) => x.id !== id)));
  }, [commit]);

  return { cases, loaded, save, remove };
}

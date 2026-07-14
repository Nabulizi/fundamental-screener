'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  type Watchlist,
  STORAGE_KEY,
  parseStored,
  serialize,
  createWatchlist,
  renameWatchlist,
  deleteWatchlist,
  addTicker,
  removeTicker
} from './watchlists';

export interface UseWatchlists {
  lists: Watchlist[];
  loaded: boolean;
  create: (name: string, tickers: string[]) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  addTickerTo: (id: string, ticker: string) => void;
  removeTickerFrom: (id: string, ticker: string) => void;
}

export function useWatchlists(): UseWatchlists {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      // localStorage is client-only; hydrate after mount to keep SSR deterministic.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLists(parseStored(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      setLists([]);
    }
    setLoaded(true);
  }, []);

  const persist = useCallback((next: Watchlist[]) => {
    setLists(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, serialize(next));
    } catch {
      // ignore quota / private-mode write failures — in-memory state still updates
    }
  }, []);

  return {
    lists,
    loaded,
    create: (name, tickers) => persist(createWatchlist(lists, name, tickers)),
    rename: (id, name) => persist(renameWatchlist(lists, id, name)),
    remove: (id) => persist(deleteWatchlist(lists, id)),
    addTickerTo: (id, ticker) => persist(addTicker(lists, id, ticker)),
    removeTickerFrom: (id, ticker) => persist(removeTicker(lists, id, ticker))
  };
}

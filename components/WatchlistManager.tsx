'use client';

import { useState } from 'react';
import { useWatchlists } from '@/lib/useWatchlists';

interface Props {
  currentTickers: string[];
  onLoad: (tickers: string[]) => void;
}

export default function WatchlistManager({ currentTickers, onLoad }: Props) {
  const wl = useWatchlists();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [addTickerValue, setAddTickerValue] = useState('');

  function saveCurrent() {
    const name = newName.trim();
    if (!name || currentTickers.length === 0) return;
    wl.create(name, currentTickers);
    setNewName('');
  }

  function startEdit(id: string, name: string) {
    setEditingId(id);
    setRenameValue(name);
    setAddTickerValue('');
  }

  function confirmDelete(id: string, name: string) {
    if (window.confirm(`Delete watchlist “${name}”? This cannot be undone.`)) {
      wl.remove(id);
      if (editingId === id) setEditingId(null);
    }
  }

  if (!wl.loaded) return null;

  return (
    <section className="watchlists" aria-label="Saved watchlists">
      <div className="wl-header">
        <h2>Saved watchlists</h2>
      </div>

      <div className="wl-save">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Name this list…"
          aria-label="New watchlist name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              saveCurrent();
            }
          }}
        />
        <button
          type="button"
          className="secondary"
          onClick={saveCurrent}
          disabled={!newName.trim() || currentTickers.length === 0}
          title={currentTickers.length === 0 ? 'Enter tickers above first' : 'Save the current tickers as a watchlist'}
        >
          Save current ({currentTickers.length})
        </button>
      </div>

      {wl.lists.length === 0 ? (
        <p className="hint">No saved watchlists yet. Enter tickers above and save them here.</p>
      ) : (
        <ul className="wl-list">
          {wl.lists.map((list) => {
            const isEditing = editingId === list.id;
            return (
              <li key={list.id} className="wl-item">
                <div className="wl-row">
                  <button type="button" className="wl-load" onClick={() => onLoad(list.tickers)} title="Load into scanner">
                    {list.name} <span className="wl-count">({list.tickers.length})</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-expanded={isEditing}
                    aria-label={`Edit watchlist ${list.name}`}
                    onClick={() => (isEditing ? setEditingId(null) : startEdit(list.id, list.name))}
                  >
                    ✎
                  </button>
                </div>

                {isEditing && (
                  <div className="wl-edit">
                    <div className="wl-edit-row">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        aria-label="Rename watchlist"
                      />
                      <button type="button" className="secondary" onClick={() => wl.rename(list.id, renameValue)} disabled={!renameValue.trim()}>
                        Rename
                      </button>
                      <button type="button" className="danger-btn" onClick={() => confirmDelete(list.id, list.name)}>
                        Delete
                      </button>
                    </div>

                    <ul className="wl-tickers">
                      {list.tickers.map((t) => (
                        <li key={t}>
                          {t}
                          <button type="button" className="chip-clear" aria-label={`Remove ${t} from ${list.name}`} onClick={() => wl.removeTickerFrom(list.id, t)}>
                            ×
                          </button>
                        </li>
                      ))}
                      {list.tickers.length === 0 && <li className="hint">No tickers</li>}
                    </ul>

                    <div className="wl-edit-row">
                      <input
                        type="text"
                        value={addTickerValue}
                        onChange={(e) => setAddTickerValue(e.target.value)}
                        placeholder="Add ticker…"
                        aria-label={`Add a ticker to ${list.name}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (addTickerValue.trim()) {
                              wl.addTickerTo(list.id, addTickerValue);
                              setAddTickerValue('');
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="secondary"
                        disabled={!addTickerValue.trim()}
                        onClick={() => {
                          wl.addTickerTo(list.id, addTickerValue);
                          setAddTickerValue('');
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

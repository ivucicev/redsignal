import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api.js';
import { BOARD_COLS } from '../../utils.js';
import BoardCard from './BoardCard.jsx';

const BOARD_PAGE = 30;

export default function BoardFeed({ newHit }) {
  const [columns, setColumns] = useState(() =>
    Object.fromEntries(BOARD_COLS.map(c => [c.status, { hits: [], total: 0, offset: 0 }]))
  );

  const loadCol = useCallback(async (status, more = false) => {
    const currentOffset = more ? (columns[status]?.offset || 0) : 0;
    const data = await apiFetch(`/api/hits?status=${status}&limit=${BOARD_PAGE}&offset=${currentOffset}`)
      .catch(() => ({ hits: [], total: 0 }));

    setColumns(prev => {
      const existing = more ? (prev[status]?.hits || []) : [];
      return {
        ...prev,
        [status]: {
          hits: [...existing, ...(data.hits || [])],
          total: data.total || 0,
          offset: currentOffset + (data.hits || []).length,
        }
      };
    });
  }, [columns]);

  useEffect(() => {
    BOARD_COLS.forEach(c => loadCol(c.status, false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When a new hit comes in via WS, prepend to 'new' column
  useEffect(() => {
    if (!newHit) return;
    setColumns(prev => {
      const col = prev['new'] || { hits: [], total: 0, offset: 0 };
      // Avoid duplicates
      if (col.hits.find(h => h.id === newHit.id)) return prev;
      return {
        ...prev,
        new: {
          ...col,
          hits: [newHit, ...col.hits],
          total: col.total + 1,
          offset: col.offset + 1,
        }
      };
    });
  }, [newHit]);

  function handleStatusChange(hit, newStatus) {
    setColumns(prev => {
      const oldStatus = hit.status || 'new';
      const result = { ...prev };
      // Remove from old column
      if (result[oldStatus]) {
        result[oldStatus] = {
          ...result[oldStatus],
          hits: result[oldStatus].hits.filter(h => h.id !== hit.id),
          total: Math.max(0, result[oldStatus].total - 1),
        };
      }
      // Add to new column
      if (result[newStatus]) {
        const updatedHit = { ...hit, status: newStatus };
        result[newStatus] = {
          ...result[newStatus],
          hits: [updatedHit, ...result[newStatus].hits],
          total: result[newStatus].total + 1,
        };
      }
      return result;
    });
  }

  return (
    <div className="flex gap-3 h-full p-4" style={{ minWidth: 'max-content' }}>
      {BOARD_COLS.map(col => {
        const colData = columns[col.status] || { hits: [], total: 0, offset: 0 };
        const hasMore = colData.offset < colData.total;
        return (
          <div
            key={col.status}
            className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50 flex-shrink-0"
            style={{ width: 300, height: '100%' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{col.label}</span>
                <span className="text-xs bg-white border border-slate-200 text-slate-400 px-1.5 py-0.5 rounded-full font-medium">
                  {colData.total}
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {colData.hits.length === 0 && (
                <div className="text-slate-400 text-xs text-center py-6">Empty</div>
              )}
              {colData.hits.map(hit => (
                <BoardCard key={hit.id} hit={hit} onStatusChange={handleStatusChange} />
              ))}
            </div>
            <div className="p-2 flex-shrink-0">
              {hasMore && (
                <button
                  onClick={() => loadCol(col.status, true)}
                  className="w-full text-xs py-2 bg-white hover:bg-slate-100 text-slate-500 rounded-xl border border-slate-200 transition-colors"
                >
                  Load more
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

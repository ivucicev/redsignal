import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context.jsx';
import { apiFetch } from '../../api.js';
import HitCard from './HitCard.jsx';

const H_LIMIT = 50;

export default function HistoryFeed({ onOpenReply, onOpenThread }) {
  const { cfg, addToast } = useApp();
  const [filters, setFilters] = useState({ listener_id: '', kind: '', q: '' });
  const [hits, setHits] = useState([]);
  const [hitsMap, setHitsMap] = useState({});
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadHistory(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadHistory(reset = false) {
    const off = reset ? 0 : offset;
    if (reset) { setOffset(0); setTotal(0); setHits([]); }

    const params = new URLSearchParams({
      limit: H_LIMIT,
      offset: off,
      ...(filters.listener_id ? { listener_id: filters.listener_id } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.q ? { q: filters.q } : {}),
    });

    setLoading(true);
    const data = await apiFetch(`/api/hits?${params}`).catch(() => ({ hits: [], total: 0 }));
    setLoading(false);
    setTotal(data.total);

    const newMap = { ...hitsMap };
    (data.hits || []).forEach(h => { newMap[h.id] = h; });
    setHitsMap(newMap);

    if (reset) {
      setHits(data.hits || []);
      loadStats();
    } else {
      setHits(prev => [...prev, ...(data.hits || [])]);
    }
    setOffset(off + (data.hits || []).length);
  }

  async function loadStats() {
    const s = await apiFetch('/api/hits/stats').catch(() => ({}));
    setStats(s);
  }

  async function analyzeHit(hit) {
    const lst = (cfg.listeners || []).find(l => l.id === hit.listener_id);
    const filters2 = (lst?.filters || []).filter(f => f.enabled);
    const credId = lst?.ai_credential_id || null;
    if (!filters2.length) { addToast('No AI filter steps for this listener', 'gray'); return; }

    setHitsMap(prev => ({ ...prev, [hit.id]: { ...prev[hit.id], analyzing: true, filter_result: null } }));
    setHits(prev => prev.map(h => h.id === hit.id ? { ...h, analyzing: true, filter_result: null } : h));

    const text = [
      hit.title ? `Title: ${hit.title}` : '',
      `Subreddit: r/${hit.subreddit || ''}`,
      `Match: ${hit.match || ''}`,
      `Excerpt: ${hit.excerpt || ''}`,
    ].filter(Boolean).join('\n\n');

    const result = await apiFetch('/api/filter/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, filters: filters2, credential_id: credId, hit_id: hit.id, listener_id: hit.listener_id }),
    }).catch(e => ({ error: e.message }));

    setHitsMap(prev => ({ ...prev, [hit.id]: { ...prev[hit.id], analyzing: false, filter_result: result } }));
    setHits(prev => prev.map(h => h.id === hit.id ? { ...h, analyzing: false, filter_result: result } : h));
  }

  async function exportHistory() {
    const qs = new URLSearchParams({
      ...(filters.listener_id ? { listener_id: filters.listener_id } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
    });
    window.location = `/api/hits/export?${qs}`;
  }

  const listeners = cfg.listeners || [];

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* History toolbar */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-2.5 mb-5 flex-wrap">
        <select
          className="inp text-sm"
          style={{ width: 'auto', minWidth: 160 }}
          value={filters.listener_id}
          onChange={e => setFilters(f => ({ ...f, listener_id: e.target.value }))}
        >
          <option value="">All listeners</option>
          {listeners.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select
          className="inp text-sm"
          style={{ width: 'auto' }}
          value={filters.kind}
          onChange={e => setFilters(f => ({ ...f, kind: e.target.value }))}
        >
          <option value="">Posts & Comments</option>
          <option value="post">Posts only</option>
          <option value="comment">Comments only</option>
        </select>
        <input
          className="inp text-sm flex-1"
          style={{ minWidth: 180 }}
          placeholder="Search title, excerpt, author, subreddit…"
          value={filters.q}
          onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') loadHistory(true); }}
        />
        <button
          onClick={() => loadHistory(true)}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors flex-shrink-0"
        >
          Search
        </button>
        <button
          onClick={exportHistory}
          className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium border border-slate-200 transition-colors flex-shrink-0"
        >
          ↓ CSV
        </button>
      </div>

      {/* Stats bar */}
      {stats?.total > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Total saved', value: stats.total?.toLocaleString() || '0', color: 'text-slate-700' },
            { label: 'Today',       value: stats.today?.toLocaleString() || '0',  color: 'text-blue-600'  },
            { label: 'AI Passed',   value: stats.passed?.toLocaleString() || '0', color: 'text-emerald-600' },
          ].map(s => (
            <div key={s.label} className="card px-4 py-3">
              <div className="text-xs text-slate-400 font-medium">{s.label}</div>
              <div className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Results info */}
      {total > 0 && (
        <div className="text-xs text-slate-400 mb-3">
          {total.toLocaleString()} hit{total !== 1 ? 's' : ''} found
        </div>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {hits.map(hit => (
          <HitCard
            key={hit.id + '-h'}
            hit={hit}
            isHistory={true}
            onStatusUpdate={(id, status) => {
              setHits(prev => prev.map(h => h.id === id ? { ...h, status } : h));
              setHitsMap(prev => ({ ...prev, [id]: { ...prev[id], status } }));
            }}
            onOpenReply={onOpenReply}
            onOpenThread={onOpenThread}
            onAnalyze={(h) => analyzeHit(h)}
            onFilterByListener={() => {}}
          />
        ))}
      </div>

      {/* Empty */}
      {total === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-slate-400 text-sm">No hits match your filters.</div>
        </div>
      )}

      {/* Load more */}
      {offset < total && (
        <div className="flex justify-center mt-5">
          <button
            onClick={() => loadHistory(false)}
            disabled={loading}
            className="px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium border border-slate-200 transition-colors disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

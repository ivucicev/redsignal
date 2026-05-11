import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api.js';
import { useApp } from '../../context.jsx';

const LEVELS = ['', 'info', 'warning', 'error'];
const WH_STATUSES = ['', 'pending', 'success', 'failed'];

export default function Logs() {
  const [tab, setTab] = useState('system');
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-0.5 bg-white border-b border-slate-100 px-5 py-2 flex-shrink-0">
        <div className="flex gap-0.5 bg-slate-100 rounded-xl p-1">
          <button onClick={() => setTab('system')} className={`tab ${tab === 'system' ? 'active' : ''}`}>System</button>
          <button onClick={() => setTab('webhooks')} className={`tab ${tab === 'webhooks' ? 'active' : ''}`}>Webhooks</button>
          <button onClick={() => setTab('file')} className={`tab ${tab === 'file' ? 'active' : ''}`}>Console</button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'system'   && <SystemLogs />}
        {tab === 'webhooks' && <WebhookLogs />}
        {tab === 'file'     && <FileLogs />}
      </div>
    </div>
  );
}

function SystemLogs() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: LIMIT, offset: off });
    if (level)  params.set('level', level);
    if (source) params.set('source', source);
    const data = await apiFetch(`/api/logs/system?${params}`).catch(() => null);
    if (data) { setRows(data.logs); setTotal(data.total); setOffset(off); }
    setLoading(false);
  }, [level, source]);

  useEffect(() => { load(0); }, [load]);

  const LEVEL_COLOR = { info: 'text-sky-600', warning: 'text-amber-600', error: 'text-red-500' };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-2 border-b border-slate-100 flex-shrink-0 flex-wrap">
        <select value={level} onChange={e => setLevel(e.target.value)} className="inp w-auto text-xs py-1">
          {LEVELS.map(l => <option key={l} value={l}>{l || 'All levels'}</option>)}
        </select>
        <input value={source} onChange={e => setSource(e.target.value)} placeholder="Filter source…" className="inp w-44 text-xs py-1" />
        <button onClick={() => load(0)} className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors">Refresh</button>
        <span className="ml-auto text-xs text-slate-400">{total} entries</span>
      </div>
      <div className="flex-1 overflow-auto">
        {loading && <div className="p-5 text-sm text-slate-400">Loading…</div>}
        {!loading && rows.length === 0 && <div className="p-5 text-sm text-slate-400">No logs found.</div>}
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-36">Time</th>
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-20">Level</th>
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-28">Source</th>
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-28">Listener</th>
              <th className="text-left px-4 py-2 text-slate-500 font-medium">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-1.5 text-slate-400 whitespace-nowrap">{r.created_at?.replace('T', ' ').slice(0, 19)}</td>
                <td className={`px-4 py-1.5 font-medium whitespace-nowrap ${LEVEL_COLOR[r.level] || 'text-slate-500'}`}>{r.level}</td>
                <td className="px-4 py-1.5 text-slate-600 whitespace-nowrap">{r.source}</td>
                <td className="px-4 py-1.5 text-slate-500 whitespace-nowrap">{r.listener_name || '—'}</td>
                <td className="px-4 py-1.5 text-slate-700 break-all">{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {total > LIMIT && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
            <button disabled={offset === 0} onClick={() => load(Math.max(0, offset - LIMIT))} className="px-3 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors">← Prev</button>
            <span className="text-xs text-slate-400">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
            <button disabled={offset + LIMIT >= total} onClick={() => load(offset + LIMIT)} className="px-3 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors">Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function WebhookLogs() {
  const { addToast } = useApp();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [retrying, setRetrying] = useState(null);
  const LIMIT = 100;

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: LIMIT, offset: off });
    if (status) params.set('status', status);
    const data = await apiFetch(`/api/logs/webhooks?${params}`).catch(() => null);
    if (data) { setRows(data.logs); setTotal(data.total); setOffset(off); }
    setLoading(false);
  }, [status]);

  useEffect(() => { load(0); }, [load]);

  async function retry(id) {
    setRetrying(id);
    const r = await apiFetch(`/api/logs/webhooks/${id}/retry`, { method: 'POST' }).catch(() => null);
    setRetrying(null);
    if (r?.ok) { addToast('Retry succeeded', 'green'); load(offset); }
    else addToast(r?.error || 'Retry failed', 'red');
  }

  const STATUS_COLOR = { success: 'text-emerald-600', failed: 'text-red-500', pending: 'text-amber-600' };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-2 border-b border-slate-100 flex-shrink-0">
        <select value={status} onChange={e => setStatus(e.target.value)} className="inp w-auto text-xs py-1">
          {WH_STATUSES.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </select>
        <button onClick={() => load(0)} className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors">Refresh</button>
        <span className="ml-auto text-xs text-slate-400">{total} entries</span>
      </div>
      <div className="flex-1 overflow-auto">
        {loading && <div className="p-5 text-sm text-slate-400">Loading…</div>}
        {!loading && rows.length === 0 && <div className="p-5 text-sm text-slate-400">No webhook logs found.</div>}
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-36">Time</th>
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-20">Status</th>
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-24">Listener</th>
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-16">Type</th>
              <th className="text-left px-4 py-2 text-slate-500 font-medium">URL</th>
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-16">Tries</th>
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-1.5 text-slate-400 whitespace-nowrap">{r.created_at?.replace('T', ' ').slice(0, 19)}</td>
                <td className={`px-4 py-1.5 font-medium whitespace-nowrap ${STATUS_COLOR[r.status] || 'text-slate-500'}`}>{r.status}</td>
                <td className="px-4 py-1.5 text-slate-600 whitespace-nowrap">{r.listener_name || '—'}</td>
                <td className="px-4 py-1.5 text-slate-500 whitespace-nowrap">{r.wtype}</td>
                <td className="px-4 py-1.5 text-slate-500 break-all max-w-xs truncate" title={r.url}>{r.url}</td>
                <td className="px-4 py-1.5 text-slate-400">{r.attempts}</td>
                <td className="px-4 py-1.5">
                  {r.status === 'failed' && (
                    <button onClick={() => retry(r.id)} disabled={retrying === r.id} className="px-2 py-0.5 text-xs rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors">
                      {retrying === r.id ? '…' : 'Retry'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {total > LIMIT && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
            <button disabled={offset === 0} onClick={() => load(Math.max(0, offset - LIMIT))} className="px-3 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors">← Prev</button>
            <span className="text-xs text-slate-400">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
            <button disabled={offset + LIMIT >= total} onClick={() => load(offset + LIMIT)} className="px-3 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-colors">Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function FileLogs() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const r = await apiFetch('/api/logs').catch(() => null);
    if (r) setData(r);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="h-full flex flex-col p-5 gap-4 overflow-auto">
      <div className="flex items-center gap-2">
        <button onClick={load} className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors">Refresh</button>
      </div>
      {loading && <div className="text-sm text-slate-400">Loading…</div>}
      {!loading && data && !data.available && <div className="text-sm text-slate-400">No log files found.</div>}
      {!loading && data?.available && (
        <>
          {data.stdout?.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">stdout</div>
              <pre className="bg-slate-900 text-slate-300 rounded-xl p-4 text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all">{data.stdout.join('\n')}</pre>
            </div>
          )}
          {data.stderr?.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">stderr</div>
              <pre className="bg-slate-900 text-red-300 rounded-xl p-4 text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all">{data.stderr.join('\n')}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useState, useCallback } from 'react';
import { apiFetch } from '../../api.js';
import { useApp } from '../../context.jsx';

export default function WebhookLogs() {
  const { addToast } = useApp();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const LIMIT = 50;

  const load = useCallback(async (more = false, st = status) => {
    const off = more ? offset : 0;
    const params = new URLSearchParams({ limit: LIMIT, offset: off, ...(st ? { status: st } : {}) });
    const data = await apiFetch(`/api/logs/webhooks?${params}`).catch(() => ({ logs: [], total: 0 }));
    if (more) {
      setLogs(prev => [...prev, ...(data.logs || [])]);
    } else {
      setLogs(data.logs || []);
    }
    setTotal(data.total || 0);
    setOffset(off + (data.logs || []).length);
    setLoaded(true);
  }, [status, offset]);

  const handleStatusChange = (val) => {
    setStatus(val);
    setOffset(0);
    load(false, val);
  };

  if (!loaded) load(false);

  const statusCls = (s) => {
    if (s === 'success') return 'text-emerald-700 bg-emerald-50 border border-emerald-100';
    if (s === 'failed')  return 'text-red-600 bg-red-50 border border-red-100';
    return 'text-amber-600 bg-amber-50 border border-amber-100';
  };

  const retry = async (id) => {
    const r = await apiFetch(`/api/logs/webhooks/${id}/retry`, { method: 'POST' }).catch(() => ({ ok: false }));
    if (r.ok) {
      addToast('Webhook queued for retry', 'green');
      setTimeout(() => { setOffset(0); load(false); }, 1000);
    } else {
      addToast(r.error || 'Retry failed', 'red');
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <select
          value={status}
          onChange={e => handleStatusChange(e.target.value)}
          className="inp text-sm"
          style={{ width: 'auto' }}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="success">Success</option>
          <option value="retrying">Retrying</option>
          <option value="failed">Failed</option>
        </select>
        <button
          onClick={() => { setOffset(0); load(false); }}
          className="text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="card overflow-hidden">
        {!logs.length ? (
          <div className="text-slate-400 text-sm text-center py-10">No webhook logs yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 font-medium w-36">Time</th>
                <th className="text-left px-4 py-2.5 font-medium w-20">Status</th>
                <th className="text-left px-4 py-2.5 font-medium w-10 text-center">Tries</th>
                <th className="text-left px-4 py-2.5 font-medium">URL</th>
                <th className="text-left px-4 py-2.5 font-medium">Error</th>
                <th className="px-4 py-2.5 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap font-mono text-[11px]">
                    {log.created_at ? new Date(log.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded-md font-semibold text-[11px] ${statusCls(log.status)}`}>
                      {log.status || ''}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-center">{log.attempts || 0}</td>
                  <td className="px-4 py-2.5 text-slate-600 font-mono truncate max-w-[200px]" title={log.url || ''}>
                    {log.url || ''}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 truncate max-w-[200px]">{log.last_error || '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {log.status !== 'success' && (
                      <button
                        onClick={() => retry(log.id)}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 font-medium transition-colors"
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {offset < total && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => load(true)}
            className="px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-medium border border-slate-200 transition-colors"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

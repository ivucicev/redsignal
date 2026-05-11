import { useState, useCallback } from 'react';
import { apiFetch } from '../../api.js';

export default function SystemLogs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [level, setLevel] = useState('');
  const [loaded, setLoaded] = useState(false);
  const LIMIT = 100;

  const load = useCallback(async (more = false, lvl = level) => {
    const off = more ? offset : 0;
    const params = new URLSearchParams({ limit: LIMIT, offset: off, ...(lvl ? { level: lvl } : {}) });
    const data = await apiFetch(`/api/logs/system?${params}`).catch(() => ({ logs: [], total: 0 }));
    if (more) {
      setLogs(prev => [...prev, ...(data.logs || [])]);
    } else {
      setLogs(data.logs || []);
    }
    setTotal(data.total || 0);
    setOffset(off + (data.logs || []).length);
    setLoaded(true);
  }, [level, offset]);

  const handleLevelChange = (val) => {
    setLevel(val);
    setOffset(0);
    load(false, val);
  };

  if (!loaded) load(false);

  const levelCls = (l) => {
    if (l === 'ERROR' || l === 'error') return 'text-red-600 bg-red-50';
    if (l === 'WARN'  || l === 'warn')  return 'text-amber-600 bg-amber-50';
    return 'text-slate-400';
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <select
          value={level}
          onChange={e => handleLevelChange(e.target.value)}
          className="inp text-sm"
          style={{ width: 'auto' }}
        >
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
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
          <div className="text-slate-400 text-sm text-center py-10">No system logs yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 font-medium w-40">Time</th>
                <th className="text-left px-4 py-2.5 font-medium w-16">Level</th>
                <th className="text-left px-4 py-2.5 font-medium">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap font-mono text-[11px]">
                    {log.created_at ? new Date(log.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded-md font-semibold text-[11px] ${levelCls(log.level)}`}>
                      {(log.level || 'info').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700 leading-relaxed">{log.message || ''}</td>
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

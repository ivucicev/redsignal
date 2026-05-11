import { timeAgo, STATUS_CFG } from '../../utils.js';
import { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../../api.js';

export default function BoardCard({ hit, onStatusChange }) {
  const isPost = hit.kind === 'post';
  const age = timeAgo((hit.ts || 0) * 1000);
  const s = hit.status || 'new';
  const sc = STATUS_CFG[s] || STATUS_CFG.new;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  async function setStatus(status) {
    setOpen(false);
    await apiFetch(`/api/hits/${hit.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, listener_id: hit.listener_id || null }),
    });
    if (onStatusChange) onStatusChange(hit, status);
  }

  const typeDot = isPost
    ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 border border-blue-100">POST</span>
    : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-500 border border-violet-100">CMT</span>;

  return (
    <div
      className="bg-white rounded-xl border border-slate-200 p-3 space-y-2 hover:border-slate-300 transition-all"
      style={{ boxShadow: '0 1px 3px rgba(15,23,42,.04)' }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        {typeDot}
        <span className="text-xs font-semibold text-orange-500">r/{hit.subreddit || ''}</span>
        <span className="ml-auto text-[10px] text-slate-300">{age}</span>
      </div>
      {hit.title
        ? <div className="text-xs font-semibold text-slate-800 leading-snug line-clamp-2">{hit.title}</div>
        : <div className="text-xs text-slate-500 leading-relaxed line-clamp-2">{hit.excerpt || ''}</div>
      }
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded truncate max-w-[100px]">
          {hit.match || ''}
        </span>
        <div className="relative inline-block" ref={ref}>
          <button
            onClick={() => setOpen(o => !o)}
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium cursor-pointer ${sc.cls}`}
          >
            {sc.label}
          </button>
          {open && (
            <div className="st-menu">
              {Object.entries(STATUS_CFG).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setStatus(k)}
                  className={k === s ? 'font-semibold text-slate-900' : 'text-slate-600'}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <a
          href={hit.url || ''}
          target="_blank"
          rel="noopener"
          className="text-[10px] px-2 py-1 rounded-lg bg-slate-900 text-white hover:bg-slate-700 font-medium transition-colors flex-shrink-0"
        >
          ↗
        </a>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { STATUS_CFG } from '../../utils.js';
import { apiFetch } from '../../api.js';

export default function StatusBadge({ hit, isHistory, onUpdate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const s = hit.status || 'new';
  const sc = STATUS_CFG[s] || STATUS_CFG.new;

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
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
    if (onUpdate) onUpdate(status);
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className={`text-xs px-2 py-0.5 rounded-md font-medium cursor-pointer transition-colors ${sc.cls}`}
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
  );
}

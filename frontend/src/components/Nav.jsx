import { useState, useEffect } from 'react';
import { useApp } from '../context.jsx';
import { apiFetch } from '../api.js';

export default function Nav({ activeTab, setActiveTab, wsStatus }) {
  const { addToast } = useApp();
  const [dark, setDark] = useState(false);
  const [browserNotif, setBrowserNotif] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('rs-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefersDark)) {
      applyDark(true);
      setDark(true);
    }
  }, []);

  function applyDark(on) {
    document.documentElement.classList.toggle('dark', on);
  }

  function toggleDark() {
    const on = !dark;
    setDark(on);
    applyDark(on);
    localStorage.setItem('rs-theme', on ? 'dark' : 'light');
  }

  function toggleBrowserNotif() {
    if (browserNotif) {
      setBrowserNotif(false);
      addToast('Browser notifications off', 'gray');
      return;
    }
    if (!('Notification' in window)) {
      addToast('Browser notifications not supported', 'red');
      return;
    }
    if (Notification.permission === 'granted') {
      setBrowserNotif(true);
      addToast('Browser notifications on — fires when AI filter passes', 'green');
    } else {
      Notification.requestPermission().then(p => {
        if (p === 'granted') {
          setBrowserNotif(true);
          addToast('Browser notifications on', 'green');
        } else {
          addToast('Permission denied', 'red');
        }
      });
    }
  }

  async function startAll() {
    const r = await apiFetch('/api/monitor/start', { method: 'POST' });
    if (r.started?.length) addToast(`Started: ${r.started.join(', ')}`, 'green');
    else if (!r.ok) addToast(r.message || 'Nothing to start', 'red');
  }

  async function stopAll() {
    await apiFetch('/api/monitor/stop', { method: 'POST' });
  }

  const tabs = ['stream', 'analytics', 'vault', 'listeners', 'logs'];
  const tabLabels = { stream: 'Stream', analytics: 'Analytics', vault: 'Vault', listeners: 'Listeners', logs: 'Logs' };

  return (
    <header
      className="bg-white border-b border-slate-100 px-5 py-3 flex items-center gap-5 flex-shrink-0"
      style={{ boxShadow: '0 1px 3px rgba(15,23,42,.06)' }}
    >
      <div className="flex items-center select-none flex-shrink-0">
        <img
          src={dark ? '/logo-dark.png' : '/logo-white.png'}
          alt="RedSignal"
          className="h-7 w-auto"
        />
      </div>

      <nav className="flex gap-0.5 bg-slate-100 rounded-xl p-1 flex-shrink-0">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`tab ${activeTab === t ? 'active' : ''}`}
          >
            {tabLabels[t]}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2 flex-shrink-0">
        <span className="text-xs mr-1">
          {wsStatus === 'live'
            ? <span className="text-emerald-500 font-medium">● Live</span>
            : <span className="text-slate-400">● Offline</span>
          }
        </span>

        {/* Notification bell */}
        <button
          onClick={toggleBrowserNotif}
          title="Browser notifications"
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
          style={browserNotif ? { color: '#3b82f6' } : {}}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>

        {/* Health toggle — rendered in Stream */}
        <HealthButton />

        {/* Dark mode toggle */}
        <button
          onClick={toggleDark}
          title="Toggle dark mode"
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
        >
          {dark ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <button
          onClick={startAll}
          className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors"
        >
          <svg width="9" height="11" viewBox="0 0 9 11" fill="currentColor">
            <path d="M0 0l9 5.5L0 11V0z" />
          </svg>{' '}
          Start All
        </button>
        <button
          onClick={stopAll}
          className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-medium border border-slate-200 transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
            <rect width="9" height="9" rx="1.5" />
          </svg>{' '}
          Stop All
        </button>
      </div>
    </header>
  );
}

function HealthButton() {
  const [visible, setVisible] = useState(false);
  const [health, setHealth] = useState(null);
  const timerRef = { current: null };

  async function refreshHealth() {
    const data = await apiFetch('/api/health').catch(() => null);
    if (data) setHealth(data);
  }

  function toggle() {
    const next = !visible;
    setVisible(next);
    if (next) {
      refreshHealth();
      timerRef.current = setInterval(refreshHealth, 30000);
    } else {
      clearInterval(timerRef.current);
    }
  }

  return (
    <>
      <button
        onClick={toggle}
        title="Stream health"
        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      </button>
      {visible && health && (
        <HealthStrip data={health} />
      )}
    </>
  );
}

// Health strip is actually rendered inside Stream, so we expose it separately
export function HealthStrip({ data }) {
  if (!data) return null;
  const now = data.now;
  if (!data.listeners?.length) {
    return (
      <div className="bg-slate-50 border-b border-slate-100 px-5 py-2 flex items-center gap-5 text-xs overflow-x-auto flex-shrink-0">
        <span className="text-slate-400">No listeners have run yet.</span>
      </div>
    );
  }
  return (
    <div className="bg-slate-50 border-b border-slate-100 px-5 py-2 flex items-center gap-5 text-xs overflow-x-auto flex-shrink-0">
      {data.listeners.map((l, i) => {
        const age = l.last_ts ? Math.round((now - l.last_ts) / 60) : null;
        const stale = l.running && age !== null && age > 5;
        const dot = l.running ? (stale ? '🟡' : '🟢') : '⚫';
        const rateStr = l.running ? `${l.per_min}/min` : 'stopped';
        const ageStr = age === null ? 'no hits yet' : age === 0 ? 'just now' : `${age}m ago`;
        return (
          <span key={i} className={`flex items-center gap-1.5 whitespace-nowrap ${stale ? 'text-amber-600' : 'text-slate-500'}`}>
            {dot} <span className="font-medium">{l.name}</span>
            <span className="text-slate-400">{rateStr} · {ageStr}{stale ? ' ⚠' : ''}</span>
          </span>
        );
      })}
    </div>
  );
}

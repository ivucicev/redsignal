import { useState, useCallback, useEffect } from 'react';
import { AppProvider, useApp } from './context.jsx';
import { apiFetch } from './api.js';
import Nav from './components/Nav.jsx';
import Toast from './components/Toast.jsx';
import Stream from './components/stream/Stream.jsx';
import Analytics from './components/analytics/Analytics.jsx';
import Vault from './components/vault/Vault.jsx';
import Listeners from './components/listeners/Listeners.jsx';
import Logs from './components/logs/Logs.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';

function AppInner() {
  const [activeTab, setActiveTab] = useState('stream');
  const { setCfg, setHits, hitIds, setListenerStatus, addToast } = useApp();
  const [wsStatus, setWsStatus] = useState('offline');
  const [newHit, setNewHit] = useState(null);
  const [wsHitCount, setWsHitCount] = useState(0);

  // Load config and listener status on mount
  useEffect(() => {
    apiFetch('/api/config').then(data => {
      if (data) setCfg(data);
    }).catch(() => {});
    apiFetch('/api/listeners/status').then(data => {
      if (data) setListenerStatus(data);
    }).catch(() => {});
  }, [setCfg, setListenerStatus]);

  const handleHit = useCallback((msg) => {
    const hit = msg.data || msg;
    if (!hitIds.current.has(hit.id)) {
      hitIds.current.add(hit.id);
      setHits(prev => [hit, ...prev]);
      setNewHit(hit);
      setWsHitCount(c => c + 1);
    }
  }, [hitIds, setHits]);

  const handleStatusChange = useCallback((status) => {
    setWsStatus(status);
  }, []);

  useWebSocket({ onHit: handleHit, onStatus: handleStatusChange });

  return (
    <div className="bg-slate-50 text-slate-900 flex flex-col h-screen overflow-hidden">
      <Nav activeTab={activeTab} setActiveTab={setActiveTab} wsStatus={wsStatus} />
      <main className="flex-1 overflow-hidden">
        {activeTab === 'stream' && (
          <Stream newHit={newHit} wsHitCount={wsHitCount} />
        )}
        {activeTab === 'analytics' && <Analytics />}
        {activeTab === 'vault' && <Vault />}
        {activeTab === 'listeners' && <Listeners />}
        {activeTab === 'logs' && <Logs />}
      </main>
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}

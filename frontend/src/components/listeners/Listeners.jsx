import { useState } from 'react';
import { useApp } from '../../context.jsx';
import { apiFetch, saveConfig } from '../../api.js';
import ListenerCard from './ListenerCard.jsx';
import ListenerDrawer from './ListenerDrawer.jsx';

export default function Listeners() {
  const { cfg, setCfg, setListenerStatus, addToast } = useApp();
  const [editingId, setEditingId] = useState(null);

  const listeners = cfg.listeners || [];

  const addListener = async () => {
    const id = crypto.randomUUID();
    const lst = { id, name: 'New Listener', enabled: true, subreddits: 'all', webhook: '', keywords: [], filters: [], negative_keywords: [], reddit_credential_id: '', ai_credential_id: '' };
    const next = { ...cfg, listeners: [...listeners, lst] };
    setCfg(next);
    await saveConfig(next);
    setEditingId(id);
  };

  const deleteListener = async (id) => {
    if (!confirm('Delete this listener?')) return;
    const next = { ...cfg, listeners: listeners.filter(l => l.id !== id) };
    setCfg(next);
    await saveConfig(next);
    if (editingId === id) setEditingId(null);
  };

  const toggleEnabled = async (id, val) => {
    const next = { ...cfg, listeners: listeners.map(l => l.id === id ? { ...l, enabled: val } : l) };
    setCfg(next);
    await saveConfig(next);
  };

  const startStop = async (id, running) => {
    if (running) {
      await apiFetch(`/api/listeners/${id}/stop`, { method: 'POST' });
    } else {
      const r = await apiFetch(`/api/listeners/${id}/start`, { method: 'POST' });
      if (!r.ok) addToast(r.message || 'Failed to start', 'red');
    }
    setTimeout(async () => {
      const status = await apiFetch('/api/listeners/status').catch(() => ({}));
      setListenerStatus(status);
    }, 800);
  };

  const editingListener = listeners.find(l => l.id === editingId);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold">Listeners</h2>
            <p className="text-sm text-slate-400 mt-0.5">Each listener runs its own Reddit stream.</p>
          </div>
          <button
            onClick={addListener}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            New Listener
          </button>
        </div>

        {listeners.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83m9.9 9.9 2.83 2.83M1 12h4m14 0h4M4.22 19.78l2.83-2.83m9.9-9.9 2.83-2.83"/></svg>
            </div>
            <div className="text-slate-700 font-semibold text-lg">No listeners yet</div>
            <div className="text-slate-400 text-sm mt-1">Click "New Listener" to get started</div>
          </div>
        ) : (
          <div className="space-y-3">
            {listeners.map(l => (
              <ListenerCard
                key={l.id}
                listener={l}
                onEdit={setEditingId}
                onDelete={deleteListener}
                onToggleEnabled={toggleEnabled}
                onStartStop={startStop}
              />
            ))}
          </div>
        )}
      </div>

      {editingListener && (
        <ListenerDrawer
          listener={editingListener}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

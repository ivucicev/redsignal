import { useState } from 'react';
import { useApp } from '../../context.jsx';
import { saveConfig } from '../../api.js';
import CredCard from './CredCard.jsx';

function newCred(type) {
  const id = crypto.randomUUID();
  if (type === 'reddit')    return { id, type, name: 'New Reddit Account', client_id: '', client_secret: '', user_agent: 'redsignal/1.0 by u/yourname' };
  if (type === 'openai')    return { id, type, name: 'New OpenAI Key', api_key: '', model: '' };
  if (type === 'ollama')    return { id, type, name: 'Local Ollama', base_url: 'http://localhost:11434', model: '' };
  return { id, type: 'anthropic', name: 'New Anthropic Key', api_key: '', model: '' };
}

export default function Vault() {
  const { cfg, setCfg } = useApp();
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);

  const credentials = cfg.credentials || [];
  const listeners   = cfg.listeners   || [];

  const reddit = credentials.filter(c => c.type === 'reddit');
  const ai     = credentials.filter(c => ['anthropic', 'openai', 'ollama'].includes(c.type));

  const listenerCount = (credId, field) =>
    listeners.filter(l => l[field] === credId).length;

  const startEdit = (cred) => {
    setEditingId(cred.id);
    setDraft({ ...cred });
  };

  const cancelEdit = () => {
    // Remove if empty new credential
    const cred = credentials.find(c => c.id === editingId);
    if (cred && !cred.client_id && !cred.client_secret && !cred.api_key && !cred.base_url) {
      const next = { ...cfg, credentials: credentials.filter(c => c.id !== editingId) };
      setCfg(next);
    }
    setEditingId(null);
    setDraft(null);
  };

  const saveCred = async () => {
    if (!draft) return;
    const next = credentials.map(c => c.id === draft.id ? { ...draft } : c);
    const newCfg = { ...cfg, credentials: next };
    setCfg(newCfg);
    await saveConfig(newCfg);
    setEditingId(null);
    setDraft(null);
  };

  const deleteCred = async (id) => {
    if (!confirm('Delete this credential?')) return;
    const next = { ...cfg, credentials: credentials.filter(c => c.id !== id) };
    setCfg(next);
    await saveConfig(next);
  };

  const addCred = async (type) => {
    const c = newCred(type);
    const next = { ...cfg, credentials: [...credentials, c] };
    setCfg(next);
    startEdit(c);
  };

  const onChange = (key, val) => setDraft(d => ({ ...d, [key]: val }));

  const renderSection = (list, title, subtitle, addButtons) => (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">{addButtons}</div>
      </div>
      <div className="space-y-3">
        {list.length === 0
          ? <div className="text-slate-400 text-sm py-6 text-center">No {title.toLowerCase()} yet.</div>
          : list.map(c => (
            <CredCard
              key={c.id}
              cred={c}
              isEditing={editingId === c.id}
              draft={editingId === c.id ? draft : null}
              onEdit={() => startEdit(c)}
              onCancel={cancelEdit}
              onSave={saveCred}
              onDelete={() => deleteCred(c.id)}
              onChange={onChange}
              listenerCount={listenerCount(c.id, c.type === 'reddit' ? 'reddit_credential_id' : 'ai_credential_id')}
            />
          ))
        }
      </div>
    </section>
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-8">
        {renderSection(
          reddit,
          'Reddit Accounts',
          'One credential per Reddit app.',
          <button
            onClick={() => addCred('reddit')}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            Add Account
          </button>
        )}

        {renderSection(
          ai,
          'AI Keys',
          'Anthropic Claude, OpenAI, or local Ollama for filter pipelines.',
          <>
            <button onClick={() => addCred('anthropic')} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-medium transition-colors">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg> Anthropic
            </button>
            <button onClick={() => addCred('openai')} className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg> OpenAI
            </button>
            <button onClick={() => addCred('ollama')} className="flex items-center gap-1.5 px-3 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-xl text-sm font-medium transition-colors">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg> Ollama
            </button>
          </>
        )}
      </div>
    </div>
  );
}

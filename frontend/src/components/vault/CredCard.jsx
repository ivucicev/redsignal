import { useApp } from '../../context.jsx';

const TYPE_UI = {
  reddit: {
    bg: 'bg-orange-100', color: 'text-orange-500',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>,
  },
  anthropic: {
    bg: 'bg-violet-100', color: 'text-violet-600',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
  },
  openai: {
    bg: 'bg-emerald-100', color: 'text-emerald-600',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83m9.9 9.9 2.83 2.83M1 12h4m14 0h4M4.22 19.78l2.83-2.83m9.9-9.9 2.83-2.83"/></svg>,
  },
  ollama: {
    bg: 'bg-slate-100', color: 'text-slate-500',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 9h8M8 12h6M8 15h4"/></svg>,
  },
};

export default function CredCard({ cred, isEditing, draft, onEdit, onCancel, onSave, onDelete, onChange, listenerCount }) {
  const ui = TYPE_UI[cred.type] || TYPE_UI.anthropic;

  if (!isEditing) {
    let preview = '', badge = null;
    if (cred.type === 'reddit') {
      preview = cred.client_id ? `${cred.client_id.slice(0, 8)}…` : 'No Client ID';
    } else if (cred.type === 'anthropic') {
      preview = cred.api_key ? `sk-ant-…${cred.api_key.slice(-4)}` : 'No key set';
      badge = <span className="text-xs bg-violet-50 text-violet-500 border border-violet-100 px-1.5 py-0.5 rounded-md font-medium">Claude</span>;
    } else if (cred.type === 'openai') {
      preview = cred.api_key ? `sk-…${cred.api_key.slice(-4)}` : 'No key set';
      badge = <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-100 px-1.5 py-0.5 rounded-md font-medium">OpenAI</span>;
    } else if (cred.type === 'ollama') {
      preview = cred.base_url || 'http://localhost:11434';
      badge = <span className="text-xs bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded-md font-medium">Local</span>;
    }
    const subline = cred.type === 'reddit' && cred.user_agent
      ? `  ·  ${cred.user_agent.slice(0, 30)}`
      : cred.model ? `  ·  model: ${cred.model}` : '';

    return (
      <div className="card px-4 py-3.5 flex items-center gap-3.5">
        <div className={`w-9 h-9 rounded-xl ${ui.bg} ${ui.color} flex items-center justify-center flex-shrink-0`}>
          {ui.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-slate-800">{cred.name}</span>
            {badge}
          </div>
          <div className="text-xs text-slate-400 mt-0.5 font-mono truncate">{preview}{subline}</div>
        </div>
        {listenerCount > 0 && (
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full flex-shrink-0">
            {listenerCount} listener{listenerCount !== 1 ? 's' : ''}
          </span>
        )}
        <button onClick={onEdit} className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-colors flex-shrink-0">Edit</button>
        <button onClick={onDelete} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors text-lg leading-none flex-shrink-0">×</button>
      </div>
    );
  }

  const f = (key) => (e) => onChange(key, e.target.value);
  const Label = ({ children }) => <span className="text-xs font-medium text-slate-500">{children}</span>;

  return (
    <div className="card border-blue-200 p-4 space-y-3.5">
      {cred.type === 'reddit' && <>
        <label className="block"><Label>Name</Label><input className="inp mt-1.5" value={draft.name || ''} onChange={f('name')} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><Label>Client ID</Label><input className="inp mt-1.5 font-mono text-sm" value={draft.client_id || ''} onChange={f('client_id')} /></label>
          <label className="block"><Label>Client Secret</Label><input className="inp mt-1.5 font-mono text-sm" type="password" value={draft.client_secret || ''} onChange={f('client_secret')} /></label>
        </div>
        <label className="block">
          <Label>User Agent</Label>
          <input className="inp mt-1.5 text-sm" value={draft.user_agent || ''} onChange={f('user_agent')} />
          <p className="text-xs text-slate-400 mt-1.5">Format: <code className="bg-slate-100 px-1 rounded">appname/1.0 by u/yourname</code></p>
        </label>
        <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline">↗ reddit.com/prefs/apps → create app → script</a>
      </>}

      {cred.type === 'anthropic' && <>
        <label className="block"><Label>Name</Label><input className="inp mt-1.5" value={draft.name || ''} onChange={f('name')} /></label>
        <label className="block">
          <Label>API Key</Label>
          <input className="inp mt-1.5 font-mono text-sm" type="password" placeholder="sk-ant-…" value={draft.api_key || ''} onChange={f('api_key')} />
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline mt-1.5">↗ console.anthropic.com</a>
        </label>
        <label className="block">
          <Label>Model <span className="font-normal text-slate-400">(default: claude-haiku-4-5-20251001)</span></Label>
          <input className="inp mt-1.5 text-sm font-mono" placeholder="claude-haiku-4-5-20251001" value={draft.model || ''} onChange={f('model')} />
        </label>
      </>}

      {cred.type === 'openai' && <>
        <label className="block"><Label>Name</Label><input className="inp mt-1.5" value={draft.name || ''} onChange={f('name')} /></label>
        <label className="block">
          <Label>API Key</Label>
          <input className="inp mt-1.5 font-mono text-sm" type="password" placeholder="sk-…" value={draft.api_key || ''} onChange={f('api_key')} />
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline mt-1.5">↗ platform.openai.com/api-keys</a>
        </label>
        <label className="block">
          <Label>Model <span className="font-normal text-slate-400">(default: gpt-4o-mini)</span></Label>
          <input className="inp mt-1.5 text-sm font-mono" placeholder="gpt-4o-mini" value={draft.model || ''} onChange={f('model')} />
        </label>
      </>}

      {cred.type === 'ollama' && <>
        <label className="block"><Label>Name</Label><input className="inp mt-1.5" value={draft.name || ''} onChange={f('name')} /></label>
        <label className="block">
          <Label>Base URL</Label>
          <input className="inp mt-1.5 text-sm font-mono" placeholder="http://localhost:11434" value={draft.base_url || 'http://localhost:11434'} onChange={f('base_url')} />
          <p className="text-xs text-slate-400 mt-1.5">Start with <code className="bg-slate-100 px-1 rounded">ollama serve</code></p>
        </label>
        <label className="block">
          <Label>Model <span className="font-normal text-slate-400">(default: llama3.2)</span></Label>
          <input className="inp mt-1.5 text-sm font-mono" placeholder="llama3.2" value={draft.model || ''} onChange={f('model')} />
          <p className="text-xs text-slate-400 mt-1.5">Pull models with: <code className="bg-slate-100 px-1 rounded">ollama pull llama3.2</code></p>
        </label>
      </>}

      <div className="flex gap-2 pt-1">
        <button onClick={onSave} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors">Save</button>
        <button onClick={onCancel} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-medium transition-colors">Cancel</button>
      </div>
    </div>
  );
}

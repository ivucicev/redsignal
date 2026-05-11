import { useApp } from '../../context.jsx';

export default function ListenerCard({ listener, onEdit, onDelete, onToggleEnabled, onStartStop }) {
  const { cfg, listenerStatus } = useApp();
  const credentials = cfg.credentials || [];

  const rCred = credentials.find(c => c.id === listener.reddit_credential_id && c.type === 'reddit');
  const aiCred = credentials.find(c => c.id === listener.ai_credential_id && ['anthropic', 'openai', 'ollama'].includes(c.type));
  const running = !!listenerStatus[listener.id];
  const kwCnt = (listener.keywords || []).length;
  const flCnt = (listener.filters || []).filter(f => f.enabled).length;

  return (
    <div className="card px-4 py-3.5 flex items-center gap-3.5">
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${running ? 'bg-emerald-400 pulse-dot' : 'bg-slate-300'}`} />

      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-slate-800 truncate">{listener.name}</div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-orange-500 font-medium">r/{listener.subreddits || 'all'}</span>
          {rCred
            ? <span className="text-xs text-slate-400">{rCred.name}</span>
            : <span className="text-xs text-red-400 font-medium">⚠ No Reddit account</span>
          }
          {aiCred && <span className="text-xs text-violet-500">{aiCred.name}</span>}
          <span className="text-xs text-slate-300">{kwCnt} kw</span>
          {flCnt > 0 && <span className="text-xs text-violet-400">{flCnt} filter{flCnt !== 1 ? 's' : ''}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={listener.enabled !== false}
            className="sr-only peer"
            onChange={e => onToggleEnabled(listener.id, e.target.checked)}
          />
          <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:bg-slate-900 transition-colors" />
          <div className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
        </label>

        <button
          onClick={() => onStartStop(listener.id, running)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
            running
              ? 'bg-red-50 hover:bg-red-100 text-red-600'
              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
          }`}
        >
          {running
            ? <><svg width="8" height="8" viewBox="0 0 9 9" fill="currentColor"><rect width="9" height="9" rx="1"/></svg> Stop</>
            : <><svg width="8" height="10" viewBox="0 0 9 11" fill="currentColor"><path d="M0 0l9 5.5L0 11V0z"/></svg> Start</>
          }
        </button>

        <button onClick={() => onEdit(listener.id)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-colors">
          Edit
        </button>

        <button onClick={() => onDelete(listener.id)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors text-xl leading-none">
          ×
        </button>
      </div>
    </div>
  );
}

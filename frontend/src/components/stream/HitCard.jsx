import { timeAgo } from '../../utils.js';
import StatusBadge from './StatusBadge.jsx';

export default function HitCard({ hit, isHistory, onStatusUpdate, onOpenReply, onOpenThread, onAnalyze, onFilterByListener }) {
  const isPost = hit.kind === 'post';
  const age = timeAgo((hit.ts || 0) * 1000);

  const typeBadge = isPost
    ? <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-100">POST</span>
    : <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-violet-50 text-violet-600 border border-violet-100">COMMENT</span>;

  let filterBadge = null;
  if (hit.analyzing) {
    filterBadge = (
      <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
        <span className="spin">⟳</span> Analyzing
      </span>
    );
  } else if (hit.filter_result?.error) {
    filterBadge = (
      <span
        className="text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded-md border border-red-100"
        title={hit.filter_result.error}
      >
        ⚠ Error
      </span>
    );
  } else if (hit.filter_result?.passed === true) {
    filterBadge = (
      <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100 font-medium">
        ✓ Passed
      </span>
    );
  } else if (hit.filter_result?.passed === false) {
    filterBadge = (
      <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-md border border-red-100 font-medium">
        ✗ Rejected
      </span>
    );
  }

  const results = hit.filter_result?.results || [];
  const steps = results.length > 0 ? (
    <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center gap-1 flex-wrap">
      {results.map((r, i) => {
        const isLast = i === results.length - 1;
        let icon, dotCls, labelCls;
        if (r.skipped) {
          icon = <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/></svg>;
          dotCls = 'bg-slate-200 text-slate-400';
          labelCls = 'text-slate-400';
        } else if (r.error || r.passed === false) {
          icon = <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>;
          dotCls = 'bg-red-100 text-red-500';
          labelCls = 'text-red-600';
        } else {
          icon = <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
          dotCls = 'bg-emerald-100 text-emerald-600';
          labelCls = 'text-emerald-700';
        }
        return (
          <div key={i} className="flex items-center gap-1 flex-shrink-0">
            <div className="flex items-center gap-1">
              <div className={`w-4 h-4 rounded-full flex items-center justify-center ${dotCls}`}>{icon}</div>
              <span className={`text-[11px] font-medium ${labelCls} whitespace-nowrap`}>{r.step}</span>
            </div>
            {!isLast && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            )}
          </div>
        );
      })}
    </div>
  ) : null;

  const dimmed = hit.filter_result?.passed === false ? 'opacity-60' : '';
  const noClick = hit.analyzing ? 'opacity-50 pointer-events-none' : '';

  return (
    <div className={`card p-4 hover:border-slate-200 transition-all ${dimmed}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-2.5">
            {typeBadge}
            <StatusBadge hit={hit} isHistory={isHistory} onUpdate={(status) => onStatusUpdate && onStatusUpdate(hit.id, status)} />
            {hit.listener_name && (
              <button
                onClick={() => onFilterByListener && onFilterByListener(hit.listener_id)}
                className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 hover:bg-slate-200 border border-slate-200 transition-colors"
              >
                {hit.listener_name}
              </button>
            )}
            <span className="text-sm font-semibold text-orange-500">r/{hit.subreddit || ''}</span>
            <span className="text-sm text-slate-400">u/{hit.author || ''}</span>
            <span className="text-xs text-slate-300">{age}</span>
            {filterBadge}
          </div>
          {hit.title && (
            <div className="text-sm font-semibold text-slate-800 mb-1 leading-snug line-clamp-1">{hit.title}</div>
          )}
          <div className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-2.5">{hit.excerpt || ''}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-md">{hit.match || ''}</span>
            {hit.reply_draft && (
              <span className="text-xs text-violet-500 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-md">Draft saved</span>
            )}
          </div>
          {steps}
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0 ml-2">
          <a
            href={hit.url || ''}
            target="_blank"
            rel="noopener"
            className="flex items-center justify-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-700 text-white font-medium transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>
            </svg>{' '}Open
          </a>
          <button
            onClick={() => onOpenThread && onOpenThread(hit.post_id || hit.id, hit.listener_id || '', hit.id)}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-colors"
          >
            📖 Thread
          </button>
          <button
            onClick={() => onOpenReply && onOpenReply(hit)}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium transition-colors"
          >
            ✍ Reply
          </button>
          <button
            onClick={() => onAnalyze && onAnalyze(hit)}
            className={`text-xs px-3 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 font-medium transition-colors ${noClick}`}
          >
            🤖 Analyze
          </button>
        </div>
      </div>
    </div>
  );
}

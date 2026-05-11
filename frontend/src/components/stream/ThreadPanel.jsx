import { useState, useEffect } from 'react';
import { apiFetch } from '../../api.js';

export default function ThreadPanel({ postId, listenerId, commentId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await apiFetch(
        `/api/reddit/thread?post_id=${encodeURIComponent(postId)}&listener_id=${encodeURIComponent(listenerId)}`
      );
      setData(result);
      setLoading(false);
    }
    load();
  }, [postId, listenerId]);

  return (
    <>
      <div className="panel-backdrop" onClick={onClose}></div>
      <div className="side-panel">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-slate-900">Thread</h2>
            {data && !data.error && (
              <p className="text-xs text-slate-400 mt-0.5">
                r/{data.subreddit} · {data.score} pts · {data.num_comments} comments
              </p>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && (
            <div className="text-center text-slate-400 py-12">
              <div className="text-2xl mb-2"><span className="spin inline-block">⟳</span></div>
              <div className="text-sm">Loading thread…</div>
            </div>
          )}
          {!loading && data?.error && (
            <div className="text-red-400 text-sm p-4">{data.error}</div>
          )}
          {!loading && data && !data.error && (
            <>
              <div className="space-y-3">
                <div className="text-base font-semibold text-slate-900 leading-snug">{data.title}</div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>u/{data.author}</span>
                  <span>·</span>
                  <span>▲ {data.score}</span>
                </div>
                {data.selftext && (
                  <div className="text-sm text-slate-600 leading-relaxed bg-slate-50 rounded-xl p-4 whitespace-pre-wrap">
                    {data.selftext}
                  </div>
                )}
                <a
                  href={data.url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
                  </svg>
                  Open on Reddit
                </a>
              </div>
              {data.comments?.length > 0 && (
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Top comments</div>
                  {data.comments.map((c) => {
                    const isMatch = c.id === commentId;
                    return (
                      <div
                        key={c.id}
                        className={`rounded-xl p-3 text-sm ${isMatch ? 'bg-blue-50 border border-blue-100' : 'bg-slate-50'}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5 text-xs text-slate-400">
                          <span className="font-medium text-slate-600">u/{c.author}</span>
                          <span>▲ {c.score}</span>
                          {isMatch && <span className="text-blue-600 font-semibold">← matched</span>}
                        </div>
                        <div className="text-slate-700 leading-relaxed whitespace-pre-wrap">{c.body}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

import { useState, useCallback } from 'react';
import { useApp } from '../../context.jsx';
import LiveFeed from './LiveFeed.jsx';
import HistoryFeed from './HistoryFeed.jsx';
import BoardFeed from './BoardFeed.jsx';
import ReplyPanel from './ReplyPanel.jsx';
import ThreadPanel from './ThreadPanel.jsx';

export default function Stream({ newHit, wsHitCount }) {
  const { cfg, setHits, hitIds, listenerStatus } = useApp();
  const [viewMode, setViewMode] = useState('live');
  const [streamFilter, setStreamFilter] = useState(null);
  const [kindFilter, setKindFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [autoFilter, setAutoFilter] = useState(false);
  const [hideRejected, setHideRejected] = useState(false);
  const [hitCount, setHitCount] = useState(0);

  // Panels
  const [replyHit, setReplyHit] = useState(null);
  const [threadState, setThreadState] = useState(null);

  const listeners = cfg.listeners || [];

  function clearHits() {
    if (!confirm('Clear live feed? (Saved history in DB is not affected)')) return;
    setHits([]);
    hitIds.current.clear();
    setHitCount(0);
  }

  function exportCSV() {
    // We need hits from context
    // This is handled in LiveFeed via the hits from context
    import('../../context.jsx').then(({ useApp: _ }) => {});
  }

  function handleExportCSV() {
    // Access hits via a ref or re-implement here
    // Using a simple approach: we'll use the global approach below
    const { hits } = window.__rsApp || {};
    if (!hits) return;
    const rows = [['ts', 'listener', 'kind', 'subreddit', 'author', 'match', 'title', 'url', 'excerpt', 'filter_passed']];
    for (const h of hits) {
      rows.push([
        new Date((h.ts || 0) * 1000).toISOString(),
        h.listener_name || '',
        h.kind || '',
        h.subreddit || '',
        h.author || '',
        h.match || '',
        h.title || '',
        h.url || '',
        h.excerpt || '',
        h.filter_result ? (h.filter_result.passed ? 'yes' : 'no') : '',
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `redsignal_live_${Date.now()}.csv`,
    }).click();
  }

  return (
    <div id="p-stream" className="h-full flex flex-col">
      {/* Toolbar row 1 */}
      <div className="bg-white border-b border-slate-100 px-5 py-2.5 flex items-center gap-3 flex-wrap flex-shrink-0">
        {/* Listener pills */}
        <div className="flex gap-2 flex-wrap items-center">
          <button
            className={`pill ${streamFilter === null ? 'active' : ''}`}
            onClick={() => setStreamFilter(null)}
          >
            All
          </button>
          {listeners.map(l => (
            <button
              key={l.id}
              className={`pill flex items-center ${streamFilter === l.id ? 'active' : ''}`}
              onClick={() => setStreamFilter(streamFilter === l.id ? null : l.id)}
            >
              {l.name}
              <span
                className={`${listenerStatus[l.id] ? 'bg-emerald-400' : 'bg-slate-300'} w-1.5 h-1.5 rounded-full ml-1.5 flex-shrink-0`}
              />
            </button>
          ))}
        </div>

        {/* Kind filter */}
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 flex-shrink-0">
          {[
            { key: null, label: 'All', id: 'all' },
            { key: 'post', label: 'Posts', id: 'post' },
            { key: 'comment', label: 'Comments', id: 'comment' },
          ].map(({ key, label, id }) => (
            <button
              key={id}
              onClick={() => setKindFilter(key)}
              className={`view-btn text-xs px-2.5 py-1 ${kindFilter === key ? 'active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs border border-slate-200 bg-white rounded-lg px-2 py-1.5 text-slate-600 outline-none cursor-pointer flex-shrink-0"
        >
          <option value="">Any status</option>
          <option value="new">New</option>
          <option value="reviewing">Reviewing</option>
          <option value="replied">Replied</option>
          <option value="converted">Converted</option>
          <option value="skipped">Skipped</option>
        </select>

        <div className="ml-auto flex items-center gap-4 flex-shrink-0">
          {/* View mode toggle */}
          <div className="flex items-center bg-slate-100 rounded-xl p-0.5">
            {[
              { mode: 'live', label: '● Live' },
              { mode: 'history', label: 'History' },
              { mode: 'board', label: 'Board' },
            ].map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`view-btn ${viewMode === mode ? 'active' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Live controls */}
          {viewMode === 'live' && (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={autoFilter}
                    onChange={e => setAutoFilter(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-violet-500 transition-colors"></div>
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4"></div>
                </div>
                <span className="text-sm text-slate-600 font-medium">Auto AI</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={hideRejected}
                    onChange={e => setHideRejected(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-red-400 transition-colors"></div>
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4"></div>
                </div>
                <span className="text-sm text-slate-600 font-medium">Hide rejected</span>
              </label>
              <button onClick={clearHits} className="text-sm text-slate-400 hover:text-slate-700 transition-colors">Clear</button>
              <ExportCSVButton />
            </div>
          )}
        </div>
      </div>

      {/* Feeds */}
      {viewMode === 'live' && (
        <LiveFeed
          streamFilter={streamFilter}
          kindFilter={kindFilter}
          statusFilter={statusFilter}
          hideRejected={hideRejected}
          autoFilter={autoFilter}
          onOpenReply={setReplyHit}
          onOpenThread={(postId, listenerId, commentId) => setThreadState({ postId, listenerId, commentId })}
          newHit={newHit}
          onHitCountUpdate={setHitCount}
        />
      )}
      {viewMode === 'history' && (
        <HistoryFeed
          onOpenReply={setReplyHit}
          onOpenThread={(postId, listenerId, commentId) => setThreadState({ postId, listenerId, commentId })}
        />
      )}
      {viewMode === 'board' && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <BoardFeed newHit={newHit} />
        </div>
      )}

      {/* Reply Panel */}
      {replyHit && (
        <ReplyPanel
          hit={replyHit}
          onClose={() => setReplyHit(null)}
          onSaved={() => setReplyHit(null)}
        />
      )}

      {/* Thread Panel */}
      {threadState && (
        <ThreadPanel
          postId={threadState.postId}
          listenerId={threadState.listenerId}
          commentId={threadState.commentId}
          onClose={() => setThreadState(null)}
        />
      )}
    </div>
  );
}

function ExportCSVButton() {
  const { hits } = useApp();
  function exportCSV() {
    const rows = [['ts', 'listener', 'kind', 'subreddit', 'author', 'match', 'title', 'url', 'excerpt', 'filter_passed']];
    for (const h of hits) {
      rows.push([
        new Date((h.ts || 0) * 1000).toISOString(),
        h.listener_name || '',
        h.kind || '',
        h.subreddit || '',
        h.author || '',
        h.match || '',
        h.title || '',
        h.url || '',
        h.excerpt || '',
        h.filter_result ? (h.filter_result.passed ? 'yes' : 'no') : '',
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `redsignal_live_${Date.now()}.csv`,
    }).click();
  }
  return (
    <button onClick={exportCSV} className="text-sm text-slate-400 hover:text-slate-700 transition-colors">
      ↓ CSV
    </button>
  );
}

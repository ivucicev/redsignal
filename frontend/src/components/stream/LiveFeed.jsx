import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context.jsx';
import { apiFetch } from '../../api.js';
import HitCard from './HitCard.jsx';

const LIVE_PAGE = 25;

export default function LiveFeed({
  streamFilter,
  kindFilter,
  statusFilter,
  hideRejected,
  autoFilter,
  onOpenReply,
  onOpenThread,
  newHit,
  onHitCountUpdate,
}) {
  const { cfg, hits, setHits, hitIds, addToast } = useApp();
  const [liveDbOffset, setLiveDbOffset] = useState(0);
  const [liveDbTotal, setLiveDbTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const feedRef = useRef(null);
  const newHitRef = useRef(null);

  // Load recent hits on mount
  useEffect(() => {
    loadRecentHits(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // New hit from WS
  useEffect(() => {
    if (!newHit) return;
    if (hitIds.current.has(newHit.id)) return;
    hitIds.current.add(newHit.id);
    setHits(prev => [newHit, ...prev]);
    setLiveDbTotal(prev => {
      const next = prev + 1;
      onHitCountUpdate && onHitCountUpdate(next);
      return next;
    });
    // Auto analyze
    if (autoFilter) {
      const lst = (cfg.listeners || []).find(l => l.id === newHit.listener_id);
      const fls = (lst?.filters || []).filter(f => f.enabled);
      if (fls.length) {
        analyzeHit(newHit, fls, lst?.ai_credential_id || null);
      }
    }
    // Browser notification batch
    notifyBatch(newHit);
  }, [newHit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hit count update when liveDbTotal changes from DB load
  useEffect(() => {
    onHitCountUpdate && onHitCountUpdate(liveDbTotal);
  }, [liveDbTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  const notifyBatchRef = useRef({ batch: [], timer: null });
  function notifyBatch(hit) {
    notifyBatchRef.current.batch.push(hit);
    clearTimeout(notifyBatchRef.current.timer);
    notifyBatchRef.current.timer = setTimeout(() => {
      const n = notifyBatchRef.current.batch.length;
      const h = notifyBatchRef.current.batch[0];
      addToast(n === 1 ? `r/${h.subreddit} · ${h.match}` : `${n} new hits`, 'blue');
      notifyBatchRef.current.batch = [];
    }, 800);
  }

  async function loadRecentHits(more = false) {
    setLoading(true);
    const offset = more ? liveDbOffset : 0;
    if (!more) setLiveDbOffset(0);
    const data = await apiFetch(`/api/hits?limit=${LIVE_PAGE}&offset=${offset}`)
      .catch(() => ({ hits: [], total: 0 }));
    const returned = data.hits || [];
    setLiveDbTotal(data.total || 0);
    const newHits = returned.filter(h => !hitIds.current.has(h.id));
    newHits.forEach(h => hitIds.current.add(h.id));
    if (more) {
      setHits(prev => [...prev, ...newHits]);
    } else {
      setHits(prev => {
        // Keep WS hits at top, add DB hits that aren't already there
        const wsHits = prev.filter(h => !returned.find(r => r.id === h.id));
        return [...wsHits, ...newHits];
      });
    }
    setLiveDbOffset(offset + returned.length);
    setLoading(false);
  }

  async function analyzeHit(hit, filtersOverride, credOverride) {
    const lst = (cfg.listeners || []).find(l => l.id === hit.listener_id);
    const filters = filtersOverride || (lst?.filters || []).filter(f => f.enabled);
    const credId = credOverride ?? (lst?.ai_credential_id || null);
    if (!filters.length) { addToast('No AI filter steps for this listener', 'gray'); return; }

    setHits(prev => prev.map(h => h.id === hit.id ? { ...h, analyzing: true, filter_result: null } : h));

    const text = [
      hit.title ? `Title: ${hit.title}` : '',
      `Subreddit: r/${hit.subreddit || ''}`,
      `Match: ${hit.match || ''}`,
      `Excerpt: ${hit.excerpt || ''}`,
    ].filter(Boolean).join('\n\n');

    const result = await apiFetch('/api/filter/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, filters, credential_id: credId, hit_id: hit.id, listener_id: hit.listener_id }),
    }).catch(e => ({ error: e.message }));

    setHits(prev => prev.map(h => h.id === hit.id ? { ...h, analyzing: false, filter_result: result } : h));

    if (result?.passed) {
      _pushBrowserNotif(hit);
      _sendExternalNotify(hit, result.results);
    }
  }

  function _pushBrowserNotif(hit) {
    if (Notification?.permission !== 'granted') return;
    new Notification(`RedSignal — r/${hit.subreddit}`, {
      body: hit.title || hit.excerpt?.slice(0, 100) || '',
      tag: hit.id,
    });
  }

  async function _sendExternalNotify(hit, filterResults) {
    const lst = (cfg.listeners || []).find(l => l.id === hit.listener_id);
    if (!lst || (!lst.slack_webhook && !lst.telegram_bot_token)) return;
    await apiFetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listener_id: hit.listener_id,
        title: hit.title || '',
        url: hit.url || '',
        subreddit: hit.subreddit || '',
        author: hit.author || '',
        match: hit.match || '',
        excerpt: hit.excerpt || '',
        filter_results: filterResults || [],
      }),
    }).catch(() => {});
  }

  function hitVisible(hit) {
    if (streamFilter && hit.listener_id !== streamFilter) return false;
    if (kindFilter && hit.kind !== kindFilter) return false;
    if (statusFilter && (hit.status || 'new') !== statusFilter) return false;
    if (hideRejected && hit.filter_result?.passed === false) return false;
    return true;
  }

  const visibleHits = hits.filter(hitVisible);
  const hasMore = liveDbOffset < liveDbTotal;

  return (
    <div ref={feedRef} className="flex-1 overflow-y-auto p-5 space-y-3">
      {hits.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
              <path d="M2 12h3m14 0h3M12 2v3m0 14v3M4.93 4.93l2.12 2.12m9.9 9.9 2.12 2.12M4.93 19.07l2.12-2.12m9.9-9.9 2.12-2.12"/>
            </svg>
          </div>
          <div className="text-slate-700 font-semibold text-lg">No hits yet</div>
          <div className="text-slate-400 text-sm mt-1">Add credentials in Vault, create a listener, then click Start All</div>
        </div>
      )}
      {visibleHits.map(hit => (
        <HitCard
          key={hit.id}
          hit={hit}
          isHistory={false}
          onStatusUpdate={(id, status) => setHits(prev => prev.map(h => h.id === id ? { ...h, status } : h))}
          onOpenReply={onOpenReply}
          onOpenThread={onOpenThread}
          onAnalyze={(h) => analyzeHit(h)}
          onFilterByListener={() => {}}
        />
      ))}
      {hasMore && (
        <div className="flex justify-center pt-1 pb-4">
          <button
            onClick={() => loadRecentHits(true)}
            disabled={loading}
            className="px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-500 rounded-xl text-sm font-medium border border-slate-200 transition-colors flex items-center gap-2 disabled:opacity-60"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12l7 7 7-7"/>
            </svg>
            {loading ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </div>
  );
}

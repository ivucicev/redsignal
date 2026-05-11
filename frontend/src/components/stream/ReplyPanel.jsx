import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context.jsx';
import { apiFetch } from '../../api.js';

const TONES = ['helpful', 'casual', 'professional', 'direct'];

export default function ReplyPanel({ hit, onClose, onSaved }) {
  const { cfg, setCfg, addToast } = useApp();
  const [tone, setTone] = useState('helpful');
  const [reply, setReply] = useState(hit?.reply_draft || '');
  const [generating, setGenerating] = useState(false);
  const [showResult, setShowResult] = useState(!!(hit?.reply_draft));
  const productSaveRef = useRef(null);

  useEffect(() => {
    if (hit?.reply_draft) {
      setReply(hit.reply_draft);
      setShowResult(true);
    }
  }, [hit]);

  function debounceSaveProduct(val) {
    setCfg(prev => ({ ...prev, product_context: val }));
    clearTimeout(productSaveRef.current);
    productSaveRef.current = setTimeout(() => {
      apiFetch('/api/settings/product_context', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: val }),
      });
    }, 800);
  }

  async function generateReply() {
    if (!hit) return;
    const lst = (cfg.listeners || []).find(l => l.id === hit.listener_id);
    const credId = lst?.ai_credential_id || null;
    setGenerating(true);
    const result = await apiFetch('/api/reply/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: hit.title || '',
        excerpt: hit.excerpt || '',
        subreddit: hit.subreddit || '',
        product_context: cfg.product_context || '',
        tone,
        credential_id: credId,
      }),
    });
    setGenerating(false);
    if (result.error) { addToast(result.error, 'red'); return; }
    setReply(result.reply);
    setShowResult(true);
  }

  async function copyReply() {
    await navigator.clipboard.writeText(reply).catch(() => {});
    addToast('Copied to clipboard', 'green');
    await saveReplyDraft();
  }

  async function saveReplyDraft() {
    if (!hit) return;
    await apiFetch(`/api/hits/${hit.id}/reply`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply, listener_id: hit.listener_id }),
    });
    if (onSaved) onSaved(hit.id, reply);
    addToast('Draft saved · status → Replied', 'blue');
  }

  if (!hit) return null;

  return (
    <>
      <div className="panel-backdrop" onClick={onClose}></div>
      <div className="side-panel">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-slate-900">Draft Reply</h2>
            <p className="text-xs text-slate-400 mt-0.5">Claude writes a context-aware, non-spammy reply</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Post context */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
            <div className="text-xs font-semibold text-orange-500">r/{hit.subreddit}</div>
            <div className="text-sm font-medium text-slate-800 leading-snug">{hit.title || ''}</div>
            <div className="text-xs text-slate-500 line-clamp-3">{hit.excerpt || ''}</div>
          </div>

          {/* Product context */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">
              Your product / context{' '}
              <span className="text-xs font-normal text-slate-400 ml-1">saved automatically</span>
            </label>
            <textarea
              rows="3"
              className="inp text-sm"
              placeholder="What are you selling? What problem does it solve? Who is it for? (used in all replies)"
              value={cfg.product_context || ''}
              onChange={e => debounceSaveProduct(e.target.value)}
            />
          </div>

          {/* Tone */}
          <div>
            <div className="text-sm font-medium text-slate-700 mb-2">Tone</div>
            <div className="flex gap-2 flex-wrap">
              {TONES.map(t => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all capitalize ${
                    tone === t
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Generate */}
          <button
            onClick={generateReply}
            disabled={generating}
            className="w-full px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {generating ? (
              <><span className="spin">⟳</span> Generating…</>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m13 2-2 2.5h3L12 15" /><path d="M9.42 7.89 3.5 14h4l-2 8 9.08-10.11H11l2-8z" />
                </svg>
                Generate Reply
              </>
            )}
          </button>

          {/* Generated reply */}
          {showResult && (
            <div className="space-y-3">
              <div className="text-sm font-medium text-slate-700">
                Generated reply <span className="text-xs font-normal text-slate-400">— edit before using</span>
              </div>
              <textarea
                rows="5"
                className="inp text-sm"
                value={reply}
                onChange={e => setReply(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={copyReply}
                  className="flex-1 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  Copy to clipboard
                </button>
                <button
                  onClick={saveReplyDraft}
                  className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium transition-colors"
                >
                  Save draft
                </button>
                <a
                  href={hit.url || '#'}
                  target="_blank"
                  rel="noopener"
                  className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium transition-colors"
                >
                  ↗ Open post
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

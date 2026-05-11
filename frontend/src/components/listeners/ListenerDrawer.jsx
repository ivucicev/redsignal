import { useState, useRef } from 'react';
import { useApp } from '../../context.jsx';
import { saveConfig } from '../../api.js';

const DAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]];

export default function ListenerDrawer({ listener, onClose }) {
  const { cfg, setCfg } = useApp();
  const [lst, setLst] = useState({ ...listener });
  const [kwInput, setKwInput] = useState('');
  const [nkwInput, setNkwInput] = useState('');
  const [regexSample, setRegexSample] = useState('');
  const saveTimer = useRef(null);

  const rCreds = (cfg.credentials || []).filter(c => c.type === 'reddit');
  const aiCreds = (cfg.credentials || []).filter(c => ['anthropic', 'openai', 'ollama'].includes(c.type));

  const persist = (updated) => {
    const listeners = (cfg.listeners || []).map(l => l.id === updated.id ? updated : l);
    const newCfg = { ...cfg, listeners };
    setCfg(newCfg);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveConfig(newCfg), 600);
  };

  const update = (key, val) => {
    const next = { ...lst, [key]: val };
    setLst(next);
    persist(next);
  };

  const addKw = () => {
    const val = kwInput.trim();
    if (!val) return;
    update('keywords', [...(lst.keywords || []), val]);
    setKwInput('');
  };

  const removeKw = (i) => {
    const kws = [...(lst.keywords || [])];
    kws.splice(i, 1);
    update('keywords', kws);
  };

  const addNkw = () => {
    const val = nkwInput.trim();
    if (!val) return;
    update('negative_keywords', [...(lst.negative_keywords || []), val]);
    setNkwInput('');
  };

  const removeNkw = (i) => {
    const kws = [...(lst.negative_keywords || [])];
    kws.splice(i, 1);
    update('negative_keywords', kws);
  };

  const addFilter = () => {
    const filters = [...(lst.filters || [])];
    filters.push({ name: `Step ${filters.length + 1}`, prompt: 'Is this post from someone who could benefit from our product? Reply YES if relevant, NO if not.', enabled: true });
    update('filters', filters);
  };

  const removeFilter = (i) => {
    const filters = [...(lst.filters || [])];
    filters.splice(i, 1);
    update('filters', filters);
  };

  const updateFilter = (i, key, val) => {
    const filters = (lst.filters || []).map((f, idx) => idx === i ? { ...f, [key]: val } : f);
    update('filters', filters);
  };

  const toggleDay = (day) => {
    const days = Array.isArray(lst.schedule_days) ? [...lst.schedule_days] : [0, 1, 2, 3, 4, 5, 6];
    const idx = days.indexOf(day);
    if (idx >= 0) days.splice(idx, 1); else days.push(day);
    update('schedule_days', days);
  };

  const testRegex = () => {
    const kws = (lst.keywords || []).filter(k => k.trim());
    if (!kws.length || !regexSample) return null;
    try {
      const pat = new RegExp('(?<![A-Za-z0-9])(?:' + kws.join('|') + ')(?![A-Za-z0-9])', 'gi');
      const matches = [...regexSample.matchAll(pat)];
      if (!matches.length) return <span className="text-slate-400">No matches.</span>;
      const hi = regexSample.replace(pat, m => `<mark class="bg-amber-200 text-amber-900 rounded px-0.5 font-medium">${m}</mark>`);
      return <>
        <div className="text-emerald-600 font-semibold mb-1.5">{matches.length} match{matches.length !== 1 ? 'es' : ''}</div>
        <div className="text-slate-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: hi }} />
      </>;
    } catch (e) {
      return <span className="text-red-400 text-xs">Regex error: {e.message}</span>;
    }
  };

  const S = ({ children }) => <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{children}</div>;

  return (
    <>
      <div className="hidden fixed inset-0 z-40" style={{ background: 'rgba(15,23,42,.2)', backdropFilter: 'blur(2px)' }} onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-xl bg-white z-50 flex flex-col" style={{ boxShadow: '-8px 0 40px rgba(15,23,42,.12)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="font-semibold text-slate-900">{lst.name}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-7">

          {/* Credentials */}
          <section className="space-y-3.5">
            <S>Credentials</S>
            <label className="block">
              <span className="text-sm font-medium text-slate-600">Reddit Account</span>
              <select className="inp mt-1.5" value={lst.reddit_credential_id || ''} onChange={e => update('reddit_credential_id', e.target.value)}>
                <option value="">— Select —</option>
                {rCreds.length === 0
                  ? <option value="" disabled>No accounts — add in Vault</option>
                  : rCreds.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                }
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-600">AI Key <span className="font-normal text-slate-400">(for filters)</span></span>
              <select className="inp mt-1.5" value={lst.ai_credential_id || ''} onChange={e => update('ai_credential_id', e.target.value)}>
                <option value="">None</option>
                {aiCreds.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
              </select>
            </label>
            {(!rCreds.length || !aiCreds.length) && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                ⚠ Missing credentials — go to Vault to add them
              </p>
            )}
          </section>

          <div className="border-t border-slate-100" />

          {/* Configuration */}
          <section className="space-y-3.5">
            <S>Configuration</S>
            <label className="block">
              <span className="text-sm font-medium text-slate-600">Name</span>
              <input className="inp mt-1.5" value={lst.name} onChange={e => update('name', e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-600">Subreddits</span>
              <input className="inp mt-1.5" value={lst.subreddits || 'all'} placeholder="all" onChange={e => update('subreddits', e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">Combine with +: <code className="bg-slate-100 px-1 rounded">SaaS+smallbusiness</code></p>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-600">Webhook <span className="font-normal text-slate-400">(optional)</span></span>
              <input className="inp mt-1.5" value={lst.webhook || ''} placeholder="https://…" onChange={e => update('webhook', e.target.value)} />
            </label>
          </section>

          <div className="border-t border-slate-100" />

          {/* Keywords */}
          <section className="space-y-3">
            <S>Keywords <span className="font-normal normal-case">(Python regex)</span></S>
            <div className="space-y-2">
              {(lst.keywords || []).length === 0
                ? <div className="text-slate-400 text-sm py-2 text-center">No keywords yet.</div>
                : (lst.keywords || []).map((kw, i) => (
                  <div key={i} className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <span className="font-mono text-sm text-emerald-700 flex-1 truncate">{kw}</span>
                    <button onClick={() => removeKw(i)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-100 text-slate-300 hover:text-red-400">×</button>
                  </div>
                ))
              }
            </div>
            <div className="flex gap-2">
              <input
                className="inp font-mono flex-1 text-sm"
                placeholder="e.g. work\Worders?"
                value={kwInput}
                onChange={e => setKwInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addKw()}
              />
              <button onClick={addKw} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium">Add</button>
            </div>
            <p className="text-xs text-slate-400">⚠ Restart listener after changing keywords.</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-500">Pattern tester</div>
              <textarea
                rows={2}
                className="inp text-sm bg-white"
                placeholder="Paste sample text here to test all patterns above…"
                value={regexSample}
                onChange={e => setRegexSample(e.target.value)}
              />
              <div className="text-xs leading-relaxed">{testRegex()}</div>
            </div>
          </section>

          <div className="border-t border-slate-100" />

          {/* Notifications */}
          <section className="space-y-3.5">
            <S>Notifications <span className="font-normal normal-case">(sent on every keyword match)</span></S>
            <label className="block">
              <span className="text-sm font-medium text-slate-600">Slack Webhook <span className="text-xs font-normal text-slate-400 ml-1">Block Kit format</span></span>
              <input className="inp mt-1.5 text-sm" value={lst.slack_webhook || ''} placeholder="https://hooks.slack.com/services/…" onChange={e => update('slack_webhook', e.target.value)} />
              <span className="text-xs text-slate-400 mt-1 block">Get at <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener" className="text-blue-500 hover:underline">api.slack.com/messaging/webhooks</a></span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-600">Telegram Bot Token</span>
                <input className="inp mt-1.5 text-sm font-mono" type="password" value={lst.telegram_bot_token || ''} placeholder="123456:ABC…" onChange={e => update('telegram_bot_token', e.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-600">Telegram Chat ID</span>
                <input className="inp mt-1.5 text-sm font-mono" value={lst.telegram_chat_id || ''} placeholder="-100123…" onChange={e => update('telegram_chat_id', e.target.value)} />
              </label>
            </div>
            <p className="text-xs text-slate-400">
              Bot via <a href="https://t.me/BotFather" target="_blank" rel="noopener" className="text-blue-500 hover:underline">@BotFather</a> · Chat ID via <a href="https://t.me/userinfobot" target="_blank" rel="noopener" className="text-blue-500 hover:underline">@userinfobot</a>
            </p>
          </section>

          <div className="border-t border-slate-100" />

          {/* Negative keywords */}
          <section className="space-y-3">
            <S>Negative Keywords <span className="font-normal normal-case">(drop hit if any match)</span></S>
            <div className="space-y-2">
              {(lst.negative_keywords || []).length === 0
                ? <div className="text-slate-400 text-sm py-1">None — all keyword matches pass through.</div>
                : (lst.negative_keywords || []).map((kw, i) => (
                  <div key={i} className="flex items-center gap-2.5 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <span className="font-mono text-sm text-red-600 flex-1 truncate">{kw}</span>
                    <button onClick={() => removeNkw(i)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-100 text-red-300 hover:text-red-500">×</button>
                  </div>
                ))
              }
            </div>
            <div className="flex gap-2">
              <input
                className="inp font-mono flex-1 text-sm"
                placeholder="e.g. hate|terrible|not looking"
                value={nkwInput}
                onChange={e => setNkwInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addNkw()}
              />
              <button onClick={addNkw} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium">Add</button>
            </div>
          </section>

          <div className="border-t border-slate-100" />

          {/* Author quality */}
          <section className="space-y-3">
            <S>Author Quality Filter</S>
            <p className="text-xs text-slate-400">Skip posts from brand-new or low-karma accounts. Set to 0 to disable.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-600">Min karma</span>
                <input type="number" min="0" className="inp mt-1.5 text-sm" value={lst.min_karma || 0} onChange={e => update('min_karma', +e.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-600">Min account age (days)</span>
                <input type="number" min="0" className="inp mt-1.5 text-sm" value={lst.min_account_age_days || 0} onChange={e => update('min_account_age_days', +e.target.value)} />
              </label>
            </div>
          </section>

          <div className="border-t border-slate-100" />

          {/* Schedule */}
          <section className="space-y-3.5">
            <div className="flex items-center justify-between">
              <S>Schedule Window</S>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={!!lst.schedule_enabled} className="sr-only peer" onChange={e => update('schedule_enabled', e.target.checked)} />
                <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-blue-500 transition-colors" />
                <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
              </label>
            </div>
            {lst.schedule_enabled ? (
              <div className="space-y-3.5">
                <label className="block">
                  <span className="text-sm font-medium text-slate-600">Timezone</span>
                  <input className="inp mt-1.5 text-sm" value={lst.schedule_timezone || 'UTC'} placeholder="UTC" onChange={e => update('schedule_timezone', e.target.value)} />
                  <p className="text-xs text-slate-400 mt-1">IANA format: <code className="bg-slate-100 px-1 rounded">America/New_York</code> · <code className="bg-slate-100 px-1 rounded">Europe/London</code></p>
                </label>
                <div>
                  <span className="text-sm font-medium text-slate-600 block mb-2">Active days</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAYS.map(([label, n]) => {
                      const days = Array.isArray(lst.schedule_days) ? lst.schedule_days : [0, 1, 2, 3, 4, 5, 6];
                      const on = days.includes(n);
                      return (
                        <button
                          key={n}
                          onClick={() => toggleDay(n)}
                          className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-600">Start hour <span className="font-normal text-slate-400">(0–23)</span></span>
                    <input type="number" min="0" max="23" className="inp mt-1.5 text-sm" value={lst.schedule_start ?? 0} onChange={e => update('schedule_start', +e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-600">End hour <span className="font-normal text-slate-400">(1–24)</span></span>
                    <input type="number" min="1" max="24" className="inp mt-1.5 text-sm" value={lst.schedule_end ?? 24} onChange={e => update('schedule_end', +e.target.value)} />
                  </label>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Enable to restrict when this listener is active (e.g. business hours only).</p>
            )}
          </section>

          <div className="border-t border-slate-100" />

          {/* AI filter pipeline */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <S>AI Filter Pipeline</S>
              <button
                onClick={addFilter}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-violet-100 hover:bg-violet-200 text-violet-700 font-medium"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                Add Step
              </button>
            </div>
            {(lst.filters || []).length === 0 && (
              <div className="text-slate-400 text-sm py-1">No filter steps yet. Each hit can be evaluated by Claude before being marked passed/rejected.</div>
            )}
            <div className="space-y-3">
              {(lst.filters || []).map((f, i) => (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold bg-white border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md flex-shrink-0">Step {i + 1}</span>
                    <input
                      className="inp text-sm py-1.5 flex-1 bg-white"
                      value={f.name}
                      placeholder="Step name"
                      onChange={e => updateFilter(i, 'name', e.target.value)}
                    />
                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input type="checkbox" checked={!!f.enabled} className="sr-only peer" onChange={e => updateFilter(i, 'enabled', e.target.checked)} />
                      <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:bg-violet-500 transition-colors" />
                      <div className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                    </label>
                    <button onClick={() => removeFilter(i)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-100 text-slate-300 hover:text-red-400 text-lg leading-none flex-shrink-0">×</button>
                  </div>
                  <textarea
                    rows={3}
                    className="inp text-sm bg-white"
                    placeholder="Prompt. Tell Claude to reply YES to pass or NO to reject."
                    value={f.prompt}
                    onChange={e => updateFilter(i, 'prompt', e.target.value)}
                  />
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>
    </>
  );
}

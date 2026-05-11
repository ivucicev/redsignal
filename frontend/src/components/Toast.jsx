import { useApp } from '../context.jsx';

export default function Toast() {
  const { toasts } = useApp();

  const dotColor = {
    blue: 'bg-blue-400',
    red: 'bg-red-400',
    green: 'bg-emerald-400',
    gray: 'bg-slate-500',
  };

  return (
    <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`${t.leaving ? 'toast-out' : 'toast'} flex items-center gap-2.5 bg-slate-900 text-white text-xs font-medium px-3.5 py-2.5 rounded-xl pointer-events-auto max-w-xs`}
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,.18)', backdropFilter: 'blur(8px)' }}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor[t.color] || 'bg-slate-500'} flex-shrink-0`}></span>
          <span className="truncate">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

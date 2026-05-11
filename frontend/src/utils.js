export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const STATUS_CFG = {
  new:       { label: 'New',          cls: 'st-new'       },
  reviewing: { label: 'Reviewing',    cls: 'st-reviewing'  },
  replied:   { label: 'Replied',      cls: 'st-replied'    },
  converted: { label: 'Converted ✓',  cls: 'st-converted'  },
  skipped:   { label: 'Skipped',      cls: 'st-skipped'    },
};

export const BOARD_COLS = [
  { status: 'new',       label: 'New',       color: 'bg-blue-50 text-blue-600 border-blue-100'     },
  { status: 'reviewing', label: 'Reviewing', color: 'bg-amber-50 text-amber-600 border-amber-100'   },
  { status: 'replied',   label: 'Replied',   color: 'bg-violet-50 text-violet-600 border-violet-100' },
  { status: 'converted', label: 'Converted', color: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
  { status: 'skipped',   label: 'Skipped',   color: 'bg-slate-100 text-slate-400 border-slate-200'  },
];

export const C = {
  blue:        '#3b82f6',
  violet:      '#8b5cf6',
  orange:      '#f97316',
  emerald:     '#10b981',
  red:         '#ef4444',
  amber:       '#f59e0b',
  slate:       '#94a3b8',
  sky:         '#0ea5e9',
  blueFill:    'rgba(59,130,246,.12)',
  violetFill:  'rgba(139,92,246,.12)',
  emeraldFill: 'rgba(16,185,129,.10)',
};

export const PALETTE = [
  C.blue, C.violet, C.orange, C.emerald, C.amber, C.red, C.sky,
  '#ec4899', '#14b8a6', '#a855f7', '#f43f5e', '#84cc16', '#6366f1', '#fb923c', '#22d3ee'
];

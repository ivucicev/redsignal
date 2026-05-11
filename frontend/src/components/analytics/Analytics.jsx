import { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { apiFetch } from '../../api.js';
import { C, PALETTE } from '../../utils.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);
ChartJS.defaults.font.family = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
ChartJS.defaults.font.size   = 11;
ChartJS.defaults.color       = '#64748b';
ChartJS.defaults.plugins.legend.display = false;
ChartJS.defaults.plugins.tooltip.backgroundColor = 'rgba(15,23,42,.88)';
ChartJS.defaults.plugins.tooltip.padding         = 10;
ChartJS.defaults.plugins.tooltip.cornerRadius    = 8;
ChartJS.defaults.plugins.tooltip.titleFont       = { size: 12, weight: '600' };
ChartJS.defaults.plugins.tooltip.bodyFont        = { size: 11 };
ChartJS.defaults.scale.grid.color                = '#f1f5f9';
ChartJS.defaults.scale.border.display            = false;
ChartJS.defaults.animation.duration              = 400;

const baseOpts = { maintainAspectRatio: false };
const noLegend = { plugins: { legend: { display: false } } };

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);

  useEffect(() => {
    apiFetch(`/api/stats?days=${days}`).then(d => setData(d)).catch(() => {});
  }, [days]);

  const ov = data?.overview;
  const hasData = ov && ov.total > 0;

  const rangeBtns = [7, 30, 90, 0];
  const rangeLabel = { 7: '7d', 30: '30d', 90: '90d', 0: 'All' };

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">Loading…</div>
    );
  }

  if (!hasData) {
    return (
      <div className="h-full overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-lg font-semibold">Analytics</h2>
            <RangeButtons days={days} setDays={setDays} rangeBtns={rangeBtns} rangeLabel={rangeLabel} />
          </div>
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            </div>
            <div className="text-slate-700 font-semibold text-lg">No data yet</div>
            <div className="text-slate-400 text-sm mt-1">Start a listener and wait for hits to appear here</div>
          </div>
        </div>
      </div>
    );
  }

  const tl = data.timeline || [];
  const tlLabels = tl.map(r => {
    const d = new Date(r.day + 'T00:00:00');
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  });

  const byHour = data.by_hour || [];
  const maxH   = Math.max(...byHour.map(r => r.count), 1);
  const byDow  = data.by_dow  || [];
  const maxD   = Math.max(...byDow.map(r => r.count), 1);
  const DOW    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const bySubPass = data.sub_pass || [];

  const kpis = [
    { label: 'Total hits',     value: ov.total.toLocaleString(),         color: 'text-slate-800'  },
    { label: 'Posts',          value: ov.posts.toLocaleString(),          color: 'text-blue-600'   },
    { label: 'Comments',       value: ov.comments.toLocaleString(),       color: 'text-violet-600' },
    { label: 'AI Passed',      value: ov.passed.toLocaleString(),         color: 'text-emerald-600'},
    { label: 'Pass rate',      value: ov.pass_rate != null ? ov.pass_rate + '%' : '—', color: 'text-emerald-600' },
    { label: 'Subreddits',     value: ov.unique_subs.toLocaleString(),    color: 'text-orange-500' },
    { label: 'Unique authors', value: ov.unique_authors.toLocaleString(), color: 'text-slate-600'  },
  ];

  const total = ov.posts + ov.comments;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto space-y-8">

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Analytics</h2>
            <p className="text-sm text-slate-400 mt-0.5">Insights from your saved hit history.</p>
          </div>
          <RangeButtons days={days} setDays={setDays} rangeBtns={rangeBtns} rangeLabel={rangeLabel} />
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {kpis.map(k => (
            <div key={k.label} className="card px-4 py-3">
              <div className="text-xs text-slate-400 font-medium truncate">{k.label}</div>
              <div className={`text-2xl font-bold mt-0.5 ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-semibold text-slate-800">Hits over time</div>
              <div className="text-xs text-slate-400 mt-0.5">Daily volume breakdown</div>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />Total</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-violet-400 inline-block" />Posts</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />Passed AI</span>
            </div>
          </div>
          <div style={{ height: 220 }}>
            <Line
              data={{
                labels: tlLabels,
                datasets: [
                  { label: 'Total',  data: tl.map(r => r.total),  borderColor: C.blue,    backgroundColor: C.blueFill,    borderWidth: 2,   pointRadius: 2, tension: .35, fill: true },
                  { label: 'Posts',  data: tl.map(r => r.posts),  borderColor: C.violet,  backgroundColor: C.violetFill,  borderWidth: 1.5, pointRadius: 0, tension: .35, fill: true },
                  { label: 'Passed', data: tl.map(r => r.passed), borderColor: C.emerald, backgroundColor: C.emeraldFill, borderWidth: 1.5, pointRadius: 0, tension: .35, fill: true },
                ],
              }}
              options={{ ...baseOpts, interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 10, maxRotation: 0 } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { display: false } } }}
            />
          </div>
        </div>

        {/* Type donut + subreddits */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="card p-6">
            <div className="font-semibold text-slate-800 mb-1">Type split</div>
            <div className="text-xs text-slate-400 mb-4">Posts vs Comments</div>
            <div style={{ height: 160 }}>
              {total > 0 && (
                <Doughnut
                  data={{ labels: ['Posts', 'Comments'], datasets: [{ data: [ov.posts, ov.comments], backgroundColor: [C.blue, C.violet], borderWidth: 0, hoverOffset: 4 }] }}
                  options={{ ...baseOpts, cutout: '72%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw.toLocaleString()} (${Math.round(ctx.raw / total * 100)}%)` } } } }}
                />
              )}
            </div>
            <div className="flex justify-center gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />Posts {total ? Math.round(ov.posts / total * 100) : 0}%</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" />Comments {total ? Math.round(ov.comments / total * 100) : 0}%</span>
            </div>
          </div>
          <div className="lg:col-span-2 card p-6">
            <div className="font-semibold text-slate-800 mb-1">Top subreddits</div>
            <div className="text-xs text-slate-400 mb-4">By hit volume</div>
            <div style={{ height: 220 }}>
              <Bar
                data={{
                  labels: (data.by_subreddit || []).map(r => 'r/' + r.name),
                  datasets: [
                    { label: 'Hits',   data: (data.by_subreddit || []).map(r => r.count),  backgroundColor: C.blue,    borderRadius: 4 },
                    { label: 'Passed', data: (data.by_subreddit || []).map(r => r.passed), backgroundColor: C.emerald, borderRadius: 4 },
                  ],
                }}
                options={{ ...baseOpts, indexAxis: 'y', interaction: { mode: 'index', intersect: false }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { ticks: { font: { size: 11 } } } }, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } } }}
              />
            </div>
          </div>
        </div>

        {/* Keywords + By hour */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-6">
            <div className="font-semibold text-slate-800 mb-1">Top keywords matched</div>
            <div className="text-xs text-slate-400 mb-4">Which patterns triggered most hits</div>
            <div style={{ height: 240 }}>
              <Bar
                data={{
                  labels: (data.by_keyword || []).map(r => r.keyword),
                  datasets: [{ data: (data.by_keyword || []).map(r => r.count), backgroundColor: (data.by_keyword || []).map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4 }],
                }}
                options={{ ...baseOpts, ...noLegend, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { ticks: { font: { size: 11, family: 'monospace' } } } } }}
              />
            </div>
          </div>
          <div className="card p-6">
            <div className="font-semibold text-slate-800 mb-1">Hits by hour (UTC)</div>
            <div className="text-xs text-slate-400 mb-4">Best times to engage</div>
            <div style={{ height: 240 }}>
              <Bar
                data={{
                  labels: byHour.map(r => r.hour === 0 ? '12am' : r.hour < 12 ? `${r.hour}am` : r.hour === 12 ? '12pm' : `${r.hour - 12}pm`),
                  datasets: [{ data: byHour.map(r => r.count), backgroundColor: byHour.map(r => `rgba(59,130,246,${0.2 + r.count / maxH * 0.8})`), borderRadius: 3 }],
                }}
                options={{ ...baseOpts, ...noLegend, scales: { x: { ticks: { maxRotation: 0, font: { size: 10 } } }, y: { beginAtZero: true, ticks: { precision: 0 } } } }}
              />
            </div>
          </div>
        </div>

        {/* By listener + By DOW */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-6">
            <div className="font-semibold text-slate-800 mb-1">By listener</div>
            <div className="text-xs text-slate-400 mb-4">Volume, passed, rejected per listener</div>
            <div style={{ height: 200 }}>
              <Bar
                data={{
                  labels: (data.by_listener || []).map(r => r.name),
                  datasets: [
                    { label: 'Total',    data: (data.by_listener || []).map(r => r.count),    backgroundColor: C.blue,    borderRadius: 4 },
                    { label: 'Passed',   data: (data.by_listener || []).map(r => r.passed),   backgroundColor: C.emerald, borderRadius: 4 },
                    { label: 'Rejected', data: (data.by_listener || []).map(r => r.rejected), backgroundColor: C.red,     borderRadius: 4 },
                  ],
                }}
                options={{ ...baseOpts, interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxRotation: 0 } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } } }}
              />
            </div>
          </div>
          <div className="card p-6">
            <div className="font-semibold text-slate-800 mb-1">By day of week</div>
            <div className="text-xs text-slate-400 mb-4">Which days are most active</div>
            <div style={{ height: 200 }}>
              <Bar
                data={{
                  labels: byDow.map(r => DOW[r.dow]),
                  datasets: [{ data: byDow.map(r => r.count), backgroundColor: byDow.map(r => `rgba(139,92,246,${0.2 + r.count / maxD * 0.8})`), borderRadius: 4 }],
                }}
                options={{ ...baseOpts, ...noLegend, scales: { x: { ticks: { maxRotation: 0 } }, y: { beginAtZero: true, ticks: { precision: 0 } } } }}
              />
            </div>
          </div>
        </div>

        {/* Sub pass rate + Top authors */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-6">
            <div className="font-semibold text-slate-800 mb-1">Subreddit quality <span className="text-xs text-slate-400 font-normal">(AI pass rate, ≥3 filtered)</span></div>
            <div className="text-xs text-slate-400 mb-4">Best subreddits for relevant leads</div>
            <div style={{ height: 220 }}>
              <Bar
                data={{
                  labels: bySubPass.map(r => `r/${r.name}`),
                  datasets: [{ data: bySubPass.map(r => r.rate), backgroundColor: bySubPass.map(r => { const h = r.rate / 100; return `rgba(${Math.round(16 + h * 224 - h * 200)},${Math.round(185 - h * 30)},${Math.round(129 - h * 90)},0.85)`; }), borderRadius: 4 }],
                }}
                options={{ ...baseOpts, ...noLegend, indexAxis: 'y', scales: { x: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }, y: { ticks: { font: { size: 11 } } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.raw}% pass rate (${bySubPass[ctx.dataIndex]?.count} filtered)` } } } }}
              />
            </div>
          </div>
          <div className="card p-6 flex flex-col">
            <div className="font-semibold text-slate-800 mb-1">Top authors</div>
            <div className="text-xs text-slate-400 mb-3">Most active users mentioning your keywords</div>
            <div className="flex-1 overflow-auto">
              {!(data.top_authors || []).length ? (
                <div className="text-slate-400 text-sm text-center py-6">No data yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-400 border-b border-slate-100">
                      <th className="text-left pb-2 font-medium">Author</th>
                      <th className="text-right pb-2 font-medium">Hits</th>
                      <th className="text-right pb-2 font-medium">Posts</th>
                      <th className="text-right pb-2 font-medium">Comments</th>
                      <th className="text-right pb-2 font-medium">Passed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {(data.top_authors || []).map((r, i) => (
                      <tr key={r.author} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-300 w-4 text-right">{i + 1}</span>
                            <a href={`https://reddit.com/u/${r.author}`} target="_blank" rel="noopener" className="font-medium text-slate-700 hover:text-blue-600 transition-colors">u/{r.author}</a>
                          </div>
                        </td>
                        <td className="py-2 text-right font-semibold text-slate-700">{r.count}</td>
                        <td className="py-2 text-right text-blue-600">{r.posts}</td>
                        <td className="py-2 text-right text-violet-600">{r.comments}</td>
                        <td className="py-2 text-right text-emerald-600">{r.passed || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Monthly table */}
        <div className="card p-6">
          <div className="font-semibold text-slate-800 mb-4">Monthly breakdown</div>
          {!(data.by_month || []).length ? (
            <div className="text-slate-400 text-sm text-center py-6">No data yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 border-b border-slate-100">
                    <th className="text-left pb-2 font-medium">Month</th>
                    <th className="text-right pb-2 font-medium">Total</th>
                    <th className="text-right pb-2 font-medium">Posts</th>
                    <th className="text-right pb-2 font-medium">Comments</th>
                    <th className="text-right pb-2 font-medium">AI Passed</th>
                    <th className="text-right pb-2 font-medium">Pass rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {(data.by_month || []).map(r => {
                    const rate = r.passed && r.total ? Math.round(r.passed / r.total * 100) : 0;
                    return (
                      <tr key={r.month} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2 font-medium text-slate-700">{r.month}</td>
                        <td className="py-2 text-right font-semibold text-slate-800">{r.total.toLocaleString()}</td>
                        <td className="py-2 text-right text-blue-600">{r.posts.toLocaleString()}</td>
                        <td className="py-2 text-right text-violet-600">{r.comments.toLocaleString()}</td>
                        <td className="py-2 text-right text-emerald-600">{r.passed.toLocaleString()}</td>
                        <td className="py-2 text-right">
                          <span className="inline-flex items-center gap-1">
                            <span className="text-slate-600">{rate}%</span>
                            <span className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden inline-block">
                              <span className="h-full bg-emerald-400 rounded-full block" style={{ width: `${rate}%` }} />
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function RangeButtons({ days, setDays, rangeBtns, rangeLabel }) {
  return (
    <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-0.5">
      {rangeBtns.map(d => (
        <button
          key={d}
          onClick={() => setDays(d)}
          className={`view-btn text-xs px-3 py-1.5${days === d ? ' active' : ''}`}
        >
          {rangeLabel[d]}
        </button>
      ))}
    </div>
  );
}

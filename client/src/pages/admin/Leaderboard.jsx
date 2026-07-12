import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, Skeleton, EmptyState, Badge } from '../../components/ui';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

const STATUS = {
  on_target: { tone: 'success', label: '✓ On target' },
  at_risk: { tone: 'alert', label: '△ At risk' },
  below: { tone: 'danger', label: '✕ Below target' },
  unassigned: { tone: 'navy', label: '— No clients' },
};

/**
 * Admin Leaderboard — jobs logged per employee with target status.
 * Horizontal bars, direct-labeled (name + count visible), status chips carry
 * text + icon so state is never color-alone.
 */
export default function AdminLeaderboard() {
  const [period, setPeriod] = useState('today');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(`/admin/leaderboard?period=${period}`)
      .then((res) => setData(res.data.leaderboard))
      .catch((err) => setError(errorMessage(err)));
  }, [period]);

  const max = data ? Math.max(1, ...data.map((r) => Math.max(r.jobsLogged, r.target))) : 1;

  return (
    <AppShell>
      <PageHeader title="Leaderboard" subtitle="Who's delivering — and who needs a push" />

      <div className="mb-6 inline-flex rounded-xl bg-white p-1 shadow-card border border-ivory-dark" role="tablist">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={period === p.key}
            onClick={() => setPeriod(p.key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              period === p.key ? 'bg-navy-800 text-ivory' : 'text-ink-soft hover:text-navy-800'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!data && !error && <Skeleton className="h-72 rounded-2xl" />}
      {data && (
        <Card className="animate-rise p-6">
          {data.length === 0 ? (
            <EmptyState icon="🏆" title="No employees yet" />
          ) : (
            <ol className="space-y-5">
              {data.map((row, i) => {
                const status = STATUS[row.status];
                const barPct = Math.round((row.jobsLogged / max) * 100);
                const targetPct = Math.round((row.target / max) * 100);
                return (
                  <li key={row.employeeId}>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-3">
                        <span className={`font-display text-lg w-8 text-center ${i === 0 ? 'text-gold-500' : 'text-ink-soft'}`}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                        </span>
                        <span className="font-semibold text-navy-800">{row.fullName}</span>
                        {!row.isActive && <Badge tone="danger">Deactivated</Badge>}
                        <span className="text-xs text-ink-soft">{row.clientCount} client{row.clientCount === 1 ? '' : 's'}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-navy-800 tabular-nums">
                          {row.jobsLogged}
                          {row.target > 0 && <span className="font-normal text-ink-soft"> / {row.target}</span>}
                        </span>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                    </div>
                    <div className="relative ml-11 h-4 rounded-full bg-ivory-dark overflow-hidden" aria-hidden="true">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${
                          row.status === 'on_target' ? 'bg-success'
                          : row.status === 'at_risk' ? 'bg-alert'
                          : row.status === 'below' ? 'bg-danger'
                          : 'bg-navy-800/30'
                        }`}
                        style={{ width: `${barPct}%` }}
                      />
                      {row.target > 0 && targetPct <= 100 && (
                        <div
                          className="absolute top-0 h-full w-0.5 bg-navy-800/60"
                          style={{ left: `${targetPct}%` }}
                          title={`Target: ${row.target}`}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-6 text-xs text-ink-soft">
            The dark tick on each bar marks the employee's prorated target for the selected period
            (sum of their clients' monthly targets).
          </p>
        </Card>
      )}
    </AppShell>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, CardHeader, StatCard, Skeleton, EmptyState, Badge, Button } from '../../components/ui';
import { formatDate } from '../../components/files';

export default function AdminOverview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [pulseResult, setPulseResult] = useState(null);
  const [pulseBusy, setPulseBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/overview')
      .then((res) => setData(res.data))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function runPulse() {
    setPulseBusy(true);
    setPulseResult(null);
    try {
      const { data: result } = await api.post('/admin/daily-pulse/run');
      setPulseResult(`Pulse sent: ${result.sent} emails (${result.skipped} skipped)`);
    } catch (err) {
      setPulseResult(errorMessage(err));
    } finally {
      setPulseBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Overview"
        subtitle="The state of the operation, at a glance"
        action={
          <Button variant="ghost" onClick={runPulse} disabled={pulseBusy}>
            {pulseBusy ? 'Sending…' : '📬 Run Daily Pulse now'}
          </Button>
        }
      />
      {pulseResult && (
        <div className="mb-6 rounded-xl bg-navy-800/5 px-4 py-3 text-sm text-navy-800">{pulseResult}</div>
      )}
      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!data && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      )}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Active Clients" value={data.kpis.activeClients} delay={0} />
            <StatCard label="Employees" value={data.kpis.activeEmployees} delay={1} />
            <StatCard label="Jobs Logged Today" value={data.kpis.jobsToday} tone="gold" sub={`${data.kpis.jobsThisMonth} this month`} delay={2} />
            <StatCard
              label="New Leads"
              value={data.kpis.newLeads ?? 0}
              tone={data.kpis.newLeads > 0 ? 'gold' : 'navy'}
              sub="from the website"
              delay={3}
            />
            <StatCard
              label="Expiring ≤ 7 Days"
              value={data.kpis.expiringSoonCount}
              tone={data.kpis.expiringSoonCount > 0 ? 'alert' : 'navy'}
              delay={4}
            />
          </div>

          <Card className="mt-8 animate-rise animate-rise-2">
            <CardHeader
              title="Renewals Radar"
              subtitle="Clients whose packages expire within 7 days"
            />
            {data.expiringSoon.length === 0 ? (
              <EmptyState icon="✅" title="Nothing expiring" hint="No client packages expire in the next 7 days." />
            ) : (
              <ul className="divide-y divide-ivory-dark">
                {data.expiringSoon.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                    <div>
                      <Link to={`/admin/clients/${c.id}`} className="font-semibold text-navy-800 hover:text-gold-600">
                        {c.fullName}
                      </Link>
                      <div className="text-sm text-ink-soft">{c.packageType}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-ink-soft">{formatDate(c.expiryDate)}</span>
                      <Badge tone="alert">⏳ {c.daysRemaining} day{c.daysRemaining === 1 ? '' : 's'} left</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}

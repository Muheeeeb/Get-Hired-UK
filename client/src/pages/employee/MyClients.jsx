import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, Skeleton, EmptyState, Badge } from '../../components/ui';

const LINKEDIN_LABEL = {
  not_started: ['Not started', 'navy'],
  in_progress: ['LinkedIn in progress', 'gold'],
  complete: ['LinkedIn complete', 'success'],
};

export default function MyClients() {
  const [clients, setClients] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/employee/clients')
      .then((res) => setClients(res.data.clients))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <AppShell>
      <PageHeader title="My Clients" subtitle="The people counting on you today" />
      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!clients && !error && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" />
        </div>
      )}
      {clients && clients.length === 0 && (
        <EmptyState icon="🗂️" title="No clients assigned yet" hint="Your admin will assign clients to you." />
      )}
      {clients && clients.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          {clients.map((c, i) => {
            const [liLabel, liTone] = LINKEDIN_LABEL[c.linkedinStatus];
            const pct = Math.min(100, Math.round((c.monthApplied / c.monthlyJobTarget) * 100));
            return (
              <Link key={c.id} to={`/employee/clients/${c.id}`}>
                <Card className={`p-6 hover:shadow-card-lg transition-shadow animate-rise animate-rise-${i % 4}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-xl text-navy-800">{c.fullName}</h2>
                      <p className="text-sm text-ink-soft">{c.packageType}</p>
                    </div>
                    {c.daysRemaining <= 7 && c.daysRemaining >= 0 && (
                      <Badge tone="alert">⏳ {c.daysRemaining}d</Badge>
                    )}
                    {c.daysRemaining < 0 && <Badge tone="danger">Expired</Badge>}
                  </div>

                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-ink-soft mb-1">
                      <span>{c.monthApplied} / {c.monthlyJobTarget} this month</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-ivory-dark overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? 'bg-success' : 'bg-gold-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Badge tone={liTone}>{liLabel}</Badge>
                    {c.todayApplied > 0 && <Badge tone="success">+{c.todayApplied} today</Badge>}
                    <span className="text-xs text-ink-soft ml-auto">
                      {c.domains.length} domain{c.domains.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

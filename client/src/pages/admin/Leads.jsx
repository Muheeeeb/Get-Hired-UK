import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, Skeleton, EmptyState, Badge } from '../../components/ui';

const STATUS = {
  new: { tone: 'gold', label: '● New' },
  contacted: { tone: 'navy', label: '◐ Contacted' },
  closed: { tone: 'success', label: '✓ Closed' },
};

/** Consultation requests submitted from the public landing page. */
export default function AdminLeads() {
  const [leads, setLeads] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  function load() {
    api.get('/admin/consultations')
      .then((res) => setLeads(res.data.leads))
      .catch((err) => setError(errorMessage(err)));
  }
  useEffect(load, []);

  async function setStatus(id, status) {
    await api.put(`/admin/consultations/${id}/status`, { status });
    load();
  }

  return (
    <AppShell>
      <PageHeader
        title="Leads"
        subtitle="Consultation requests from the website — reply within one working day"
      />
      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!leads && !error && <Skeleton className="h-64 rounded-2xl" />}
      {leads && (
        <Card className="animate-rise">
          {leads.length === 0 ? (
            <EmptyState
              icon="📥"
              title="No requests yet"
              hint="When someone books a consultation on the website, it lands here instantly."
            />
          ) : (
            <ul className="divide-y divide-ivory-dark">
              {leads.map((lead) => (
                <li key={lead.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-navy-800">{lead.fullName}</span>
                        <Badge tone={STATUS[lead.status].tone}>{STATUS[lead.status].label}</Badge>
                        {lead.interest && <Badge tone="navy">{lead.interest}</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-ink-soft">
                        <a href={`mailto:${lead.email}`} className="text-gold-600 font-medium hover:underline">
                          {lead.email}
                        </a>
                        {lead.phone && <span>{lead.phone}</span>}
                        <span>
                          {new Date(lead.createdAt).toLocaleString('en-GB', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {lead.message && (
                        <p
                          className={`mt-2 text-sm text-ink cursor-pointer ${expanded === lead.id ? '' : 'line-clamp-2'}`}
                          onClick={() => setExpanded(expanded === lead.id ? null : lead.id)}
                          title="Click to expand"
                        >
                          {lead.message}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {Object.keys(STATUS).map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatus(lead.id, s)}
                          disabled={lead.status === s}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                            lead.status === s
                              ? 'bg-navy-800 text-ivory'
                              : 'bg-navy-800/5 text-ink-soft hover:bg-navy-800/15'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </AppShell>
  );
}

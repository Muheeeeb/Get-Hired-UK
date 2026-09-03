import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Select, Skeleton } from '../../components/ui';
import { formatDate } from '../../components/files';

function hours(ms) {
  if (!ms) return '0h 0m';
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

/** Full employee profile: clients, per-client performance, activity & working time. */
export default function EmployeeDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [designation, setDesignation] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiModels, setAiModels] = useState([]);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    api.get(`/admin/employees/${id}`)
      .then((res) => {
        setData(res.data);
        setDesignation(res.data.employee.designation || '');
        setAiModel(res.data.employee.aiModel || '');
      })
      .catch((err) => setError(errorMessage(err)));
  }, [id]);
  useEffect(load, [load]);

  useEffect(() => {
    api.get('/ai/models').then((res) => setAiModels(res.data.models || [])).catch(() => {});
  }, []);

  async function saveSettings(e) {
    e.preventDefault();
    try {
      await api.put(`/admin/employees/${id}`, { designation, aiModel: aiModel || null });
      setNotice('Employee settings saved');
      setTimeout(() => setNotice(null), 3000);
      load();
    } catch (err) {
      setNotice(errorMessage(err));
    }
  }

  if (error) {
    return <AppShell><EmptyState icon="⚠️" title="Failed to load employee" hint={error} /></AppShell>;
  }

  return (
    <AppShell>
      {!data ? (
        <div className="space-y-6"><Skeleton className="h-12 w-72" /><Skeleton className="h-64 rounded-2xl" /></div>
      ) : (
        <>
          <PageHeader
            title={data.employee.fullName}
            subtitle={`${data.employee.email}${data.employee.designation ? ` · ${data.employee.designation}` : ''}`}
            action={
              <Link to="/admin/employees"><Button variant="ghost">← All employees</Button></Link>
            }
          />
          {notice && <div className="mb-6 rounded-xl bg-gold-100 px-4 py-3 text-sm text-navy-800">{notice}</div>}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Card className="px-5 py-4">
              <div className="label-caps text-ink-soft">Status</div>
              <div className="mt-2">
                <Badge tone={data.activity?.online ? 'success' : 'navy'}>
                  {data.activity?.online ? '● Online now' : '○ Offline'}
                </Badge>
              </div>
            </Card>
            <Card className="px-5 py-4">
              <div className="label-caps text-ink-soft">Working today</div>
              <div className="mt-1.5 font-display text-2xl text-navy-800">{hours(data.activity?.todayMs)}</div>
            </Card>
            <Card className="px-5 py-4">
              <div className="label-caps text-ink-soft">Last 7 days</div>
              <div className="mt-1.5 font-display text-2xl text-navy-800">{hours(data.activity?.weekMs)}</div>
            </Card>
            <Card className="px-5 py-4">
              <div className="label-caps text-ink-soft">Jobs today</div>
              <div className="mt-1.5 font-display text-2xl text-gold-600">{data.totals.jobsToday}</div>
              <div className="text-xs text-ink-soft">{data.totals.jobsWeek} this week · {data.totals.jobsMonth} this month</div>
            </Card>
            <Card className="px-5 py-4">
              <div className="label-caps text-ink-soft">Last login</div>
              <div className="mt-1.5 text-sm font-semibold text-navy-800">
                {data.activity?.lastLoginAt
                  ? new Date(data.activity.lastLoginAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                  : 'Never'}
              </div>
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Assigned Clients" subtitle="Current package-month progress against each client's target" />
              {data.clients.length === 0 ? (
                <EmptyState icon="🗂️" title="No clients assigned" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="stack-table w-full text-sm">
                    <thead>
                      <tr className="border-b border-gold-500/20 text-left">
                        <th className="label-caps px-6 py-3 text-ink-soft">Client</th>
                        <th className="label-caps px-4 py-3 text-ink-soft">Package</th>
                        <th className="label-caps px-4 py-3 text-ink-soft">Package Month</th>
                        <th className="label-caps px-4 py-3 text-ink-soft">Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.clients.map((c) => (
                        <tr key={c.clientId} className="border-b border-ivory-dark last:border-0 hover:bg-ivory/60">
                          <td data-label="Client" className="px-6 py-3.5">
                            <Link to={`/admin/clients/${c.clientId}`} className="font-semibold text-navy-800 hover:text-gold-600">
                              {c.fullName}
                            </Link>
                            {c.daysRemaining <= 7 && c.daysRemaining >= 0 && (
                              <Badge tone="alert">⏳ {c.daysRemaining}d</Badge>
                            )}
                          </td>
                          <td data-label="Package" className="px-4 py-3.5 text-ink-soft">{c.packageType}</td>
                          <td data-label="Package month" className="px-4 py-3.5 tabular-nums">
                            <span className="mr-1 text-xs text-ink-soft">M{c.packageMonth}</span> {c.monthApplied} / {c.monthlyJobTarget}
                            <span className="ml-1.5 text-xs text-ink-soft">({c.percent ?? 0}%)</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <Badge tone={c.targetMet ? 'success' : c.percent >= 60 ? 'alert' : 'danger'}>
                              {c.targetMet ? '✓ Met' : `${c.percent ?? 0}%`}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader title="Employee Settings" subtitle="Role details and AI Studio access" />
                <form onSubmit={saveSettings} className="space-y-4 p-6">
                  <Input id="designation" label="Designation" placeholder="e.g. Senior Recruitment Specialist"
                    value={designation} onChange={(e) => setDesignation(e.target.value)} maxLength={120} />
                  <Select id="employee-ai-model" label="Allowed Claude model" value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}>
                    <option value="">Server default</option>
                    {aiModel && !aiModels.some((model) => model.id === aiModel) && (
                      <option value={aiModel}>{aiModel}</option>
                    )}
                    {aiModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </Select>
                  <p className="text-xs text-ink-soft">The employee cannot switch to any other model in AI Studio.</p>
                  <Button type="submit" className="w-full">Save settings</Button>
                </form>
              </Card>

              <Card>
                <CardHeader title="Recent Sessions" subtitle="Login and working periods" />
                {data.recentSessions.length === 0 ? (
                  <EmptyState icon="🕐" title="No sessions yet" />
                ) : (
                  <ul className="divide-y divide-ivory-dark text-sm">
                    {data.recentSessions.map((s) => (
                      <li key={s.id} className="flex items-center justify-between px-6 py-2.5">
                        <span className="text-ink">{formatDate(s.loginAt)}</span>
                        <span className="text-xs text-ink-soft tabular-nums">
                          {new Date(s.loginAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          {' → '}
                          {new Date(s.lastSeenAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          {' · '}
                          {hours(new Date(s.lastSeenAt) - new Date(s.loginAt))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

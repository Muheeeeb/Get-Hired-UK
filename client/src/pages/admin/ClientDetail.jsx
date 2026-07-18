import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, CardHeader, Skeleton, EmptyState, Badge, Button, Input, Select } from '../../components/ui';
import { JobTable } from '../../components/JobTable';
import { DownloadButton, formatDate } from '../../components/files';
import { LinkedInStepper } from '../../components/LinkedInStepper';

/** Admin client detail — sees everything: package, domains, masters, jobs + tailored files. */
export default function ClientDetail() {
  const { id } = useParams();
  const [dash, setDash] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [pkg, setPkg] = useState(null);
  const [domainsDraft, setDomainsDraft] = useState(null);

  const load = useCallback(async () => {
    try {
      const [{ data: d }, { data: j }, { data: e }] = await Promise.all([
        api.get(`/clients/${id}/dashboard`),
        api.get(`/clients/${id}/jobs`),
        api.get('/admin/employees'),
      ]);
      setDash(d);
      setJobs(j.jobs);
      setEmployees(e.employees);
      setPkg({
        packageType: d.client.packageType,
        expiryDate: new Date(d.expiry.expiryDate).toISOString().slice(0, 10),
        monthlyJobTarget: d.client.monthlyJobTarget,
        assignedEmployeeId: d.assignedEmployeeId || '',
      });
      setDomainsDraft(d.domains.map((dom) => dom.name));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  async function savePackage(e) {
    e.preventDefault();
    try {
      await api.put(`/admin/clients/${id}/package`, {
        packageType: pkg.packageType,
        expiryDate: pkg.expiryDate,
        monthlyJobTarget: Number(pkg.monthlyJobTarget),
      });
      await api.put(`/admin/clients/${id}/assign`, {
        employeeId: pkg.assignedEmployeeId || null,
      });
      flash('Package & assignment saved');
      load();
    } catch (err) {
      flash(errorMessage(err));
    }
  }

  async function saveDomains() {
    const domains = domainsDraft.map((d) => d.trim()).filter(Boolean);
    if (domains.length < 1 || domains.length > 10) return flash('Please provide between 1 and 10 domains');
    try {
      await api.put(`/admin/clients/${id}/domains`, { domains });
      flash('Domains updated');
      load();
    } catch (err) {
      flash(errorMessage(err));
    }
  }

  if (error) {
    return (
      <AppShell><EmptyState icon="⚠️" title="Failed to load client" hint={error} /></AppShell>
    );
  }

  return (
    <AppShell>
      {!dash || !pkg ? (
        <div className="space-y-6">
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <>
          <PageHeader
            title={dash.client.fullName}
            subtitle={dash.client.email}
            action={
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const next = !dash.clientActive;
                    if (!next && !window.confirm('Deactivate this client? They will be signed out and unable to log in.')) return;
                    await api.put(`/admin/clients/${id}/status`, { isActive: next });
                    flash(next ? 'Client reactivated' : 'Client deactivated');
                    load();
                  }}
                >
                  {dash.clientActive ? 'Deactivate' : 'Reactivate'}
                </Button>
                <Link to={`/employee/clients/${id}`}>
                  <Button variant="navy">Open workspace →</Button>
                </Link>
              </div>
            }
          />
          {!dash.clientActive && (
            <div className="mb-6 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
              This client account is deactivated — they cannot sign in.
            </div>
          )}
          {notice && (
            <div className="mb-6 rounded-xl bg-gold-100 px-4 py-3 text-sm text-navy-800" role="status">{notice}</div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="px-6 py-5">
              <div className="label-caps text-ink-soft">This Month</div>
              <div className="mt-2 font-display text-3xl text-navy-800">
                {dash.momentum.applied}<span className="text-lg text-ink-soft"> / {dash.momentum.target}</span>
              </div>
              <div className="text-xs text-ink-soft mt-1">applications logged</div>
            </Card>
            <Card className="px-6 py-5">
              <div className="label-caps text-ink-soft">Days Remaining</div>
              <div className={`mt-2 font-display text-3xl ${dash.expiry.expiringSoon ? 'text-alert' : 'text-navy-800'}`}>
                {dash.expiry.daysRemaining}
              </div>
              <div className="text-xs text-ink-soft mt-1">expires {formatDate(dash.expiry.expiryDate)}</div>
            </Card>
            <Card className="px-6 py-5">
              <div className="label-caps text-ink-soft mb-3">LinkedIn</div>
              <LinkedInStepper status={dash.client.linkedinStatus} />
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Package & Assignment" />
              <form onSubmit={savePackage} className="space-y-4 p-6">
                <Input id="pkg-type" label="Package type" value={pkg.packageType}
                  onChange={(e) => setPkg({ ...pkg, packageType: e.target.value })} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input id="pkg-expiry" label="Expiry date" type="date" value={pkg.expiryDate}
                    onChange={(e) => setPkg({ ...pkg, expiryDate: e.target.value })} />
                  <Input id="pkg-target" label="Monthly target" type="number" min={1} max={500}
                    value={pkg.monthlyJobTarget}
                    onChange={(e) => setPkg({ ...pkg, monthlyJobTarget: e.target.value })} />
                </div>
                <Select id="pkg-emp" label="Assigned employee" value={pkg.assignedEmployeeId}
                  onChange={(e) => setPkg({ ...pkg, assignedEmployeeId: e.target.value })}>
                  <option value="">— Unassigned —</option>
                  {employees.filter((e) => e.isActive).map((e) => (
                    <option key={e.id} value={e.id}>{e.fullName}</option>
                  ))}
                </Select>
                <Button type="submit">Save changes</Button>
              </form>
            </Card>

            <Card>
              <CardHeader title="Domains (1–10)" subtitle="Career domains this client targets — full sentences allowed" />
              <div className="space-y-2 p-6">
                {domainsDraft.map((d, i) => (
                  <Input key={i} id={`dom-${i}`} value={d}
                    onChange={(e) => {
                      const next = [...domainsDraft];
                      next[i] = e.target.value;
                      setDomainsDraft(next);
                    }} />
                ))}
                <div className="flex gap-2 pt-1">
                  {domainsDraft.length < 10 && (
                    <Button type="button" variant="ghost" className="!px-3 !py-1.5 text-xs"
                      onClick={() => setDomainsDraft([...domainsDraft, ''])}>+ Add</Button>
                  )}
                  {domainsDraft.length > 1 && (
                    <Button type="button" variant="ghost" className="!px-3 !py-1.5 text-xs"
                      onClick={() => setDomainsDraft(domainsDraft.slice(0, -1))}>− Remove last</Button>
                  )}
                  <Button type="button" className="!px-4 !py-1.5 text-xs ml-auto" onClick={saveDomains}>
                    Save domains
                  </Button>
                </div>
                <p className="text-xs text-ink-soft pt-1">
                  Renaming a domain removes its master documents — keep names stable once masters are uploaded.
                </p>
              </div>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader title="Master Documents" subtitle="Visible to the client" />
            <ul className="divide-y divide-ivory-dark">
              {dash.domains.map((domain) => (
                <li key={domain.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                  <span className="font-semibold text-navy-800">{domain.name}</span>
                  <div className="flex flex-wrap gap-2">
                    {domain.masterDocuments.length === 0 && <Badge tone="alert">No masters yet</Badge>}
                    {domain.masterDocuments.map((doc) => (
                      <DownloadButton key={doc.id} docId={doc.id}
                        label={doc.type === 'master_cv' ? 'Master CV' : 'Cover Letter'} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="mt-6">
            <CardHeader
              title="Job Applications"
              subtitle="Full log including tailored files (admin view)"
            />
            {!jobs ? (
              <div className="p-6"><Skeleton className="h-32" /></div>
            ) : (
              <JobTable jobs={jobs} showTailored />
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}

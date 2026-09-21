import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, CardHeader, Skeleton, EmptyState, Badge, Button, Input, Select } from '../../components/ui';
import { JobTable } from '../../components/JobTable';
import { DeleteFileButton, DownloadButton, formatDate } from '../../components/files';
import { LinkedInStepper } from '../../components/LinkedInStepper';
import { ClientCredentials } from '../../components/ClientCredentials';
import { ClientPersonalDetails } from '../../components/ClientPersonalDetails';
import { MonthlyApplicationBreakdown } from '../../components/MonthlyApplicationBreakdown';
import { ApplicationCharts } from '../../components/ApplicationCharts';
import { CollapsibleCard } from '../../components/CollapsibleCard';
import { PackageMonthsEditor } from '../../components/PackageMonthsEditor';

/** Admin client detail — sees everything: package, domains, masters, jobs + tailored files. */
export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dash, setDash] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

  const [pkg, setPkg] = useState(null);
  const [domainsDraft, setDomainsDraft] = useState(null);
  const [packageChoices, setPackageChoices] = useState([]);
  // Bumped on every successful load so child editors refetch instead of holding
  // a draft built from dates that have since changed.
  const [dataVersion, setDataVersion] = useState(0);

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
        packageStartedAt: new Date(d.client.packageStartedAt).toISOString().slice(0, 10),
        expiryDate: new Date(d.expiry.expiryDate).toISOString().slice(0, 10),
        monthlyJobTarget: d.client.monthlyJobTarget,
        assignedEmployeeId: d.assignedEmployeeId || '',
      });
      setDomainsDraft(d.domains.map((dom) => dom.name));
      setDataVersion((v) => v + 1);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get('/admin/package-choices').then((r) => setPackageChoices(r.data.choices)).catch(() => {});
  }, []);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  function flash(message, tone = 'success') {
    clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }

  async function savePackage(e) {
    e.preventDefault();
    try {
      await api.put(`/admin/clients/${id}/package`, {
        packageType: pkg.packageType,
        packageStartedAt: pkg.packageStartedAt,
        monthlyJobTarget: Number(pkg.monthlyJobTarget),
      });
      await api.put(`/admin/clients/${id}/assign`, {
        employeeId: pkg.assignedEmployeeId || null,
      });
      flash('Changes have been saved');
      load();
    } catch (err) {
      flash(errorMessage(err), 'error');
    }
  }

  async function saveDomains() {
    const domains = domainsDraft.map((d) => d.trim()).filter(Boolean);
    if (domains.length < 1 || domains.length > 10) return flash('Please provide between 1 and 10 domains', 'error');
    try {
      await api.put(`/admin/clients/${id}/domains`, { domains });
      flash('Domains updated');
      load();
    } catch (err) {
      flash(errorMessage(err), 'error');
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
                <Button
                  variant="ghost"
                  className="!text-danger !border-danger/30"
                  onClick={async () => {
                    const typed = window.prompt(
                      `PERMANENTLY delete ${dash.client.fullName} and ALL their data (documents, job history, chats)? This frees their email (${dash.client.email}) for reuse and cannot be undone.\n\nType DELETE to confirm:`
                    );
                    if (typed !== 'DELETE') return;
                    try {
                      await api.delete(`/admin/clients/${id}`);
                      navigate('/admin/clients');
                    } catch (err) {
                      flash(errorMessage(err), 'error');
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            }
          />
          {!dash.clientActive && (
            <div className="mb-6 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
              This client account is deactivated — they cannot sign in.
            </div>
          )}
          {notice && (
            <div
              className={`fixed right-4 top-4 z-[100] flex max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-card-lg sm:right-6 sm:top-6 ${
                notice.tone === 'error'
                  ? 'border-danger/20 bg-danger-soft text-danger'
                  : 'border-success/20 bg-white text-navy-800'
              }`}
              role={notice.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              <span className={`font-bold ${notice.tone === 'error' ? 'text-danger' : 'text-success'}`} aria-hidden="true">
                {notice.tone === 'error' ? '!' : '✓'}
              </span>
              <span className="font-semibold">{notice.message}</span>
              <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="px-6 py-5">
              <div className="label-caps text-ink-soft">Package Month {dash.momentum.month}</div>
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

          <ClientPersonalDetails client={dash.client} className="mt-6" />

          <ClientCredentials clientId={id} canViewLog />

          <ApplicationCharts
            stats={dash.applicationStats}
            months={dash.monthlyBreakdown}
            className="mt-6"
          />

          <MonthlyApplicationBreakdown months={dash.monthlyBreakdown} className="mt-6" />

          <PackageMonthsEditor
            clientId={id}
            className="mt-6"
            reloadToken={dataVersion}
            onSaved={() => { load(); flash('Package months updated'); }}
          />

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Package & Assignment" />
              <form onSubmit={savePackage} className="space-y-4 p-6">
                <Select id="pkg-type" label="Package type" value={pkg.packageType || ''}
                  onChange={(e) => setPkg({ ...pkg, packageType: e.target.value })}>
                  {pkg.packageType && !packageChoices.includes(pkg.packageType) && (
                    <option value={pkg.packageType}>{pkg.packageType}</option>
                  )}
                  {packageChoices.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input id="pkg-start" label="Start date (Month 1)" type="date" value={pkg.packageStartedAt}
                    onChange={(e) => setPkg({ ...pkg, packageStartedAt: e.target.value })} />
                  {/* Read-only on purpose. The expiry IS the last month's end
                      date; typing one here would re-cut every month boundary to
                      a new phase and silently re-bucket logged applications.
                      Package Months below owns it. */}
                  <div>
                    <span className="label-caps text-navy-800/70 mb-1.5 block">End / expiry date</span>
                    <div className="rounded-xl border border-navy-800/10 bg-ivory px-3.5 py-2.5 text-sm text-navy-800">
                      {formatDate(dash.expiry.expiryDate)}
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">Set by the last package month below</p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
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
                <p className="border-t border-ivory-dark pt-4 text-xs text-ink-soft">
                  The start date above is Month 1's start. Use
                  <strong className="font-semibold text-navy-800"> Package Months</strong> below to change
                  the end date, edit any individual month, extend the package, or remove a month.
                </p>
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

          <Card className="mt-6 overflow-hidden">
            <CardHeader title="Master Documents" subtitle="Visible to the client" />
            <ul className="divide-y divide-ivory-dark">
              {dash.domains.map((domain) => (
                <li key={domain.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <span className="min-w-0 break-words font-semibold text-navy-800">{domain.name}</span>
                  <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
                    {domain.masterDocuments.length === 0 && <Badge tone="alert">No masters yet</Badge>}
                    {domain.masterDocuments.map((doc) => (
                      <span key={doc.id} className="inline-flex max-w-full items-center gap-0.5 rounded-lg bg-ivory/70 pr-0.5">
                        <DownloadButton docId={doc.id} fileName={doc.fileName}
                          label={doc.type === 'master_cv' ? 'Master CV' : 'Cover Letter'} />
                        <DeleteFileButton
                          endpoint={`/clients/${id}/master-docs/${doc.id}`}
                          label={`the ${doc.type === 'master_cv' ? 'master CV' : 'master cover letter'} for "${domain.name}"`}
                          onDeleted={load}
                          className="!px-1.5"
                        />
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <CollapsibleCard
            className="mt-6"
            title="Job Applications"
            subtitle="Full log including tailored files (admin view)"
            badge={<Badge tone="navy">{jobs?.length ?? '…'} logged</Badge>}
          >
            {!jobs ? (
              <div className="p-6"><Skeleton className="h-32" /></div>
            ) : (
              <JobTable jobs={jobs} showTailored onDocumentDeleted={load} />
            )}
          </CollapsibleCard>
        </>
      )}
    </AppShell>
  );
}

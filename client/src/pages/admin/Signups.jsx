import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, Skeleton, EmptyState, Badge, Button, Input, Select, Modal } from '../../components/ui';

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS = {
  pending: { tone: 'gold', label: '● Awaiting approval' },
  approved: { tone: 'success', label: '✓ Approved' },
  rejected: { tone: 'danger', label: '✕ Rejected' },
};

const emptyApprove = {
  packageType: 'Gold — 30 jobs/month',
  expiryDate: '',
  monthlyJobTarget: 30,
  assignedEmployeeId: '',
  domains: ['', '', ''],
};

export default function AdminSignups() {
  const [tab, setTab] = useState('pending');
  const [signups, setSignups] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [approving, setApproving] = useState(null); // the signup being approved
  const [form, setForm] = useState(emptyApprove);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  function load() {
    setSignups(null);
    api.get(`/admin/signups?status=${tab}`)
      .then((res) => setSignups(res.data.signups))
      .catch((err) => setError(errorMessage(err)));
    api.get('/admin/employees').then((res) => setEmployees(res.data.employees)).catch(() => {});
  }
  useEffect(load, [tab]);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  function openApprove(signup) {
    setForm(emptyApprove);
    setFormError(null);
    setApproving(signup);
  }

  function setDomain(i, v) {
    const domains = [...form.domains];
    domains[i] = v;
    setForm({ ...form, domains });
  }

  async function submitApprove(e) {
    e.preventDefault();
    setFormError(null);
    const domains = form.domains.map((d) => d.trim()).filter(Boolean);
    if (domains.length < 3) return setFormError('Please enter at least 3 domains');
    setBusy(true);
    try {
      await api.put(`/admin/signups/${approving.id}/approve`, {
        packageType: form.packageType,
        expiryDate: form.expiryDate,
        monthlyJobTarget: Number(form.monthlyJobTarget),
        ...(form.assignedEmployeeId ? { assignedEmployeeId: form.assignedEmployeeId } : {}),
        domains,
      });
      setApproving(null);
      flash(`${approving.fullName} approved — they can now sign in.`);
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reject(signup) {
    if (!window.confirm(`Reject ${signup.fullName}'s sign-up request? They will not be able to sign in.`)) return;
    await api.put(`/admin/signups/${signup.id}/reject`);
    flash(`${signup.fullName}'s request was rejected.`);
    load();
  }

  return (
    <AppShell>
      <PageHeader title="Client Sign-ups" subtitle="Review and approve people who registered on the website" />

      <div className="mb-6 inline-flex rounded-xl bg-white p-1 shadow-card border border-ivory-dark" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-navy-800 text-ivory' : 'text-ink-soft hover:text-navy-800'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {notice && <div className="mb-6 rounded-xl bg-gold-100 px-4 py-3 text-sm text-navy-800" role="status">{notice}</div>}
      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!signups && !error && <Skeleton className="h-64 rounded-2xl" />}

      {signups && (
        <Card className="animate-rise">
          {signups.length === 0 ? (
            <EmptyState
              icon={tab === 'pending' ? '📭' : '—'}
              title={tab === 'pending' ? 'No pending requests' : `No ${tab} sign-ups`}
              hint={tab === 'pending' ? 'When someone registers on the website, they appear here for approval.' : undefined}
            />
          ) : (
            <ul className="divide-y divide-ivory-dark">
              {signups.map((s) => (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-navy-800">{s.fullName}</span>
                      <Badge tone={STATUS[s.approvalStatus].tone}>{STATUS[s.approvalStatus].label}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-ink-soft">
                      <a href={`mailto:${s.email}`} className="font-medium text-gold-600 hover:underline">{s.email}</a>
                      {s.phone && <span>{s.phone}</span>}
                      <span>{new Date(s.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {s.signupNote && <p className="mt-2 max-w-xl text-sm text-ink">“{s.signupNote}”</p>}
                  </div>
                  {tab === 'pending' && (
                    <div className="flex shrink-0 gap-2">
                      <Button className="!px-4 !py-2 text-xs" onClick={() => openApprove(s)}>Approve & set up</Button>
                      <Button variant="ghost" className="!px-4 !py-2 text-xs !text-danger !border-danger/30" onClick={() => reject(s)}>
                        Reject
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Modal open={Boolean(approving)} onClose={() => setApproving(null)} title={`Approve ${approving?.fullName || ''}`} wide>
        <form onSubmit={submitApprove} className="space-y-4">
          <p className="rounded-xl bg-ivory px-4 py-3 text-sm text-ink-soft">
            Set up <strong className="text-navy-800">{approving?.email}</strong>'s package and domains. Approving activates their sign-in.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input id="a-package" label="Package type" required value={form.packageType}
              onChange={(e) => setForm({ ...form, packageType: e.target.value })} />
            <Input id="a-expiry" label="Expiry date" type="date" required value={form.expiryDate}
              onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            <Input id="a-target" label="Monthly target" type="number" min={1} max={500} required
              value={form.monthlyJobTarget} onChange={(e) => setForm({ ...form, monthlyJobTarget: e.target.value })} />
          </div>
          <Select id="a-emp" label="Assign to employee" value={form.assignedEmployeeId}
            onChange={(e) => setForm({ ...form, assignedEmployeeId: e.target.value })}>
            <option value="">— Unassigned —</option>
            {employees.filter((e) => e.isActive).map((e) => (
              <option key={e.id} value={e.id}>{e.fullName}</option>
            ))}
          </Select>
          <div>
            <span className="label-caps text-navy-800/70 block mb-1.5">Domains (3–5)</span>
            <div className="space-y-2">
              {form.domains.map((d, i) => (
                <Input key={i} id={`a-domain-${i}`} placeholder={`Domain ${i + 1} — e.g. Software Engineer`}
                  value={d} onChange={(e) => setDomain(i, e.target.value)} />
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {form.domains.length < 5 && (
                <Button type="button" variant="ghost" className="!px-3 !py-1.5 text-xs"
                  onClick={() => setForm({ ...form, domains: [...form.domains, ''] })}>+ Add domain</Button>
              )}
              {form.domains.length > 3 && (
                <Button type="button" variant="ghost" className="!px-3 !py-1.5 text-xs"
                  onClick={() => setForm({ ...form, domains: form.domains.slice(0, -1) })}>− Remove last</Button>
              )}
            </div>
          </div>
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Approving…' : 'Approve & activate account'}
          </Button>
        </form>
      </Modal>
    </AppShell>
  );
}

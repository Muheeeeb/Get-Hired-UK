import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, Skeleton, EmptyState, Badge, Button, Input, Select, Modal } from '../../components/ui';
import { formatDate } from '../../components/files';

const EMPTY_FORM = {
  fullName: '', email: '', password: '', packageType: 'Platinum — 40 jobs/month',
  expiryDate: '', monthlyJobTarget: 40, assignedEmployeeId: '', domains: ['', '', ''],
};

export default function AdminClients() {
  const [clients, setClients] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  function load() {
    api.get('/admin/clients')
      .then((res) => setClients(res.data.clients))
      .catch((err) => setError(errorMessage(err)));
    api.get('/admin/employees').then((res) => setEmployees(res.data.employees));
  }
  useEffect(load, []);

  function setDomain(i, value) {
    const domains = [...form.domains];
    domains[i] = value;
    setForm({ ...form, domains });
  }

  async function createClient(e) {
    e.preventDefault();
    setFormError(null);
    const domains = form.domains.map((d) => d.trim()).filter(Boolean);
    if (domains.length < 3) return setFormError('Please enter at least 3 domains');
    setBusy(true);
    try {
      await api.post('/admin/clients', {
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        packageType: form.packageType,
        expiryDate: form.expiryDate,
        monthlyJobTarget: Number(form.monthlyJobTarget),
        ...(form.assignedEmployeeId ? { assignedEmployeeId: form.assignedEmployeeId } : {}),
        domains,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Clients"
        subtitle="Every client, every package, every deadline"
        action={<Button onClick={() => setShowCreate(true)}>+ New client</Button>}
      />
      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!clients && !error && <Skeleton className="h-64 rounded-2xl" />}
      {clients && (
        <Card className="animate-rise">
          {clients.length === 0 ? (
            <EmptyState icon="👤" title="No clients yet" hint="Create your first client to get started." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gold-500/20">
                    <th className="label-caps text-ink-soft px-6 py-3">Client</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Package</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Assigned To</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Jobs</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.id} className="border-b border-ivory-dark last:border-0 hover:bg-ivory/60">
                      <td className="px-6 py-3.5">
                        <Link to={`/admin/clients/${c.id}`} className="font-semibold text-navy-800 hover:text-gold-600">
                          {c.user.fullName}
                        </Link>
                        <div className="text-xs text-ink-soft">{c.user.email}</div>
                      </td>
                      <td className="px-4 py-3.5 text-ink-soft">{c.packageType}</td>
                      <td className="px-4 py-3.5">
                        {c.assignedEmployee ? c.assignedEmployee.fullName : <Badge tone="alert">Unassigned</Badge>}
                      </td>
                      <td className="px-4 py-3.5">{c._count.jobApplications}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="text-ink-soft whitespace-nowrap">{formatDate(c.expiryDate)}</span>
                          {c.daysRemaining <= 7 && c.daysRemaining >= 0 && (
                            <Badge tone="alert">{c.daysRemaining}d left</Badge>
                          )}
                          {c.daysRemaining < 0 && <Badge tone="danger">Expired</Badge>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New client" wide>
        <form onSubmit={createClient} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="c-name" label="Full name" required value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            <Input id="c-email" label="Email" type="email" required value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <Input id="c-pass" label="Temporary password (min 10 chars)" type="text" required minLength={10}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input id="c-package" label="Package type" required value={form.packageType}
              onChange={(e) => setForm({ ...form, packageType: e.target.value })} />
            <Input id="c-expiry" label="Expiry date" type="date" required value={form.expiryDate}
              onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            <Input id="c-target" label="Monthly job target" type="number" min={1} max={500} required
              value={form.monthlyJobTarget}
              onChange={(e) => setForm({ ...form, monthlyJobTarget: e.target.value })} />
          </div>
          <Select id="c-emp" label="Assign to employee" value={form.assignedEmployeeId}
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
                <Input key={i} id={`domain-${i}`} placeholder={`Domain ${i + 1} — e.g. Software Engineer`}
                  value={d} onChange={(e) => setDomain(i, e.target.value)} />
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {form.domains.length < 5 && (
                <Button type="button" variant="ghost" className="!px-3 !py-1.5 text-xs"
                  onClick={() => setForm({ ...form, domains: [...form.domains, ''] })}>
                  + Add domain
                </Button>
              )}
              {form.domains.length > 3 && (
                <Button type="button" variant="ghost" className="!px-3 !py-1.5 text-xs"
                  onClick={() => setForm({ ...form, domains: form.domains.slice(0, -1) })}>
                  − Remove last
                </Button>
              )}
            </div>
          </div>

          {formError && <p className="text-sm text-danger">{formError}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create client'}
          </Button>
        </form>
      </Modal>
    </AppShell>
  );
}

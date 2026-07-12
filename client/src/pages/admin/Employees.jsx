import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, Skeleton, EmptyState, Badge, Button, Input, Modal } from '../../components/ui';
import { formatDate } from '../../components/files';

export default function AdminEmployees() {
  const [employees, setEmployees] = useState(null);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  function load() {
    api.get('/admin/employees')
      .then((res) => setEmployees(res.data.employees))
      .catch((err) => setError(errorMessage(err)));
  }
  useEffect(load, []);

  async function createEmployee(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/employees', form);
      setShowCreate(false);
      setForm({ fullName: '', email: '', password: '' });
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(emp) {
    await api.put(`/admin/employees/${emp.id}/status`, { isActive: !emp.isActive });
    load();
  }

  return (
    <AppShell>
      <PageHeader
        title="Employees"
        subtitle="Your delivery team"
        action={<Button onClick={() => setShowCreate(true)}>+ New employee</Button>}
      />
      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!employees && !error && <Skeleton className="h-64 rounded-2xl" />}
      {employees && (
        <Card className="animate-rise">
          {employees.length === 0 ? (
            <EmptyState icon="🧑‍💼" title="No employees yet" hint="Create your first team member." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gold-500/20">
                    <th className="label-caps text-ink-soft px-6 py-3">Name</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Email</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Clients</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Last Login</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Status</th>
                    <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id} className="border-b border-ivory-dark last:border-0">
                      <td className="px-6 py-3.5 font-semibold text-navy-800">{emp.fullName}</td>
                      <td className="px-4 py-3.5 text-ink-soft">{emp.email}</td>
                      <td className="px-4 py-3.5">{emp._count.assignedClients}</td>
                      <td className="px-4 py-3.5 text-ink-soft">{emp.lastLoginAt ? formatDate(emp.lastLoginAt) : 'Never'}</td>
                      <td className="px-4 py-3.5">
                        <Badge tone={emp.isActive ? 'success' : 'danger'}>
                          {emp.isActive ? '● Active' : '○ Deactivated'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => toggleActive(emp)}>
                          {emp.isActive ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New employee">
        <form onSubmit={createEmployee} className="space-y-4">
          <Input id="fullName" label="Full name" required value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input id="email" label="Email" type="email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input id="password" label="Temporary password (min 10 chars)" type="text" required minLength={10}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create employee'}
          </Button>
        </form>
      </Modal>
    </AppShell>
  );
}

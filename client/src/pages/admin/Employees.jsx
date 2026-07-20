import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, Skeleton, EmptyState, Badge, Button, Input, Modal } from '../../components/ui';
import { formatDate } from '../../components/files';

export default function AdminEmployees() {
  const [employees, setEmployees] = useState(null);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', designation: '' });
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
      setForm({ fullName: '', email: '', password: '', designation: '' });
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

  async function deleteEmployee(emp) {
    const typed = window.prompt(
      `PERMANENTLY delete ${emp.fullName}? This frees their email (${emp.email}) for reuse and cannot be undone.\n\nType DELETE to confirm:`
    );
    if (typed !== 'DELETE') return;
    try {
      await api.delete(`/admin/employees/${emp.id}`);
      load();
    } catch (err) {
      alert(errorMessage(err));
    }
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
                    <tr key={emp.id} onClick={() => navigate(`/admin/employees/${emp.id}`)}
                      className="cursor-pointer border-b border-ivory-dark last:border-0 hover:bg-ivory/60">
                      <td className="px-6 py-3.5 font-semibold text-navy-800">{emp.fullName}</td>
                      <td className="px-4 py-3.5 text-ink-soft">{emp.email}</td>
                      <td className="px-4 py-3.5">{emp._count.assignedClients}</td>
                      <td className="px-4 py-3.5 text-ink-soft">{emp.lastLoginAt ? formatDate(emp.lastLoginAt) : 'Never'}</td>
                      <td className="px-4 py-3.5">
                        <Badge tone={emp.isActive ? 'success' : 'danger'}>
                          {emp.isActive ? '● Active' : '○ Deactivated'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => toggleActive(emp)}>
                            {emp.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                          <Button variant="ghost" className="!px-3 !py-1.5 text-xs !text-danger !border-danger/30" onClick={() => deleteEmployee(emp)}>
                            Delete
                          </Button>
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New employee">
        <form onSubmit={createEmployee} className="space-y-4">
          <Input id="fullName" label="Full name" required value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input id="email" label="Email" type="email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input id="designation" label="Designation (optional)" value={form.designation}
            onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Recruitment Specialist" />
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

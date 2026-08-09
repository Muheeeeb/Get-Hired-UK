import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, Skeleton, EmptyState, Badge, Button, Input, Modal } from '../../components/ui';
import { formatDate } from '../../components/files';

/** Admin management of Social Media portal accounts (one per social-media employee). */
export default function AdminSocialTeam() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  function load() {
    api.get('/admin/social-users')
      .then((res) => setUsers(res.data.users))
      .catch((err) => setError(errorMessage(err)));
  }
  useEffect(load, []);

  async function createUser(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/social-users', form);
      setShowCreate(false);
      setForm({ fullName: '', email: '', password: '' });
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u) {
    await api.put(`/admin/social-users/${u.id}/status`, { isActive: !u.isActive });
    load();
  }

  async function deleteUser(u) {
    const typed = window.prompt(
      `PERMANENTLY delete ${u.fullName}? Their posts are reassigned to you so published content survives. This frees their email (${u.email}) for reuse.\n\nType DELETE to confirm:`
    );
    if (typed !== 'DELETE') return;
    try {
      await api.delete(`/admin/social-users/${u.id}`);
      load();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Social Team"
        subtitle="Accounts for the Social Media Marketing portal"
        action={<Button onClick={() => setShowCreate(true)}>+ New social account</Button>}
      />
      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!users && !error && <Skeleton className="h-64 rounded-2xl" />}
      {users && (
        <Card className="animate-rise">
          {users.length === 0 ? (
            <EmptyState icon="✍️" title="No social accounts yet" hint="Create an account for a social-media team member." />
          ) : (
            <div className="overflow-x-auto">
              <table className="stack-table w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gold-500/20">
                    <th className="label-caps text-ink-soft px-6 py-3">Name</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Email</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Posts</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Last Login</th>
                    <th className="label-caps text-ink-soft px-4 py-3">Status</th>
                    <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-ivory-dark last:border-0 hover:bg-ivory/60">
                      <td data-label="Name" className="px-6 py-3.5 font-semibold text-navy-800">{u.fullName}</td>
                      <td data-label="Email" className="break-all px-4 py-3.5 text-ink-soft">{u.email}</td>
                      <td data-label="Posts" className="px-4 py-3.5">{u._count.posts}</td>
                      <td data-label="Last login" className="px-4 py-3.5 text-ink-soft">{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never'}</td>
                      <td data-label="Status" className="px-4 py-3.5">
                        <Badge tone={u.isActive ? 'success' : 'danger'}>
                          {u.isActive ? '● Active' : '○ Deactivated'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => toggleActive(u)}>
                            {u.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                          <Button variant="ghost" className="!px-3 !py-1.5 text-xs !text-danger !border-danger/30" onClick={() => deleteUser(u)}>
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New social account">
        <form onSubmit={createUser} className="space-y-4">
          <Input id="s-fullName" label="Full name" required value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input id="s-email" label="Email" type="email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input id="s-password" label="Temporary password (min 10 chars)" type="text" required minLength={10}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create social account'}
          </Button>
        </form>
      </Modal>
    </AppShell>
  );
}

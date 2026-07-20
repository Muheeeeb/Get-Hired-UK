import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Badge, Button, Card, CardHeader, EmptyState, Input, PasswordInput, Modal, Skeleton } from '../../components/ui';

function hours(ms) {
  if (!ms) return '0h 0m';
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

/**
 * Admin Lead control centre: manage admin accounts and see login status +
 * working time across the whole team. Lead-only (server enforced).
 */
export default function Team() {
  const [admins, setAdmins] = useState(null);
  const [team, setTeam] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', password: '', designation: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  const [resetTarget, setResetTarget] = useState(null);
  const [resetPw, setResetPw] = useState('');

  function load() {
    api.get('/admin/admins').then((r) => setAdmins(r.data.admins)).catch((e) => setError(errorMessage(e)));
    api.get('/admin/activity').then((r) => setTeam(r.data.team)).catch(() => {});
  }
  useEffect(load, []);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  async function createAdmin(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/admins', form);
      setShowCreate(false);
      setForm({ fullName: '', email: '', password: '', designation: '' });
      flash('Admin account created');
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(admin) {
    if (!admin.isActive || window.confirm(`Deactivate ${admin.fullName}? They will be signed out immediately.`)) {
      try {
        await api.put(`/admin/admins/${admin.id}/status`, { isActive: !admin.isActive });
        load();
      } catch (err) {
        flash(errorMessage(err));
      }
    }
  }

  async function resetPassword(e) {
    e.preventDefault();
    try {
      await api.put(`/admin/admins/${resetTarget.id}/password`, { password: resetPw });
      setResetTarget(null);
      setResetPw('');
      flash('Password reset — their other sessions were signed out');
    } catch (err) {
      flash(errorMessage(err));
    }
  }

  async function deleteAdmin(admin) {
    const typed = window.prompt(
      `PERMANENTLY delete admin ${admin.fullName}? This frees their email (${admin.email}) for reuse and cannot be undone.\n\nType DELETE to confirm:`
    );
    if (typed !== 'DELETE') return;
    try {
      await api.delete(`/admin/admins/${admin.id}`);
      flash(`${admin.fullName} deleted`);
      load();
    } catch (err) {
      flash(errorMessage(err));
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Team"
        subtitle="Admin accounts, activity and working time — Admin Lead only"
        action={<Button onClick={() => setShowCreate(true)}>+ New admin</Button>}
      />
      {notice && <div className="mb-6 rounded-xl bg-gold-100 px-4 py-3 text-sm text-navy-800" role="status">{notice}</div>}
      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}

      {!admins && !error && <Skeleton className="h-64 rounded-2xl" />}
      {admins && (
        <Card className="animate-rise">
          <CardHeader title="Administrators" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gold-500/20 text-left">
                  <th className="label-caps px-6 py-3 text-ink-soft">Name</th>
                  <th className="label-caps px-4 py-3 text-ink-soft">Email</th>
                  <th className="label-caps px-4 py-3 text-ink-soft">Status</th>
                  <th className="label-caps px-4 py-3 text-ink-soft">Today</th>
                  <th className="label-caps px-4 py-3 text-ink-soft">7 days</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id} className="border-b border-ivory-dark last:border-0">
                    <td className="px-6 py-3.5">
                      <span className="font-semibold text-navy-800">{a.fullName}</span>
                      {a.isLead && <Badge tone="gold">Lead</Badge>}
                      {a.designation && <div className="text-xs text-ink-soft">{a.designation}</div>}
                    </td>
                    <td className="px-4 py-3.5 text-ink-soft">{a.email}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={a.activity?.online ? 'success' : 'navy'}>
                          {a.activity?.online ? '● Online' : '○ Offline'}
                        </Badge>
                        {!a.isActive && <Badge tone="danger">Deactivated</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 tabular-nums">{hours(a.activity?.todayMs)}</td>
                    <td className="px-4 py-3.5 tabular-nums">{hours(a.activity?.weekMs)}</td>
                    <td className="px-4 py-3.5">
                      {!a.isLead && (
                        <div className="flex justify-end gap-1.5">
                          <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setResetTarget(a)}>
                            Reset password
                          </Button>
                          <Button variant="ghost" className={`!px-3 !py-1.5 text-xs ${a.isActive ? '!text-alert !border-alert/30' : ''}`}
                            onClick={() => toggle(a)}>
                            {a.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                          <Button variant="ghost" className="!px-3 !py-1.5 text-xs !text-danger !border-danger/30"
                            onClick={() => deleteAdmin(a)}>
                            Delete
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {team && (
        <Card className="mt-6 animate-rise animate-rise-1">
          <CardHeader title="Team Activity" subtitle="Login status and working time — everyone" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gold-500/20 text-left">
                  <th className="label-caps px-6 py-3 text-ink-soft">Name</th>
                  <th className="label-caps px-4 py-3 text-ink-soft">Role</th>
                  <th className="label-caps px-4 py-3 text-ink-soft">Status</th>
                  <th className="label-caps px-4 py-3 text-ink-soft">Last login</th>
                  <th className="label-caps px-4 py-3 text-ink-soft">Today</th>
                  <th className="label-caps px-4 py-3 text-ink-soft">7 days</th>
                </tr>
              </thead>
              <tbody>
                {team.map((t) => (
                  <tr key={t.id} className="border-b border-ivory-dark last:border-0">
                    <td className="px-6 py-3.5 font-semibold text-navy-800">
                      {t.fullName}
                      {t.designation && <div className="text-xs font-normal text-ink-soft">{t.designation}</div>}
                    </td>
                    <td className="px-4 py-3.5 capitalize text-ink-soft">{t.isLead ? 'admin lead' : t.role}</td>
                    <td className="px-4 py-3.5">
                      <Badge tone={t.activity?.online ? 'success' : 'navy'}>
                        {t.activity?.online ? '● Online' : '○ Offline'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-ink-soft">
                      {t.activity?.lastLoginAt
                        ? new Date(t.activity.lastLoginAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : 'Never'}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums">{hours(t.activity?.todayMs)}</td>
                    <td className="px-4 py-3.5 tabular-nums">{hours(t.activity?.weekMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New admin">
        <form onSubmit={createAdmin} className="space-y-4">
          <Input id="a-name" label="Full name" required value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input id="a-email" label="Email" type="email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input id="a-designation" label="Designation (optional)" value={form.designation}
            onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          <PasswordInput id="a-password" label="Temporary password (min 10 chars)" required minLength={10}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create admin'}
          </Button>
        </form>
      </Modal>

      <Modal open={Boolean(resetTarget)} onClose={() => setResetTarget(null)} title={`Reset password — ${resetTarget?.fullName || ''}`}>
        <form onSubmit={resetPassword} className="space-y-4">
          <PasswordInput id="r-password" label="New password (min 10 chars)" required minLength={10}
            value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
          <Button type="submit" className="w-full">Reset password</Button>
        </form>
      </Modal>
    </AppShell>
  );
}

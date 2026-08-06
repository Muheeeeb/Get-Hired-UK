import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, errorMessage } from '../api/client';
import { Button, Input, PasswordInput, Modal } from '../components/ui';

function navFor(user) {
  if (user?.role === 'admin') {
    return [
      { to: '/admin', label: 'Overview', icon: '◈', end: true },
      { to: '/admin/clients', label: 'Clients', icon: '👤' },
      { to: '/admin/employees', label: 'Employees', icon: '🧑‍💼' },
      { to: '/admin/leaderboard', label: 'Leaderboard', icon: '🏆' },
      { to: '/admin/signups', label: 'Sign-ups', icon: '✍️' },
      { to: '/admin/leads', label: 'Leads', icon: '📥' },
      { to: '/admin/subscribers', label: 'Subscribers', icon: '✉️' },
      { to: '/admin/resources', label: 'Prep Hub', icon: '🎓' },
      { to: '/admin/chat', label: 'Chat', icon: '💬', chat: true },
      ...(user.isLead ? [{ to: '/admin/team', label: 'Team', icon: '🛡️' }] : []),
    ];
  }
  if (user?.role === 'employee') {
    return [
      { to: '/employee', label: 'My Clients', icon: '👤', end: true },
      { to: '/employee/ai-studio', label: 'AI Studio', icon: '✨' },
      { to: '/employee/chat', label: 'Chat', icon: '💬', chat: true },
    ];
  }
  return [
    { to: '/client', label: 'My Dashboard', icon: '◈', end: true },
    { to: '/client/chat', label: 'Chat', icon: '💬', chat: true },
  ];
}

function LogoChip({ size = 40 }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-white/20"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src="/logo-mark.png" alt="" className="h-full w-full object-contain p-[3px]" />
    </span>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-6">
      <LogoChip size={40} />
      <div>
        <div className="font-display text-ivory text-base leading-tight">Get Hired Global</div>
        <div className="text-[10px] tracking-[0.2em] uppercase text-gold-300/80">Operations Portal</div>
      </div>
    </div>
  );
}

/**
 * Role-aware shell: dark navy sidebar (desktop) / slide-over (mobile),
 * ivory content area. `alertMode` shifts accents to amber for expiring clients.
 */
export function AppShell({ children, alertMode = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [profileRequired, setProfileRequired] = useState(false);
  const [unread, setUnread] = useState(0);
  const items = navFor(user);

  // Chat unread badge — light polling.
  useEffect(() => {
    if (!user) return;
    let on = true;
    const poll = () =>
      api.get('/chat/unread-count').then((r) => on && setUnread(r.data.unread)).catch(() => {});
    poll();
    const id = setInterval(poll, 25_000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'client') return;
    api.get('/clients/me/profile').then((r) => {
      if (!r.data.complete) { setProfileRequired(true); setShowAccount(true); }
    }).catch(() => {});
  }, [user]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900">
      <Brand />
      <div className="mx-5 h-px bg-gold-500/20" />
      <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Main navigation">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? `${alertMode ? 'bg-alert/20 text-[#F5B27E]' : 'bg-gold-500/15 text-gold-300'} `
                  : 'text-ivory/70 hover:bg-white/5 hover:text-ivory'
              }`
            }
          >
            <span aria-hidden="true" className="text-base">{item.icon}</span>
            {item.label}
            {item.chat && unread > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1.5 text-[11px] font-bold text-navy-900">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-5 border-t border-white/10">
        <div className="text-sm text-ivory font-medium truncate">{user?.fullName}</div>
        <div className="text-xs text-ivory/50 capitalize">{user?.role}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => { setMobileOpen(false); setShowAccount(true); }}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-ivory/80 hover:bg-white/10 transition"
          >
            Account
          </button>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-ivory/80 hover:bg-white/10 transition"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ivory">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between bg-navy-900 px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <LogoChip size={32} />
          <span className="font-display text-ivory">Get Hired Global</span>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          className="rounded-lg p-2 text-ivory hover:bg-white/10"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* Mobile slide-over */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 shadow-card-lg animate-rise">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-ivory/70 hover:bg-white/10"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10">{children}</div>
      </main>

      <ChangePasswordModal open={showAccount} onClose={() => { if (!profileRequired) setShowAccount(false); }} user={user} requiredProfile={profileRequired} onProfileComplete={() => setProfileRequired(false)} />
    </div>
  );
}

function ChangePasswordModal({ open, onClose, user, requiredProfile, onProfileComplete }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [linkSent, setLinkSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (next !== confirm) return setMsg({ tone: 'error', text: 'New passwords do not match' });
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setMsg({ tone: 'ok', text: 'Password changed. Other devices have been signed out.' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function emailResetLink() {
    try {
      await api.post('/auth/forgot-password', { email: user.email });
    } finally {
      setLinkSent(true);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={requiredProfile ? 'Complete your profile' : 'Account'}>
      {user?.role === 'client' && <ClientProfile requiredProfile={requiredProfile} onComplete={onProfileComplete} />}
      {/* Full account details */}
      <div className="mb-5 space-y-1.5 rounded-xl bg-ivory px-4 py-3.5 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-ink-soft">Name</span>
          <span className="font-semibold text-navy-800">{user?.fullName}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-ink-soft">Email</span>
          <span className="font-medium text-navy-800">{user?.email}</span>
        </div>
        {user?.phone && (
          <div className="flex justify-between gap-4">
            <span className="text-ink-soft">Phone</span>
            <span className="font-medium text-navy-800">{user.phone}</span>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <span className="text-ink-soft">Role</span>
          <span className="font-medium capitalize text-navy-800">
            {user?.isLead ? 'Admin Lead' : user?.role}
            {user?.designation ? ` · ${user.designation}` : ''}
          </span>
        </div>
      </div>

      <p className="label-caps mb-3 text-navy-800/70">Change password</p>
      <form onSubmit={submit} className="space-y-4">
        <PasswordInput id="cp-current" label="Current password" required autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)} />
        <PasswordInput id="cp-new" label="New password (min 10 characters)" required minLength={10}
          autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <PasswordInput id="cp-confirm" label="Confirm new password" required autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {msg && (
          <p className={`text-sm ${msg.tone === 'ok' ? 'text-success' : 'text-danger'}`} role="status">
            {msg.text}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Saving…' : 'Change password'}
        </Button>
      </form>

      <div className="mt-4 border-t border-ivory-dark pt-4 text-center text-sm text-ink-soft">
        Prefer email?{' '}
        <button onClick={emailResetLink} disabled={linkSent} className="font-semibold text-gold-600 hover:underline disabled:opacity-60">
          {linkSent ? 'Reset link sent to your inbox ✓' : 'Email me a secure reset link'}
        </button>
      </div>
    </Modal>
  );
}

function ClientProfile({ requiredProfile, onComplete }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get('/clients/me/profile').then((r) => {
      const p = r.data.profile;
      // Normalise for the form: notes must never be null (the box would submit
      // null and fail validation), and the date fields must be YYYY-MM-DD so a
      // re-save of an existing profile doesn't send a full ISO timestamp.
      setForm({
        ...p,
        dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : '',
        visaExpiryDate: p.visaExpiryDate ? p.visaExpiryDate.slice(0, 10) : '',
        notes: p.notes ?? '',
      });
    }).catch((err) => setError(errorMessage(err)));
  }, []);
  if (!form) return <div className="mb-5 text-sm text-ink-soft">Loading your profile…</div>;
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function save(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.put('/clients/me/profile', form); onComplete(); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="mb-5 space-y-3 rounded-xl border border-gold-500/25 bg-gold-100/30 p-4">
    <p className="text-sm font-semibold text-navy-800">{requiredProfile ? 'Please provide all mandatory details to continue.' : 'Personal details'}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <Input id="dob" label="Date of birth" type="date" required value={form.dateOfBirth?.slice(0, 10) || ''} onChange={(e) => set('dateOfBirth', e.target.value)} />
      <Input id="ni" label="NI number" required maxLength={80} value={form.niNumber || ''} onChange={(e) => set('niNumber', e.target.value)} />
      <Input id="visa" label="Visa status" required maxLength={120} value={form.visaStatus || ''} onChange={(e) => set('visaStatus', e.target.value)} />
      <Input id="visa-expiry" label="Visa expiry date" type="date" required value={form.visaExpiryDate?.slice(0, 10) || ''} onChange={(e) => set('visaExpiryDate', e.target.value)} />
      <Input id="profile-phone" label="Phone number" type="tel" required maxLength={40} value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} />
      <Input id="postcode" label="Postcode" required maxLength={30} value={form.postcode || ''} onChange={(e) => set('postcode', e.target.value)} />
    </div>
    <label className="block"><span className="label-caps text-navy-800/70 block mb-1.5">Residential address</span><textarea required rows={2} maxLength={2000} className="w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm" value={form.residentialAddress || ''} onChange={(e) => set('residentialAddress', e.target.value)} /></label>
    <label className="block"><span className="label-caps text-navy-800/70 block mb-1.5">Additional notes (optional)</span><textarea rows={2} maxLength={2000} className="w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm" value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} /></label>
    {error && <p className="text-sm text-danger">{error}</p>}
    <Button type="submit" disabled={busy} className="w-full">{busy ? 'Saving…' : 'Save profile details'}</Button>
  </form>;
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl text-navy-800">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

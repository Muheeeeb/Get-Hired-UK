import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, errorMessage } from '../api/client';
import { Button, Input, Modal } from '../components/ui';

const NAV = {
  admin: [
    { to: '/admin', label: 'Overview', icon: '◈', end: true },
    { to: '/admin/clients', label: 'Clients', icon: '👤' },
    { to: '/admin/employees', label: 'Employees', icon: '🧑‍💼' },
    { to: '/admin/leaderboard', label: 'Leaderboard', icon: '🏆' },
    { to: '/admin/leads', label: 'Leads', icon: '📥' },
    { to: '/admin/resources', label: 'Prep Hub', icon: '🎓' },
  ],
  employee: [
    { to: '/employee', label: 'My Clients', icon: '👤', end: true },
  ],
  client: [
    { to: '/client', label: 'My Dashboard', icon: '◈', end: true },
  ],
};

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
        <div className="font-display text-ivory text-base leading-tight">Get Hired UK</div>
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
  const items = NAV[user?.role] || [];

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
          <span className="font-display text-ivory">Get Hired UK</span>
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

      <ChangePasswordModal open={showAccount} onClose={() => setShowAccount(false)} user={user} />
    </div>
  );
}

function ChangePasswordModal({ open, onClose, user }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

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

  return (
    <Modal open={open} onClose={onClose} title="Account">
      <div className="mb-5 rounded-xl bg-ivory px-4 py-3 text-sm">
        <div className="font-semibold text-navy-800">{user?.fullName}</div>
        <div className="text-ink-soft">{user?.email} · <span className="capitalize">{user?.role}</span></div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <Input id="cp-current" label="Current password" type="password" required autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Input id="cp-new" label="New password (min 10 characters)" type="password" required minLength={10}
          autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <Input id="cp-confirm" label="Confirm new password" type="password" required autoComplete="new-password"
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
    </Modal>
  );
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

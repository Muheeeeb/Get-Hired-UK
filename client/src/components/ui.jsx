/** Design-system primitives: navy & gold, rounded-2xl, soft shadows. */
import { useState } from 'react';
import { Link } from 'react-router-dom';

/** Password field with a show/hide (eye) toggle. */
export function PasswordInput({ label, error, id, className = '', ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block" htmlFor={id}>
      {label && <span className="label-caps text-navy-800/70 block mb-1.5">{label}</span>}
      <span className="relative block">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className={`w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 pr-11 text-sm text-ink placeholder:text-ink-soft/50 focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30 outline-none transition ${className}`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-soft hover:text-navy-800"
        >
          {visible ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
              <path d="M1 1l22 22" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </span>
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

export function Card({ children, className = '', ...props }) {
  return (
    <div
      className={`rounded-2xl bg-white shadow-card border border-ivory-dark ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-gold-500/15">
      <div>
        <h2 className="font-display text-lg text-navy-800">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({ variant = 'primary', className = '', disabled, children, ...props }) {
  const variants = {
    primary:
      'bg-gold-500 text-navy-900 hover:bg-gold-400 active:bg-gold-600 shadow-sm font-semibold',
    navy: 'bg-navy-800 text-ivory hover:bg-navy-700 font-semibold',
    ghost: 'bg-transparent text-navy-800 hover:bg-navy-800/5 border border-navy-800/15',
    danger: 'bg-danger text-white hover:opacity-90 font-semibold',
    alert: 'bg-alert text-white hover:opacity-90 font-semibold',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({ tone = 'navy', children }) {
  const tones = {
    navy: 'bg-navy-800/8 text-navy-800',
    gold: 'bg-gold-100 text-gold-600',
    success: 'bg-success-soft text-success',
    alert: 'bg-alert-soft text-alert',
    danger: 'bg-danger-soft text-danger',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Input({ label, error, id, className = '', ...props }) {
  return (
    <label className="block" htmlFor={id}>
      {label && <span className="label-caps text-navy-800/70 block mb-1.5">{label}</span>}
      <input
        id={id}
        className={`w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30 outline-none transition ${className}`}
        {...props}
      />
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

export function Select({ label, id, children, className = '', ...props }) {
  return (
    <label className="block" htmlFor={id}>
      {label && <span className="label-caps text-navy-800/70 block mb-1.5">{label}</span>}
      <select
        id={id}
        className={`w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30 outline-none transition ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function EmptyState({ icon = '📂', title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="text-4xl mb-3" aria-hidden="true">{icon}</div>
      <p className="font-display text-navy-800 text-lg">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-soft max-w-sm">{hint}</p>}
    </div>
  );
}

export function StatCard({ label, value, sub, tone = 'navy', delay = 0, to }) {
  const body = (
    <Card className={`px-6 py-5 animate-rise animate-rise-${delay} h-full ${to ? 'transition hover:-translate-y-0.5 hover:shadow-card-lg cursor-pointer' : ''}`}>
      <div className="label-caps text-ink-soft">{label}</div>
      <div className={`mt-2 font-display text-3xl ${tone === 'gold' ? 'text-gold-600' : tone === 'alert' ? 'text-alert' : 'text-navy-800'}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-soft">{sub}</div>}
    </Card>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function GoldDivider() {
  return <div className="h-px bg-gradient-to-r from-transparent via-gold-500/40 to-transparent" />;
}

export function Modal({ open, onClose, title, children, wide = false }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl bg-white shadow-card-lg animate-rise max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gold-500/15">
          <h2 className="font-display text-lg text-navy-800">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-ink-soft hover:bg-navy-800/5"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ className = '' }) {
  return (
    <svg
      className={`animate-spin h-4 w-4 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

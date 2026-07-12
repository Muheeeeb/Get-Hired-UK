import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Button, Input, Spinner } from '../components/ui';

export default function Signup() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '', phone: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError('Passwords do not match');
    if (form.password.length < 10) return setError('Password must be at least 10 characters');
    setBusy(true);
    try {
      await api.post('/auth/signup', {
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone,
        note: form.note,
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, 'Sign-up failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-navy-900 p-12 lg:flex">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-gold-500/10 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-navy-600/30 blur-3xl" aria-hidden="true" />
        <Link to="/" className="relative flex items-center gap-3" aria-label="Back to the Get Hired UK homepage">
          <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-white/20">
            <img src="/logo-mark.png" alt="" className="h-full w-full object-contain p-[3px]" />
          </span>
          <div>
            <div className="font-display text-xl text-ivory">Get Hired UK</div>
            <div className="text-[11px] tracking-[0.25em] uppercase text-gold-300/80">Client Registration</div>
          </div>
        </Link>
        <div className="relative">
          <h1 className="font-display text-4xl leading-snug text-ivory">
            Start your<br />
            <span className="text-gold-300">career campaign.</span>
          </h1>
          <p className="mt-4 max-w-sm text-ivory/60">
            Register in a minute. Once our team approves your account, you'll get a dashboard
            and a specialist applying to hand-picked roles on your behalf.
          </p>
        </div>
        <div className="relative text-xs text-ivory/40">© 2016 Get Hired UK</div>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center bg-ivory px-6 py-10 lg:w-1/2">
        {done ? (
          <div className="w-full max-w-sm text-center animate-rise">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4.5 12.5l4.5 4.5L19.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h2 className="mt-5 font-display text-2xl text-navy-800">Request received</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
              Thanks for registering! Your account is <strong>awaiting approval</strong>. We'll email
              you as soon as it's activated — then you can sign in.
            </p>
            <Link to="/login" className="mt-7 inline-block">
              <Button variant="navy">Go to sign in</Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="w-full max-w-sm animate-rise">
            <h2 className="font-display text-3xl text-navy-800">Create your account</h2>
            <p className="mt-1.5 text-sm text-ink-soft">
              Register as a client — our team reviews and approves every request.
            </p>

            <div className="mt-7 space-y-4">
              <Input id="fullName" label="Full name" required autoComplete="name"
                value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Your name" />
              <Input id="email" label="Email" type="email" required autoComplete="email"
                value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" />
              <Input id="phone" label="Phone (optional)" autoComplete="tel"
                value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+44 …" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input id="password" label="Password (min 10)" type="password" required minLength={10} autoComplete="new-password"
                  value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="••••••••••" />
                <Input id="confirm" label="Confirm" type="password" required autoComplete="new-password"
                  value={form.confirm} onChange={(e) => set('confirm', e.target.value)} placeholder="••••••••••" />
              </div>
              <label className="block">
                <span className="label-caps text-navy-800/70 block mb-1.5">What roles are you looking for? (optional)</span>
                <textarea rows={3} maxLength={2000}
                  className="w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30 outline-none transition"
                  value={form.note} onChange={(e) => set('note', e.target.value)}
                  placeholder="e.g. Senior engineering roles in London or remote…" />
              </label>
            </div>

            {error && (
              <div className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>
            )}

            <Button type="submit" disabled={busy} className="mt-6 w-full py-3">
              {busy ? <Spinner /> : null}
              {busy ? 'Creating account…' : 'Create account'}
            </Button>

            <p className="mt-5 text-center text-sm text-ink-soft">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-gold-600 hover:underline">Sign in</Link>
            </p>
            <p className="mt-2 text-center text-sm">
              <Link to="/" className="font-medium text-ink-soft hover:text-navy-800">← Back to site</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

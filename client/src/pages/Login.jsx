import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Input, PasswordInput, Spinner } from '../components/ui';
import { api, errorMessage } from '../api/client';

const HOME = { admin: '/admin', employee: '/employee', client: '/client' };

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      const user = await login(email, password);
      navigate(HOME[user.role] || '/login');
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
      setUnverified(err?.response?.data?.code === 'EMAIL_UNVERIFIED');
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    try {
      await api.post('/auth/resend-verification', { email });
      setResent(true);
    } catch {
      setResent(true);
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
            <div className="text-[11px] tracking-[0.25em] uppercase text-gold-300/80">Operations Portal</div>
          </div>
        </Link>
        <div className="relative">
          <h1 className="font-display text-4xl leading-snug text-ivory">
            We apply.<br />
            You <span className="text-gold-300">interview.</span><br />
            You get hired.
          </h1>
          <p className="mt-4 max-w-sm text-ivory/60">
            A dedicated team applying to hand-picked roles for you, every single day — with a tailored CV and cover letter for every application.
          </p>
        </div>
        <div className="relative text-xs text-ivory/40">© 2016 Get Hired UK</div>
      </div>

      {/* Form panel */}
      <div className="relative flex w-full items-center justify-center bg-ivory px-6 lg:w-1/2">
        <form onSubmit={submit} className="w-full max-w-sm animate-rise">
          <h2 className="font-display text-3xl text-navy-800">Welcome back</h2>
          <p className="mt-1.5 text-sm text-ink-soft">Sign in to your portal</p>

          <div className="mt-8 space-y-4">
            <Input
              id="email" label="Email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            />
            <PasswordInput
              id="password" label="Password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••"
            />
          </div>

          {error && (
            <div className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
              {error}
              {unverified && (
                <button
                  type="button"
                  onClick={resendVerification}
                  disabled={resent}
                  className="mt-2 block font-semibold underline disabled:opacity-60"
                >
                  {resent ? 'Verification email sent ✓' : 'Resend verification email'}
                </button>
              )}
            </div>
          )}

          <Button type="submit" disabled={busy} className="mt-6 w-full py-3">
            {busy ? <Spinner /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>

          <div className="mt-4 flex items-center justify-between">
            <Link to="/" className="text-sm font-medium text-ink-soft hover:text-navy-800">
              ← Back to site
            </Link>
            <Link to="/forgot-password" className="text-sm font-medium text-gold-600 hover:underline">
              Forgot your password?
            </Link>
          </div>

          <div className="mt-6 rounded-xl border border-navy-800/10 bg-white px-4 py-3.5 text-center text-sm text-ink-soft">
            New client?{' '}
            <Link to="/signup" className="font-semibold text-navy-800 hover:text-gold-600">
              Create an account →
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

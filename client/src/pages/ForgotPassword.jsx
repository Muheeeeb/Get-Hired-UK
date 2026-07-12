import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Button, Input, Card } from '../components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory px-6">
      <Card className="w-full max-w-md p-8 animate-rise">
        <h1 className="font-display text-2xl text-navy-800">Reset your password</h1>
        {sent ? (
          <p className="mt-4 text-sm text-ink-soft">
            If that account exists, a reset link has been sent to <strong>{email}</strong>. It expires in 30 minutes.
          </p>
        ) : (
          <form onSubmit={submit}>
            <p className="mt-1.5 text-sm text-ink-soft">We'll email you a secure reset link.</p>
            <div className="mt-6">
              <Input
                id="email" label="Email" type="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={busy} className="mt-5 w-full">
              {busy ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
        )}
        <div className="mt-6 flex items-center justify-between">
          <Link to="/login" className="text-sm font-medium text-gold-600 hover:underline">← Back to sign in</Link>
          <Link to="/" className="text-sm font-medium text-ink-soft hover:text-navy-800">Home</Link>
        </div>
      </Card>
    </div>
  );
}

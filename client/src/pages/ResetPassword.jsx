import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Button, PasswordInput, Card } from '../components/ui';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory px-6">
      <Card className="w-full max-w-md p-8 animate-rise">
        <h1 className="font-display text-2xl text-navy-800">Choose a new password</h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <PasswordInput
            id="password" label="New password (min 10 characters)" required minLength={10}
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordInput
            id="confirm" label="Confirm password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Saving…' : 'Set new password'}
          </Button>
        </form>
        <div className="mt-6 flex items-center justify-between">
          <Link to="/login" className="text-sm font-medium text-gold-600 hover:underline">← Back to sign in</Link>
          <Link to="/" className="text-sm font-medium text-ink-soft hover:text-navy-800">Home</Link>
        </div>
      </Card>
    </div>
  );
}

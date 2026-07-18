import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Button, Card, Spinner } from '../components/ui';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState('working'); // working | ok | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('Missing verification token.');
      return;
    }
    api.post('/auth/verify-email', { token })
      .then((res) => {
        setState('ok');
        setMessage(res.data.message);
      })
      .catch((err) => {
        setState('error');
        setMessage(errorMessage(err, 'Verification failed.'));
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory px-6">
      <Card className="w-full max-w-md p-8 text-center animate-rise">
        {state === 'working' && (
          <>
            <Spinner className="mx-auto h-6 w-6 text-gold-600" />
            <p className="mt-4 text-sm text-ink-soft">Verifying your email…</p>
          </>
        )}
        {state === 'ok' && (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4.5 12.5l4.5 4.5L19.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="mt-5 font-display text-2xl text-navy-800">Email verified</h1>
            <p className="mt-2 text-sm text-ink-soft">{message}</p>
            <Link to="/login" className="mt-6 inline-block"><Button>Go to sign in</Button></Link>
          </>
        )}
        {state === 'error' && (
          <>
            <h1 className="font-display text-2xl text-navy-800">Verification failed</h1>
            <p className="mt-2 text-sm text-danger">{message}</p>
            <p className="mt-3 text-sm text-ink-soft">
              You can request a new link from the sign-in page.
            </p>
            <Link to="/login" className="mt-5 inline-block"><Button variant="navy">Back to sign in</Button></Link>
          </>
        )}
      </Card>
    </div>
  );
}

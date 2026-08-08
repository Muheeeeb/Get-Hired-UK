import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Card, CardHeader, Badge, Button, EmptyState } from './ui';

const LABELS = {
  email: 'Email account',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  nhs_jobs: 'NHS Jobs',
};

const REVEAL_SECONDS = 60;

/**
 * The client's job-board logins, for applying on their behalf.
 * Passwords are never included in the listing — revealing one is a separate,
 * audited call, and the plaintext is dropped from memory again after a minute.
 */
export function ClientCredentials({ clientId, canViewLog = false }) {
  const [creds, setCreds] = useState(null);
  const [error, setError] = useState(null);
  const [revealed, setRevealed] = useState({}); // service -> password
  const [busy, setBusy] = useState(null);
  const [copied, setCopied] = useState(null);
  const [log, setLog] = useState(null);
  const timers = useRef({});

  const load = useCallback(() => {
    api.get(`/clients/${clientId}/credentials`)
      .then((r) => setCreds(r.data.credentials))
      .catch((err) => setError(errorMessage(err)));
  }, [clientId]);
  useEffect(load, [load]);

  // Don't leave plaintext behind in a component that unmounts.
  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  async function reveal(service) {
    setBusy(service); setError(null);
    try {
      const { data } = await api.post(`/clients/${clientId}/credentials/${service}/reveal`);
      setRevealed((r) => ({ ...r, [service]: data.password }));
      clearTimeout(timers.current[service]);
      timers.current[service] = setTimeout(() => {
        setRevealed((r) => { const next = { ...r }; delete next[service]; return next; });
      }, REVEAL_SECONDS * 1000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function hide(service) {
    clearTimeout(timers.current[service]);
    setRevealed((r) => { const next = { ...r }; delete next[service]; return next; });
  }

  async function copy(service) {
    try {
      await navigator.clipboard.writeText(revealed[service]);
      setCopied(service);
      setTimeout(() => setCopied(null), 1800);
    } catch { /* clipboard unavailable */ }
  }

  function loadLog() {
    api.get(`/clients/${clientId}/credentials/log`)
      .then((r) => setLog(r.data.entries))
      .catch((err) => setError(errorMessage(err)));
  }

  return (
    <Card className="mt-6">
      <CardHeader
        title="Job board logins"
        subtitle="Apply from the client's own accounts — every reveal is logged"
        action={canViewLog && (
          <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => (log ? setLog(null) : loadLog())}>
            {log ? 'Hide access log' : 'Access log'}
          </Button>
        )}
      />
      {error && <p className="px-6 pt-4 text-sm text-danger">{error}</p>}
      {!creds ? (
        <div className="p-6 text-sm text-ink-soft">Loading…</div>
      ) : creds.length === 0 ? (
        <EmptyState icon="🔒" title="No logins saved" hint="The client can add these from their portal under Account." />
      ) : (
        <ul className="divide-y divide-ivory-dark">
          {creds.map((c) => (
            <li key={c.service} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-navy-800">{LABELS[c.service] || c.service}</span>
                  <Badge tone="navy">{c.username}</Badge>
                </div>
                <div className="mt-1 font-mono text-sm text-ink">
                  {revealed[c.service] ? (
                    <span className="rounded bg-gold-100 px-2 py-0.5">{revealed[c.service]}</span>
                  ) : (
                    <span className="text-ink-soft">••••••••</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {revealed[c.service] ? (
                  <>
                    <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => copy(c.service)}>
                      {copied === c.service ? 'Copied ✓' : 'Copy'}
                    </Button>
                    <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => hide(c.service)}>Hide</Button>
                  </>
                ) : (
                  <Button className="!px-3 !py-1.5 text-xs" disabled={busy === c.service} onClick={() => reveal(c.service)}>
                    {busy === c.service ? 'Revealing…' : 'Reveal'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {log && (
        <div className="border-t border-ivory-dark px-6 py-4">
          <p className="label-caps mb-2 text-ink-soft">Who has viewed these</p>
          {log.length === 0 ? (
            <p className="text-sm text-ink-soft">No one has revealed a password yet.</p>
          ) : (
            <ul className="space-y-1 text-sm text-ink-soft">
              {log.map((e) => (
                <li key={e.id}>
                  <span className="font-medium text-navy-800">{e.by}</span> ({e.role}) viewed{' '}
                  {LABELS[e.service] || e.service} ·{' '}
                  {new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

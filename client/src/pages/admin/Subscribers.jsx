import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, Skeleton, EmptyState, Badge, Button } from '../../components/ui';

/** Newsletter / email captures from the public site. Private to admins. */
export default function AdminSubscribers() {
  const [subscribers, setSubscribers] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get('/admin/newsletter')
      .then((res) => setSubscribers(res.data.subscribers))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function copyAll() {
    if (!subscribers?.length) return;
    const emails = subscribers.map((s) => s.email).join(', ');
    try {
      await navigator.clipboard.writeText(emails);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Subscribers"
        subtitle="Emails captured from the website — private to your team"
        action={
          subscribers?.length ? (
            <Button className="!px-4 !py-2 text-sm" onClick={copyAll}>
              {copied ? 'Copied ✓' : 'Copy all emails'}
            </Button>
          ) : null
        }
      />
      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!subscribers && !error && <Skeleton className="h-64 rounded-2xl" />}
      {subscribers && (
        <Card className="animate-rise">
          {subscribers.length === 0 ? (
            <EmptyState
              icon="✉️"
              title="No subscribers yet"
              hint="When someone enters their email on the website, it lands here."
            />
          ) : (
            <>
              <div className="border-b border-ivory-dark px-6 py-3 text-sm text-ink-soft">
                {subscribers.length} {subscribers.length === 1 ? 'subscriber' : 'subscribers'}
              </div>
              <ul className="divide-y divide-ivory-dark">
                {subscribers.map((sub) => (
                  <li key={sub.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <a
                        href={`mailto:${sub.email}`}
                        className="break-all font-medium text-gold-600 hover:underline"
                      >
                        {sub.email}
                      </a>
                      {sub.source && <Badge tone="navy">{sub.source}</Badge>}
                    </div>
                    <span className="shrink-0 text-sm text-ink-soft">
                      {new Date(sub.createdAt).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </AppShell>
  );
}

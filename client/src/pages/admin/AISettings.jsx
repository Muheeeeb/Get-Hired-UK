import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Button, Card, CardHeader, EmptyState, Skeleton } from '../../components/ui';

/**
 * AI Studio master prompt — Admin Lead only (the server enforces it too).
 *
 * Whatever is saved here runs once, invisibly, at the start of every
 * "CV & Cover Letter" chat. Nobody types it and nobody sees it in the
 * transcript; it stays in force until it is changed here.
 */
export default function AISettings() {
  const { user } = useAuth();
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(null);
  const [meta, setMeta] = useState({ updatedAt: null, maxChars: 100_000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    api.get('/admin/settings/master-prompt')
      .then((r) => {
        setDraft(r.data.masterPrompt || '');
        setSaved(r.data.masterPrompt || '');
        setMeta({ updatedAt: r.data.updatedAt, maxChars: r.data.maxChars || 100_000 });
      })
      .catch((err) => setError(errorMessage(err, 'Could not load the master prompt')));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.put('/admin/settings/master-prompt', { masterPrompt: draft });
      setSaved(data.masterPrompt);
      setDraft(data.masterPrompt);
      setMeta({ updatedAt: data.updatedAt, maxChars: data.maxChars || meta.maxChars });
      setNotice('Master prompt saved — new chats will use it from now on');
      setTimeout(() => setNotice(null), 4000);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the master prompt'));
    } finally {
      setBusy(false);
    }
  }

  if (!user?.isLead) {
    return (
      <AppShell>
        <EmptyState
          icon="🔒"
          title="Admin Lead only"
          hint="The AI Studio master prompt can only be viewed and edited from the main admin console."
        />
      </AppShell>
    );
  }

  const dirty = saved !== null && draft !== saved;

  return (
    <AppShell>
      <PageHeader
        title="AI Settings"
        subtitle="The master prompt behind every CV & Cover Letter chat"
      />

      <Card className="overflow-hidden">
        <CardHeader
          title="Master prompt"
          subtitle="Runs automatically as the first message of every new CV & Cover Letter chat"
        />

        {saved === null && !error ? (
          <div className="p-6"><Skeleton className="h-48" /></div>
        ) : (
          <div className="space-y-4 p-6">
            <div className="rounded-xl bg-ivory px-4 py-3 text-sm text-ink-soft">
              <p className="font-semibold text-navy-800">How this is used</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>A specialist opens a new chat and picks <strong>CV &amp; Cover Letter</strong>.</li>
                <li>This prompt is sent once, in the background — they never see or type it.</li>
                <li>They then paste job descriptions one after another; each gets a CV and cover letter back.</li>
                <li>
                  The prompt is cached for <strong>one hour</strong>, so a job description arriving 30 minutes
                  to 2 hours later still only pays for itself rather than re-sending the whole prompt.
                </li>
                <li>Starting a new chat picks up whatever is saved here at that moment.</li>
              </ul>
            </div>

            <label className="block" htmlFor="master-prompt">
              <span className="label-caps text-navy-800/70 mb-1.5 block">Prompt text</span>
              <textarea
                id="master-prompt"
                rows={18}
                value={draft}
                maxLength={meta.maxChars}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write the instructions Claude should follow for every CV and cover letter…"
                className="w-full resize-y rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 font-mono text-[13px] leading-relaxed text-ink outline-none transition focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-soft">
              <span>
                {meta.updatedAt
                  ? `Last saved ${new Date(meta.updatedAt).toLocaleString('en-GB')}`
                  : 'Not saved yet'}
              </span>
              <span>{draft.length.toLocaleString()} / {meta.maxChars.toLocaleString()} characters</span>
            </div>

            {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
            {notice && <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success" role="status">{notice}</p>}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={save} disabled={busy || !dirty}>
                {busy ? 'Saving…' : 'Save master prompt'}
              </Button>
              {dirty && (
                <Button type="button" variant="ghost" onClick={() => setDraft(saved)} disabled={busy}>
                  Discard changes
                </Button>
              )}
              {dirty && <span className="text-xs text-alert">Unsaved changes</span>}
            </div>
            <p className="text-xs text-ink-soft">
              Chats that are already open keep the prompt they started with, so an edit here never
              rewrites a conversation mid-flow.
            </p>
          </div>
        )}
      </Card>
    </AppShell>
  );
}

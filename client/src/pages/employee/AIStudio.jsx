import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Button, Card, CardHeader, Select, Spinner } from '../../components/ui';

const KINDS = [
  { key: 'cv', label: 'CV' },
  { key: 'cover_letter', label: 'Cover letter' },
  { key: 'freeform', label: 'Freeform' },
];

const MAX_TABS = 5;

function newSession(n) {
  return {
    id: `s${n}`, n,
    clientId: '', domainId: '', kind: 'cv', prompt: '', file: null,
    busy: false, result: '', note: null, error: null, saveBusy: false, saved: null,
  };
}

/**
 * AI Studio — generate CVs and cover letters grounded in a client's master
 * documents. Supports up to five parallel sessions (tabs) so one person can
 * work several clients at once; each tab generates independently.
 */
export default function AIStudio() {
  const [clients, setClients] = useState([]);
  const idRef = useRef(1);
  const [sessions, setSessions] = useState(() => [newSession(1)]);
  const [activeId, setActiveId] = useState('s1');

  useEffect(() => {
    api.get('/employee/clients').then((r) => setClients(r.data.clients)).catch(() => {});
  }, []);

  const active = sessions.find((s) => s.id === activeId) || sessions[0];
  const activeClient = clients.find((c) => c.id === active.clientId);

  // Update a session by id (not "active") so a generation still lands in its own
  // tab even if the user switches tabs while it runs.
  const patch = (id, p) => setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const updateActive = (p) => patch(active.id, p);

  function addSession() {
    if (sessions.length >= MAX_TABS) return;
    idRef.current += 1;
    const s = newSession(idRef.current);
    setSessions((prev) => [...prev, s]);
    setActiveId(s.id);
  }

  function closeSession(id) {
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      idRef.current += 1;
      const fresh = newSession(idRef.current);
      setSessions([fresh]);
      setActiveId(fresh.id);
    } else {
      setSessions(remaining);
      if (id === activeId) setActiveId(remaining[0].id);
    }
  }

  function tabTitle(s) {
    const c = clients.find((x) => x.id === s.clientId);
    return c ? c.fullName : `Draft ${s.n}`;
  }

  async function generate(e) {
    e.preventDefault();
    const s = active;
    patch(s.id, { busy: true, error: null, note: null, saved: null });
    try {
      const fd = new FormData();
      fd.append('kind', s.kind);
      fd.append('prompt', s.prompt);
      if (s.clientId) fd.append('clientId', s.clientId);
      if (s.domainId) fd.append('domainId', s.domainId);
      if (s.file) fd.append('file', s.file);
      const { data } = await api.post('/ai/generate', fd);
      patch(s.id, { result: data.draft, note: data.note || null, busy: false });
    } catch (err) {
      patch(s.id, { error: errorMessage(err, 'Generation failed'), busy: false });
    }
  }

  async function saveAsMaster() {
    const s = active;
    if (!s.clientId || !s.domainId || !s.result) return;
    patch(s.id, { saveBusy: true, error: null });
    try {
      const type = s.kind === 'cv' ? 'master_cv' : 'master_cover_letter';
      const label = s.kind === 'cv' ? 'Master CV' : 'Master Cover Letter';
      const fd = new FormData();
      fd.append('domainId', s.domainId);
      fd.append('type', type);
      fd.append('file', new File([s.result], `${label} — AI draft.txt`, { type: 'text/plain' }));
      await api.post(`/clients/${s.clientId}/master-docs`, fd);
      patch(s.id, { saved: `${label} saved to the client's domain.`, saveBusy: false });
    } catch (err) {
      patch(s.id, { error: errorMessage(err, 'Save failed'), saveBusy: false });
    }
  }

  function downloadTxt() {
    const s = active;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([s.result], { type: 'text/plain' }));
    a.download = `${s.kind === 'cv' ? 'CV' : s.kind === 'cover_letter' ? 'Cover Letter' : 'Document'} — AI draft.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <AppShell>
      <PageHeader
        title="AI Studio"
        subtitle="Generate CVs and cover letters — work up to five clients in parallel"
      />

      {/* Session tabs */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
              s.id === activeId
                ? 'border-navy-800 bg-navy-800 text-ivory'
                : 'border-ivory-dark bg-white text-ink-soft hover:border-navy-800/30'
            }`}
          >
            <button type="button" onClick={() => setActiveId(s.id)} className="flex items-center gap-2 font-semibold">
              {s.busy && <Spinner className={s.id === activeId ? 'text-ivory' : ''} />}
              <span className="max-w-[160px] truncate">{tabTitle(s)}</span>
            </button>
            {sessions.length > 1 && (
              <button
                type="button"
                aria-label={`Close ${tabTitle(s)}`}
                onClick={() => closeSession(s.id)}
                className={`rounded p-0.5 text-xs leading-none opacity-60 hover:opacity-100 ${
                  s.id === activeId ? 'hover:bg-white/20' : 'hover:bg-navy-800/10'
                }`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {sessions.length < MAX_TABS && (
          <button
            type="button"
            onClick={addSession}
            className="rounded-xl border border-dashed border-navy-800/30 px-3 py-2 text-sm font-semibold text-ink-soft hover:border-gold-500 hover:text-navy-800"
          >
            + New draft
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-rise">
          <CardHeader title="Brief" subtitle="Pick a client for context, describe what you need" />
          <form onSubmit={generate} className="space-y-4 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select id="ai-client" label="Client (optional)" value={active.clientId}
                onChange={(e) => updateActive({ clientId: e.target.value, domainId: '' })}>
                <option value="">— No client context —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
              </Select>
              <Select id="ai-domain" label="Domain (optional)" value={active.domainId}
                onChange={(e) => updateActive({ domainId: e.target.value })}
                disabled={!activeClient}>
                <option value="">Auto</option>
                {(activeClient?.domains || []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </div>

            <div>
              <span className="label-caps text-navy-800/70 block mb-1.5">Document type</span>
              <div className="inline-flex rounded-xl bg-ivory p-1">
                {KINDS.map((k) => (
                  <button key={k.key} type="button" onClick={() => updateActive({ kind: k.key })}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                      active.kind === k.key ? 'bg-navy-800 text-ivory' : 'text-ink-soft hover:text-navy-800'
                    }`}>
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="label-caps text-navy-800/70 block mb-1.5">Prompt</span>
              <textarea rows={6} required minLength={3} maxLength={6000} value={active.prompt}
                onChange={(e) => updateActive({ prompt: e.target.value })}
                placeholder={active.kind === 'cv'
                  ? 'e.g. Rewrite the master CV to target fintech platform-engineering roles; emphasise Kubernetes and payments experience…'
                  : 'e.g. Cover letter for a Senior Product Manager role at Monzo, warm but direct tone…'}
                className="w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30" />
            </label>

            <div>
              <span className="label-caps text-navy-800/70 block mb-1.5">Reference file (optional, .txt/.md read as text)</span>
              <input key={active.id} type="file" accept=".txt,.md,.pdf,.doc,.docx"
                onChange={(e) => updateActive({ file: e.target.files[0] || null })}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-ivory hover:file:bg-navy-700 file:cursor-pointer" />
              {active.file && <p className="mt-1 text-xs text-ink-soft">Attached: {active.file.name}</p>}
            </div>

            {active.error && <p className="text-sm text-danger">{active.error}</p>}
            <Button type="submit" disabled={active.busy} className="w-full">
              {active.busy ? <Spinner /> : '✨'} {active.busy ? 'Generating…' : 'Generate'}
            </Button>
          </form>
        </Card>

        <Card className="animate-rise animate-rise-1">
          <CardHeader
            title="Result"
            subtitle="Edit freely — then download or save as a master document"
            action={
              active.result && (
                <div className="flex gap-2">
                  <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={downloadTxt}>Download .txt</Button>
                  {active.clientId && active.domainId && active.kind !== 'freeform' && (
                    <Button className="!px-3 !py-1.5 text-xs" onClick={saveAsMaster} disabled={active.saveBusy}>
                      {active.saveBusy ? 'Saving…' : 'Save as master'}
                    </Button>
                  )}
                </div>
              )
            }
          />
          <div className="p-6">
            {active.note && <p className="mb-3 rounded-xl bg-alert-soft px-3 py-2 text-xs text-alert">{active.note}</p>}
            {active.saved && <p className="mb-3 rounded-xl bg-success-soft px-3 py-2 text-xs text-success">{active.saved}</p>}
            {active.result ? (
              <textarea
                value={active.result}
                onChange={(e) => updateActive({ result: e.target.value })}
                rows={22}
                className="w-full rounded-xl border border-navy-800/15 bg-white p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30"
              />
            ) : (
              <p className="py-16 text-center text-sm text-ink-soft">
                {active.busy ? 'Generating…' : 'Generated documents appear here.'}
              </p>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

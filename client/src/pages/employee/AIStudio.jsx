import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Button, Card, CardHeader, Input, Select, Spinner } from '../../components/ui';

const KINDS = [
  { key: 'cv', label: 'CV' },
  { key: 'cover_letter', label: 'Cover letter' },
  { key: 'freeform', label: 'Freeform' },
];

/**
 * AI Studio — generate CVs and cover letters from a prompt, grounded in a
 * client's master CV and optional uploaded reference material.
 */
export default function AIStudio() {
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ clientId: '', domainId: '', kind: 'cv', prompt: '' });
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    api.get('/employee/clients').then((r) => setClients(r.data.clients)).catch(() => {});
  }, []);

  const activeClient = clients.find((c) => c.id === form.clientId);

  async function generate(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    setSaved(null);
    try {
      const fd = new FormData();
      fd.append('kind', form.kind);
      fd.append('prompt', form.prompt);
      if (form.clientId) fd.append('clientId', form.clientId);
      if (form.domainId) fd.append('domainId', form.domainId);
      if (file) fd.append('file', file);
      const { data } = await api.post('/ai/generate', fd);
      setResult(data.draft);
      if (data.note) setNote(data.note);
    } catch (err) {
      setError(errorMessage(err, 'Generation failed'));
    } finally {
      setBusy(false);
    }
  }

  async function saveAsMaster() {
    if (!form.clientId || !form.domainId || !result) return;
    setSaveBusy(true);
    setError(null);
    try {
      const type = form.kind === 'cv' ? 'master_cv' : 'master_cover_letter';
      const label = form.kind === 'cv' ? 'Master CV' : 'Master Cover Letter';
      const fd = new FormData();
      fd.append('domainId', form.domainId);
      fd.append('type', type);
      fd.append(
        'file',
        new File([result], `${label} — AI draft.txt`, { type: 'text/plain' })
      );
      await api.post(`/clients/${form.clientId}/master-docs`, fd);
      setSaved(`${label} saved to the client's domain.`);
    } catch (err) {
      setError(errorMessage(err, 'Save failed'));
    } finally {
      setSaveBusy(false);
    }
  }

  function downloadTxt() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([result], { type: 'text/plain' }));
    a.download = `${form.kind === 'cv' ? 'CV' : form.kind === 'cover_letter' ? 'Cover Letter' : 'Document'} — AI draft.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <AppShell>
      <PageHeader
        title="AI Studio"
        subtitle="Generate CVs and cover letters — grounded in the client's master documents"
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="animate-rise">
          <CardHeader title="Brief" subtitle="Pick a client for context, describe what you need" />
          <form onSubmit={generate} className="space-y-4 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select id="ai-client" label="Client (optional)" value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value, domainId: '' })}>
                <option value="">— No client context —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
              </Select>
              <Select id="ai-domain" label="Domain (optional)" value={form.domainId}
                onChange={(e) => setForm({ ...form, domainId: e.target.value })}
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
                  <button key={k.key} type="button" onClick={() => setForm({ ...form, kind: k.key })}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                      form.kind === k.key ? 'bg-navy-800 text-ivory' : 'text-ink-soft hover:text-navy-800'
                    }`}>
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="label-caps text-navy-800/70 block mb-1.5">Prompt</span>
              <textarea rows={6} required minLength={3} maxLength={6000} value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                placeholder={form.kind === 'cv'
                  ? 'e.g. Rewrite the master CV to target fintech platform-engineering roles; emphasise Kubernetes and payments experience…'
                  : 'e.g. Cover letter for a Senior Product Manager role at Monzo, warm but direct tone…'}
                className="w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30" />
            </label>

            <div>
              <span className="label-caps text-navy-800/70 block mb-1.5">Reference file (optional, .txt/.md read as text)</span>
              <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.doc,.docx"
                onChange={(e) => setFile(e.target.files[0] || null)}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-ivory hover:file:bg-navy-700 file:cursor-pointer" />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Spinner /> : '✨'} {busy ? 'Generating…' : 'Generate'}
            </Button>
          </form>
        </Card>

        <Card className="animate-rise animate-rise-1">
          <CardHeader
            title="Result"
            subtitle="Edit freely — then download or save as a master document"
            action={
              result && (
                <div className="flex gap-2">
                  <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={downloadTxt}>Download .txt</Button>
                  {form.clientId && form.domainId && form.kind !== 'freeform' && (
                    <Button className="!px-3 !py-1.5 text-xs" onClick={saveAsMaster} disabled={saveBusy}>
                      {saveBusy ? 'Saving…' : 'Save as master'}
                    </Button>
                  )}
                </div>
              )
            }
          />
          <div className="p-6">
            {note && <p className="mb-3 rounded-xl bg-alert-soft px-3 py-2 text-xs text-alert">{note}</p>}
            {saved && <p className="mb-3 rounded-xl bg-success-soft px-3 py-2 text-xs text-success">{saved}</p>}
            {result ? (
              <textarea
                value={result}
                onChange={(e) => setResult(e.target.value)}
                rows={22}
                className="w-full rounded-xl border border-navy-800/15 bg-white p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30"
              />
            ) : (
              <p className="py-16 text-center text-sm text-ink-soft">
                Generated documents appear here.
              </p>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

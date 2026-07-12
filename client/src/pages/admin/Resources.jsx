import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, CardHeader, Skeleton, EmptyState, Badge, Button, Input, Modal } from '../../components/ui';
import { DownloadButton, formatDate } from '../../components/files';

/** Admin management of the Interview Prep Hub content clients see. */
export default function AdminResources() {
  const [resources, setResources] = useState(null);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', tipText: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const fileRef = useRef(null);

  function load() {
    api.get('/interview-resources')
      .then((res) => setResources(res.data.resources))
      .catch((err) => setError(errorMessage(err)));
  }
  useEffect(load, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const fd = new FormData();
      fd.append('title', form.title);
      fd.append('description', form.description);
      if (form.tipText.trim()) fd.append('tipText', form.tipText.trim());
      if (file) fd.append('file', file);
      await api.post('/interview-resources', fd);
      setShowCreate(false);
      setForm({ title: '', description: '', tipText: '' });
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this resource? Clients will no longer see it.')) return;
    await api.delete(`/interview-resources/${id}`);
    load();
  }

  return (
    <AppShell>
      <PageHeader
        title="Interview Prep Hub"
        subtitle="Guides and tips every client sees on their dashboard"
        action={<Button onClick={() => setShowCreate(true)}>+ New resource</Button>}
      />
      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!resources && !error && <Skeleton className="h-64 rounded-2xl" />}
      {resources && (
        <Card className="animate-rise">
          {resources.length === 0 ? (
            <EmptyState icon="🎓" title="No resources yet" hint="Post your first interview guide or tip." />
          ) : (
            <ul className="divide-y divide-ivory-dark">
              {resources.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-navy-800">{r.title}</span>
                      {r.hasFile && <Badge tone="gold">📎 File</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-soft">{r.description}</p>
                    {r.tipText && <p className="mt-1 text-sm text-ink line-clamp-2">💡 {r.tipText}</p>}
                    <p className="mt-1 text-xs text-ink-soft">Posted {formatDate(r.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.hasFile && <DownloadButton docId={r.id} label="View file" />}
                    <Button variant="ghost" className="!px-3 !py-1.5 text-xs !text-danger !border-danger/30"
                      onClick={() => remove(r.id)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New resource" wide>
        <form onSubmit={create} className="space-y-4">
          <Input id="r-title" label="Title" required value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input id="r-desc" label="Description" required value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label className="block">
            <span className="label-caps text-navy-800/70 block mb-1.5">Tip text (optional)</span>
            <textarea rows={4} value={form.tipText}
              onChange={(e) => setForm({ ...form, tipText: e.target.value })}
              className="w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30 outline-none" />
          </label>
          <div>
            <span className="label-caps text-navy-800/70 block mb-1.5">Attachment (optional)</span>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf,.odt"
              onChange={(e) => setFile(e.target.files[0] || null)}
              className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-ivory hover:file:bg-navy-700 file:cursor-pointer" />
          </div>
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Publishing…' : 'Publish resource'}
          </Button>
        </form>
      </Modal>
    </AppShell>
  );
}

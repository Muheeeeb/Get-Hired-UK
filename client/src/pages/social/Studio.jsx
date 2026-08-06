import { useEffect, useState, useCallback } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, Skeleton, EmptyState, Badge, Button, Input, Select, Modal } from '../../components/ui';
import { RichTextEditor } from '../../components/RichTextEditor';

const TYPES = [
  { key: 'blog', label: 'Blog', singular: 'blog post' },
  { key: 'story', label: 'Success Stories', singular: 'success story' },
  { key: 'insight', label: 'Insights', singular: 'insight' },
];

const empty = (type) => ({ type, title: '', category: '', summary: '', body: '', status: 'draft' });

/** Social Media Marketing Portal — create Blog posts, Success Stories & Insights. */
export default function SocialStudio() {
  const [activeType, setActiveType] = useState('blog');
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(empty('blog'));
  const [cover, setCover] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(() => {
    setPosts(null);
    api.get(`/content?type=${activeType}`)
      .then((r) => setPosts(r.data.posts))
      .catch((err) => setError(errorMessage(err)));
  }, [activeType]);
  useEffect(load, [load]);

  function openNew() {
    setEditingId(null);
    setForm(empty(activeType));
    setCover(null);
    setFormError(null);
    setOpen(true);
  }
  function openEdit(p) {
    setEditingId(p.id);
    setForm({ type: p.type, title: p.title, category: p.category || '', summary: p.summary || '', body: p.body || '', status: p.status });
    setCover(null);
    setFormError(null);
    setOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const fd = new FormData();
      fd.append('type', form.type);
      fd.append('title', form.title);
      fd.append('category', form.category);
      fd.append('summary', form.summary);
      fd.append('body', form.body);
      fd.append('status', form.status);
      if (cover) fd.append('cover', cover);
      if (editingId) await api.put(`/content/${editingId}`, fd);
      else await api.post('/content', fd);
      setOpen(false);
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p) {
    if (!window.confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    await api.delete(`/content/${p.id}`);
    load();
  }

  const activeLabel = TYPES.find((t) => t.key === activeType);

  return (
    <AppShell>
      <PageHeader
        title="Content Studio"
        subtitle="Publish Blog posts, Success Stories and Insights to the public website"
        action={<Button onClick={openNew}>+ New {activeLabel.singular}</Button>}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveType(t.key)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
              activeType === t.key ? 'border-navy-800 bg-navy-800 text-ivory' : 'border-ivory-dark bg-white text-ink-soft hover:border-navy-800/30'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <EmptyState icon="⚠️" title="Failed to load" hint={error} />}
      {!posts && !error && <Skeleton className="h-64 rounded-2xl" />}
      {posts && (
        <Card className="animate-rise">
          {posts.length === 0 ? (
            <EmptyState icon="📝" title={`No ${activeLabel.label.toLowerCase()} yet`} hint={`Create your first ${activeLabel.singular}.`} />
          ) : (
            <ul className="divide-y divide-ivory-dark">
              {posts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words font-semibold text-navy-800">{p.title}</span>
                      <Badge tone={p.status === 'published' ? 'success' : 'navy'}>
                        {p.status === 'published' ? '● Published' : '○ Draft'}
                      </Badge>
                      {p.category && <Badge tone="gold">{p.category}</Badge>}
                      {p.hasCover && <Badge tone="navy">📎 Cover</Badge>}
                    </div>
                    {p.summary && <p className="mt-1 text-sm text-ink-soft line-clamp-2">{p.summary}</p>}
                    <p className="mt-1 text-xs text-ink-soft">
                      Updated {new Date(p.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {p.authorName ? ` · ${p.authorName}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => openEdit(p)}>Edit</Button>
                    <Button variant="ghost" className="!px-3 !py-1.5 text-xs !text-danger !border-danger/30" onClick={() => remove(p)}>Delete</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editingId ? 'Edit post' : 'New post'} wide>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select id="p-type" label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
            <Select id="p-status" label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="draft">Draft (private)</option>
              <option value="published">Published (live on site)</option>
            </Select>
          </div>
          <Input id="p-title" label="Title" required maxLength={200} value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="p-category" label="Category (optional)" maxLength={80} value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Careers" />
            <div>
              <span className="label-caps text-navy-800/70 block mb-1.5">Cover image (optional)</span>
              <input type="file" accept=".png,.jpg,.jpeg,.webp,.gif"
                onChange={(e) => setCover(e.target.files[0] || null)}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-ivory hover:file:bg-navy-700 file:cursor-pointer" />
              {editingId && !cover && <p className="mt-1 text-xs text-ink-soft">Leave empty to keep the current cover.</p>}
            </div>
          </div>
          <label className="block">
            <span className="label-caps text-navy-800/70 block mb-1.5">Short summary (optional)</span>
            <textarea rows={2} maxLength={500} value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              className="w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30" />
          </label>
          <div>
            <span className="label-caps text-navy-800/70 block mb-1.5">Main text</span>
            <RichTextEditor value={form.body} onChange={(html) => setForm((f) => ({ ...f, body: html }))} />
          </div>
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : form.status === 'published' ? 'Save & publish' : 'Save draft'}
            </Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}

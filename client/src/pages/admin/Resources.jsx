import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, CardHeader, Skeleton, EmptyState, Badge, Button, Input, Select, Modal } from '../../components/ui';
import { DownloadButton, formatDate } from '../../components/files';

/** Admin management of the Interview Prep Hub content clients see. */
export default function AdminResources() {
  const [resources, setResources] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showSession, setShowSession] = useState(false);
  const [sessForm, setSessForm] = useState({ clientId: '', title: '', scheduledAt: '', joinLink: '', notes: '', assignedEmployeeId: '' });
  const [sessFile, setSessFile] = useState(null);
  const sessFileRef = useRef(null);
  const [sessBusy, setSessBusy] = useState(false);
  const [sessError, setSessError] = useState(null);
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
    api.get('/interview-sessions').then((r) => setSessions(r.data.sessions)).catch(() => {});
    api.get('/admin/clients').then((r) => setClients(r.data.clients)).catch(() => {});
    api.get('/admin/employees').then((r) => setEmployees(r.data.employees)).catch(() => {});
  }
  useEffect(load, []);

  async function createSession(e) {
    e.preventDefault();
    setSessBusy(true);
    setSessError(null);
    try {
      const fd = new FormData();
      fd.append('clientId', sessForm.clientId);
      fd.append('title', sessForm.title);
      fd.append('scheduledAt', sessForm.scheduledAt);
      if (sessForm.joinLink) fd.append('joinLink', sessForm.joinLink);
      if (sessForm.notes) fd.append('notes', sessForm.notes);
      if (sessForm.assignedEmployeeId) fd.append('assignedEmployeeId', sessForm.assignedEmployeeId);
      if (sessFile) fd.append('file', sessFile);
      await api.post('/interview-sessions', fd);
      setShowSession(false);
      setSessForm({ clientId: '', title: '', scheduledAt: '', joinLink: '', notes: '', assignedEmployeeId: '' });
      setSessFile(null);
      if (sessFileRef.current) sessFileRef.current.value = '';
      load();
    } catch (err) {
      setSessError(errorMessage(err));
    } finally {
      setSessBusy(false);
    }
  }

  async function removeSession(id) {
    if (!window.confirm('Delete this prep session?')) return;
    await api.delete(`/interview-sessions/${id}`);
    load();
  }

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

      <Card className="mt-8 animate-rise animate-rise-1">
        <CardHeader
          title="Interview Prep Sessions"
          subtitle="Scheduled 1:1 sessions — visible to the client and the assigned employee"
          action={<Button onClick={() => setShowSession(true)}>+ Schedule session</Button>}
        />
        {!sessions ? (
          <div className="p-6"><Skeleton className="h-24" /></div>
        ) : sessions.length === 0 ? (
          <EmptyState icon="🗓️" title="No sessions scheduled" hint="Schedule interview prep for a client." />
        ) : (
          <ul className="divide-y divide-ivory-dark">
            {sessions.map((sn) => (
              <li key={sn.id} className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-navy-800">{sn.title}</span>
                    <Badge tone={sn.upcoming ? 'gold' : 'navy'}>{sn.upcoming ? 'Upcoming' : 'Past'}</Badge>
                    {sn.hasFile && <Badge tone="navy">📎 Materials</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-soft">
                    <span>{sn.clientName}</span>
                    <span>{new Date(sn.scheduledAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    {sn.assignedEmployee && <span>with {sn.assignedEmployee.fullName}</span>}
                    {sn.joinLink && <a className="font-semibold text-gold-600 hover:underline" href={sn.joinLink} target="_blank" rel="noopener noreferrer">Join link ↗</a>}
                  </div>
                  {sn.notes && <p className="mt-1 text-sm text-ink">{sn.notes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {sn.hasFile && <DownloadButton docId={sn.id} label="Materials" />}
                  <Button variant="ghost" className="!px-3 !py-1.5 text-xs !text-danger !border-danger/30" onClick={() => removeSession(sn.id)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={showSession} onClose={() => setShowSession(false)} title="Schedule prep session" wide>
        <form onSubmit={createSession} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select id="sn-client" label="Client" required value={sessForm.clientId}
              onChange={(e) => setSessForm({ ...sessForm, clientId: e.target.value })}>
              <option value="">— Select client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.user.fullName}</option>)}
            </Select>
            <Select id="sn-emp" label="Assigned employee (optional)" value={sessForm.assignedEmployeeId}
              onChange={(e) => setSessForm({ ...sessForm, assignedEmployeeId: e.target.value })}>
              <option value="">— None —</option>
              {employees.filter((e) => e.isActive).map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
            </Select>
          </div>
          <Input id="sn-title" label="Title" required maxLength={200} value={sessForm.title}
            onChange={(e) => setSessForm({ ...sessForm, title: e.target.value })}
            placeholder="e.g. Mock interview — final round prep" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="sn-when" label="Date & time" type="datetime-local" required value={sessForm.scheduledAt}
              onChange={(e) => setSessForm({ ...sessForm, scheduledAt: e.target.value })} />
            <Input id="sn-link" label="Join link (optional)" type="url" placeholder="https://meet…" value={sessForm.joinLink}
              onChange={(e) => setSessForm({ ...sessForm, joinLink: e.target.value })} />
          </div>
          <Input id="sn-notes" label="Notes (optional)" maxLength={4000} value={sessForm.notes}
            onChange={(e) => setSessForm({ ...sessForm, notes: e.target.value })} />
          <div>
            <span className="label-caps text-navy-800/70 block mb-1.5">Prep materials (optional)</span>
            <input ref={sessFileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf,.odt"
              onChange={(e) => setSessFile(e.target.files[0] || null)}
              className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-ivory hover:file:bg-navy-700 file:cursor-pointer" />
          </div>
          {sessError && <p className="text-sm text-danger">{sessError}</p>}
          <Button type="submit" disabled={sessBusy} className="w-full">
            {sessBusy ? 'Scheduling…' : 'Schedule session'}
          </Button>
        </form>
      </Modal>

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

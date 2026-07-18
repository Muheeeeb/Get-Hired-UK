import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AppShell, PageHeader } from '../layouts/AppShell';
import { Button, Card, EmptyState, Input, Modal, Select, Skeleton, Badge, Spinner } from '../components/ui';
import { DownloadButton } from '../components/files';

const POLL_MS = 7000;

function timeLabel(iso) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Shared chat page for all three roles; behaviour adapts to the signed-in role. */
export default function Chat() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [conversations, setConversations] = useState(null);
  const [activeId, setActiveId] = useState(params.get('c') || null);
  const [thread, setThread] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState(null);

  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ subject: '', message: '', clientUserId: '' });
  const [clients, setClients] = useState([]);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState('');
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);

  const loadList = useCallback(() => {
    api.get('/chat/conversations')
      .then((res) => setConversations(res.data.conversations))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const loadThread = useCallback((id) => {
    if (!id) return;
    api.get(`/chat/conversations/${id}`)
      .then((res) => setThread(res.data))
      .catch(() => setThread(null));
  }, []);

  useEffect(loadList, [loadList]);
  useEffect(() => {
    loadThread(activeId);
  }, [activeId, loadThread]);

  // Poll for new messages.
  useEffect(() => {
    const id = setInterval(() => {
      loadList();
      if (activeId) loadThread(activeId);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [activeId, loadList, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages?.length]);

  useEffect(() => {
    // Admins can assign conversations and start client threads; employees start
    // team threads with the admins (per spec), clients message the team.
    if (user?.role === 'admin') {
      api.get('/admin/employees').then((r) => setEmployees(r.data.employees)).catch(() => {});
      api.get('/admin/clients')
        .then((r) => setClients(r.data.clients.map((c) => ({ userId: c.user.id, name: c.user.fullName }))))
        .catch(() => {});
    }
  }, [user]);

  async function createConversation(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post('/chat/conversations', {
        subject: newForm.subject,
        message: newForm.message,
        ...(newForm.clientUserId ? { clientUserId: newForm.clientUserId } : {}),
      });
      setShowNew(false);
      setNewForm({ subject: '', message: '', clientUserId: '' });
      loadList();
      setActiveId(data.conversation.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function send(e) {
    e.preventDefault();
    if (!draft.trim() && !file) return;
    const fd = new FormData();
    if (draft.trim()) fd.append('body', draft.trim());
    if (file) fd.append('file', file);
    setDraft('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
    try {
      await api.post(`/chat/conversations/${activeId}/messages`, fd);
      loadThread(activeId);
      loadList();
    } catch (err) {
      setError(errorMessage(err, 'Failed to send'));
    }
  }

  async function assign(employeeId) {
    await api.put(`/chat/conversations/${activeId}/assign`, { employeeId: employeeId || null });
    loadThread(activeId);
    loadList();
  }

  const activeConvo = thread?.conversation;

  return (
    <AppShell>
      <PageHeader
        title="Chat"
        subtitle={
          user?.role === 'client'
            ? 'Message our team — we reply within one working day'
            : user?.role === 'admin'
              ? 'All conversations across clients, employees and admins'
              : 'Your assigned conversations and threads with the admin team'
        }
        action={<Button onClick={() => setShowNew(true)}>+ New conversation</Button>}
      />
      {error && (
        <div className="mb-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          {error}
          <button className="ml-3 underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* Conversation list */}
        <Card className="max-h-[70vh] overflow-y-auto">
          {!conversations ? (
            <div className="space-y-3 p-4"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
          ) : conversations.length === 0 ? (
            <EmptyState icon="💬" title="No conversations yet" hint="Start one with the button above." />
          ) : (
            <ul className="divide-y divide-ivory-dark">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={`w-full px-4 py-3 text-left transition hover:bg-ivory/70 ${activeId === c.id ? 'bg-gold-100/50' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-navy-800">{c.subject}</span>
                      {c.unread > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1.5 text-[11px] font-bold text-navy-900">
                          {c.unread}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-soft">
                      {c.clientUser && <span className="truncate">{c.clientUser.fullName}</span>}
                      {c.assignedEmployee && <Badge tone="navy">→ {c.assignedEmployee.fullName}</Badge>}
                      <span className="ml-auto whitespace-nowrap">{timeLabel(c.lastMessageAt)}</span>
                    </div>
                    {c.lastMessage && (
                      <p className="mt-1 truncate text-xs text-ink-soft/80">
                        {c.lastMessage.body || `📎 ${c.lastMessage.fileName}`}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Thread */}
        <Card className="flex max-h-[70vh] min-h-[420px] flex-col">
          {!activeId ? (
            <EmptyState icon="💬" title="Select a conversation" hint="Pick a thread from the list, or start a new one." />
          ) : !thread ? (
            <div className="p-6"><Skeleton className="h-40" /></div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold-500/15 px-5 py-3.5">
                <div>
                  <div className="font-display text-lg text-navy-800">{activeConvo.subject}</div>
                  <div className="text-xs text-ink-soft">
                    {activeConvo.clientUser ? `Client: ${activeConvo.clientUser.fullName}` : `Started by ${activeConvo.createdBy.fullName}`}
                  </div>
                </div>
                {user?.role === 'admin' && (
                  <div className="flex items-center gap-2">
                    <Select
                      id="assign"
                      value={activeConvo.assignedEmployee?.id || ''}
                      onChange={(e) => assign(e.target.value)}
                      className="!w-auto !py-1.5 text-xs"
                      aria-label="Assign conversation to employee"
                    >
                      <option value="">Unassigned</option>
                      {employees.filter((e) => e.isActive).map((e) => (
                        <option key={e.id} value={e.id}>{e.fullName}</option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {thread.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${m.mine ? 'bg-navy-800 text-ivory' : 'bg-ivory text-ink'}`}>
                      {!m.mine && (
                        <div className={`text-[11px] font-semibold ${m.mine ? 'text-gold-300' : 'text-gold-600'}`}>
                          {m.sender.fullName} · {m.sender.role}
                        </div>
                      )}
                      {m.body && <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>}
                      {m.hasFile && (
                        <div className="mt-1.5">
                          <DownloadButton docId={m.id} label={m.fileName || 'Attachment'} />
                        </div>
                      )}
                      <div className={`mt-1 text-right text-[10px] ${m.mine ? 'text-ivory/50' : 'text-ink-soft/70'}`}>
                        {timeLabel(m.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {activeConvo.canReply ? (
                <form onSubmit={send} className="border-t border-ivory-dark p-3">
                  {file && (
                    <div className="mb-2 flex items-center gap-2 rounded-lg bg-ivory px-3 py-1.5 text-xs text-ink">
                      📎 {file.name}
                      <button type="button" className="ml-auto text-danger" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
                        remove
                      </button>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-navy-800/15 text-ink-soft hover:border-gold-500 hover:text-gold-600">
                      <input ref={fileRef} type="file" className="hidden"
                        accept=".pdf,.doc,.docx,.txt,.md,.rtf,.odt,.png,.jpg,.jpeg,.webp"
                        onChange={(e) => setFile(e.target.files[0] || null)} />
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M21 12.5l-8.5 8.5a6 6 0 01-8.5-8.5L12.5 4a4 4 0 015.7 5.7L9.7 18.2a2 2 0 01-2.8-2.8l8.5-8.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </label>
                    <textarea
                      rows={1}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); }
                      }}
                      placeholder="Write a message…"
                      className="max-h-32 flex-1 resize-y rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30"
                    />
                    <Button type="submit" className="!px-5">Send</Button>
                  </div>
                </form>
              ) : (
                <div className="border-t border-ivory-dark bg-ivory/60 px-5 py-3 text-center text-xs text-ink-soft">
                  This conversation is assigned to {activeConvo.assignedEmployee?.fullName || 'another teammate'} — only they and admins can reply.
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="New conversation">
        <form onSubmit={createConversation} className="space-y-4">
          {user?.role === 'admin' && (
            <Select id="nc-client" label="Client (optional)" value={newForm.clientUserId}
              onChange={(e) => setNewForm({ ...newForm, clientUserId: e.target.value })}>
              <option value="">— Team conversation —</option>
              {clients.map((c) => (
                <option key={c.userId} value={c.userId}>{c.name}</option>
              ))}
            </Select>
          )}
          <Input id="nc-subject" label="Subject" required maxLength={200} value={newForm.subject}
            onChange={(e) => setNewForm({ ...newForm, subject: e.target.value })} />
          <label className="block">
            <span className="label-caps text-navy-800/70 block mb-1.5">Message</span>
            <textarea rows={4} required maxLength={5000} value={newForm.message}
              onChange={(e) => setNewForm({ ...newForm, message: e.target.value })}
              className="w-full rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30" />
          </label>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? <Spinner /> : null} {busy ? 'Starting…' : 'Start conversation'}
          </Button>
        </form>
      </Modal>
    </AppShell>
  );
}

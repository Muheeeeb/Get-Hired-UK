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
const MAX_FILES = 6;

let seq = 0;
const uid = () => `m${++seq}`;

function newSession(n) {
  return {
    id: `s${n}`, n,
    clientId: '', domainId: '', kind: 'cv',
    messages: [], input: '', files: [],
    busy: false, error: null, saveBusyId: null, savedId: null,
  };
}

/** Renders plain text from the model, honouring **bold** without any HTML injection. */
function MessageText({ text }) {
  return (
    <div className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
      {text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4
          ? <strong key={i} className="font-semibold text-navy-800">{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </div>
  );
}

/**
 * AI Studio — a chat with the assistant, grounded in a client's master documents.
 * Up to five conversations run in parallel (tabs); each keeps its own history so
 * follow-ups like "make it shorter" refine the previous draft.
 */
export default function AIStudio() {
  const [clients, setClients] = useState([]);
  const idRef = useRef(1);
  const [sessions, setSessions] = useState(() => [newSession(1)]);
  const [activeId, setActiveId] = useState('s1');
  const endRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api.get('/employee/clients').then((r) => setClients(r.data.clients)).catch(() => {});
  }, []);

  const active = sessions.find((s) => s.id === activeId) || sessions[0];
  const activeClient = clients.find((c) => c.id === active.clientId);

  // Patch by id (never "the active one") so a reply still lands in its own tab
  // if the user switches tabs while it is generating.
  const patch = (id, p) => setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const updateActive = (p) => patch(active.id, p);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [active.messages.length, active.busy, active.id]);

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
    return c ? c.fullName : `Chat ${s.n}`;
  }

  function addFiles(list) {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    updateActive({ files: [...active.files, ...incoming].slice(0, MAX_FILES) });
    if (fileRef.current) fileRef.current.value = '';
  }

  async function send(e) {
    e?.preventDefault();
    const s = active;
    const text = s.input.trim();
    if (!text || s.busy) return;

    const outgoing = s.files;
    const history = s.messages.map((m) => ({ role: m.role, content: m.content }));
    const userMsg = { id: uid(), role: 'user', content: text, files: outgoing.map((f) => f.name) };

    patch(s.id, { messages: [...s.messages, userMsg], input: '', files: [], busy: true, error: null, savedId: null });

    try {
      const fd = new FormData();
      fd.append('kind', s.kind);
      fd.append('prompt', text);
      if (s.clientId) fd.append('clientId', s.clientId);
      if (s.domainId) fd.append('domainId', s.domainId);
      fd.append('history', JSON.stringify(history));
      outgoing.forEach((f) => fd.append('files', f));
      const { data } = await api.post('/ai/generate', fd);
      const reply = { id: uid(), role: 'assistant', content: data.draft, note: data.note || null };
      setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, busy: false, messages: [...x.messages, reply] } : x)));
    } catch (err) {
      patch(s.id, { busy: false, error: errorMessage(err, 'Generation failed') });
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function downloadMsg(msg) {
    const label = active.kind === 'cv' ? 'CV' : active.kind === 'cover_letter' ? 'Cover Letter' : 'Document';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([msg.content], { type: 'text/plain' }));
    a.download = `${label} — AI draft.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copyMsg(msg) {
    try { await navigator.clipboard.writeText(msg.content); } catch { /* clipboard unavailable */ }
  }

  async function saveAsMaster(msg) {
    const s = active;
    if (!s.clientId || !s.domainId) return;
    patch(s.id, { saveBusyId: msg.id, error: null });
    try {
      const type = s.kind === 'cv' ? 'master_cv' : 'master_cover_letter';
      const label = s.kind === 'cv' ? 'Master CV' : 'Master Cover Letter';
      const fd = new FormData();
      fd.append('domainId', s.domainId);
      fd.append('type', type);
      fd.append('file', new File([msg.content], `${label} — AI draft.txt`, { type: 'text/plain' }));
      await api.post(`/clients/${s.clientId}/master-docs`, fd);
      patch(s.id, { saveBusyId: null, savedId: msg.id });
    } catch (err) {
      patch(s.id, { saveBusyId: null, error: errorMessage(err, 'Save failed') });
    }
  }

  const canSaveMaster = active.clientId && active.domainId && active.kind !== 'freeform';

  return (
    <AppShell>
      <PageHeader
        title="AI Studio"
        subtitle="Chat with the assistant to draft and refine CVs and cover letters — up to five clients in parallel"
      />

      {/* Conversation tabs */}
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
            + New chat
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* ---------------- context ---------------- */}
        <Card className="animate-rise h-fit">
          <CardHeader title="Context" subtitle="Grounds the chat in this client's documents" />
          <div className="space-y-4 p-6">
            <Select id="ai-client" label="Client (optional)" value={active.clientId}
              onChange={(e) => updateActive({ clientId: e.target.value, domainId: '' })}>
              <option value="">— No client context —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </Select>
            <Select id="ai-domain" label="Domain (optional)" value={active.domainId}
              onChange={(e) => updateActive({ domainId: e.target.value })}
              disabled={!activeClient}>
              <option value="">Auto</option>
              {(activeClient?.domains || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <div>
              <span className="label-caps text-navy-800/70 mb-1.5 block">Document type</span>
              <div className="inline-flex rounded-xl bg-ivory p-1">
                {KINDS.map((k) => (
                  <button key={k.key} type="button" onClick={() => updateActive({ kind: k.key })}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                      active.kind === k.key ? 'bg-navy-800 text-ivory' : 'text-ink-soft hover:text-navy-800'
                    }`}>
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="border-t border-ivory-dark pt-3 text-xs text-ink-soft">
              Ask follow-ups like “make it shorter” or “emphasise leadership” — the assistant keeps the
              whole conversation and refines the last draft.
            </p>
          </div>
        </Card>

        {/* ---------------- conversation ---------------- */}
        <Card className="animate-rise animate-rise-1 flex flex-col">
          <CardHeader title="Conversation" subtitle="Download or save any draft the assistant produces" />

          {/* transcript */}
          <div className="flex-1 space-y-5 overflow-y-auto p-6" style={{ minHeight: '46vh', maxHeight: '62vh' }}>
            {active.messages.length === 0 && !active.busy && (
              <div className="py-14 text-center">
                <div className="mb-2 text-3xl">✨</div>
                <p className="text-sm text-ink-soft">
                  Start the conversation — describe the document you need.
                </p>
                <p className="mx-auto mt-2 max-w-sm text-xs text-ink-soft/80">
                  e.g. “Rewrite the master CV for fintech platform-engineering roles; emphasise
                  Kubernetes and payments experience.”
                </p>
              </div>
            )}

            {active.messages.map((m) => (
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-navy-800 px-4 py-3 text-ivory">
                    <MessageText text={m.content} />
                    {m.files?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/15 pt-2">
                        {m.files.map((f) => (
                          <span key={f} className="rounded-md bg-white/15 px-2 py-0.5 text-[11px]">📎 {f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gold-100 text-sm">✨</span>
                  <div className="min-w-0 flex-1">
                    <div className="rounded-2xl rounded-tl-sm border border-ivory-dark bg-white px-4 py-3 text-ink">
                      <MessageText text={m.content} />
                    </div>
                    {m.note && <p className="mt-1.5 rounded-lg bg-alert-soft px-3 py-1.5 text-xs text-alert">{m.note}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => copyMsg(m)}
                        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-soft transition hover:bg-navy-800/5 hover:text-navy-800">
                        Copy
                      </button>
                      <button type="button" onClick={() => downloadMsg(m)}
                        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-soft transition hover:bg-navy-800/5 hover:text-navy-800">
                        Download .txt
                      </button>
                      {canSaveMaster && (
                        <button type="button" onClick={() => saveAsMaster(m)} disabled={active.saveBusyId === m.id}
                          className="rounded-lg px-2.5 py-1 text-xs font-semibold text-gold-600 transition hover:bg-gold-100 disabled:opacity-60">
                          {active.saveBusyId === m.id ? 'Saving…' : 'Save as master'}
                        </button>
                      )}
                      {active.savedId === m.id && <span className="text-xs font-semibold text-success">Saved ✓</span>}
                    </div>
                  </div>
                </div>
              )
            ))}

            {active.busy && (
              <div className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gold-100 text-sm">✨</span>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-ivory-dark bg-white px-4 py-3 text-sm text-ink-soft">
                  <Spinner /> Thinking…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* composer */}
          <form onSubmit={send} className="border-t border-ivory-dark p-4">
            {active.error && <p className="mb-2 text-sm text-danger">{active.error}</p>}
            {active.files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {active.files.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-lg bg-ivory px-2 py-1 text-xs text-ink-soft">
                    📎 <span className="max-w-[160px] truncate">{f.name}</span>
                    <button type="button" aria-label={`Remove ${f.name}`}
                      onClick={() => updateActive({ files: active.files.filter((_, j) => j !== i) })}
                      className="opacity-60 hover:opacity-100">✕</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input ref={fileRef} type="file" multiple accept=".txt,.md,.pdf,.doc,.docx" className="hidden"
                id="ai-files" onChange={(e) => addFiles(e.target.files)} />
              <label htmlFor="ai-files"
                title={`Attach reference files (up to ${MAX_FILES})`}
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-navy-800/15 text-lg text-ink-soft transition hover:border-gold-500 hover:text-navy-800">
                📎
              </label>
              <textarea
                rows={1} value={active.input} onKeyDown={onKeyDown}
                onChange={(e) => updateActive({ input: e.target.value })}
                placeholder={active.messages.length ? 'Ask a follow-up…' : 'Describe the document you need…'}
                className="max-h-40 min-h-[40px] flex-1 resize-y rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30"
              />
              <Button type="submit" disabled={active.busy || !active.input.trim()} className="!px-4 shrink-0">
                {active.busy ? <Spinner /> : 'Send'}
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-soft">
              Enter to send · Shift+Enter for a new line · .txt/.md files are read as text
            </p>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}

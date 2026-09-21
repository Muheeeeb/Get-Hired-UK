import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Button, Card, CardHeader, Select, Spinner } from '../../components/ui';

/**
 * Two modes only.
 * "CV & Cover Letter" silently runs the admin's saved master prompt once when the
 * chat starts, so the specialist just pastes job descriptions and gets a CV plus
 * a cover letter back for each one. "Freeform" is a plain Claude chat.
 */
const KINDS = [
  { key: 'cv_cover_letter', label: 'CV & Cover Letter', hint: 'Paste a job description — get a tailored CV and cover letter' },
  { key: 'freeform', label: 'Freeform', hint: 'An open chat with Claude' },
];

const MAX_TABS = 5;
const MAX_FILES = 6;
const MAX_PROMPT_CHARS = 50_000;

let seq = 0;
const uid = () => `m${++seq}`;

function newSession(n) {
  return {
    id: `draft-${n}`, conversationId: null, n,
    kind: 'cv_cover_letter',
    // Whether THIS chat is actually running a master prompt — a chat started
    // before the setting existed has none, and the banner must not claim it does.
    hasMasterPrompt: false,
    model: '',
    messages: [], input: '', files: [],
    busy: false, error: null, exportBusyId: null,
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
  const idRef = useRef(1);
  const [sessions, setSessions] = useState(() => [newSession(1)]);
  const [modelConfig, setModelConfig] = useState({
    models: [], selectedModel: '', canChoose: false, configured: true, masterPromptReady: true,
  });
  const [activeId, setActiveId] = useState('draft-1');
  const [restoring, setRestoring] = useState(true);
  const endRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api.get('/ai/models').then((r) => {
      const config = r.data;
      setModelConfig(config);
      setSessions((current) => current.map((session) => ({
        ...session,
        model: config.canChoose
          ? (session.model || config.selectedModel || config.models?.[0]?.id || '')
          : (config.selectedModel || config.models?.[0]?.id || ''),
      })));
    }).catch(() => setModelConfig((current) => ({ ...current, configured: false })));

    api.get('/ai/conversations').then((r) => {
      const saved = r.data.conversations || [];
      if (!saved.length) return;
      const restored = saved.map((conversation, index) => ({
        ...newSession(index + 1),
        ...conversation,
        conversationId: conversation.id,
        n: index + 1,
        input: '', files: [], busy: false, error: null, exportBusyId: null,
      }));
      idRef.current = restored.length;
      setSessions(restored);
      setActiveId(restored.at(-1).id);
    }).catch(() => {}).finally(() => setRestoring(false));
  }, []);

  const active = sessions.find((s) => s.id === activeId) || sessions[0];
  // The master prompt runs once, at the start of a chat — after the first turn
  // the mode is fixed, exactly as it is in a real Claude conversation.
  const kindLocked = active.messages.length > 0;

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
    s.model = modelConfig.selectedModel || modelConfig.models?.[0]?.id || '';
    setSessions((prev) => [...prev, s]);
    setActiveId(s.id);
  }

  function closeSession(id) {
    const closing = sessions.find((s) => s.id === id);
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      idRef.current += 1;
      const fresh = newSession(idRef.current);
      fresh.model = modelConfig.selectedModel || modelConfig.models?.[0]?.id || '';
      setSessions([fresh]);
      setActiveId(fresh.id);
    } else {
      setSessions(remaining);
      if (id === activeId) setActiveId(remaining[0].id);
    }
    if (closing?.conversationId) {
      api.delete(`/ai/conversations/${closing.conversationId}`).catch(() => {});
    }
  }

  function tabTitle(s) {
    return `Chat ${s.n}`;
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
    if (!text || s.busy || restoring) return;

    const outgoing = s.files;
    const history = s.messages.map((m) => ({ role: m.role, content: m.content }));
    const userMsg = { id: uid(), role: 'user', content: text, files: outgoing.map((f) => f.name) };

    patch(s.id, { messages: [...s.messages, userMsg], input: '', files: [], busy: true, error: null });

    try {
      const fd = new FormData();
      fd.append('kind', s.kind);
      fd.append('prompt', text);
      fd.append('history', JSON.stringify(history));
      if (s.model) fd.append('model', s.model);
      if (s.conversationId) fd.append('conversationId', s.conversationId);
      outgoing.forEach((f) => fd.append('files', f));
      const { data } = await api.post('/ai/generate', fd);
      setSessions((prev) => prev.map((x) => (x.id === s.id ? {
        ...x,
        conversationId: data.conversationId,
        hasMasterPrompt: Boolean(data.hasMasterPrompt),
        busy: false,
        messages: data.messages || [
          ...x.messages,
          { id: uid(), role: 'assistant', content: data.draft, note: data.note || null },
        ],
      } : x)));
    } catch (err) {
      patch(s.id, { busy: false, error: errorMessage(err, 'Generation failed') });
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadTxt(msg) {
    const label = active.kind === 'cv_cover_letter' ? 'CV and Cover Letter' : 'Document';
    triggerDownload(new Blob([msg.content], { type: 'text/plain' }), `${label} — AI draft.txt`);
  }

  async function downloadFormatted(msg, format) {
    const s = active;
    const busyId = `${msg.id}:${format}`;
    patch(s.id, { exportBusyId: busyId, error: null });
    try {
      const { data } = await api.post('/ai/export', {
        content: msg.content,
        kind: s.kind,
        format,
      }, { responseType: 'blob' });
      const label = s.kind === 'cv_cover_letter' ? 'CV-and-Cover-Letter' : 'Document';
      triggerDownload(data, `${label}-AI-Draft.${format}`);
    } catch (err) {
      patch(s.id, { error: errorMessage(err, 'Download failed') });
    } finally {
      patch(s.id, { exportBusyId: null });
    }
  }

  async function copyMsg(msg) {
    try { await navigator.clipboard.writeText(msg.content); } catch { /* clipboard unavailable */ }
  }


  return (
    <AppShell>
      <PageHeader
        title="AI Studio"
        subtitle="Paste a job description and get a tailored CV and cover letter back — conversations are saved automatically"
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
        <Card className="animate-rise h-fit overflow-hidden">
          <CardHeader title="Chat settings" subtitle="Pick the mode, then paste job descriptions" />
          <div className="space-y-4 p-6">
            <div>
              <span className="label-caps text-navy-800/70 mb-1.5 block">Mode</span>
              <div className="flex flex-col gap-1.5 rounded-xl bg-ivory p-1.5">
                {KINDS.map((k) => (
                  <button key={k.key} type="button" disabled={kindLocked}
                    onClick={() => updateActive({ kind: k.key })}
                    aria-pressed={active.kind === k.key}
                    className={`rounded-lg px-3 py-2 text-left text-sm font-semibold transition disabled:cursor-not-allowed ${
                      active.kind === k.key
                        ? 'bg-navy-800 text-ivory'
                        : `text-ink-soft ${kindLocked ? 'opacity-50' : 'hover:text-navy-800'}`
                    }`}>
                    {k.label}
                    <span className={`mt-0.5 block text-xs font-normal ${active.kind === k.key ? 'text-ivory/70' : 'text-ink-soft'}`}>
                      {k.hint}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-ink-soft">
                {kindLocked
                  ? 'The mode is fixed for this chat — start a new chat to switch.'
                  : 'Chosen once per chat.'}
              </p>
            </div>
            {modelConfig.canChoose ? (
              <div>
                {/* Locked once the chat starts: prompt caches are per-model, so
                    switching mid-chat would throw the master-prompt cache away
                    and every later job description would pay full price again. */}
                <Select id="ai-model" label="Claude model" value={active.model} disabled={kindLocked}
                  onChange={(e) => updateActive({ model: e.target.value })}>
                  {modelConfig.models.map((model) => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </Select>
                {kindLocked && (
                  <p className="mt-1 text-xs text-ink-soft">
                    Fixed for this chat to keep the cached prompt — start a new chat to switch model.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <span className="label-caps text-navy-800/70 mb-1.5 block">Claude model</span>
                <div className="rounded-xl border border-navy-800/10 bg-ivory px-3.5 py-2.5 text-sm text-navy-800">
                  {active.model || modelConfig.selectedModel || 'Server default'}
                </div>
                <p className="mt-1 text-xs text-ink-soft">Set by your administrator</p>
              </div>
            )}
            {!modelConfig.configured && (
              <p className="rounded-lg bg-alert-soft px-3 py-2 text-xs text-alert">
                Claude is not connected yet. Add ANTHROPIC_API_KEY on the server before going live.
              </p>
            )}
            {active.kind === 'cv_cover_letter' && (
              // Before the first message there is nothing chat-specific to report,
              // so fall back to whether a prompt is saved at all. Once the chat has
              // turns, report what THIS chat is actually running.
              (kindLocked ? active.hasMasterPrompt : modelConfig.masterPromptReady) ? (
                <p className="rounded-lg bg-success-soft px-3 py-2 text-xs text-success">
                  {kindLocked
                    ? '✓ The master prompt is running in this chat — just paste the next job description.'
                    : '✓ The master prompt runs automatically when you send the first message — just paste the job description.'}
                  {' '}It is cached for an hour, so each job description only costs for itself.
                </p>
              ) : (
                <p className="rounded-lg bg-alert-soft px-3 py-2 text-xs text-alert">
                  {kindLocked
                    ? 'This chat is not running a master prompt. Start a new chat to pick up the saved one.'
                    : 'No master prompt has been saved yet. An Admin Lead can add one under Admin → AI Settings.'}
                </p>
              )
            )}
            <p className="border-t border-ivory-dark pt-3 text-xs text-ink-soft">
              Paste one job description after another in the same chat — each gets its own CV and cover
              letter. Follow-ups like “make it shorter” refine the last draft.
            </p>
          </div>
        </Card>

        {/* ---------------- conversation ---------------- */}
        <Card className="animate-rise animate-rise-1 flex flex-col">
          <CardHeader title="Conversation" subtitle="Saved automatically · download or save any draft" />

          {/* transcript */}
          <div className="flex-1 space-y-5 overflow-y-auto p-6" style={{ minHeight: '46vh', maxHeight: '62vh' }}>
            {restoring && active.messages.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-14 text-sm text-ink-soft">
                <Spinner /> Restoring saved conversations…
              </div>
            )}
            {!restoring && active.messages.length === 0 && !active.busy && (
              <div className="py-14 text-center">
                <div className="mb-2 text-3xl">✨</div>
                <p className="text-sm text-ink-soft">
                  {active.kind === 'cv_cover_letter'
                    ? 'Paste a job description to get a tailored CV and cover letter.'
                    : 'Start the conversation — describe what you need.'}
                </p>
                <p className="mx-auto mt-2 max-w-sm text-xs text-ink-soft/80">
                  {active.kind === 'cv_cover_letter'
                    ? 'Paste the job description (and attach the candidate’s CV) — the saved master prompt is applied automatically.'
                    : 'e.g. “Summarise this job spec into five interview questions.”'}
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
                      <button type="button" onClick={() => downloadFormatted(m, 'pdf')}
                        disabled={active.exportBusyId === `${m.id}:pdf`}
                        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-soft transition hover:bg-navy-800/5 hover:text-navy-800 disabled:opacity-50">
                        {active.exportBusyId === `${m.id}:pdf` ? 'Creating PDF…' : 'Download PDF'}
                      </button>
                      <button type="button" onClick={() => downloadFormatted(m, 'docx')}
                        disabled={active.exportBusyId === `${m.id}:docx`}
                        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-soft transition hover:bg-navy-800/5 hover:text-navy-800 disabled:opacity-50">
                        {active.exportBusyId === `${m.id}:docx` ? 'Creating Word…' : 'Download Word'}
                      </button>
                      <button type="button" onClick={() => downloadTxt(m)}
                        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-ink-soft transition hover:bg-navy-800/5 hover:text-navy-800">
                        Download .txt
                      </button>
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
                rows={1} value={active.input} maxLength={MAX_PROMPT_CHARS} onKeyDown={onKeyDown}
                onChange={(e) => updateActive({ input: e.target.value })}
                placeholder={active.messages.length
                  ? 'Paste the next job description, or ask a follow-up…'
                  : active.kind === 'cv_cover_letter'
                    ? 'Paste the job description…'
                    : 'Describe what you need…'}
                className="max-h-40 min-h-[40px] flex-1 resize-y rounded-xl border border-navy-800/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30"
              />
              <Button type="submit" disabled={restoring || active.busy || !active.input.trim()} className="!px-4 shrink-0">
                {active.busy ? <Spinner /> : 'Send'}
              </Button>
            </div>
            <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11px] text-ink-soft">
              <p>Enter to send · Shift+Enter for a new line · PDF, Word, TXT and Markdown files are supported</p>
              <p>{active.input.length.toLocaleString()} / {MAX_PROMPT_CHARS.toLocaleString()}</p>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}

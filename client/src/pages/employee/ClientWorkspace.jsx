import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { AppShell, PageHeader } from '../../layouts/AppShell';
import { Card, CardHeader, Skeleton, EmptyState, Badge, Button, Input, Select, Spinner } from '../../components/ui';
import { JobTable } from '../../components/JobTable';
import { DownloadButton } from '../../components/files';

const TABS = [
  { key: 'masters', label: 'Domains & Masters' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'jobs', label: 'Log Jobs' },
];

export default function ClientWorkspace() {
  const { id } = useParams();
  const [dash, setDash] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [tab, setTab] = useState('masters');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const [{ data: d }, { data: j }] = await Promise.all([
        api.get(`/clients/${id}/dashboard`),
        api.get(`/clients/${id}/jobs`),
      ]);
      setDash(d);
      setJobs(j.jobs);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  if (error) {
    return <AppShell><EmptyState icon="⚠️" title="Cannot open workspace" hint={error} /></AppShell>;
  }

  return (
    <AppShell>
      {!dash ? (
        <div className="space-y-6"><Skeleton className="h-12 w-72" /><Skeleton className="h-72 rounded-2xl" /></div>
      ) : (
        <>
          <PageHeader
            title={dash.client.fullName}
            subtitle={`${dash.momentum.applied} of ${dash.momentum.target} applications this month · ${dash.client.packageType}`}
            action={
              <Link to="/employee"><Button variant="ghost">← All clients</Button></Link>
            }
          />
          {notice && (
            <div className="mb-6 rounded-xl bg-gold-100 px-4 py-3 text-sm text-navy-800" role="status">{notice}</div>
          )}

          <div className="mb-6 inline-flex rounded-xl bg-white p-1 shadow-card border border-ivory-dark" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  tab === t.key ? 'bg-navy-800 text-ivory' : 'text-ink-soft hover:text-navy-800'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'jobs' && <JobsTab clientId={id} dash={dash} jobs={jobs} onChanged={() => { load(); flash('Saved'); }} />}
          {tab === 'masters' && <MastersTab clientId={id} dash={dash} onChanged={() => { load(); flash('Master document uploaded'); }} />}
          {tab === 'linkedin' && <LinkedInTab clientId={id} dash={dash} onChanged={() => { load(); flash('LinkedIn status updated'); }} />}
        </>
      )}
    </AppShell>
  );
}

/* ---------------- Log Jobs tab ---------------- */

function JobsTab({ clientId, dash, jobs, onChanged }) {
  const [form, setForm] = useState({
    jobTitle: '', company: '',
    applicationDate: new Date().toISOString().slice(0, 10),
    jobUrl: '', domainId: '',
  });
  const [cvFile, setCvFile] = useState(null);
  const [clFile, setClFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // AI assistant state
  const [aiDraft, setAiDraft] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState(null);
  const cvInputRef = useRef(null);
  const clInputRef = useRef(null);

  async function draftWithAI() {
    if (!form.jobTitle || !form.company) {
      return setAiErr('Enter the job title and company first');
    }
    setAiBusy(true);
    setAiErr(null);
    try {
      const { data } = await api.post('/ai/cover-letter', {
        clientId,
        jobTitle: form.jobTitle,
        company: form.company,
        ...(form.domainId ? { domainId: form.domainId } : {}),
      });
      setAiDraft(data.draft);
    } catch (e) {
      setAiErr(errorMessage(e, 'AI drafting failed'));
    } finally {
      setAiBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { data } = await api.post(`/clients/${clientId}/jobs`, {
        jobTitle: form.jobTitle,
        company: form.company,
        applicationDate: form.applicationDate,
        jobUrl: form.jobUrl,
      });
      const jobId = data.job.id;

      const uploads = [];
      if (cvFile) {
        const fd = new FormData();
        fd.append('type', 'tailored_cv');
        fd.append('file', cvFile);
        uploads.push(api.post(`/jobs/${jobId}/tailored-docs`, fd));
      }
      const coverLetterBlob = !clFile && aiDraft
        ? new File([aiDraft], `Cover Letter — ${form.company}.txt`, { type: 'text/plain' })
        : clFile;
      if (coverLetterBlob) {
        const fd = new FormData();
        fd.append('type', 'tailored_cover_letter');
        fd.append('file', coverLetterBlob);
        uploads.push(api.post(`/jobs/${jobId}/tailored-docs`, fd));
      }
      await Promise.all(uploads);

      setForm({ ...form, jobTitle: '', company: '', jobUrl: '' });
      setCvFile(null);
      setClFile(null);
      setAiDraft('');
      if (cvInputRef.current) cvInputRef.current.value = '';
      if (clInputRef.current) clInputRef.current.value = '';
      onChanged();
    } catch (e2) {
      setErr(errorMessage(e2, 'Failed to log job'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="animate-rise">
        <CardHeader
          title="Log a Job Application"
          subtitle="Record the application and attach the tailored documents"
        />
        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="j-title" label="Job title" required value={form.jobTitle}
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
            <Input id="j-company" label="Company" required value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="j-date" label="Application date" type="date" required value={form.applicationDate}
              onChange={(e) => setForm({ ...form, applicationDate: e.target.value })} />
            <Input id="j-url" label="Job URL" type="url" required placeholder="https://…" value={form.jobUrl}
              onChange={(e) => setForm({ ...form, jobUrl: e.target.value })} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="label-caps text-navy-800/70 block mb-1.5">Tailored CV</span>
              <input ref={cvInputRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf,.odt"
                onChange={(e) => setCvFile(e.target.files[0] || null)}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-ivory hover:file:bg-navy-700 file:cursor-pointer" />
            </div>
            <div>
              <span className="label-caps text-navy-800/70 block mb-1.5">Tailored cover letter</span>
              <input ref={clInputRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf,.odt"
                onChange={(e) => setClFile(e.target.files[0] || null)}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-ivory hover:file:bg-navy-700 file:cursor-pointer" />
              <p className="mt-1 text-xs text-ink-soft">…or draft one with AI below — it uploads automatically.</p>
            </div>
          </div>

          {/* ✨ AI Writing Assistant */}
          <div className="rounded-2xl border border-gold-500/30 bg-gold-100/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-navy-800">AI Writing Assistant</div>
                <div className="text-xs text-ink-soft">
                  Drafts a cover letter from the client's master CV + this job's details.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select id="j-domain" value={form.domainId} aria-label="Domain for AI draft"
                  onChange={(e) => setForm({ ...form, domainId: e.target.value })} className="!w-auto">
                  <option value="">Auto domain</option>
                  {dash.domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
                <Button type="button" onClick={draftWithAI} disabled={aiBusy}>
                  {aiBusy ? <Spinner /> : '✨'} {aiBusy ? 'Drafting…' : aiDraft ? 'Regenerate' : 'Draft with AI'}
                </Button>
              </div>
            </div>
            {aiErr && <p className="mt-2 text-sm text-danger">{aiErr}</p>}
            {aiDraft && (
              <textarea
                value={aiDraft}
                onChange={(e) => setAiDraft(e.target.value)}
                rows={10}
                aria-label="AI cover letter draft (editable)"
                className="mt-3 w-full rounded-xl border border-navy-800/15 bg-white p-3.5 text-sm leading-relaxed focus:border-gold-500 focus:ring-2 focus:ring-gold-500/30 outline-none"
              />
            )}
          </div>

          {err && <p className="text-sm text-danger">{err}</p>}
          <Button type="submit" disabled={busy} className="w-full sm:w-auto">
            {busy ? <Spinner /> : null} {busy ? 'Saving…' : 'Log application'}
          </Button>
        </form>
      </Card>

      <Card className="animate-rise animate-rise-1">
        <CardHeader title="Application Log" subtitle="Everything filed for this client — tailored documents attached" />
        {!jobs ? (
          <div className="p-6"><Skeleton className="h-32" /></div>
        ) : (
          <JobTable
            jobs={jobs}
            showTailored
            onDelete={async (jobId) => {
              await api.delete(`/jobs/${jobId}`);
              onChanged();
            }}
          />
        )}
      </Card>
    </div>
  );
}

/* ---------------- Domains & Masters tab ---------------- */

function MastersTab({ clientId, dash, onChanged }) {
  const [busyDoc, setBusyDoc] = useState(null);
  const [err, setErr] = useState(null);

  async function uploadMaster(domainId, type, file) {
    if (!file) return;
    setBusyDoc(`${domainId}:${type}`);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('domainId', domainId);
      fd.append('type', type);
      fd.append('file', file);
      await api.post(`/clients/${clientId}/master-docs`, fd);
      onChanged();
    } catch (e) {
      setErr(errorMessage(e, 'Upload failed'));
    } finally {
      setBusyDoc(null);
    }
  }

  return (
    <Card className="animate-rise">
      <CardHeader
        title="Domains & Master Documents"
        subtitle="One master CV + one master cover letter per domain. Masters are visible to the client."
      />
      {err && <p className="px-6 pt-4 text-sm text-danger">{err}</p>}
      <ul className="divide-y divide-ivory-dark">
        {dash.domains.map((domain) => (
          <li key={domain.id} className="px-6 py-5">
            <div className="font-display text-lg text-navy-800">{domain.name}</div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {['master_cv', 'master_cover_letter'].map((type) => {
                const existing = domain.masterDocuments.find((d) => d.type === type);
                const uploading = busyDoc === `${domain.id}:${type}`;
                return (
                  <div key={type} className="rounded-xl border border-ivory-dark bg-ivory/50 p-4">
                    <div className="flex items-center justify-between">
                      <span className="label-caps text-navy-800/70">
                        {type === 'master_cv' ? 'Master CV' : 'Master Cover Letter'}
                      </span>
                      {existing ? <Badge tone="success">✓ Uploaded</Badge> : <Badge tone="alert">Missing</Badge>}
                    </div>
                    {existing && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="truncate text-sm text-ink" title={existing.fileName}>{existing.fileName}</span>
                        <DownloadButton docId={existing.id} label="View" />
                      </div>
                    )}
                    <label className="mt-3 block">
                      <span className="sr-only">{existing ? 'Replace' : 'Upload'} {type.replace(/_/g, ' ')} for {domain.name}</span>
                      <input type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf,.odt" disabled={uploading}
                        onChange={(e) => uploadMaster(domain.id, type, e.target.files[0])}
                        className="block w-full text-xs text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-gold-500 file:px-3.5 file:py-2 file:text-xs file:font-semibold file:text-navy-900 hover:file:bg-gold-400 file:cursor-pointer" />
                    </label>
                    {uploading && <p className="mt-2 text-xs text-ink-soft">Uploading…</p>}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------------- LinkedIn tab ---------------- */

function LinkedInTab({ clientId, dash, onChanged }) {
  const [busy, setBusy] = useState(false);
  const options = [
    { key: 'not_started', label: 'Not Started', hint: 'Work has not begun yet' },
    { key: 'in_progress', label: 'In Progress', hint: 'Profile is being optimised' },
    { key: 'complete', label: 'Complete', hint: 'Profile is fully polished' },
  ];

  async function setStatus(status) {
    setBusy(true);
    try {
      await api.put(`/clients/${clientId}/linkedin-status`, { status });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="animate-rise max-w-2xl">
      <CardHeader title="LinkedIn Profile Status" subtitle="The client sees this on their dashboard tracker" />
      <div className="p-6 space-y-3">
        {options.map((opt) => {
          const active = dash.client.linkedinStatus === opt.key;
          return (
            <button key={opt.key} disabled={busy} onClick={() => setStatus(opt.key)}
              className={`w-full rounded-xl border-2 px-5 py-4 text-left transition ${
                active
                  ? 'border-gold-500 bg-gold-100/60'
                  : 'border-ivory-dark bg-white hover:border-gold-500/40'
              }`}
              aria-pressed={active}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-navy-800">{opt.label}</span>
                {active && <Badge tone="gold">Current</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-ink-soft">{opt.hint}</p>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

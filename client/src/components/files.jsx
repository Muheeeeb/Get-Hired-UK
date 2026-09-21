import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner } from './ui';
import { FileViewer, useFileViewer } from './FileViewer';

/**
 * Opens a document in the in-app viewer (PDFs, images and text render inline);
 * anything a browser cannot display falls back to a download.
 * The server enforces role rules — clients get 403 for tailored docs.
 */
export function DownloadButton({ docId, label = 'View', fileName = '', className = '' }) {
  const { viewerProps, openDoc } = useFileViewer();
  const busy = viewerProps.open && viewerProps.loading;

  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => openDoc(docId, fileName || label)}
        disabled={busy}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-navy-800 bg-gold-100 hover:bg-gold-300/50 transition disabled:opacity-50 ${className}`}
      >
        {busy ? <Spinner /> : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="shrink-0">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
        <span className="truncate">{label}</span>
      </button>
      <FileViewer {...viewerProps} />
    </span>
  );
}

/**
 * Remove an uploaded document (a master CV/cover letter, or a tailored file on a
 * job log entry). `endpoint` is the DELETE path; the caller reloads on success.
 */
export function DeleteFileButton({ endpoint, label = 'file', onDeleted, className = '' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function remove() {
    if (!window.confirm(`Delete ${label}? This permanently removes the uploaded file.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api.delete(endpoint);
      onDeleted?.();
    } catch (e) {
      setErr(errorMessage(e, 'Delete failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        aria-label={`Delete ${label}`}
        title={`Delete ${label}`}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger-soft disabled:opacity-50 ${className}`}
      >
        {busy ? <Spinner /> : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        Delete
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

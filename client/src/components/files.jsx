import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner } from './ui';

/**
 * Fetches a short-lived signed URL for a document, then opens it.
 * The server enforces role rules — clients get 403 for tailored docs.
 */
export function DownloadButton({ docId, label = 'Download', className = '' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function download() {
    setBusy(true);
    setErr(null);
    try {
      const { data } = await api.get(`/files/${docId}/signed-url`);
      window.open(data.url, '_blank', 'noopener');
    } catch (e) {
      setErr(errorMessage(e, 'Download failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        onClick={download}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-navy-800 bg-gold-100 hover:bg-gold-300/50 transition disabled:opacity-50 ${className}`}
      >
        {busy ? <Spinner /> : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {label}
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

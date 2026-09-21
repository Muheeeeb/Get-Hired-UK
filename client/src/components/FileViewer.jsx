import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner } from './ui';

/**
 * In-app document viewer.
 *
 * Attachments used to be handed to a brand-new browser tab. PDFs, images and
 * text now render in this overlay instead, so the specialist stays inside the
 * portal — with Download and "Open in new tab" still one click away. Anything the
 * browser cannot display inline (Word, ODT…) falls straight through to a download.
 */
export function FileViewer({ open, onClose, url, fileName, loading, error }) {
  // Esc closes, and the page behind must not scroll while the viewer is up.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-navy-950/60 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={fileName || 'Document viewer'}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-card-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-ivory-dark px-4 py-3 sm:px-5">
          <span className="text-lg" aria-hidden="true">📄</span>
          <span className="min-w-0 flex-1 truncate font-semibold text-navy-800" title={fileName}>
            {fileName || 'Document'}
          </span>
          {url && (
            <>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-navy-800/5 hover:text-navy-800 sm:inline-block"
              >
                Open in new tab ↗
              </a>
              <a
                href={url}
                download={fileName || true}
                className="rounded-lg bg-gold-100 px-2.5 py-1.5 text-xs font-semibold text-navy-800 transition hover:bg-gold-300/50"
              >
                Download
              </a>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document viewer"
            className="rounded-lg p-1.5 text-ink-soft transition hover:bg-navy-800/5 hover:text-navy-800"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-hidden bg-ivory">
          {loading && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-soft">
              <Spinner /> Opening document…
            </div>
          )}
          {!loading && error && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="text-3xl" aria-hidden="true">⚠️</span>
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}
          {!loading && !error && url && (
            <iframe
              src={url}
              title={fileName || 'Document'}
              className="h-full w-full border-0 bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Shared "open a document" behaviour: fetch the short-lived signed URL, then
 * either show it in the viewer or download it. Returns the props the viewer needs.
 */
export function useFileViewer() {
  const [state, setState] = useState({ open: false, url: null, fileName: '', loading: false, error: null });

  async function openDoc(docId, fallbackName = '') {
    setState({ open: true, url: null, fileName: fallbackName, loading: true, error: null });
    try {
      const { data } = await api.get(`/files/${docId}/signed-url`);
      if (data.inline) {
        setState({ open: true, url: data.url, fileName: data.fileName || fallbackName, loading: false, error: null });
        return;
      }
      // Not viewable in a browser — download it and drop the overlay.
      setState({ open: false, url: null, fileName: '', loading: false, error: null });
      const a = document.createElement('a');
      a.href = data.url;
      a.rel = 'noopener';
      a.download = data.fileName || fallbackName || '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setState({
        open: true, url: null, fileName: fallbackName, loading: false,
        error: errorMessage(err, 'Could not open this document'),
      });
    }
  }

  const close = () => setState({ open: false, url: null, fileName: '', loading: false, error: null });
  return { viewerProps: { ...state, onClose: close }, openDoc };
}

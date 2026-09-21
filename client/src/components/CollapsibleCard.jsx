import { useId, useState } from 'react';
import { Card } from './ui';

/**
 * A card whose contents stay closed until the header is clicked.
 *
 * Used for the job application log: the full table was dominating every
 * dashboard, so it is now one line you open on demand.
 */
export function CollapsibleCard({
  title, subtitle, badge, defaultOpen = false, className = '', children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <Card className={`overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex w-full items-center gap-3 px-6 py-5 text-left transition hover:bg-ivory/60 ${
          open ? 'border-b border-gold-500/15' : ''
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg text-navy-800">{title}</span>
            {badge}
          </span>
          {subtitle && <span className="mt-0.5 block text-sm text-ink-soft">{subtitle}</span>}
        </span>
        <span className="shrink-0 text-sm font-semibold text-gold-600">{open ? 'Hide' : 'View'}</span>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          aria-hidden="true"
          className={`shrink-0 text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Kept mounted rather than unmounted so anything with its own state
          inside (scroll position, an open row) survives a collapse. */}
      <div id={panelId} hidden={!open}>{children}</div>
    </Card>
  );
}

const STEPS = [
  { key: 'not_started', label: 'Not Started' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'complete', label: 'Complete' },
];

/** Horizontal LinkedIn profile progress stepper — gold highlight on the current stage. */
export function LinkedInStepper({ status }) {
  const activeIdx = STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="flex items-center w-full" aria-label="LinkedIn profile progress">
      {STEPS.map((step, i) => {
        const reached = i <= activeIdx;
        const current = i === activeIdx;
        return (
          <li key={step.key} className={`flex items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
            <div className="flex flex-col items-center gap-2 min-w-[72px]">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors
                  ${reached
                    ? 'border-gold-500 bg-gold-500 text-navy-900'
                    : 'border-navy-800/20 bg-white text-ink-soft'}
                  ${current ? 'ring-4 ring-gold-500/25' : ''}`}
                aria-current={current ? 'step' : undefined}
              >
                {i < activeIdx ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={`text-xs font-medium ${current ? 'text-gold-600' : reached ? 'text-navy-800' : 'text-ink-soft'}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-2 h-0.5 flex-1 rounded-full mb-6 ${i < activeIdx ? 'bg-gold-500' : 'bg-navy-800/15'}`}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

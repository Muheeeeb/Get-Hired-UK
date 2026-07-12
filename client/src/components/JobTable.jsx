import { Badge, EmptyState } from './ui';
import { DownloadButton, formatDate } from './files';

/**
 * Job applications table.
 * For clients: Company · Job Title · Date · URL only. No tailored-file column —
 * the API never sends tailored docs to a client either.
 */
export function JobTable({ jobs, showTailored = false, onDelete }) {
  if (!jobs.length) {
    return (
      <EmptyState
        icon="🗂️"
        title="No applications yet"
        hint="Your first batch of tailored applications will appear here soon."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gold-500/20">
            <th className="label-caps text-ink-soft px-6 py-3">Company</th>
            <th className="label-caps text-ink-soft px-4 py-3">Job Title</th>
            <th className="label-caps text-ink-soft px-4 py-3">Date</th>
            <th className="label-caps text-ink-soft px-4 py-3">Link</th>
            {showTailored && <th className="label-caps text-ink-soft px-4 py-3">Tailored Files</th>}
            {onDelete && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-b border-ivory-dark last:border-0 hover:bg-ivory/60 transition-colors">
              <td className="px-6 py-3.5 font-semibold text-navy-800">{job.company}</td>
              <td className="px-4 py-3.5 text-ink">{job.jobTitle}</td>
              <td className="px-4 py-3.5 text-ink-soft whitespace-nowrap">{formatDate(job.applicationDate)}</td>
              <td className="px-4 py-3.5">
                <a
                  href={job.jobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold-600 font-semibold hover:underline"
                >
                  View posting ↗
                </a>
              </td>
              {showTailored && (
                <td className="px-4 py-3.5">
                  {job.tailoredDocuments?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {job.tailoredDocuments.map((doc) => (
                        <DownloadButton
                          key={doc.id}
                          docId={doc.id}
                          label={doc.type === 'tailored_cv' ? 'CV' : 'Cover letter'}
                        />
                      ))}
                    </div>
                  ) : (
                    <Badge tone="alert">Pending</Badge>
                  )}
                </td>
              )}
              {onDelete && (
                <td className="px-4 py-3.5 text-right">
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete the ${job.company} application? Its tailored files go with it.`)) {
                        onDelete(job.id);
                      }
                    }}
                    aria-label={`Delete ${job.company} application`}
                    className="rounded-lg px-2 py-1.5 text-xs font-semibold text-danger hover:bg-danger-soft transition"
                  >
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

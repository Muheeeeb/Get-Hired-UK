import { Badge, EmptyState } from './ui';
import { DeleteFileButton, DownloadButton, formatDate } from './files';

/**
 * Job applications table.
 * For clients: Company · Job Title · Date · URL only. No tailored-file column —
 * the API never sends tailored docs to a client either.
 */
export function JobTable({ jobs, showTailored = false, onDelete, onDocumentDeleted }) {
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
            <tr key={job.id} className={`border-b border-ivory-dark last:border-0 transition-colors ${job.duplicateUrl ? 'bg-danger-soft/60 hover:bg-danger-soft' : 'hover:bg-ivory/60'}`}>
              <td className="px-6 py-3.5 font-semibold text-navy-800">
                {job.company}
                {job.duplicateUrl && <Badge tone="danger">Duplicate URL</Badge>}
              </td>
              <td className="px-4 py-3.5 text-ink">{job.jobTitle}</td>
              <td className="px-4 py-3.5 text-ink-soft whitespace-nowrap">{formatDate(job.applicationDate)}</td>
              <td className="px-4 py-3.5">
                <a
                  href={job.jobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={job.jobUrl}
                  className="whitespace-nowrap font-semibold text-gold-600 hover:underline"
                >
                  View posting ↗
                </a>
              </td>
              {showTailored && (
                <td className="px-4 py-3.5">
                  {job.tailoredDocuments?.length ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {job.tailoredDocuments.map((doc) => (
                        <span key={doc.id} className="inline-flex items-center gap-0.5 rounded-lg bg-ivory/70 pr-0.5">
                          <DownloadButton
                            docId={doc.id}
                            fileName={doc.fileName}
                            label={doc.type === 'tailored_cv' ? 'CV' : 'Cover letter'}
                          />
                          {onDocumentDeleted && (
                            <DeleteFileButton
                              endpoint={`/jobs/tailored-docs/${doc.id}`}
                              label={`the ${doc.type === 'tailored_cv' ? 'tailored CV' : 'tailored cover letter'} for ${job.company}`}
                              onDeleted={onDocumentDeleted}
                              className="!px-1.5"
                            />
                          )}
                        </span>
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

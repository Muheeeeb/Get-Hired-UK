import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Badge, Button, Card, CardHeader, Input, Skeleton } from '../components/ui';
import { formatDate } from './files';

/**
 * Admin editor for a client's package months.
 *
 * Every month has its own stored start and end date, and all of them stay
 * editable: Month 1 can be corrected while the client is on Month 3. Saving
 * recounts the logged jobs against the new ranges, and the package expiry
 * follows the last month automatically. Gaps between months are allowed (a
 * client who pauses and resumes); overlaps are rejected by the server.
 */
export function PackageMonthsEditor({ clientId, onSaved, reloadToken = 0, className = '' }) {
  const [months, setMonths] = useState(null);
  const [draft, setDraft] = useState([]);
  const [summary, setSummary] = useState({ packageMonths: 0, packageStartedAt: null, expiryDate: null });
  const [extendMonths, setExtendMonths] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const apply = useCallback((data) => {
    setMonths(data.months);
    setDraft(data.months.map((m) => ({ month: m.month, startDate: m.startDate, endDate: m.endDate })));
    setSummary({
      packageMonths: data.packageMonths,
      packageStartedAt: data.packageStartedAt,
      expiryDate: data.expiryDate,
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/clients/${clientId}/package-months`);
      apply(data);
    } catch (err) {
      setError(errorMessage(err, 'Could not load package months'));
    }
  }, [clientId, apply]);

  // `reloadToken` changes whenever the parent page reloads the client — the
  // Package & Assignment form above also moves Month 1's start and the last
  // month's end, and saving a stale draft here would silently revert it.
  useEffect(() => { load(); }, [load, reloadToken]);

  function flash(message) {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  }

  function patchMonth(index, patch) {
    setDraft((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  const dirty = months !== null && draft.some((m, i) => (
    m.startDate !== months[i]?.startDate || m.endDate !== months[i]?.endDate
  ));

  async function run(action, successMessage) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await action();
      apply(data);
      flash(successMessage);
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err, 'Could not update the package months'));
    } finally {
      setBusy(false);
    }
  }

  const save = () => run(
    () => api.put(`/admin/clients/${clientId}/package-months`, { months: draft }),
    'Package dates saved — job counts have been recalculated',
  );

  const extend = () => run(
    () => api.post(`/admin/clients/${clientId}/extend`, { months: Number(extendMonths) }),
    `Added ${extendMonths} month${Number(extendMonths) === 1 ? '' : 's'} — edit the dates below if needed`,
  );

  function removeMonth(month) {
    if (!window.confirm(
      `Delete Month ${month}? The remaining months are renumbered and the package expiry moves to the new last month. Logged jobs are kept, but any that fall outside the remaining months stop counting towards a monthly target.`
    )) return;
    run(
      () => api.delete(`/admin/clients/${clientId}/package-months/${month}`),
      `Month ${month} deleted`,
    );
  }

  return (
    <Card className={`overflow-hidden ${className}`}>
      <CardHeader
        title="Package Months"
        subtitle="Each month has its own dates — edit any of them at any time, including Month 1"
      />

      {!months ? (
        <div className="space-y-3 p-6"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : (
        <>
          <div className="grid gap-3 border-b border-ivory-dark px-6 py-4 text-sm sm:grid-cols-3">
            <div className="min-w-0">
              <span className="text-ink-soft">Package started</span>
              <div className="font-semibold text-navy-800">{formatDate(summary.packageStartedAt)}</div>
            </div>
            <div className="min-w-0">
              <span className="text-ink-soft">Expiry (last month's end)</span>
              <div className="font-semibold text-navy-800">{formatDate(summary.expiryDate)}</div>
            </div>
            <div className="min-w-0">
              <span className="text-ink-soft">Duration</span>
              <div className="font-semibold text-navy-800">
                {summary.packageMonths} month{summary.packageMonths === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {notice && (
            <p className="border-b border-ivory-dark bg-success-soft px-6 py-3 text-sm text-success" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="border-b border-ivory-dark bg-danger-soft px-6 py-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <ul className="divide-y divide-ivory-dark">
            {draft.map((month, index) => {
              const stored = months[index];
              return (
                <li key={month.month} className="px-6 py-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="font-display text-base text-navy-800">Month {month.month}</span>
                    {stored?.status === 'current' && <Badge tone="gold">Current</Badge>}
                    {stored?.status === 'upcoming' && <Badge tone="navy">Upcoming</Badge>}
                    <span className="text-xs text-ink-soft">
                      {stored?.applications} of {stored?.target} applications logged
                    </span>
                    {draft.length > 1 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => removeMonth(month.month)}
                        className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-danger transition hover:bg-danger-soft disabled:opacity-50"
                      >
                        Delete month
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      id={`pm-${month.month}-start`} label="Start date" type="date" value={month.startDate}
                      onChange={(e) => patchMonth(index, { startDate: e.target.value })}
                    />
                    <Input
                      id={`pm-${month.month}-end`} label="End date" type="date" value={month.endDate}
                      min={month.startDate}
                      onChange={(e) => patchMonth(index, { endDate: e.target.value })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-ivory-dark p-6">
            <div className="flex flex-wrap items-end gap-2">
              <Input
                id="pm-extend" label="Extend by (months)" type="number" min={1} max={24}
                value={extendMonths} onChange={(e) => setExtendMonths(e.target.value)}
                className="!w-32"
              />
              <Button
                type="button" variant="navy" disabled={busy || Number(extendMonths) < 1 || Number(extendMonths) > 24}
                onClick={extend}
              >
                Extend package
              </Button>
            </div>
            <div className="flex items-center gap-3">
              {dirty && <span className="text-xs text-alert">Unsaved date changes</span>}
              <Button type="button" onClick={save} disabled={busy || !dirty}>
                {busy ? 'Saving…' : 'Save dates'}
              </Button>
            </div>
          </div>
          <p className="border-t border-ivory-dark px-6 py-3 text-xs text-ink-soft">
            Months may not overlap. Gaps between them are allowed — useful when a client pauses and
            resumes. Saving recalculates the logged-job count for every month.
          </p>
        </>
      )}
    </Card>
  );
}

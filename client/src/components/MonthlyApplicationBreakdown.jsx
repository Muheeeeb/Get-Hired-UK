import { Badge, Card, CardHeader } from './ui';
import { formatDate } from './files';

/** Package-month application totals shared by client, employee and admin views. */
export function MonthlyApplicationBreakdown({ months = [], className = '' }) {
  const packageStart = months[0]?.startDate;
  const packageExpiry = months.at(-1)?.endDate;
  return (
    <Card className={className}>
      <CardHeader
        title="Monthly Application Tracking"
        subtitle="Applications are counted separately from each package-month anniversary"
      />
      {months.length > 0 && (
        <div className="grid gap-3 border-b border-ivory-dark px-6 py-4 text-sm sm:grid-cols-3">
          <div><span className="text-ink-soft">Package started</span><div className="font-semibold text-navy-800">{formatDate(packageStart)}</div></div>
          <div><span className="text-ink-soft">Current expiry</span><div className="font-semibold text-navy-800">{formatDate(packageExpiry)}</div></div>
          <div><span className="text-ink-soft">Package duration</span><div className="font-semibold text-navy-800">{months.length} month{months.length === 1 ? '' : 's'}</div></div>
        </div>
      )}
      <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
        {months.map((period) => (
          <div
            key={period.month}
            className={`rounded-xl border p-4 ${period.status === 'current' ? 'border-gold-500 bg-gold-100/35' : 'border-ivory-dark bg-ivory/50'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-display text-lg text-navy-800">{period.label}</div>
              {period.status === 'current' && <Badge tone="gold">Current</Badge>}
              {period.status === 'upcoming' && <Badge tone="navy">Upcoming</Badge>}
            </div>
            <div className="mt-1 text-xs text-ink-soft">
              {formatDate(period.startDate)} – {formatDate(period.endDate)}
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <span className="font-display text-3xl text-navy-800">{period.applications}</span>
                <span className="text-sm text-ink-soft"> / {period.target}</span>
              </div>
              <span className="text-sm font-semibold text-gold-600">{period.percent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ivory-dark">
              <div className="h-full rounded-full bg-gold-500" style={{ width: `${period.percent}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

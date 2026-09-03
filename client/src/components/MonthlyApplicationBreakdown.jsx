import { Badge, Card, CardHeader } from './ui';
import { formatDate } from './files';

/** Package-month application totals shared by client, employee and admin views. */
export function MonthlyApplicationBreakdown({ months = [], className = '' }) {
  return (
    <Card className={className}>
      <CardHeader
        title="Monthly Application Tracking"
        subtitle="Applications are counted separately from each package-month anniversary"
      />
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

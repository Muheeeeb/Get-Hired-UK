import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardHeader } from './ui';
import { formatDate } from './files';

// Brand hues stepped for chart use: both clear 3:1 on white and stay separable
// under every colour-vision deficiency (validated, worst pair ΔE 24 normal / 19 CVD).
const APPLIED = '#a8861d';
const REMAINING = '#efede6';
const MONTH_BAR = '#2f6bb5';
const CURRENT_BAR = '#a8861d';

function Tile({ label, value, sub, tone = 'navy' }) {
  return (
    <div className="min-w-0 rounded-xl border border-ivory-dark bg-ivory/50 p-4">
      <div className="label-caps text-ink-soft">{label}</div>
      <div className={`mt-1 font-display text-3xl ${tone === 'gold' ? 'text-gold-600' : 'text-navy-800'}`}>
        {value}
      </div>
      {sub && <div className="mt-1 break-words text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  const label = point.name || point.payload?.label;
  // "Remaining to target" is a shortfall, not a count of applications.
  const unit = point.payload?.unit || 'applications';
  return (
    <div className="rounded-lg border border-ivory-dark bg-white px-3 py-2 text-xs shadow-card">
      <div className="font-semibold text-navy-800">{label}</div>
      <div className="text-ink-soft">{point.value} {unit}</div>
    </div>
  );
}

/**
 * Application activity for a client, read entirely from the package months — so
 * when an admin edits a month's dates, every figure and both charts move with it.
 *
 * The donut is a genuine part-to-whole (this month's applications against the
 * monthly target); "today" is deliberately a tile rather than a pie slice,
 * because today sits *inside* this month and would double-count as a segment.
 */
export function ApplicationCharts({ stats, months = [], className = '' }) {
  if (!stats) return null;

  const current = stats.currentMonth;
  const next = stats.nextMonth;
  // Today falls in a deliberate gap between two package months. Nothing logged
  // now counts towards a target, so presenting the next month as if it were
  // running would be a misleading zero.
  const inGap = Boolean(stats.inGap);
  const target = stats.target || 0;
  const applied = current?.applications || 0;
  const remaining = Math.max(0, target - applied);

  const donut = [
    { name: 'Applied', value: applied, fill: APPLIED, unit: 'applications' },
    { name: 'Remaining to target', value: remaining, fill: REMAINING, unit: 'still to go' },
  ];
  const bars = months.map((month) => ({
    label: month.label,
    short: month.label.replace('Month ', 'M'),
    applications: month.applications,
    current: month.status === 'current',
  }));

  return (
    <Card className={`overflow-hidden ${className}`}>
      <CardHeader
        title="Application Activity"
        subtitle="Counted against this client's package months — editing a month's dates updates these charts"
      />

      <div className="grid gap-4 border-b border-ivory-dark p-6 sm:grid-cols-3">
        {/* No date caption: the count is "today" in the business timezone
            (Europe/London), which the browser's clock may disagree with. */}
        <Tile label="Applied today" value={stats.today} tone="gold" sub="Across this client's package" />
        <Tile
          label={inGap ? 'Between package months' : `This month (${current?.label || 'Month 1'})`}
          value={inGap ? '—' : `${applied} / ${target}`}
          sub={current
            ? (inGap
                ? `${current.label} starts ${formatDate(current.startDate)}`
                : `${formatDate(current.startDate)} – ${formatDate(current.endDate)}`)
            : null}
        />
        <Tile
          label={`Next month${next ? ` (${next.label})` : ''}`}
          value={next ? `${next.applications} / ${next.target}` : '—'}
          sub={next
            ? `${formatDate(next.startDate)} – ${formatDate(next.endDate)}`
            : 'No further month — extend the package to add one'}
        />
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-2">
        {/* Part-to-whole: this package month against its target. */}
        <figure className="min-w-0">
          <figcaption className="mb-1 font-semibold text-navy-800">
            {inGap ? 'Next month vs target' : `${current?.label || 'This month'} vs target`}
          </figcaption>
          <p className="mb-3 text-xs text-ink-soft">
            {inGap
              ? `The package is between months — ${current?.label} starts ${formatDate(current?.startDate)}`
              : (current ? `${formatDate(current.startDate)} – ${formatDate(current.endDate)}` : null)}
          </p>
          <div className="relative h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donut}
                  dataKey="value"
                  innerRadius="62%"
                  outerRadius="88%"
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={2}
                  stroke="#ffffff"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {donut.map((slice) => <Cell key={slice.name} fill={slice.fill} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            {/* The headline lives in the hole, so the number is never colour-only. */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-3xl text-navy-800">{current?.percent ?? 0}%</span>
              <span className="text-xs text-ink-soft">{applied} of {target}</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-ink-soft">
            {donut.map((slice) => (
              <span key={slice.name} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-navy-800/10"
                  style={{ background: slice.fill }}
                  aria-hidden="true"
                />
                {slice.name} · <strong className="font-semibold text-navy-800">{slice.value}</strong>
              </span>
            ))}
          </div>
        </figure>

        {/* Comparison across every package month. */}
        <figure className="min-w-0">
          <figcaption className="mb-1 font-semibold text-navy-800">Applications by package month</figcaption>
          <p className="mb-3 text-xs text-ink-soft">
            {months.length} month{months.length === 1 ? '' : 's'} · {stats.total} logged in total
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <XAxis
                  dataKey="short" tickLine={false} axisLine={{ stroke: '#efede6' }}
                  tick={{ fill: '#4b5563', fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false} tickLine={false} axisLine={false}
                  tick={{ fill: '#4b5563', fontSize: 12 }}
                />
                <Tooltip cursor={{ fill: '#f7f6f2' }} content={<ChartTooltip />} />
                <Bar dataKey="applications" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {bars.map((bar) => (
                    <Cell key={bar.label} fill={bar.current ? CURRENT_BAR : MONTH_BAR} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-ink-soft">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CURRENT_BAR }} aria-hidden="true" />
              Current month
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: MONTH_BAR }} aria-hidden="true" />
              Other months
            </span>
          </div>
        </figure>
      </div>
    </Card>
  );
}

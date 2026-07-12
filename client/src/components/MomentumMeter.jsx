/**
 * The Momentum Meter — hero circular progress ring.
 * Gold arc on deep navy, animated fill on load, hero number in the center.
 * Single-series progress: value is direct-labeled (no legend needed).
 */
export function MomentumMeter({ applied, target, alertMode = false }) {
  const size = 260;
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(1, target > 0 ? applied / target : 0);
  const dashOffset = circumference * (1 - pct);
  const arcColor = alertMode ? '#E8791E' : '#C9A227';
  const arcColorLight = alertMode ? '#F09A52' : '#E4C55A';

  return (
    <div className="relative inline-flex items-center justify-center" role="img"
      aria-label={`${applied} of ${target} jobs applied this month (${Math.round(pct * 100)}%)`}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="momentumArc" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={arcColor} />
            <stop offset="100%" stopColor={arcColorLight} />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="rgba(247,246,242,0.12)" strokeWidth={stroke}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="url(#momentumArc)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="ring-animated"
          style={{ '--ring-circumference': circumference }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="font-display text-5xl text-ivory leading-none">
          {applied}
        </div>
        <div className="mt-1.5 text-sm text-ivory/70">of {target} jobs</div>
        <div className={`mt-2 font-semibold text-lg ${alertMode ? 'text-[#F09A52]' : 'text-gold-300'}`}>
          {Math.round(pct * 100)}%
        </div>
      </div>
    </div>
  );
}

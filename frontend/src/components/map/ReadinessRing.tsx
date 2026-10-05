/** Small donut: share of ready / caution / grounded aircraft. Status colours carry meaning only. */
export function ReadinessRing({ ready, caution, grounded, size = 34, active }: { ready: number; caution: number; grounded: number; size?: number; active?: boolean }) {
  const total = Math.max(1, ready + caution + grounded);
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const segs = [
    { n: ready, cls: "stroke-ready" },
    { n: caution, cls: "stroke-caution" },
    { n: grounded, cls: "stroke-grounded" },
  ];
  let offset = 0;
  const pct = Math.round((100 * (ready + caution)) / total);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r + 2.5} className={active ? "fill-accent/20 stroke-accent" : "fill-surface stroke-border"} strokeWidth={1} />
      {segs.map((s, i) => {
        const len = (s.n / total) * c;
        const el = (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            className={s.cls}
            strokeWidth={3.5}
            strokeDasharray={`${Math.max(0, len - 1.2)} ${c}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        offset += len;
        return el;
      })}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-strong" style={{ fontSize: 10, fontWeight: 600 }}>
        {pct}
      </text>
    </svg>
  );
}

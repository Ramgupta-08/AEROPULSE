export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden className="shrink-0">
        <rect width="32" height="32" rx="7" className="fill-raised" />
        <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" fill="none" className="stroke-border" />
        <path d="M6 17h5l2.5-6 4 11 3-8 1.5 3H26" fill="none" className="stroke-accent" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!collapsed && (
        <div className="leading-none">
          <span className="block text-[15px] font-semibold tracking-tight text-strong">AeroPulse</span>
          <span className="mt-0.5 block text-[11px] text-subtle">Fleet readiness</span>
        </div>
      )}
    </div>
  );
}

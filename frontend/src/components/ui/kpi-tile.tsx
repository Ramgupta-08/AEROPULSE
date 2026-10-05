import { animate, useMotionValue, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Sparkline } from "@/components/charts/Sparkline";
import { cn } from "@/lib/utils";

const seen = new Set<string>();

/** Counts up only on first load per KPI id (per session). */
function useCountUp(id: string, value: number, digits: number) {
  const reduce = useReducedMotion();
  const first = useRef(!seen.has(id) && !reduce);
  const mv = useMotionValue(first.current ? 0 : value);
  const [display, setDisplay] = useState(first.current ? 0 : value);
  useEffect(() => {
    seen.add(id);
    if (!first.current) {
      setDisplay(value);
      return;
    }
    first.current = false;
    const c = animate(mv, value, { duration: 0.6, ease: "easeOut", onUpdate: (v) => setDisplay(v) });
    return () => c.stop();
  }, [id, value, mv]);
  return display.toFixed(digits);
}

export function KpiTile({
  id,
  label,
  value,
  digits = 0,
  unit,
  delta,
  deltaUnit = "",
  goodWhen = "up",
  spark,
  tone = "accent",
  hint,
  className,
}: {
  id: string;
  label: string;
  value: number;
  digits?: number;
  unit?: string;
  delta?: number | null;
  deltaUnit?: string;
  goodWhen?: "up" | "down";
  spark?: number[];
  tone?: string;
  hint?: string;
  className?: string;
}) {
  const shown = useCountUp(id, value, digits);
  const good = delta == null || delta === 0 ? null : goodWhen === "up" ? delta > 0 : delta < 0;
  const DeltaIcon = delta == null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={cn("card flex min-w-0 flex-col justify-between gap-2 p-4", className)} title={hint}>
      <p className="label truncate">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1">
          <span className="text-2xl font-semibold tracking-tight text-strong tnum">{shown}</span>
          {unit && <span className="shrink-0 text-sm text-subtle">{unit}</span>}
        </div>
        {spark && spark.length > 1 && (
          <div className="mb-1 w-16 min-w-0 shrink">
            <Sparkline data={spark} tone={tone} ariaLabel={`${label} trend`} height={26} />
          </div>
        )}
      </div>
      {delta != null ? (
        <span
          className={cn("inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium tnum", good === null ? "text-subtle" : good ? "text-ready" : "text-grounded")}
          aria-label={`Change versus last week ${delta}${deltaUnit}`}
        >
          <DeltaIcon size={13} strokeWidth={2} aria-hidden />
          {Math.abs(delta).toFixed(digits === 0 && Number.isInteger(delta) ? 0 : 1)}
          {deltaUnit}
          <span className="ml-1 font-normal text-subtle">vs last week</span>
        </span>
      ) : (
        <span className="text-xs text-subtle">&nbsp;</span>
      )}
    </div>
  );
}

import { Layers, Lock, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/format";
import type { PlanBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Bay {
  id: string;
  base_id: string;
  base_name: string;
  name: string;
}
export interface TimelineMission {
  id: string;
  name: string;
  start_day: number;
  end_day: number;
  base_id: string;
  scope: string;
  required: number;
  priority: number;
}

const LABEL_W = 148;
const ROW_H = 40;
const MIN_DAY_W = 32;

/**
 * Lightweight custom Gantt: rows = hangar bays grouped by base, columns = days.
 * Blocks can be dragged horizontally (day) and vertically (bay within the same base).
 */
export function Timeline({
  dates,
  bays,
  blocks,
  missions,
  focus,
  onSelect,
  onMove,
  canEdit,
}: {
  dates: string[];
  bays: Bay[];
  blocks: (PlanBlock & { late_days?: number })[];
  missions: TimelineMission[];
  focus?: string | null;
  onSelect: (b: PlanBlock) => void;
  onMove: (b: PlanBlock, startDay: number, bayId: string) => void;
  canEdit: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [dayW, setDayW] = useState(MIN_DAY_W);
  const [drag, setDrag] = useState<{ id: number; dx: number; dy: number; x0: number; y0: number } | null>(null);
  const H = dates.length;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDayW(Math.max(MIN_DAY_W, Math.floor((el.clientWidth - LABEL_W) / H))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [H]);

  const groups = useMemo(() => {
    const g: { base_id: string; base_name: string; bays: Bay[] }[] = [];
    for (const b of bays) {
      const last = g[g.length - 1];
      if (last && last.base_id === b.base_id) last.bays.push(b);
      else g.push({ base_id: b.base_id, base_name: b.base_name, bays: [b] });
    }
    return g;
  }, [bays]);

  useEffect(() => {
    if (!focus) return;
    const el = wrap.current?.querySelector(`[data-tail="${focus}"]`);
    el?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [focus, blocks]);

  const width = LABEL_W + H * dayW;
  const fleetMissions = missions.filter((m) => m.scope === "fleet");

  const endDrag = (b: PlanBlock, bayIds: string[]) => {
    if (!drag || drag.id !== b.id) return;
    const dd = Math.round(drag.dx / dayW);
    const dr = Math.round(drag.dy / ROW_H);
    const idx = bayIds.indexOf(b.bay_id);
    const bay = bayIds[Math.max(0, Math.min(bayIds.length - 1, idx + dr))];
    setDrag(null);
    if (dd !== 0 || bay !== b.bay_id) onMove(b, Math.max(0, Math.min(H - 1, b.start_day + dd)), bay);
  };

  return (
    <div ref={wrap} className="overflow-x-auto" role="grid" aria-label="Maintenance plan timeline">
      <div style={{ width }} className="relative select-none">
        {/* Date header */}
        <div className="sticky top-0 z-20 flex border-b border-border bg-surface" style={{ height: 44 }}>
          <div style={{ width: LABEL_W }} className="label flex shrink-0 items-end px-3 pb-2">
            Bay / day
          </div>
          {dates.map((d, i) => {
            const dt = new Date(d + "T00:00:00");
            const weekend = dt.getDay() === 0 || dt.getDay() === 6;
            return (
              <div key={d} style={{ width: dayW }} className={cn("flex shrink-0 flex-col items-center justify-end pb-1.5 text-[11px] leading-tight", weekend ? "text-subtle/70" : "text-subtle")}>
                {(i === 0 || dt.getDate() === 1) && <span className="font-medium text-body">{dt.toLocaleDateString("en-GB", { month: "short" })}</span>}
                <span className={cn("tnum", i === 0 && "font-semibold text-accent")}>{dt.getDate()}</span>
              </div>
            );
          })}
        </div>
        {/* Fleet-wide missions */}
        {fleetMissions.length > 0 && (
          <div className="relative flex border-b border-border bg-bg/40" style={{ height: 30 }}>
            <div style={{ width: LABEL_W }} className="flex shrink-0 items-center px-3 text-xs text-subtle">
              Fleet missions
            </div>
            {fleetMissions.map((m) => (
              <div
                key={m.id}
                title={`${m.name}: ${m.required} aircraft required`}
                className="absolute top-1 flex h-[22px] items-center truncate rounded-md border border-grounded/40 bg-grounded/12 px-2 text-[11px] font-medium text-strong"
                style={{ left: LABEL_W + Math.max(0, m.start_day) * dayW + 1, width: (Math.min(H - 1, m.end_day) - Math.max(0, m.start_day) + 1) * dayW - 2 }}
              >
                {m.name} · {m.required}
              </div>
            ))}
          </div>
        )}
        {groups.map((g) => {
          const bayIds = g.bays.map((b) => b.id);
          const baseMissions = missions.filter((m) => m.scope === "base" && m.base_id === g.base_id && m.end_day - m.start_day < 20);
          return (
            <div key={g.base_id} className="border-b border-border">
              <div className="relative flex bg-raised/40" style={{ height: 26 }}>
                <div style={{ width: LABEL_W }} className="flex shrink-0 items-center px-3 text-xs font-semibold text-strong">
                  {g.base_name}
                </div>
                {baseMissions.map((m) => (
                  <div
                    key={m.id}
                    title={`${m.name}: ${m.required} required`}
                    className="absolute top-[4px] flex h-[18px] items-center truncate rounded border border-caution/40 bg-caution/12 px-1.5 text-[10px] font-medium text-body"
                    style={{ left: LABEL_W + Math.max(0, m.start_day) * dayW + 1, width: Math.max(dayW - 2, (Math.min(H - 1, m.end_day) - Math.max(0, m.start_day) + 1) * dayW - 2) }}
                  >
                    {m.name}
                  </div>
                ))}
              </div>
              {g.bays.map((bay) => (
                <div key={bay.id} className="relative flex border-t border-border/50" style={{ height: ROW_H }} role="row">
                  <div style={{ width: LABEL_W }} className="flex shrink-0 items-center px-3 text-xs text-subtle" role="rowheader">
                    {bay.name.replace(g.base_name + " ", "")}
                  </div>
                  {dates.map((d, i) => (
                    <div key={d} style={{ width: dayW }} className={cn("h-full shrink-0 border-l border-border/30", i === 0 && "bg-accent/5")} />
                  ))}
                  {blocks
                    .filter((b) => b.bay_id === bay.id && b.start_day < H)
                    .map((b) => {
                      const isDrag = drag?.id === b.id;
                      const grounded = b.tasks.some((t) => t.source === "work-order");
                      const late = (b.late_days ?? 0) > 0;
                      const focused = focus === b.tail;
                      const w = Math.min(b.duration_days, H - b.start_day) * dayW - 4;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          data-tail={b.tail}
                          aria-label={`${b.tail}, ${b.tasks.length} task${b.tasks.length > 1 ? "s" : ""}, day ${b.start_day} for ${b.duration_days} days${b.locked ? ", in progress" : ""}`}
                          onClick={() => !isDrag && onSelect(b)}
                          onPointerDown={(e) => {
                            if (!canEdit || b.locked) return;
                            (e.target as HTMLElement).setPointerCapture(e.pointerId);
                            setDrag({ id: b.id, dx: 0, dy: 0, x0: e.clientX, y0: e.clientY });
                          }}
                          onPointerMove={(e) => isDrag && drag && setDrag({ ...drag, dx: e.clientX - drag.x0, dy: e.clientY - drag.y0 })}
                          onPointerUp={() => {
                            if (isDrag && drag && Math.abs(drag.dx) < 4 && Math.abs(drag.dy) < 4) {
                              setDrag(null);
                              onSelect(b);
                            } else endDrag(b, bayIds);
                          }}
                          className={cn(
                            "absolute top-1 z-10 flex h-8 items-center gap-1 overflow-hidden rounded-md border px-1.5 text-left text-[11px] transition-shadow",
                            grounded ? "border-grounded/50 bg-grounded/15" : "border-accent/50 bg-accent/15",
                            late && "border-caution ring-1 ring-caution",
                            focused && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
                            canEdit && !b.locked ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                            isDrag && "z-30 opacity-90 shadow-lg",
                          )}
                          style={{ left: LABEL_W + b.start_day * dayW + 2, width: Math.max(w, dayW - 4), transform: isDrag ? `translate(${drag!.dx}px, ${drag!.dy}px)` : undefined }}
                          title={`${b.tail} · ${b.tasks.map((t) => t.title).join(" · ")}`}
                        >
                          {b.locked && <Lock size={11} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />}
                          {late && <TriangleAlert size={11} strokeWidth={2} className="shrink-0 text-caution" aria-hidden />}
                          <span className="whitespace-nowrap font-mono font-semibold text-strong">{b.tail}</span>
                          {b.bundled_count > 0 && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface/70 px-1 text-[10px] text-body">
                              <Layers size={10} strokeWidth={2} aria-hidden />
                              {b.tasks.length}
                            </span>
                          )}
                          {w > 120 && <span className="truncate text-body">{b.tasks[0]?.title}</span>}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          );
        })}
        <p className="px-3 py-2 text-[11px] text-subtle">
          {fmt.date(dates[0])} – {fmt.date(dates[dates.length - 1])} · red blocks: aircraft already on the ground · blue: planned visits · stacked-layers badge: bundled tasks
        </p>
      </div>
    </div>
  );
}

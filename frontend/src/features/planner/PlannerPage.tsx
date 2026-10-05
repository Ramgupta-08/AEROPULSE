import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Cpu, Layers, Package, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Timeline, type Bay, type TimelineMission } from "@/components/timeline/Timeline";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Modal } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { addDays, fmt } from "@/lib/format";
import { useMeta } from "@/lib/queries";
import type { Compare, PlanBlock, PlanMeta } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ComparePanel } from "./ComparePanel";

interface Schedule {
  as_of: string;
  horizon_days: number;
  dates: string[];
  plan: PlanMeta | null;
  bays: Bay[];
  blocks: (PlanBlock & { late_days?: number })[];
  missions: TimelineMission[];
  pending_tasks: { id: string; tail: string; base_id: string; title: string; source: string; due_day: number; part_source: string; earliest_day: number }[];
}
interface Issue {
  level: "error" | "warning";
  type: string;
  message: string;
}

export default function PlannerPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const focus = params.get("focus");
  const { data: meta } = useMeta();
  const canEdit = !!meta?.role.areas.includes("schedule_write");
  const [missionAware, setMissionAware] = useState(true);
  const [window, setWindow] = useState("20");
  const [selected, setSelected] = useState<PlanBlock | null>(null);
  const [conflict, setConflict] = useState<{ block: PlanBlock; start: number; bay: string; issues: Issue[] } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const { data: sched } = useQuery({ queryKey: ["schedule"], queryFn: () => api.get<Schedule>("/api/schedule") });
  const { data: cmp } = useQuery({ queryKey: ["compare"], queryFn: () => api.get<Compare>("/api/schedule/compare"), enabled: !!sched?.plan });

  const refresh = () => {
    for (const k of ["schedule", "compare", "forecast", "alerts", "missions", "kpi", "aircraft"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const opt = useMutation({
    mutationFn: () => api.post<{ plan: PlanMeta }>("/api/schedule/optimise", undefined, { mission_aware: missionAware, bundling_window_days: Number(window) }),
    onSuccess: (r) => {
      refresh();
      const b = r.plan.bundling;
      toast.success(`Plan optimised · ${r.plan.status.toLowerCase()} in ${r.plan.solve_seconds.toFixed(1)} s`, `${b.visits} visits, ${b.bundled_tasks} tasks bundled, ${r.plan.late_visits} deadline risks.`);
    },
    onError: (e) => toast.error("Optimisation failed", String(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.post("/api/schedule/reset"),
    onSuccess: () => {
      refresh();
      toast.info("Plan cleared", "Forecasts now show the reactive baseline.");
    },
  });
  const move = useMutation({
    mutationFn: (v: { block: PlanBlock; start: number; bay: string; force?: boolean }) =>
      api.patch<{ applied: boolean; issues: Issue[] }>(`/api/schedule/${v.block.id}`, { start_day: v.start, bay_id: v.bay, force: !!v.force }),
    onSuccess: (r, v) => {
      if (r.applied) {
        refresh();
        setConflict(null);
        const warn = r.issues.filter((i) => i.level === "warning");
        if (warn.length) toast.info(`${v.block.tail} moved — check impact`, warn.map((w) => w.message).join(" "));
        else if (r.issues.length) toast.info(`${v.block.tail} moved with overrides`, "The change is recorded in the audit chain.");
        else toast.success(`${v.block.tail} moved to day ${v.start}`, "All constraints satisfied.");
      } else setConflict({ block: v.block, start: v.start, bay: v.bay, issues: r.issues });
    },
    onError: (e) => toast.error("Move failed", String(e)),
  });

  const plan = sched?.plan;
  const focusBlock = focus ? sched?.blocks.find((b) => b.tail === focus) : undefined;

  return (
    <>
      <PageHeader
        title="Maintenance Planner"
        description="Readiness-first schedule from OR-Tools CP-SAT: hangar bays, technician hours, spares and P10 deadlines, with mission-aware placement and opportunistic bundling."
        actions={
          canEdit && (
            <>
              <Switch id="ma" checked={missionAware} onChange={setMissionAware} label="Mission-aware" />
              <Select
                ariaLabel="Bundling window"
                value={window}
                onChange={setWindow}
                className="w-[160px]"
                icon={<Layers size={14} strokeWidth={1.75} className="text-subtle" aria-hidden />}
                options={[
                  { value: "0", label: "No bundling" },
                  { value: "10", label: "Bundle ≤ 10 d" },
                  { value: "20", label: "Bundle ≤ 20 d" },
                  { value: "30", label: "Bundle ≤ 30 d" },
                ]}
              />
              {plan && (
                <Button variant="ghost" onClick={() => setConfirmReset(true)}>
                  <RotateCcw size={14} strokeWidth={1.75} /> Reset
                </Button>
              )}
              <Button variant="primary" onClick={() => opt.mutate()} disabled={opt.isPending} data-tour="optimise">
                <Sparkles size={14} strokeWidth={1.75} /> {opt.isPending ? "Optimising…" : plan ? "Re-optimise" : "Optimise plan"}
              </Button>
            </>
          )
        }
      />

      {!sched ? (
        <Skeleton className="h-[420px]" />
      ) : (
        <div className="space-y-4">
          {plan ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="card flex items-start gap-3 p-4">
                <Cpu size={18} strokeWidth={1.75} className="mt-0.5 text-accent" aria-hidden />
                <div className="min-w-0 text-sm">
                  <p className="text-strong">
                    Solver {plan.status.toLowerCase()} in {plan.solve_seconds.toFixed(2)} s
                  </p>
                  <p className="text-subtle">
                    Objective {fmt.int(plan.objective)} · min {plan.min_mc} aircraft/day · {plan.mission_aware ? "mission-aware" : "readiness only"}
                  </p>
                </div>
              </div>
              <div className="card flex items-start gap-3 p-4" data-tour="bundling">
                <Layers size={18} strokeWidth={1.75} className="mt-0.5 text-accent" aria-hidden />
                <div className="min-w-0 text-sm">
                  <p className="text-strong">
                    Bundled: {plan.bundling.bundled_tasks} tasks, saved {plan.bundling.groundings_saved} groundings
                  </p>
                  <p className="text-subtle">{fmt.int(plan.bundling.downtime_avoided_hours)} aircraft-hours of downtime avoided · window {plan.bundling.window_days} d</p>
                </div>
              </div>
              <div className="card flex items-start gap-3 p-4">
                <CalendarRange size={18} strokeWidth={1.75} className="mt-0.5 text-accent" aria-hidden />
                <div className="min-w-0 text-sm">
                  <p className="text-strong">{sched.blocks.length} hangar visits planned</p>
                  <p className="text-subtle">
                    {plan.late_visits ? `${plan.late_visits} visit(s) start after a P10 point` : "Every task before its P10 failure point"}
                  </p>
                </div>
              </div>
              <div className="card flex items-start gap-3 p-4">
                <Package size={18} strokeWidth={1.75} className="mt-0.5 text-accent" aria-hidden />
                <div className="min-w-0 text-sm">
                  <p className="text-strong">Spares pre-positioned</p>
                  <p className="text-subtle">
                    Inter-base transfers used where faster than ordering ·{" "}
                    <Link to="/spares" className="text-accent hover:underline">
                      see Spares
                    </Link>
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <Card>
              <EmptyState
                icon={CalendarRange}
                title={focus ? `No plan yet — optimise to schedule ${focus}` : "No optimised plan yet"}
                description={`${sched.pending_tasks.length} tasks are waiting: open work orders, predicted failures and life-limit items in the next 30 days. The forecast currently assumes reactive maintenance.`}
                action={
                  canEdit ? (
                    <Button variant="primary" onClick={() => opt.mutate()} disabled={opt.isPending}>
                      <Sparkles size={14} strokeWidth={1.75} /> {opt.isPending ? "Optimising…" : "Optimise (mission-aware + bundling)"}
                    </Button>
                  ) : (
                    <p className="text-sm text-subtle">An Engineering Officer can run the optimiser.</p>
                  )
                }
              />
            </Card>
          )}

          {focusBlock && (
            <div className="flex flex-wrap items-center gap-3 rounded-card border border-accent/40 bg-accent/8 px-4 py-3 text-sm">
              <StatusPill tone="info" label={`Focus ${focusBlock.tail}`} />
              <span className="text-body">
                Visit day {focusBlock.start_day}–{focusBlock.start_day + focusBlock.duration_days - 1} ({fmt.shortDate(addDays(sched.as_of, focusBlock.start_day))}) in{" "}
                {sched.bays.find((b) => b.id === focusBlock.bay_id)?.name}: {focusBlock.tasks.map((t) => t.title).join(" · ")}
              </span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(focusBlock)}>
                Details
              </Button>
            </div>
          )}

          {cmp?.aeropulse && <ComparePanel data={cmp} />}

          {plan && (
            <Card>
              <CardHeader
                title="Hangar timeline · next 30 days"
                subtitle={canEdit ? "Drag a visit to another day or bay — constraints are re-validated on drop" : "Read-only for your role"}
              />
              <Timeline
                dates={sched.dates}
                bays={sched.bays}
                blocks={sched.blocks}
                missions={sched.missions}
                focus={focus}
                onSelect={setSelected}
                onMove={(b, start, bay) => move.mutate({ block: b, start, bay })}
                canEdit={canEdit}
              />
            </Card>
          )}
        </div>
      )}

      <Drawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected ? `${selected.tail} · hangar visit` : ""}
        subtitle={selected && sched ? `${sched.bays.find((b) => b.id === selected.bay_id)?.name} · day ${selected.start_day}–${selected.start_day + selected.duration_days - 1} · ${selected.duration_days} days` : undefined}
        width="max-w-[520px]"
        footer={
          selected && (
            <Button asChild variant="secondary" className="w-full">
              <Link to={`/aircraft/${selected.tail}`}>Open aircraft</Link>
            </Button>
          )
        }
      >
        {selected && (
          <div className="space-y-3">
            {selected.bundled_count > 0 && (
              <p className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-sm text-body">
                <Layers size={15} strokeWidth={1.75} className="text-accent" aria-hidden /> {selected.tasks.length} tasks in one visit — {selected.bundled_count} pulled in by bundling instead
                of separate groundings.
              </p>
            )}
            {selected.locked && <p className="text-sm text-subtle">Work is in progress; this visit is locked at day 0.</p>}
            <ul className="space-y-2">
              {selected.tasks.map((t) => (
                <li key={t.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-strong">{t.title}</p>
                    {Boolean(t.bundled) && <StatusPill tone="info" label="Bundled" />}
                  </div>
                  <p className="mt-1 text-xs text-subtle">
                    {t.source === "work-order" ? "Open work order" : t.source === "predicted" ? `Predicted · P10 day ${Number(t.p10_day).toFixed(0)}, P50 day ${Number(t.p50_day).toFixed(0)}` : t.source === "life-limit" ? `Life-limit due day ${t.due_day}` : "Scenario"}
                    {t.trade ? ` · ${t.trade} trade` : ""}
                    {t.man_hours ? ` · ${t.man_hours} man-hours` : ""}
                  </p>
                  {Boolean(t.part_number) && (
                    <p className="mt-1 text-xs text-subtle">
                      Part <span className="font-mono text-body">{String(t.part_number)}</span> · {String(t.part_source)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Drawer>

      <Modal open={!!conflict} onOpenChange={(o) => !o && setConflict(null)} title="Move breaks constraints" description={conflict ? `${conflict.block.tail} → day ${conflict.start} (${conflict.bay})` : undefined}>
        {conflict && (
          <div className="space-y-4">
            <ul className="space-y-2">
              {conflict.issues.map((i) => (
                <li key={i.message} className="flex gap-2 text-sm">
                  <TriangleAlert size={15} strokeWidth={1.75} className={cn("mt-0.5 shrink-0", i.level === "error" ? "text-grounded" : "text-caution")} aria-hidden />
                  <span className="text-body">
                    <b className="font-medium text-strong">{i.level === "error" ? "Conflict" : "Impact"}:</b> {i.message}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConflict(null)}>
                Keep original
              </Button>
              {!conflict.issues.some((i) => i.type === "locked") && (
                <Button variant="danger" onClick={() => move.mutate({ block: conflict.block, start: conflict.start, bay: conflict.bay, force: true })}>
                  Apply anyway
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Clear the optimised plan?"
        description="All planned visits are removed and forecasts fall back to the reactive baseline. The reset is recorded in the audit chain."
        confirmLabel="Clear plan"
        destructive
        onConfirm={() => reset.mutate()}
      />
    </>
  );
}

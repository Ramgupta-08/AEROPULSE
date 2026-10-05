import { useQuery } from "@tanstack/react-query";
import { CalendarDays, List, ShieldCheck, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StatusPill, type Tone } from "@/components/ui/status-pill";
import { api } from "@/lib/api";
import { addDays, fmt } from "@/lib/format";
import { useMissions } from "@/lib/queries";
import type { MissionRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HealthBar } from "@/features/fleet/FleetPage";

interface Coverage {
  mission: { id: string; name: string; required: number; start_date: string; end_date: string; aircraft_type: string; base_id: string; scope: string };
  available: number;
  supportable: boolean;
  candidates: { tail: string; base_id: string; status: "ready" | "caution" | "grounded"; health: number; conflicts: unknown[] }[];
  blocked: { tail: string; base_id: string; status: "ready" | "caution" | "grounded"; health: number; conflicts: { start_day: number; end_day: number; reason: string }[] }[];
  movable_maintenance: { tail: string; block_id: number; start_day: number; duration_days: number; locked: boolean; can_move_before: boolean; can_defer_after: boolean; tasks: string[] }[];
}

function tone(m: MissionRow): Tone {
  return m.status === "info" ? "neutral" : m.status;
}
function statusLabel(m: MissionRow) {
  if (m.status === "info") return "Beyond forecast";
  if (m.shortfall) return `${m.shortfall} short`;
  return m.status === "caution" ? "No margin" : "Covered";
}

const DAYS = 60;

function LaneCalendar({ rows, asOf, onOpen }: { rows: MissionRow[]; asOf: string; onOpen: (m: MissionRow) => void }) {
  const weeks = Array.from({ length: DAYS / 7 + 1 }, (_, i) => i * 7);
  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-[760px] px-4 pb-4">
        <div className="relative ml-[200px] h-8 border-b border-border">
          {weeks.map((d) => (
            <span key={d} className="absolute bottom-1 -translate-x-1/2 text-[11px] text-subtle" style={{ left: `${(100 * d) / DAYS}%` }}>
              {fmt.shortDate(addDays(asOf, d))}
            </span>
          ))}
          <span className="absolute bottom-0 top-0 w-px bg-accent" style={{ left: "0%" }} aria-hidden />
          <span className="absolute bottom-0 top-0 border-l border-dashed border-border-strong" style={{ left: `${(100 * 30) / DAYS}%` }} title="End of 30-day forecast" />
        </div>
        <ul>
          {rows.map((m) => {
            const s = Math.max(0, m.start_day);
            const e = Math.min(DAYS - 1, m.end_day);
            return (
              <li key={m.id} className="flex h-9 items-center border-b border-border/50">
                <button type="button" onClick={() => onOpen(m)} className="w-[200px] shrink-0 truncate pr-3 text-left text-sm text-body hover:text-strong">
                  {m.name}
                </button>
                <div className="relative h-full flex-1">
                  {weeks.map((d) => (
                    <span key={d} className="absolute inset-y-0 w-px bg-border/40" style={{ left: `${(100 * d) / DAYS}%` }} aria-hidden />
                  ))}
                  <button
                    type="button"
                    onClick={() => onOpen(m)}
                    className={cn(
                      "absolute top-1.5 flex h-6 items-center gap-1 overflow-hidden rounded-md border px-1.5 text-[11px] font-medium text-strong",
                      m.status === "grounded" ? "border-grounded/50 bg-grounded/15" : m.status === "caution" ? "border-caution/50 bg-caution/15" : m.status === "ready" ? "border-ready/50 bg-ready/12" : "border-border bg-raised",
                    )}
                    style={{ left: `${(100 * s) / DAYS}%`, width: `max(${(100 * (e - s + 1)) / DAYS}%, 22px)` }}
                    title={`${m.name} · ${m.required} × ${m.aircraft_type} · ${statusLabel(m)}`}
                  >
                    <span className="whitespace-nowrap">{m.required}×</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-subtle">Bars coloured by coverage from the readiness forecast · dashed line = end of 30-day forecast</p>
      </div>
    </div>
  );
}

const columns: Column<MissionRow>[] = [
  { key: "name", header: "Mission", cell: (m) => <span className="font-medium text-strong">{m.name}</span>, sortValue: (m) => m.name },
  { key: "when", header: "When", cell: (m) => `${fmt.shortDate(m.start_date)} – ${fmt.shortDate(m.end_date)}`, sortValue: (m) => m.start_day },
  { key: "where", header: "Where", cell: (m) => (m.scope === "fleet" ? "Fleet-wide" : m.base_name), sortValue: (m) => m.base_name, hideBelow: "md" },
  { key: "need", header: "Required", cell: (m) => `${m.required} × ${m.aircraft_type}`, sortValue: (m) => m.required, hideBelow: "sm" },
  { key: "prio", header: "Priority", cell: (m) => ["", "Critical", "High", "Routine"][m.priority], sortValue: (m) => m.priority, hideBelow: "lg" },
  { key: "avail", header: "Available", cell: (m) => (m.available == null ? "—" : m.available), sortValue: (m) => m.available ?? 999, align: "right", hideBelow: "md" },
  { key: "status", header: "Coverage", cell: (m) => <StatusPill tone={tone(m)} label={statusLabel(m)} />, sortValue: (m) => m.shortfall ?? -1 },
];

function CoverageDrawer({ mission, onClose }: { mission: MissionRow | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["coverage", mission?.id],
    queryFn: () => api.get<Coverage>(`/api/missions/${mission!.id}/coverage`),
    enabled: !!mission,
  });
  return (
    <Drawer
      open={!!mission}
      onOpenChange={(o) => !o && onClose()}
      title={mission?.name ?? ""}
      subtitle={mission ? `${mission.required} × ${mission.aircraft_type} · ${mission.scope === "fleet" ? "fleet-wide" : mission.base_name} · ${fmt.date(mission.start_date)} – ${fmt.date(mission.end_date)}` : undefined}
      width="max-w-[560px]"
      footer={
        <Button asChild variant="primary" className="w-full">
          <Link to="/planner">Adjust maintenance in the Planner</Link>
        </Button>
      }
    >
      {isLoading || !data ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="space-y-5">
          <div className={cn("flex items-start gap-3 rounded-lg border p-3", data.supportable ? "border-ready/40 bg-ready/8" : "border-grounded/40 bg-grounded/8")}>
            <ShieldCheck size={18} strokeWidth={1.75} className={data.supportable ? "text-ready" : "text-grounded"} aria-hidden />
            <div>
              <p className="text-md font-semibold text-strong">{data.supportable ? "Yes — this mission can be supported" : "Not with the current plan"}</p>
              <p className="text-sm text-body">
                {data.available} of {data.mission.required} required aircraft are mission-capable for the whole window.
                {!data.supportable && " Optimise the plan or move the maintenance listed below."}
              </p>
            </div>
          </div>
          {data.movable_maintenance.length > 0 && (
            <section>
              <h3 className="label mb-2">Maintenance overlapping the mission</h3>
              <ul className="space-y-2">
                {data.movable_maintenance.map((m) => (
                  <li key={m.block_id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="text-strong">
                      <span className="font-mono">{m.tail}</span> · day {m.start_day}–{m.start_day + m.duration_days - 1}
                    </p>
                    <p className="text-subtle">{m.tasks.join(" · ")}</p>
                    <p className="mt-1 text-body">{m.locked
                        ? "Work already in progress — the aircraft returns after the mission window."
                        : m.can_move_before
                          ? "Can be pulled before the mission."
                          : m.can_defer_after
                            ? "Can be deferred after the mission."
                            : "Cannot move without breaching a P10 deadline."}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="label mb-2">Available aircraft · {data.candidates.length}</h3>
            <ul className="grid grid-cols-2 gap-2">
              {data.candidates.map((c) => (
                <li key={c.tail} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
                  <Link to={`/aircraft/${c.tail}`} className="font-mono text-sm text-strong hover:text-accent">
                    {c.tail}
                  </Link>
                  <HealthBar value={c.health} />
                </li>
              ))}
            </ul>
          </section>
          {data.blocked.length > 0 && (
            <section>
              <h3 className="label mb-2">Unavailable · {data.blocked.length}</h3>
              <ul className="space-y-1.5">
                {data.blocked.map((c) => (
                  <li key={c.tail} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link to={`/aircraft/${c.tail}`} className="font-mono text-strong hover:text-accent">
                      {c.tail}
                    </Link>
                    <span className="text-subtle">{c.conflicts.map((x) => `${x.reason === "planned" ? "planned maintenance" : x.reason} (day ${x.start_day}–${x.end_day - 1})`).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

export default function MissionsPage() {
  const { data } = useMissions();
  const [params] = useSearchParams();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [open, setOpen] = useState<MissionRow | null>(null);
  const rows = [...(data?.missions ?? [])].filter((m) => m.end_day >= 0).sort((a, b) => a.start_day - b.start_day || a.priority - b.priority);
  const focus = params.get("focus");
  useEffect(() => {
    if (focus && data) setOpen(data.missions.find((m) => m.id === focus) ?? null);
  }, [focus, data]);
  const short = rows.filter((m) => (m.shortfall ?? 0) > 0).length;
  const asOf = rows.length ? addDays(rows[0].start_date, -rows[0].start_day) : "";

  return (
    <>
      <PageHeader
        title="Missions"
        description={data ? `${rows.length} missions and exercises in the next 60 days · ${short} short of aircraft under the ${data.plan === "aeropulse" ? "AeroPulse plan" : "reactive baseline"}` : "Loading"}
        actions={
          <Segmented
            ariaLabel="View"
            value={view}
            onChange={setView}
            options={[
              { value: "calendar", label: <CalendarDays size={14} strokeWidth={1.75} />, title: "Calendar" },
              { value: "list", label: <List size={14} strokeWidth={1.75} />, title: "List" },
            ]}
          />
        }
      />
      <Card>
        <CardHeader title={view === "calendar" ? "60-day mission calendar" : "All missions"} subtitle="Select a mission for “Can we support this mission?”" />
        {!data ? (
          <SkeletonRows rows={10} className="p-4" />
        ) : view === "calendar" ? (
          <LaneCalendar rows={rows} asOf={asOf} onOpen={setOpen} />
        ) : (
          <DataTable ariaLabel="Missions" rows={rows} columns={columns} rowKey={(m) => m.id} onRowClick={setOpen} empty={<p className="p-6 text-sm text-subtle">No missions.</p>} />
        )}
      </Card>
      <p className="mt-3 flex items-center gap-2 text-xs text-subtle">
        <Target size={13} strokeWidth={1.75} aria-hidden /> Mission names are fictional; all fleet data is simulated.
      </p>
      <CoverageDrawer mission={open} onClose={() => setOpen(null)} />
    </>
  );
}

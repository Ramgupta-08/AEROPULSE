import * as Slider from "@radix-ui/react-slider";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarRange, History, Plane, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { COMPONENT_TONE_LABEL, StatusPill, toneForHealth } from "@/components/ui/status-pill";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useAircraft } from "@/lib/queries";
import type { ComponentBrief } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HealthBar } from "@/features/fleet/FleetPage";
import { ComponentDrawer, RecordItem } from "./ComponentDrawer";
import { TelemetryPanel } from "./TelemetryPanel";
import { TwinSvg } from "./TwinSvg";

interface Series {
  offsets: number[];
  aircraft: number[];
  components: Record<string, number[]>;
}

function Stat({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className={cn("mt-1 truncate text-base text-strong tnum", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

function remaining(c: ComponentBrief) {
  if (c.failed) return "failed";
  return c.rul_unit === "sorties" ? `${c.p50.toFixed(0)} sorties` : `${c.p50_days.toFixed(0)} d`;
}

export default function AircraftPage() {
  const { tail = "" } = useParams();
  const navigate = useNavigate();
  const { data: a, isLoading, error } = useAircraft(tail);
  const { data: series } = useQuery({ queryKey: ["twin-series", tail], queryFn: () => api.get<Series>(`/api/aircraft/${tail}/twin/series`), enabled: !!a });
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  // Recolour the twin from the precomputed health series as the slider moves.
  const timeline = useMemo(() => {
    if (!a) return null;
    if (!series || offset === 0) return { components: a.components, health: a.health };
    const i = series.offsets.indexOf(offset);
    if (i < 0) return { components: a.components, health: a.health };
    const comps = a.components.map((c) => {
      const h = series.components[String(c.id)]?.[i] ?? c.health;
      return { ...c, health: h, tone: toneForHealth(h) as ComponentBrief["tone"], failed: h <= 0 };
    });
    return { components: comps, health: series.aircraft[i] };
  }, [a, series, offset]);

  if (error)
    return (
      <div className="card">
        <EmptyState icon={Plane} title={`Aircraft ${tail} not found`} description="Check the tail number or pick an aircraft from the Fleet list." action={<Button asChild variant="primary"><Link to="/fleet">Go to Fleet</Link></Button>} />
      </div>
    );
  if (isLoading || !a || !timeline)
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-28" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[520px]" />
          <SkeletonRows rows={10} />
        </div>
      </div>
    );

  const engines = a.components.filter((c) => c.kind === "engine").length;
  const sorted = [...timeline.components].sort((x, y) => x.health - y.health);

  return (
    <>
      <div className="mb-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} strokeWidth={1.75} /> Back
        </Button>
      </div>
      <PageHeader
        title={`${a.tail}`}
        description={`${a.type} · ${a.squadron} · ${a.base_name} (${a.environment}) · ${a.sortie_profile.replace(/-/g, " ")} profile`}
        actions={
          <>
            <StatusPill tone={a.status} label={a.status === "ready" ? "Ready" : a.status === "caution" ? "Caution" : "Grounded"} />
            <Button asChild variant="secondary">
              <Link to={`/planner?focus=${a.tail}`}>
                <CalendarRange size={14} strokeWidth={1.75} /> Plan maintenance
              </Link>
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div className="min-w-0">
            <dt className="label">Health score</dt>
            <dd className="mt-1">
              <HealthBar value={a.health} />
            </dd>
          </div>
          <Stat label="Total hours" value={fmt.int(a.total_hours)} />
          <Stat label="Total cycles" value={fmt.int(a.total_cycles)} />
          <Stat label="Sortie rate" value={`${a.sorties_per_day} / day`} />
          <Stat label="In service since" value={fmt.date(a.entered_service)} />
          <Stat label="Status" value={a.status_reason || "Serviceable"} />
        </dl>
        {a.work_order && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-grounded/30 bg-grounded/8 px-3 py-2 text-sm">
            <Wrench size={15} strokeWidth={1.75} className="text-grounded" aria-hidden />
            <span className="text-strong">{a.work_order.title}</span>
            <span className="text-subtle">
              {a.work_order.status.replace("-", " ")} · opened {fmt.date(a.work_order.opened_on)} · {a.work_order.remaining_days} days of work remaining
              {a.work_order.part_number ? ` · needs ${a.work_order.part_number}` : ""}
            </span>
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="flex flex-col" data-tour="twin">
          <CardHeader
            title="Digital twin"
            subtitle={offset === 0 ? "Today — component zones coloured by health; select one for details" : `${offset < 0 ? "History" : "Prediction, no maintenance"} · ${offset > 0 ? "+" : ""}${offset} days`}
            actions={<span className="text-sm text-subtle tnum">Aircraft health {timeline.health.toFixed(0)}</span>}
          />
          <div className="grid flex-1 items-center gap-2 p-4 md:grid-cols-[minmax(0,1fr)_196px]">
            <div className="mx-auto aspect-[400/460] w-full max-w-[460px]">
              <TwinSvg components={timeline.components} engines={engines} selected={selected} onSelect={(c) => setSelected(c.id)} isTransport={a.type.startsWith("Transport")} />
            </div>
            <ul className="space-y-1 self-start" aria-label="Components by health">
              {sorted.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.id)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-raised", selected === c.id && "bg-raised")}
                  >
                    <StatusPill tone={c.tone} iconOnly label={COMPONENT_TONE_LABEL[c.tone]} />
                    <span className="min-w-0 flex-1 truncate text-body">{c.position}</span>
                    <span className="text-xs text-subtle tnum">{offset === 0 ? remaining(c) : c.health.toFixed(0)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-border px-4 py-4">
            <div className="mb-2 flex items-center justify-between text-xs text-subtle">
              <span className="inline-flex items-center gap-1">
                <History size={13} strokeWidth={1.75} /> −90 days
              </span>
              <span className={cn("font-medium tnum", offset === 0 ? "text-accent" : "text-strong")}>
                {offset === 0 ? "Today" : `${offset > 0 ? "+" : ""}${offset} days`}
              </span>
              <span>+60 days (predicted)</span>
            </div>
            <Slider.Root
              className="relative flex h-5 w-full touch-none select-none items-center"
              min={-90}
              max={60}
              step={5}
              value={[offset]}
              onValueChange={([v]) => setOffset(v)}
              aria-label="Time offset in days"
            >
              <Slider.Track className="relative h-1 grow rounded-full bg-raised">
                <span className="absolute h-full rounded-full bg-border-strong" style={{ left: 0, width: `${(90 / 150) * 100}%` }} />
                <Slider.Range className="absolute h-full rounded-full bg-accent/50" />
              </Slider.Track>
              <span className="pointer-events-none absolute h-3 w-px bg-subtle" style={{ left: `${(90 / 150) * 100}%` }} aria-hidden />
              <Slider.Thumb className="block h-4 w-4 rounded-full border-2 border-accent bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
            </Slider.Root>
            <div className="mt-2 flex justify-end">
              {offset !== 0 && (
                <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
                  Reset to today
                </Button>
              )}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Components" subtitle="Remaining life (P50 with P10–P90 range) and next due" />
            <ul className="divide-y divide-border/70">
              {[...a.components].sort((x, y) => x.due_days - y.due_days).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setSelected(c.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-raised/60">
                    <StatusPill tone={c.tone} iconOnly label={COMPONENT_TONE_LABEL[c.tone]} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-strong">{c.position}</span>
                      <span className="block truncate text-xs text-subtle tnum">
                        {c.rul_unit === "sorties" ? `${c.p50.toFixed(0)} sorties (${c.p10.toFixed(0)}–${c.p90.toFixed(0)})` : `${c.p50_days.toFixed(0)} days (${c.p10_days.toFixed(0)}–${c.p90_days.toFixed(0)})`}
                      </span>
                    </span>
                    <span className={cn("text-xs tnum", c.due_days <= 7 ? "text-grounded" : c.due_days <= 21 ? "text-caution" : "text-subtle")}>
                      due {c.due_days <= 0 ? "now" : `${Math.floor(c.due_days)} d`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <TelemetryPanel tail={a.tail} />
        <Card className="flex flex-col">
          <CardHeader title="Recent technical records" subtitle={`${a.recent_records.length} most recent entries`} />
          <ul className="max-h-[600px] min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {a.recent_records.map((r) => (
              <RecordItem key={r.id} r={r} />
            ))}
          </ul>
        </Card>
      </div>

      <ComponentDrawer tail={a.tail} componentId={selected} onClose={() => setSelected(null)} />
    </>
  );
}

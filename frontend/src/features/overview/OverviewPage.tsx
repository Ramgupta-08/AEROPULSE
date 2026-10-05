import { AlertTriangle, ArrowRight, CalendarClock, CalendarRange, MapPin, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ForecastChart } from "@/components/charts/ForecastChart";
import { BaseMap } from "@/components/map/BaseMap";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { fmt } from "@/lib/format";
import { useAlerts, useBases, useForecast, useKpis, useMissions } from "@/lib/queries";
import { useUi } from "@/lib/store";
import type { Alert, MissionRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS = [
  { value: "Fighter Type-A", label: "Fighters" },
  { value: "Transport Type-C", label: "Transport" },
  { value: "Trainer Type-T", label: "Trainers" },
  { value: "all", label: "All" },
];

function KpiRow() {
  const { data: k } = useKpis();
  if (!k)
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[124px] rounded-card" />
        ))}
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-tour="kpis">
      <KpiTile
        id="readiness"
        label="Fleet readiness"
        value={k.readiness_pct}
        digits={1}
        unit="%"
        delta={k.readiness_delta}
        deltaUnit=" pts"
        spark={k.readiness_spark}
        hint={`${k.mission_capable} of ${k.total} aircraft mission-capable`}
      />
      <div className="card flex min-w-0 flex-col justify-between gap-2 p-4">
        <p className="label truncate">Mission-capable</p>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold tracking-tight text-strong tnum">{k.mission_capable}</span>
          <span className="text-sm text-subtle">of {k.total} aircraft</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <StatusPill tone="ready" label={`${k.ready} ready`} />
          <StatusPill tone="caution" label={`${k.caution} caution`} />
          <StatusPill tone="grounded" label={`${k.grounded} grounded`} />
        </div>
      </div>
      <KpiTile
        id="pred14"
        label="Failures due · 14 d"
        value={k.predicted_failures_14d}
        delta={k.predicted_failures_delta}
        goodWhen="down"
        hint="Components whose median remaining life is under 14 days"
      />
      <KpiTile id="aog" label="AOG hours · 7 d" value={k.aog_hours_week} unit="h" delta={k.aog_hours_delta} deltaUnit=" h" goodWhen="down" spark={k.aog_spark} tone="caution" />
      <KpiTile id="mtbf" label="MTBF · 90 d" value={k.mtbf_hours} digits={1} unit="flight h" delta={k.mtbf_delta} deltaUnit=" h" hint="Flight hours per unscheduled defect" />
      <KpiTile id="mttr" label="MTTR · 90 d" value={k.mttr_hours} digits={1} unit="h" delta={k.mttr_delta} deltaUnit=" h" goodWhen="down" hint="Mean elapsed repair time, excluding waits for parts" />
    </div>
  );
}

function BaseMapCard() {
  const { data: bases } = useBases();
  const { baseFilter, setBaseFilter } = useUi();
  const sel = bases?.find((b) => b.id === baseFilter);
  return (
    <Card className="flex flex-col" data-tour="map">
      <CardHeader
        title="Bases"
        subtitle={sel ? `${sel.name} · ${sel.environment} · ${sel.aircraft} aircraft` : "Readiness by base — select one to filter the app"}
        actions={
          sel && (
            <Button size="sm" variant="ghost" onClick={() => setBaseFilter(null)}>
              <X size={14} strokeWidth={1.75} /> Clear filter
            </Button>
          )
        }
      />
      {bases ? <BaseMap bases={bases} height={372} /> : <Skeleton className="m-4 h-[340px]" />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ready" aria-hidden /> Ready
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-caution" aria-hidden /> Caution
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-grounded" aria-hidden /> Grounded
        </span>
        <span className="ml-auto">Ring number = mission-capable %</span>
      </div>
    </Card>
  );
}

function ForecastCard() {
  const [type, setType] = useState("Fighter Type-A");
  const { data } = useForecast();
  const s = data?.types[type];
  const shortDays = s?.shortfall_days ?? [];
  const worst = s ? Math.max(0, ...s.demand.map((d, i) => d - s.p50[i])) : 0;
  return (
    <Card data-tour="forecast">
      <CardHeader
        title="30-day readiness forecast"
        subtitle={
          data ? (
            <>
              {data.plan === "aeropulse" ? "With the AeroPulse maintenance plan" : "Reactive baseline (no optimised plan yet)"} · band = P10–P90 failure timing
            </>
          ) : (
            "Loading forecast"
          )
        }
        actions={<Segmented ariaLabel="Aircraft type" value={type} onChange={setType} options={TYPE_OPTIONS} />}
      />
      <div className="px-2 pb-2 pt-3 sm:px-4">
        {s && data ? <ForecastChart days={data.days} series={s} height={300} /> : <Skeleton className="h-[300px]" />}
      </div>
      {s && (
        <div className={cn("flex flex-wrap items-center gap-3 border-t border-border px-4 py-2.5 text-sm", shortDays.length ? "text-body" : "text-subtle")}>
          {shortDays.length ? (
            <>
              <StatusPill tone="grounded" label={`Shortfall on ${shortDays.length} day${shortDays.length > 1 ? "s" : ""}`} />
              <span>
                Up to <b className="text-strong">{worst}</b> aircraft short, first on {fmt.date(data!.days[shortDays[0]])}.
              </span>
              <Button asChild size="sm" variant="primary" className="ml-auto">
                <Link to="/planner">
                  Optimise plan <ArrowRight size={14} strokeWidth={1.75} />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <StatusPill tone="ready" label="Demand covered" />
              <span>Forecast supply meets every mission requirement for this aircraft type.</span>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function AlertItem({ a, rank }: { a: Alert; rank: number }) {
  const navigate = useNavigate();
  return (
    <li className="group border-b border-border/70 last:border-0">
      <div className="flex gap-3 px-4 py-3">
        <span className="mt-0.5 w-4 shrink-0 text-right text-xs text-subtle tnum">{rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={`/aircraft/${a.tail}`} className="font-mono text-sm font-medium text-strong hover:text-accent" data-tour={rank === 1 ? "top-alert" : undefined}>
              {a.tail}
            </Link>
            <span className="text-xs text-subtle">
              {a.aircraft_type} · {a.base_id}
            </span>
            <StatusPill tone={a.severity} label={a.due_day <= 0 ? "Due now" : `Due ≤ ${a.due_day} d`} />
          </div>
          <p className="mt-1 text-sm text-body">{a.headline}</p>
          {a.also_due.length > 0 && <p className="mt-0.5 text-xs text-subtle">+ {a.also_due.map((x) => x.title).join(" · ")}</p>}
          {a.missions.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-xs text-subtle">
              <CalendarClock size={13} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />
              <span>Affects {a.missions.join(", ")}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end justify-between gap-2">
          <span className="text-xs text-subtle tnum" title="Risk × mission impact">
            {a.score.toFixed(0)}
          </span>
          {a.planned ? (
            <StatusPill tone="info" label={`Planned day ${a.planned_start_day}`} />
          ) : (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/planner?focus=${a.tail}`)}>
              <CalendarRange size={14} strokeWidth={1.75} />
              <span className="hidden sm:inline">Plan maintenance</span>
              <span className="sm:hidden">Plan</span>
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function AlertsCard() {
  const { data, isLoading } = useAlerts();
  return (
    <Card className="flex flex-col" data-tour="alerts">
      <CardHeader title="Priority alerts" subtitle="Ranked by failure risk × mission impact" />
      {isLoading ? (
        <SkeletonRows rows={5} className="p-4" />
      ) : data && data.length ? (
        <ol className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: 398 }}>
          {data.map((a, i) => (
            <AlertItem key={a.tail} a={a} rank={i + 1} />
          ))}
        </ol>
      ) : (
        <EmptyState icon={AlertTriangle} title="No alerts" description="No component is predicted to need maintenance in the next 30 days for this selection." />
      )}
    </Card>
  );
}

function MissionCard({ m }: { m: MissionRow }) {
  const tone = m.status === "info" ? "neutral" : m.status;
  return (
    <Link
      to={`/missions?focus=${m.id}`}
      className="card flex min-w-0 flex-col gap-2 p-3 transition-colors hover:border-border-strong"
      aria-label={`${m.name}, ${m.required} ${m.aircraft_type} required`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-medium text-strong">{m.name}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-subtle">
        <CalendarClock size={13} strokeWidth={1.75} aria-hidden />
        {m.start_day <= 0 ? "Ongoing" : `In ${m.start_day} d`} · {fmt.shortDate(m.start_date)}–{fmt.shortDate(m.end_date)}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-subtle">
        <MapPin size={13} strokeWidth={1.75} aria-hidden />
        {m.scope === "fleet" ? "Fleet-wide" : m.base_name} · {m.required} × {m.aircraft_type.split(" ")[0]}
      </div>
      <div className="mt-auto flex items-center justify-between pt-1">
        <StatusPill
          tone={tone}
          label={m.status === "info" ? "Beyond forecast" : m.shortfall ? `${m.shortfall} short` : m.status === "caution" ? "No margin" : "Covered"}
        />
        {m.available != null && (
          <span className="text-xs text-subtle tnum">{m.available} available</span>
        )}
      </div>
    </Link>
  );
}

function MissionsStrip() {
  const { data } = useMissions();
  // Next missions to start (standing duties that are already running are listed on the Missions page).
  const upcoming = (data?.missions ?? []).filter((m) => m.start_day > 0).sort((a, b) => a.start_day - b.start_day || a.priority - b.priority);
  return (
    <Card data-tour="missions">
      <CardHeader
        title="Upcoming missions"
        subtitle="Coverage from the readiness forecast"
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link to="/missions">
              All missions <ArrowRight size={14} strokeWidth={1.75} />
            </Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3">
        {data ? upcoming.slice(0, 6).map((m) => <MissionCard key={m.id} m={m} />) : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[126px]" />)}
      </div>
    </Card>
  );
}

export default function OverviewPage() {
  const { data: k } = useKpis();
  const { baseFilter } = useUi();
  const { data: bases } = useBases();
  const base = bases?.find((b) => b.id === baseFilter);
  return (
    <>
      <PageHeader
        title={base ? `Command Overview · ${base.name}` : "Command Overview"}
        description={k ? `Fleet status as of ${fmt.date(k.as_of)}. Simulated fleet data.` : "Fleet readiness, forecast and priority alerts."}
      />
      <div className="space-y-4">
        <KpiRow />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <ForecastCard />
          <AlertsCard />
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)]">
          <BaseMapCard />
          <MissionsStrip />
        </div>
      </div>
    </>
  );
}

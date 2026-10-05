import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { COMPONENT_TONE_LABEL, StatusPill } from "@/components/ui/status-pill";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useUi } from "@/lib/store";
import type { AnomalyRow, EngineRow } from "@/lib/types";
import { ComponentDrawer } from "@/features/aircraft/ComponentDrawer";
import { ModelCard } from "./ModelCard";

const SCALE = 135;

/** P10–P90 interval with P50 tick on a common 0–135 sortie scale. */
function IntervalBar({ p10, p50, p90, tone }: { p10: number; p50: number; p90: number; tone: string }) {
  const x = (v: number) => `${Math.min(100, (100 * v) / SCALE)}%`;
  const color = tone === "ready" ? "bg-ready" : tone === "caution" ? "bg-caution" : "bg-grounded";
  return (
    <div className="relative h-4 w-40" aria-label={`P10 ${p10.toFixed(0)}, P50 ${p50.toFixed(0)}, P90 ${p90.toFixed(0)} sorties`}>
      <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
      <div className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-40 ${color}`} style={{ left: x(p10), width: `calc(${x(p90)} - ${x(p10)})` }} />
      <div className={`absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded ${color}`} style={{ left: x(p50) }} />
    </div>
  );
}

const engineCols: Column<EngineRow>[] = [
  { key: "tail", header: "Aircraft", cell: (e) => <span className="font-mono font-medium text-strong">{e.tail}</span>, sortValue: (e) => e.tail },
  { key: "pos", header: "Engine", cell: (e) => e.position, sortValue: (e) => e.position },
  { key: "base", header: "Base", cell: (e) => e.base_id, sortValue: (e) => e.base_id, hideBelow: "md" },
  {
    key: "rul",
    header: "RUL (sorties)",
    cell: (e) => (
      <span className="tnum">
        <b className="font-semibold text-strong">{e.p50.toFixed(0)}</b>
        <span className="text-subtle">
          {" "}
          ({e.p10.toFixed(0)}–{e.p90.toFixed(0)})
        </span>
      </span>
    ),
    sortValue: (e) => e.p50,
  },
  { key: "int", header: "80 % interval", cell: (e) => <IntervalBar p10={e.p10} p50={e.p50} p90={e.p90} tone={e.tone} />, hideBelow: "lg" },
  { key: "days", header: "≈ Days", cell: (e) => <span className="tnum">{e.p50_days.toFixed(0)}</span>, sortValue: (e) => e.p50_days, align: "right", hideBelow: "sm" },
  {
    key: "why",
    header: "Top driver",
    cell: (e) =>
      e.anomaly ? (
        <StatusPill tone="caution" label="Unusual behaviour" />
      ) : e.reasons[0] ? (
        <span className="block max-w-[340px] truncate text-sm text-body" title={e.reasons.map((r) => r.text).join("\n")}>
          {e.reasons[0].text}
        </span>
      ) : (
        <span className="text-sm text-subtle">Healthy — no strong drivers</span>
      ),
    hideBelow: "xl",
  },
  { key: "health", header: "Health", cell: (e) => <StatusPill tone={e.tone} label={`${e.health.toFixed(0)} · ${COMPONENT_TONE_LABEL[e.tone]}`} />, sortValue: (e) => e.health, align: "right" },
];

function EnginesTab({ onOpen }: { onOpen: (tail: string, id: number) => void }) {
  const base = useUi((s) => s.baseFilter);
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["engines", base], queryFn: () => api.get<EngineRow[]>("/api/health/engines", { base_id: base }) });
  const rows = useMemo(() => (data ?? []).filter((e) => !q || `${e.tail} ${e.position} ${e.base_id}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const near = (data ?? []).filter((e) => e.p10_days <= 30).length;
  return (
    <Card>
      <CardHeader
        title="Engine remaining useful life"
        subtitle={data ? `${data.length} engines · ${near} with P10 inside 30 days · LightGBM quantile regression on NASA C-MAPSS trajectories` : "Loading"}
        actions={
          <div className="relative w-56">
            <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter engines" className="pl-8" aria-label="Filter engines" />
          </div>
        }
      />
      {isLoading ? (
        <SkeletonRows rows={10} className="p-4" />
      ) : (
        <DataTable
          ariaLabel="Engines by remaining useful life"
          rows={rows}
          columns={engineCols}
          rowKey={(e) => e.component_id}
          initialSort={{ key: "rul", dir: "asc" }}
          onRowClick={(e) => onOpen(e.tail, e.component_id)}
          maxHeight="calc(100vh - 300px)"
          empty={<EmptyState icon={Activity} title="No engines match" />}
        />
      )}
    </Card>
  );
}

function AnomaliesTab({ onOpen }: { onOpen: (tail: string, id: number) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["anomalies"], queryFn: () => api.get<AnomalyRow[]>("/api/anomalies") });
  return (
    <Card>
      <CardHeader
        title="Unknown-fault detector"
        subtitle="IsolationForest on deviations from the learned degradation path — catches faults the RUL model was never trained on"
      />
      {isLoading ? (
        <SkeletonRows rows={4} className="p-4" />
      ) : data?.length ? (
        <ul className="divide-y divide-border">
          {data.map((a) => (
            <li key={a.component_id}>
              <button type="button" onClick={() => onOpen(a.tail, a.component_id)} className="flex w-full flex-wrap items-start gap-4 px-4 py-4 text-left hover:bg-raised/50">
                <AlertTriangle size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-caution" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-strong">
                    <span className="font-mono font-medium">{a.tail}</span> · {a.position} · {a.base_id}
                  </p>
                  <p className="mt-0.5 text-sm text-body">{a.message}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {a.sensors.map((s) => (
                      <span key={s.sensor} className="rounded-md border border-border bg-raised px-2 py-1 text-xs text-body">
                        {s.name} · {s.kind === "drift" ? `${s.z > 0 ? "+" : ""}${s.z.toFixed(1)}σ drift` : `${s.volatility_ratio.toFixed(1)}× noise`}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right text-xs text-subtle tnum">
                  <p>
                    score <b className="text-strong">{a.score.toFixed(3)}</b>
                  </p>
                  <p>threshold {a.threshold.toFixed(3)}</p>
                  <p className="mt-1">RUL model: {a.p50.toFixed(0)} sorties</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Activity} title="No unusual behaviour" description="Every engine is degrading along a known path." />
      )}
    </Card>
  );
}

interface AdjRow {
  component_id: number;
  tail: string;
  base_id: string;
  environment: string;
  sortie_profile: string;
  position: string;
  env_multiplier: number;
  profile_multiplier: number;
  combined: number;
  p50_days: number;
  unadjusted_p50_days: number;
  note: string;
}

const adjCols: Column<AdjRow>[] = [
  { key: "tail", header: "Aircraft", cell: (r) => <span className="font-mono text-strong">{r.tail}</span>, sortValue: (r) => r.tail },
  { key: "pos", header: "Component", cell: (r) => r.position, sortValue: (r) => r.position },
  { key: "env", header: "Environment", cell: (r) => `${r.environment} ×${r.env_multiplier.toFixed(2)}`, sortValue: (r) => r.env_multiplier, hideBelow: "md" },
  { key: "prof", header: "Sortie profile", cell: (r) => `${r.sortie_profile.replace(/-/g, " ")} ×${r.profile_multiplier.toFixed(2)}`, sortValue: (r) => r.profile_multiplier, hideBelow: "lg" },
  { key: "comb", header: "Wear ×", cell: (r) => <b className="font-semibold text-strong tnum">{r.combined.toFixed(2)}</b>, sortValue: (r) => r.combined, align: "right" },
  {
    key: "life",
    header: "Life (adjusted vs reference)",
    cell: (r) => (
      <span className="tnum">
        <b className="text-strong">{r.p50_days.toFixed(0)} d</b> <span className="text-subtle">vs {r.unadjusted_p50_days.toFixed(0)} d</span>
      </span>
    ),
    sortValue: (r) => r.p50_days,
    align: "right",
  },
];

function AdjustmentsTab({ onOpen }: { onOpen: (tail: string, id: number) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["adjustments"], queryFn: () => api.get<AdjRow[]>("/api/health/adjustments") });
  const base = useUi((s) => s.baseFilter);
  const rows = (data ?? []).filter((r) => !base || r.base_id === base);
  return (
    <Card>
      <CardHeader title="Environment & flight-profile adjustment" subtitle="Non-engine wear rates are multiplied by documented base-environment and sortie-profile factors (see Model Card)" />
      {isLoading ? (
        <SkeletonRows rows={8} className="p-4" />
      ) : (
        <DataTable ariaLabel="Adjusted components" rows={rows} columns={adjCols} rowKey={(r) => r.component_id} initialSort={{ key: "comb", dir: "desc" }} onRowClick={(r) => onOpen(r.tail, r.component_id)} maxHeight="calc(100vh - 300px)" />
      )}
    </Card>
  );
}

export default function HealthPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "engines";
  const [open, setOpen] = useState<{ tail: string; id: number } | null>(null);
  const onOpen = (tail: string, id: number) => setOpen({ tail, id });
  return (
    <>
      <PageHeader
        title="Predictive Health"
        description="Remaining useful life with confidence and reasons, unknown-fault detection, environment adjustment and the model card."
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList
          className="mb-4"
          tabs={[
            { value: "engines", label: "Engine RUL" },
            { value: "anomalies", label: "Unusual behaviour" },
            { value: "adjustments", label: "Environment adjustment" },
            { value: "model", label: "Model card" },
          ]}
        />
        <TabsContent value="engines">
          <EnginesTab onOpen={onOpen} />
        </TabsContent>
        <TabsContent value="anomalies">
          <AnomaliesTab onOpen={onOpen} />
        </TabsContent>
        <TabsContent value="adjustments">
          <AdjustmentsTab onOpen={onOpen} />
        </TabsContent>
        <TabsContent value="model">
          <ModelCard />
        </TabsContent>
      </Tabs>
      {open && <ComponentDrawer tail={open.tail} componentId={open.id} onClose={() => setOpen(null)} />}
    </>
  );
}

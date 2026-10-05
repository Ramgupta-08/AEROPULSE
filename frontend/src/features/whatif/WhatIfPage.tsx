import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Play, Plus, Save, Trash2, Truck, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Chart } from "@/components/charts/Chart";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { baseChart, tokenColor } from "@/lib/echartsTheme";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

type Action = Record<string, unknown> & { type: string; label?: string };
interface EvalResult {
  status: string;
  late_visits: number;
  late: { tail: string; late_days: number; tasks: string[] }[];
  summary: { daily_mc: number[]; min_mc: number; avg_readiness_pct: number; downtime_aircraft_days: number; missions_short: number; missions_total: number; mission_shortfall_aircraft: number };
  missions: { mission_id: string; name: string; required: number; available: number; shortfall: number }[];
  forecast: Record<string, { p50: number[]; demand: number[]; total: number }>;
}
interface RunResult {
  actions: Action[];
  dates: string[];
  baseline: EvalResult;
  scenario: EvalResult;
  delta: { avg_readiness_pts: number; min_mc: number; downtime_aircraft_days: number; missions_short: number; late_visits: number };
  unmitigated?: { summary: EvalResult["summary"]; late: EvalResult["late"]; late_visits: number };
  mitigations: { message: string; days_saved: number }[];
}
interface Saved {
  id: number;
  name: string;
  actions: Action[];
  result: RunResult;
  created_by: string;
  created_at: string;
}
interface Options {
  aircraft: { tail: string; type: string; base_id: string }[];
  bases: { id: string; name: string; bays: number }[];
  parts: { part_number: string; name: string; lead_time_days: number }[];
  types: string[];
}

const PRESETS: { label: string; actions: Action[] }[] = [
  { label: "Delay seal delivery by 10 days", actions: [{ type: "delay_part", part_number: "FA-HYD-02", days: 10 }] },
  { label: "Lose 2 bays at Gwalior for a week", actions: [{ type: "lose_bays", base_id: "GWL", count: 2, start_day: 2, days: 7 }] },
  { label: "Technician shortage 20 %", actions: [{ type: "tech_shortage", pct: 20 }] },
  { label: "Surge: 7 fighters at Gwalior", actions: [{ type: "add_mission", name: "Snap surge — Gwalior", aircraft_type: "Fighter Type-A", base_id: "GWL", required: 7, start_day: 3, end_day: 6, scope: "base", priority: 1 }] },
  { label: "Send AP-101–103 in for 3 days on day 10", actions: [{ type: "send_for_maintenance", tails: ["AP-101", "AP-102", "AP-103"], day: 10, duration: 3 }] },
];

const TYPE_LABEL: Record<string, string> = {
  send_for_maintenance: "Send aircraft for maintenance",
  delay_part: "Delay a part",
  add_mission: "Add a mission",
  lose_bays: "Lose hangar bays",
  tech_shortage: "Technician shortage",
};

function ActionForm({ options, onAdd }: { options: Options; onAdd: (a: Action) => void }) {
  const [type, setType] = useState("delay_part");
  const [tails, setTails] = useState("AP-101, AP-102");
  const [day, setDay] = useState("10");
  const [dur, setDur] = useState("3");
  const [part, setPart] = useState("FA-HYD-02");
  const [days, setDays] = useState("10");
  const [base, setBase] = useState("GWL");
  const [count, setCount] = useState("1");
  const [pct, setPct] = useState("20");
  const [mName, setMName] = useState("Surge exercise");
  const [mType, setMType] = useState("Fighter Type-A");
  const [req, setReq] = useState("6");
  const [end, setEnd] = useState("14");

  const build = (): Action | null => {
    switch (type) {
      case "send_for_maintenance": {
        const list = tails.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
        const bad = list.filter((t) => !options.aircraft.some((a) => a.tail === t));
        if (!list.length || bad.length) {
          toast.error("Unknown tail number", bad.join(", ") || "Enter at least one tail");
          return null;
        }
        return { type, tails: list, day: Number(day), duration: Number(dur) };
      }
      case "delay_part":
        return { type, part_number: part, days: Number(days) };
      case "add_mission":
        return { type, name: mName, aircraft_type: mType, base_id: base, required: Number(req), start_day: Number(day), end_day: Math.max(Number(day), Number(end)), scope: "base", priority: 1 };
      case "lose_bays":
        return { type, base_id: base, count: Number(count), start_day: Number(day), days: Number(days) };
      case "tech_shortage":
        return { type, pct: Number(pct) };
    }
    return null;
  };

  const baseOpts = options.bases.map((b) => ({ value: b.id, label: `${b.name} (${b.bays} bays)` }));
  return (
    <div className="space-y-3">
      <Field label="Action">
        <Select ariaLabel="Action type" value={type} onChange={setType} className="w-full" options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        {type === "send_for_maintenance" && (
          <>
            <div className="col-span-2">
              <Field label="Tail numbers" htmlFor="wi-tails">
                <Input id="wi-tails" value={tails} onChange={(e) => setTails(e.target.value)} />
              </Field>
            </div>
            <Field label="On day" htmlFor="wi-day">
              <Input id="wi-day" type="number" min={0} max={29} value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="Duration (days)" htmlFor="wi-dur">
              <Input id="wi-dur" type="number" min={1} max={14} value={dur} onChange={(e) => setDur(e.target.value)} />
            </Field>
          </>
        )}
        {type === "delay_part" && (
          <>
            <div className="col-span-2">
              <Field label="Part">
                <Select ariaLabel="Part" value={part} onChange={setPart} className="w-full" options={options.parts.map((p) => ({ value: p.part_number, label: `${p.part_number} · ${p.name}` }))} />
              </Field>
            </div>
            <Field label="Delay (days)" htmlFor="wi-days">
              <Input id="wi-days" type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
          </>
        )}
        {type === "add_mission" && (
          <>
            <div className="col-span-2">
              <Field label="Mission name" htmlFor="wi-mname">
                <Input id="wi-mname" value={mName} onChange={(e) => setMName(e.target.value)} />
              </Field>
            </div>
            <Field label="Aircraft type">
              <Select ariaLabel="Aircraft type" value={mType} onChange={setMType} className="w-full" options={options.types.map((t) => ({ value: t, label: t }))} />
            </Field>
            <Field label="Base">
              <Select ariaLabel="Base" value={base} onChange={setBase} className="w-full" options={baseOpts} />
            </Field>
            <Field label="Aircraft needed" htmlFor="wi-req">
              <Input id="wi-req" type="number" min={1} max={36} value={req} onChange={(e) => setReq(e.target.value)} />
            </Field>
            <Field label="Days (from–to)" htmlFor="wi-from">
              <div className="flex gap-2">
                <Input id="wi-from" type="number" min={0} max={29} value={day} onChange={(e) => setDay(e.target.value)} aria-label="Start day" />
                <Input type="number" min={0} max={29} value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End day" />
              </div>
            </Field>
          </>
        )}
        {type === "lose_bays" && (
          <>
            <div className="col-span-2">
              <Field label="Base">
                <Select ariaLabel="Base" value={base} onChange={setBase} className="w-full" options={baseOpts} />
              </Field>
            </div>
            <Field label="Bays lost" htmlFor="wi-count">
              <Input id="wi-count" type="number" min={1} max={3} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            <Field label="From day" htmlFor="wi-from2">
              <Input id="wi-from2" type="number" min={0} max={29} value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="For (days)" htmlFor="wi-days2">
              <Input id="wi-days2" type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
          </>
        )}
        {type === "tech_shortage" && (
          <Field label="Shortage (%)" htmlFor="wi-pct">
            <Input id="wi-pct" type="number" min={5} max={80} value={pct} onChange={(e) => setPct(e.target.value)} />
          </Field>
        )}
      </div>
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          const a = build();
          if (a) onAdd(a);
        }}
      >
        <Plus size={14} strokeWidth={1.75} /> Add to scenario
      </Button>
    </div>
  );
}

function label(a: Action): string {
  if (a.label) return a.label;
  switch (a.type) {
    case "send_for_maintenance":
      return `Send ${(a.tails as string[]).join(", ")} for maintenance on day ${a.day}`;
    case "delay_part":
      return `Delay ${a.part_number} by ${a.days} days`;
    case "add_mission":
      return `Add “${a.name}”: ${a.required} × ${a.aircraft_type} at ${a.base_id}, days ${a.start_day}–${a.end_day}`;
    case "lose_bays":
      return `Lose ${a.count} bay(s) at ${a.base_id} for ${a.days} days from day ${a.start_day}`;
    case "tech_shortage":
      return `Technician shortage ${a.pct} %`;
  }
  return a.type;
}

function Delta({ v, unit = "", good = "up" }: { v: number; unit?: string; good?: "up" | "down" }) {
  if (v === 0) return <span className="text-subtle">no change</span>;
  const better = good === "up" ? v > 0 : v < 0;
  return (
    <span className={cn("font-medium tnum", better ? "text-ready" : "text-grounded")}>
      {v > 0 ? "+" : "−"}
      {Math.abs(v)}
      {unit}
    </span>
  );
}

const SERIES = ["series-1", "series-2", "series-3"];

function ReadinessChart({ dates, lines, demand }: { dates: string[]; lines: { name: string; data: number[]; color: string; dashed?: boolean }[]; demand?: number[] }) {
  return (
    <Chart
      ariaLabel="Mission-capable aircraft per day by scenario"
      height={260}
      deps={[JSON.stringify(lines.map((l) => [l.name, l.data])), demand?.join(",")]}
      build={() => {
        const b = baseChart();
        return {
          ...b,
          grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
          legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 2, textStyle: { color: tokenColor("subtle") } },
          tooltip: { ...(b.tooltip as object), valueFormatter: (v: unknown) => `${v} aircraft` },
          xAxis: { ...(b.xAxis as object), type: "category", boundaryGap: false, data: dates.map((d) => fmt.shortDate(d)), axisLabel: { color: tokenColor("subtle"), hideOverlap: true } },
          yAxis: { ...(b.yAxis as object), type: "value", scale: true, minInterval: 1 },
          series: [
            ...lines.map((l) => ({
              name: l.name,
              type: "line" as const,
              data: l.data,
              symbol: "none",
              lineStyle: { width: 2, color: tokenColor(l.color), type: l.dashed ? ("dashed" as const) : ("solid" as const) },
              itemStyle: { color: tokenColor(l.color) },
            })),
            ...(demand
              ? [{ name: "Mission demand", type: "line" as const, step: "middle" as const, data: demand, symbol: "none", lineStyle: { width: 1.2, type: "dotted" as const, color: tokenColor("strong", 0.6) }, itemStyle: { color: tokenColor("strong", 0.6) } }]
              : []),
          ],
        };
      }}
    />
  );
}

function ResultView({ r }: { r: RunResult }) {
  const [type, setType] = useState("all");
  const base = r.baseline.forecast[type];
  const sc = r.scenario.forecast[type];
  const changed = r.scenario.missions.filter((m, i) => m.shortfall !== r.baseline.missions[i]?.shortfall || m.shortfall > 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { l: "Avg readiness", v: `${r.scenario.summary.avg_readiness_pct.toFixed(1)}%`, d: <Delta v={r.delta.avg_readiness_pts} unit=" pts" /> },
          { l: "Lowest daily MC", v: r.scenario.summary.min_mc, d: <Delta v={r.delta.min_mc} /> },
          { l: "Aircraft-days down", v: fmt.int(r.scenario.summary.downtime_aircraft_days), d: <Delta v={r.delta.downtime_aircraft_days} good="down" /> },
          { l: "Missions short", v: `${r.scenario.summary.missions_short} / ${r.scenario.summary.missions_total}`, d: <Delta v={r.delta.missions_short} good="down" /> },
        ].map((x) => (
          <div key={x.l} className="card p-3">
            <p className="label">{x.l}</p>
            <p className="mt-1 text-xl font-semibold text-strong tnum">{x.v}</p>
            <p className="text-xs">{x.d} <span className="text-subtle">vs current plan</span></p>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader
          title="Readiness forecast — current plan vs scenario"
          subtitle="Both re-optimised with the same solver settings"
          actions={
            <Segmented
              ariaLabel="Aircraft type"
              value={type}
              onChange={setType}
              options={[
                { value: "all", label: "All" },
                { value: "Fighter Type-A", label: "Fighters" },
                { value: "Transport Type-C", label: "Transport" },
                { value: "Trainer Type-T", label: "Trainers" },
              ]}
            />
          }
        />
        <div className="p-3">
          <ReadinessChart
            dates={r.dates}
            demand={sc.demand}
            lines={[
              { name: "Current plan", data: base.p50, color: "subtle" },
              { name: "Scenario", data: sc.p50, color: "accent" },
            ]}
          />
        </div>
      </Card>
      {(r.mitigations.length > 0 || r.unmitigated) && (
        <Card>
          <CardHeader title="Spares-transfer fix" subtitle="Impact of the delay with and without AeroPulse inter-base transfers" />
          <CardBody className="space-y-3 text-sm">
            {r.unmitigated && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-grounded/30 bg-grounded/8 p-3">
                  <p className="font-medium text-strong">Without transfer</p>
                  <p className="text-body">
                    {r.unmitigated.late_visits} visit(s) after a P10 failure point
                    {r.unmitigated.late.length > 0 && `: ${r.unmitigated.late.map((l) => `${l.tail} +${l.late_days} d`).join(", ")}`} · avg readiness {r.unmitigated.summary.avg_readiness_pct.toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-lg border border-ready/30 bg-ready/8 p-3">
                  <p className="font-medium text-strong">With transfer (scenario result)</p>
                  <p className="text-body">
                    {r.scenario.late_visits} visit(s) late · avg readiness {r.scenario.summary.avg_readiness_pct.toFixed(1)}%
                  </p>
                </div>
              </div>
            )}
            <ul className="space-y-1.5">
              {r.mitigations.map((m) => (
                <li key={m.message} className="flex items-start gap-2 text-body">
                  <Truck size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" aria-hidden /> {m.message} — saves {m.days_saved} days
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Mission coverage" subtitle={changed.length ? "Missions affected by the scenario" : "No mission loses coverage"} />
        <ul className="divide-y divide-border/70">
          {(changed.length ? changed : r.scenario.missions.slice(0, 4)).map((m) => {
            const b = r.baseline.missions.find((x) => x.mission_id === m.mission_id);
            return (
              <li key={m.mission_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 text-body">{m.name}</span>
                <span className="text-xs text-subtle tnum">
                  {b ? `${b.available}` : "new"} → {m.available} of {m.required}
                </span>
                <StatusPill tone={m.shortfall ? "grounded" : "ready"} label={m.shortfall ? `${m.shortfall} short` : "Covered"} />
              </li>
            );
          })}
        </ul>
        {r.scenario.late.length > 0 && (
          <p className="flex items-start gap-2 border-t border-border px-4 py-3 text-sm text-body">
            <TriangleAlert size={15} strokeWidth={1.75} className="mt-0.5 text-caution" aria-hidden />
            Deadline risk: {r.scenario.late.map((l) => `${l.tail} serviced ${l.late_days} d after its P10 point`).join("; ")}.
          </p>
        )}
      </Card>
    </div>
  );
}

export default function WhatIfPage() {
  const qc = useQueryClient();
  const [actions, setActions] = useState<Action[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [name, setName] = useState("");
  const [compare, setCompare] = useState<number[]>([]);
  const { data: options } = useQuery({ queryKey: ["whatif-options"], queryFn: () => api.get<Options>("/api/whatif/options") });
  const { data: saved } = useQuery({ queryKey: ["scenarios"], queryFn: () => api.get<Saved[]>("/api/whatif/scenarios") });
  const run = useMutation({
    mutationFn: (acts: Action[]) => api.post<RunResult>("/api/whatif/run", { actions: acts }),
    onSuccess: setResult,
    onError: (e) => toast.error("Scenario failed", String(e)),
  });
  const save = useMutation({
    mutationFn: () => api.post<Saved>("/api/whatif/scenarios", { name, actions }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["scenarios"] });
      setResult(s.result);
      setCompare((c) => [...c, s.id].slice(-3));
      toast.success("Scenario saved", s.name);
      setName("");
    },
    onError: (e) => toast.error("Save failed", String(e)),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/whatif/scenarios/${id}`),
    onSuccess: (_, id) => {
      setCompare((c) => c.filter((x) => x !== id));
      qc.invalidateQueries({ queryKey: ["scenarios"] });
      toast.info("Scenario deleted");
    },
  });
  const compared = (saved ?? []).filter((s) => compare.includes(s.id));
  const [params] = useSearchParams();
  const autoRan = useRef<string | null>(null);
  useEffect(() => {
    const p = params.get("preset");
    const preset = p === "seal" ? PRESETS[0] : null;
    if (preset && autoRan.current !== p) {
      autoRan.current = p;
      setActions(preset.actions);
      setName(preset.label);
      run.mutate(preset.actions);
    }
  }, [params, run]);

  return (
    <>
      <PageHeader title="What-If Simulator" description="Build a scenario, re-optimise the plan under it and compare readiness, mission coverage and downtime against the current plan." />
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Scenario builder" />
            <CardBody className="space-y-4">
              <div>
                <p className="label mb-2">Quick scenarios</p>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setActions(p.actions);
                        setName(p.label);
                        run.mutate(p.actions);
                      }}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-body hover:border-border-strong hover:text-strong"
                      data-tour={p.label.startsWith("Delay seal") ? "preset-seal" : undefined}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {options ? <ActionForm options={options} onAdd={(a) => setActions((x) => [...x, a])} /> : <SkeletonRows rows={4} />}
              <div>
                <p className="label mb-2">Scenario · {actions.length} action{actions.length === 1 ? "" : "s"}</p>
                {actions.length ? (
                  <ul className="space-y-1.5">
                    {actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2 text-sm text-body">
                        <span className="min-w-0 flex-1">{label(a)}</span>
                        <button type="button" aria-label="Remove action" onClick={() => setActions((x) => x.filter((_, j) => j !== i))} className="text-subtle hover:text-grounded">
                          <X size={14} strokeWidth={1.75} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-subtle">Add actions or pick a quick scenario.</p>
                )}
              </div>
              <Button variant="primary" className="w-full" disabled={!actions.length || run.isPending} onClick={() => run.mutate(actions)}>
                <Play size={14} strokeWidth={1.75} /> {run.isPending ? "Running…" : "Run scenario"}
              </Button>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim() && actions.length) save.mutate();
                }}
              >
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Scenario name" aria-label="Scenario name" />
                <Button type="submit" variant="secondary" disabled={!name.trim() || !actions.length || save.isPending}>
                  <Save size={14} strokeWidth={1.75} /> Save
                </Button>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Saved scenarios" subtitle="Tick up to 3 to compare" />
            {saved?.length ? (
              <ul className="divide-y divide-border/70">
                {saved.map((s) => (
                  <li key={s.id} className="flex items-start gap-3 px-4 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[rgb(var(--accent))]"
                      checked={compare.includes(s.id)}
                      onChange={(e) => setCompare((c) => (e.target.checked ? [...c, s.id].slice(-3) : c.filter((x) => x !== s.id)))}
                      aria-label={`Compare ${s.name}`}
                    />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setResult(s.result)}>
                      <span className="block truncate text-sm text-strong">{s.name}</span>
                      <span className="block text-xs text-subtle">
                        {fmt.dateTime(s.created_at)} · {s.result.delta.avg_readiness_pts >= 0 ? "+" : ""}
                        {s.result.delta.avg_readiness_pts} pts
                      </span>
                    </button>
                    <button type="button" aria-label={`Delete ${s.name}`} className="text-subtle hover:text-grounded" onClick={() => del.mutate(s.id)}>
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-sm text-subtle">No saved scenarios yet.</p>
            )}
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          {compared.length > 1 && (
            <Card>
              <CardHeader title={`Comparing ${compared.length} scenarios`} subtitle="All aircraft · mission-capable per day" />
              <div className="p-3">
                <ReadinessChart
                  dates={compared[0].result.dates}
                  lines={[
                    { name: "Current plan", data: compared[0].result.baseline.forecast.all.p50, color: "subtle", dashed: true },
                    ...compared.map((s, i) => ({ name: s.name, data: s.result.scenario.forecast.all.p50, color: SERIES[i] })),
                  ]}
                />
              </div>
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="label py-2 text-left">Scenario</th>
                      <th className="label py-2 text-right">Avg readiness</th>
                      <th className="label py-2 text-right">Min MC</th>
                      <th className="label py-2 text-right">Downtime</th>
                      <th className="label py-2 text-right">Missions short</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compared.map((s) => (
                      <tr key={s.id} className="border-t border-border/70">
                        <td className="py-2 text-strong">{s.name}</td>
                        <td className="py-2 text-right tnum">{s.result.scenario.summary.avg_readiness_pct.toFixed(1)}%</td>
                        <td className="py-2 text-right tnum">{s.result.scenario.summary.min_mc}</td>
                        <td className="py-2 text-right tnum">{s.result.scenario.summary.downtime_aircraft_days}</td>
                        <td className="py-2 text-right tnum">{s.result.scenario.summary.missions_short}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {run.isPending ? (
            <Card>
              <SkeletonRows rows={8} className="p-4" />
            </Card>
          ) : result ? (
            <ResultView r={result} />
          ) : (
            <Card>
              <EmptyState icon={FlaskConical} title="Run a scenario" description="Pick a quick scenario or build one. AeroPulse re-optimises the plan under the new conditions and shows the readiness and mission impact." />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

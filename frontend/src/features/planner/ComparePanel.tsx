import { ArrowRight, CircleCheck, CircleX } from "lucide-react";
import { useState } from "react";
import { Chart } from "@/components/charts/Chart";
import { Card, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { baseChart, tokenColor } from "@/lib/echartsTheme";
import { fmt } from "@/lib/format";
import type { Compare } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPES = [
  { value: "all", label: "All" },
  { value: "Fighter Type-A", label: "Fighters" },
  { value: "Transport Type-C", label: "Transport" },
  { value: "Trainer Type-T", label: "Trainers" },
];

function Row({ label, r, a, better, unit = "" }: { label: string; r: number; a: number; better: "up" | "down"; unit?: string }) {
  const improved = better === "up" ? a > r : a < r;
  const same = a === r;
  return (
    <tr className="border-t border-border/70">
      <td className="py-2 pr-3 text-sm text-body">{label}</td>
      <td className="px-3 py-2 text-right text-sm text-subtle tnum">
        {fmt.one(r).replace(".0", "")}
        {unit}
      </td>
      <td className={cn("py-2 pl-3 text-right text-sm font-semibold tnum", same ? "text-strong" : improved ? "text-ready" : "text-grounded")}>
        {fmt.one(a).replace(".0", "")}
        {unit}
      </td>
    </tr>
  );
}

export function ComparePanel({ data }: { data: Compare }) {
  const [type, setType] = useState("all");
  const ap = data.aeropulse;
  if (!ap) return null;
  const series = type === "all" ? { reactive: data.reactive.daily_mc, aeropulse: ap.daily_mc, demand: null } : data.by_type?.[type];
  const d = data.delta!;
  return (
    <Card data-tour="compare">
      <CardHeader
        title="Reactive baseline vs AeroPulse plan"
        subtitle="Same fleet, same 30 days: fly-until-failure with local spares vs predictive, mission-aware, bundled plan"
        actions={<Segmented ariaLabel="Aircraft type" value={type} onChange={setType} options={TYPES} />}
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div>
          <Chart
            ariaLabel="Daily mission-capable aircraft, reactive versus AeroPulse"
            height={260}
            deps={[type, JSON.stringify(series)]}
            build={() => {
              const b = baseChart();
              const x = data.dates.map((v) => fmt.shortDate(v));
              return {
                ...b,
                grid: { left: 8, right: 96, top: 28, bottom: 8, containLabel: true },
                legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 2, textStyle: { color: tokenColor("subtle") }, data: ["Reactive", "AeroPulse", ...(series?.demand ? ["Mission demand"] : [])] },
                xAxis: { ...(b.xAxis as object), type: "category", data: x, boundaryGap: false, axisLabel: { color: tokenColor("subtle"), interval: 4 } },
                yAxis: { ...(b.yAxis as object), type: "value", minInterval: 1, scale: true },
                tooltip: { ...(b.tooltip as object), valueFormatter: (v: unknown) => `${v} aircraft` },
                series: [
                  {
                    name: "Reactive",
                    type: "line",
                    data: series?.reactive ?? [],
                    symbol: "none",
                    lineStyle: { width: 2, color: tokenColor("subtle") },
                    itemStyle: { color: tokenColor("subtle") },
                    endLabel: { show: true, formatter: "Reactive {c}", color: tokenColor("subtle"), fontSize: 12 },
                  },
                  {
                    name: "AeroPulse",
                    type: "line",
                    data: series?.aeropulse ?? [],
                    symbol: "none",
                    lineStyle: { width: 2.5, color: tokenColor("accent") },
                    itemStyle: { color: tokenColor("accent") },
                    areaStyle: { color: tokenColor("accent", 0.08) },
                    endLabel: { show: true, formatter: "AeroPulse {c}", color: tokenColor("body"), fontSize: 12 },
                  },
                  ...(series?.demand
                    ? [
                        {
                          name: "Mission demand",
                          type: "line" as const,
                          step: "middle" as const,
                          data: series.demand,
                          symbol: "none",
                          lineStyle: { width: 1.5, type: "dashed" as const, color: tokenColor("strong", 0.6) },
                          itemStyle: { color: tokenColor("strong", 0.6) },
                        },
                      ]
                    : []),
                ],
              };
            }}
          />
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-ready/30 bg-ready/8 p-3">
              <p className="label">Avg readiness</p>
              <p className="mt-1 text-xl font-semibold text-strong tnum">+{d.avg_readiness_pts.toFixed(1)} pts</p>
            </div>
            <div className="rounded-lg border border-ready/30 bg-ready/8 p-3">
              <p className="label">Downtime avoided</p>
              <p className="mt-1 text-xl font-semibold text-strong tnum">{fmt.int(d.downtime_avoided_aircraft_days)} ac-days</p>
            </div>
          </div>
          <table className="w-full" aria-label="Comparison metrics">
            <thead>
              <tr>
                <th className="label pb-1 text-left">30-day metric</th>
                <th className="label px-3 pb-1 text-right">Reactive</th>
                <th className="label pb-1 pl-3 text-right">
                  <span className="inline-flex items-center gap-1">
                    <ArrowRight size={12} strokeWidth={2} aria-hidden /> AeroPulse
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <Row label="Average readiness" r={data.reactive.avg_readiness_pct} a={ap.avg_readiness_pct} better="up" unit="%" />
              <Row label="Lowest daily mission-capable" r={data.reactive.min_mc} a={ap.min_mc} better="up" />
              <Row label="Aircraft-days on the ground" r={data.reactive.downtime_aircraft_days} a={ap.downtime_aircraft_days} better="down" />
              <Row label="In-service failures" r={data.reactive.in_service_failures} a={ap.in_service_failures} better="down" />
              <Row label="Missions short of aircraft" r={data.reactive.missions_short} a={ap.missions_short} better="down" />
              <Row label="Aircraft short across missions" r={data.reactive.mission_shortfall_aircraft} a={ap.mission_shortfall_aircraft} better="down" />
            </tbody>
          </table>
          <ul className="space-y-1.5">
            {ap.missions
              .map((m, i) => ({ a: m, r: data.reactive.missions[i] }))
              .filter(({ a, r }) => r && (r.shortfall > 0 || a.shortfall > 0))
              .map(({ a, r }) => (
                <li key={a.mission_id} className="flex items-center gap-2 text-sm">
                  {a.covered ? <CircleCheck size={15} strokeWidth={1.75} className="text-ready" aria-label="Covered" /> : <CircleX size={15} strokeWidth={1.75} className="text-grounded" aria-label="Short" />}
                  <span className="min-w-0 flex-1 truncate text-body">{a.name}</span>
                  <span className="text-xs text-subtle tnum">
                    {r.shortfall} short → {a.covered ? "covered" : `${a.shortfall} short`}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

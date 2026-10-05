import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2 } from "lucide-react";
import { useState } from "react";
import { Chart } from "@/components/charts/Chart";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Select } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { api } from "@/lib/api";
import { baseChart, tokenColor } from "@/lib/echartsTheme";
import { cn } from "@/lib/utils";

interface AgencyRow {
  id: string;
  rank: number;
  name: string;
  kind: string;
  location: string;
  specialities: string[];
  promised_tat_days: number;
  avg_tat_days: number;
  tat_ratio: number;
  on_time_pct: number;
  repeat_failure_pct: number;
  jobs_completed: number;
  backlog: number;
  overdue: number;
  capacity: number;
  utilisation_pct: number;
  score: number;
  trend: (number | null)[];
}
interface Scorecard {
  agencies: AgencyRow[];
  months: string[];
  routing: { component_kind: string; label: string; recommended: string; recommended_name: string; reason: string; alternatives: string[] }[];
}

const KIND: Record<string, string> = { depot: "Depot", oem: "OEM", field: "Field unit" };

const cols: Column<AgencyRow>[] = [
  { key: "rank", header: "#", cell: (r) => <span className="text-subtle tnum">{r.rank}</span>, sortValue: (r) => r.rank },
  {
    key: "name",
    header: "Agency",
    cell: (r) => (
      <span>
        <span className="block text-strong">{r.name}</span>
        <span className="block text-xs text-subtle">
          {KIND[r.kind]} · {r.location}
        </span>
      </span>
    ),
    sortValue: (r) => r.name,
  },
  {
    key: "score",
    header: "Score",
    cell: (r) => <StatusPill tone={r.score >= 75 ? "ready" : r.score >= 55 ? "caution" : "grounded"} label={r.score.toFixed(0)} />,
    sortValue: (r) => r.score,
    align: "right",
  },
  {
    key: "tat",
    header: "Turnaround vs promised",
    cell: (r) => (
      <span className={cn("tnum", r.tat_ratio > 1.15 ? "text-grounded" : r.tat_ratio > 1 ? "text-caution" : "text-strong")}>
        {r.avg_tat_days.toFixed(0)} d <span className="text-subtle">/ {r.promised_tat_days} d</span>
      </span>
    ),
    sortValue: (r) => r.tat_ratio,
    align: "right",
  },
  { key: "otp", header: "On time", cell: (r) => `${r.on_time_pct.toFixed(0)}%`, sortValue: (r) => r.on_time_pct, align: "right" },
  {
    key: "rep",
    header: "Repeat failure",
    cell: (r) => <span className={cn("tnum", r.repeat_failure_pct >= 10 ? "font-semibold text-grounded" : "text-strong")}>{r.repeat_failure_pct.toFixed(1)}%</span>,
    sortValue: (r) => r.repeat_failure_pct,
    align: "right",
  },
  { key: "jobs", header: "Jobs (24 mo)", cell: (r) => r.jobs_completed, sortValue: (r) => r.jobs_completed, align: "right", hideBelow: "lg" },
  { key: "back", header: "Backlog", cell: (r) => `${r.backlog}${r.overdue ? ` (${r.overdue} overdue)` : ""}`, sortValue: (r) => r.backlog, align: "right", hideBelow: "md" },
];

export default function AgenciesPage() {
  const { data } = useQuery({ queryKey: ["agencies"], queryFn: () => api.get<Scorecard>("/api/agencies/scorecard") });
  const [sel, setSel] = useState<string>("");
  const agency = data?.agencies.find((a) => a.id === (sel || data.agencies[0]?.id));
  return (
    <>
      <PageHeader title="Maintenance Agencies" description="Scorecard of repair agencies: turnaround against promise, on-time delivery, repeat failures within 90 days of repair, and backlog." />
      {!data ? (
        <SkeletonRows rows={10} />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Agency ranking" subtitle="Score = 40 % on-time + 40 % repeat-failure quality + 20 % turnaround — select a row for its trend" />
            <DataTable ariaLabel="Agency ranking" rows={data.agencies} columns={cols} rowKey={(r) => r.id} initialSort={{ key: "rank", dir: "asc" }} onRowClick={(r) => setSel(r.id)} rowClassName={(r) => (r.id === agency?.id ? "bg-raised/60" : undefined)} />
          </Card>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader
                title="Turnaround trend"
                subtitle="Average days per completed repair, by month returned"
                actions={<Select ariaLabel="Agency" value={agency?.id ?? ""} onChange={setSel} className="w-[260px]" options={data.agencies.map((a) => ({ value: a.id, label: a.name }))} />}
              />
              {agency && (
                <div className="p-3">
                  <Chart
                    ariaLabel={`${agency.name} monthly turnaround`}
                    height={260}
                    deps={[agency.id]}
                    build={() => {
                      const b = baseChart();
                      return {
                        ...b,
                        grid: { left: 8, right: 96, top: 16, bottom: 8, containLabel: true },
                        tooltip: { ...(b.tooltip as object), valueFormatter: (v: unknown) => (v == null ? "no returns" : `${v} days`) },
                        xAxis: { ...(b.xAxis as object), type: "category", data: data.months },
                        yAxis: { ...(b.yAxis as object), type: "value", min: 0 },
                        series: [
                          {
                            type: "bar",
                            name: "Avg turnaround",
                            data: agency.trend,
                            barMaxWidth: 22,
                            itemStyle: { color: tokenColor("accent"), borderRadius: [4, 4, 0, 0] },
                            markLine: {
                              silent: true,
                              symbol: "none",
                              lineStyle: { color: tokenColor("caution"), type: "dashed" },
                              label: { formatter: `promised ${agency.promised_tat_days} d`, color: tokenColor("subtle"), position: "end" },
                              data: [{ yAxis: agency.promised_tat_days }],
                            },
                          },
                        ],
                      };
                    }}
                  />
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title="Routing recommendation" subtitle="Where to send each repair type next" />
              <ul className="divide-y divide-border/70">
                {data.routing.map((r) => (
                  <li key={r.component_kind} className="px-4 py-3">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="w-28 shrink-0 text-subtle">{r.label}</span>
                      <ArrowRight size={13} strokeWidth={1.75} className="text-subtle" aria-hidden />
                      <span className="font-medium text-strong">{r.recommended_name}</span>
                    </p>
                    <p className="mt-0.5 pl-0 text-xs text-subtle sm:pl-[136px]">{r.reason}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <p className="flex items-center gap-2 text-xs text-subtle">
            <Building2 size={13} strokeWidth={1.75} aria-hidden /> Agency names are fictional; job history is simulated.
          </p>
        </div>
      )}
    </>
  );
}

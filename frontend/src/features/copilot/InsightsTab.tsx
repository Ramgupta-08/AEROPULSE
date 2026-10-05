import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Lightbulb, ShieldAlert, TrendingUp } from "lucide-react";
import { Chart } from "@/components/charts/Chart";
import { Card, CardHeader } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { baseChart, tokenColor } from "@/lib/echartsTheme";
import { cn } from "@/lib/utils";

interface Insight {
  type: "bad-batch" | "base-rate" | "rising-theme";
  severity: "grounded" | "caution" | "info";
  title: string;
  message: string;
  recommendation: string;
}
interface Theme {
  id: number;
  label: string;
  top_terms: string[];
  size: number;
  component_kind: string;
  defect_codes: [string, number][];
  bases: [string, number][];
  monthly: number[];
  recent_90d: number;
  prior_90d: number;
  examples: { id: number; tail: string; date: string; narrative: string }[];
}

const ICON = { "bad-batch": ShieldAlert, "base-rate": CircleAlert, "rising-theme": TrendingUp };

export function InsightsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["logbook-insights"],
    queryFn: () => api.get<{ insights: Insight[]; themes: Theme[]; months: string[]; n_records: number }>("/api/logbook/insights"),
  });
  if (isLoading || !data) return <SkeletonRows rows={10} />;
  return (
    <div className="space-y-4">
      <Card data-tour="insights">
        <CardHeader title="Discovered insights" subtitle={`Automatically found in ${data.n_records.toLocaleString("en-IN")} free-text defect entries and part batches — no rules written for these patterns`} />
        <ul className="divide-y divide-border">
          {data.insights.map((i) => {
            const Icon = ICON[i.type];
            return (
              <li key={i.title} className="flex gap-3 px-4 py-3.5">
                <Icon size={18} strokeWidth={1.75} className={cn("mt-0.5 shrink-0", i.severity === "grounded" ? "text-grounded" : i.severity === "caution" ? "text-caution" : "text-info")} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-strong">{i.title}</p>
                  <p className="mt-0.5 text-sm text-body">{i.message}</p>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-subtle">
                    <Lightbulb size={13} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden /> {i.recommendation}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Recurring-fault themes" subtitle="TF-IDF + k-means clustering of defect narratives · monthly reports over the last 12 months" />
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
          {data.themes.map((t) => {
            const change = t.prior_90d ? Math.round((100 * (t.recent_90d - t.prior_90d)) / t.prior_90d) : null;
            return (
              <div key={t.id} className="bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-strong">{t.label}</p>
                  <span className="shrink-0 text-xs text-subtle tnum">{t.size}</span>
                </div>
                <p className="mt-1 text-xs text-subtle">
                  {t.defect_codes.map(([c]) => c).join(" · ")} · top bases {t.bases.map(([b]) => b).join(", ")}
                </p>
                <Chart
                  ariaLabel={`${t.label} monthly reports`}
                  height={56}
                  deps={[t.id]}
                  build={() => {
                    const b = baseChart();
                    return {
                      ...b,
                      grid: { left: 0, right: 0, top: 4, bottom: 0 },
                      tooltip: { ...(b.tooltip as object), valueFormatter: (v: unknown) => `${v} reports` },
                      xAxis: { type: "category", show: false, data: data.months },
                      yAxis: { type: "value", show: false },
                      series: [{ type: "bar", data: t.monthly, barMaxWidth: 10, itemStyle: { color: tokenColor("accent", 0.75), borderRadius: [2, 2, 0, 0] } }],
                    };
                  }}
                />
                <p className="mt-1 text-xs text-subtle">
                  Last 90 days: <b className="text-strong tnum">{t.recent_90d}</b>
                  {change != null && <span className={cn("ml-1 tnum", change > 30 ? "text-caution" : "text-subtle")}>({change > 0 ? "+" : ""}{change}%)</span>}
                </p>
                <p className="mt-2 line-clamp-2 text-xs text-body">“{t.examples[0]?.narrative}”</p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

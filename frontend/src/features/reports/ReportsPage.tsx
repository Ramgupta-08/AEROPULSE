import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { Chart } from "@/components/charts/Chart";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { baseChart, tokenColor } from "@/lib/echartsTheme";
import { fmt } from "@/lib/format";

interface Kpis {
  as_of: string;
  availability_pct: number;
  availability_weekly: number[];
  weeks: string[];
  mtbf_hours: number;
  mttr_hours: number;
  aog_hours_week: number;
  aog_weekly: number[];
  maintenance_cost_90d_lakh: number;
  cost_monthly: { month: string; parts: number; labour: number }[];
  downtime_avoided_aircraft_days: number;
  readiness_gain_pts: number;
  missions_recovered: number;
  plan_saved: boolean;
  prediction: { rmse: number | null; coverage_pct: number | null; nasa_score: number | null; field_feedback: number; field_accuracy_pct: number | null };
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-strong tnum">{value}</p>
      {sub && <p className="mt-1 text-xs text-subtle">{sub}</p>}
    </div>
  );
}

export default function ReportsPage() {
  const { data: k } = useQuery({ queryKey: ["report-kpis"], queryFn: () => api.get<Kpis>("/api/reports/kpis") });
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (path: string, name: string, params?: Record<string, string>) => {
    setBusy(name);
    try {
      await api.download(path, name, params);
      toast.success("Download ready", name);
    } catch (e) {
      toast.error("Download failed", String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <PageHeader
        title="Reports & KPIs"
        description={k ? `Fleet performance as of ${fmt.date(k.as_of)} · simulated data` : "Fleet performance indicators and the commander readiness brief."}
        actions={
          <>
            <Button variant="primary" onClick={() => download("/api/reports/brief.pdf", `aeropulse-readiness-brief-${k?.as_of ?? ""}.pdf`)} disabled={busy !== null}>
              <FileText size={15} strokeWidth={1.75} /> {busy?.endsWith(".pdf") ? "Generating…" : "Readiness brief (PDF)"}
            </Button>
          </>
        }
      />
      {!k ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-card" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Fleet availability" value={`${k.availability_pct.toFixed(1)}%`} sub="mission-capable aircraft today" />
            <Tile label="MTBF · 90 d" value={`${k.mtbf_hours.toFixed(1)} h`} sub="flight hours per unscheduled defect" />
            <Tile label="MTTR · 90 d" value={`${k.mttr_hours.toFixed(1)} h`} sub="mean elapsed repair time" />
            <Tile label="AOG hours · 7 d" value={fmt.int(k.aog_hours_week)} sub="aircraft on ground awaiting parts" />
            <Tile label="Maintenance cost · 90 d" value={fmt.lakh(k.maintenance_cost_90d_lakh)} sub="parts + labour (simulated rates)" />
            <Tile label="Downtime avoided" value={`${fmt.int(k.downtime_avoided_aircraft_days)} ac-days`} sub={`next 30 d, AeroPulse plan vs reactive${k.plan_saved ? "" : " (plan not yet saved)"}`} />
            <Tile label="Readiness gain" value={`+${k.readiness_gain_pts.toFixed(1)} pts`} sub={`${k.missions_recovered} mission(s) recovered`} />
            <Tile
              label="Prediction accuracy"
              value={`RMSE ${k.prediction.rmse ?? "—"}`}
              sub={`${k.prediction.coverage_pct ?? "—"}% inside P10–P90 · ${k.prediction.field_feedback ? `${k.prediction.field_accuracy_pct}% field-confirmed` : "no field feedback yet"}`}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Fleet availability · last 13 weeks" subtitle="Weekly average of mission-capable aircraft, from technical-record downtime" />
              <div className="p-3">
                <Chart
                  ariaLabel="Weekly fleet availability"
                  height={240}
                  deps={[k.as_of]}
                  build={() => {
                    const b = baseChart();
                    return {
                      ...b,
                      tooltip: { ...(b.tooltip as object), valueFormatter: (v: unknown) => `${v}%` },
                      xAxis: { ...(b.xAxis as object), type: "category", boundaryGap: false, data: k.weeks.map((w) => fmt.shortDate(w)) },
                      yAxis: { ...(b.yAxis as object), type: "value", min: 50, max: 100, axisLabel: { color: tokenColor("subtle"), formatter: "{value}%" } },
                      series: [{ type: "line", name: "Availability", data: k.availability_weekly, symbol: "circle", symbolSize: 5, lineStyle: { width: 2, color: tokenColor("accent") }, itemStyle: { color: tokenColor("accent") }, areaStyle: { color: tokenColor("accent", 0.08) } }],
                    };
                  }}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Maintenance cost by month" subtitle="₹ lakh · parts consumed and labour (simulated rates)" />
              <div className="p-3">
                <Chart
                  ariaLabel="Monthly maintenance cost split into parts and labour"
                  height={240}
                  deps={[k.as_of]}
                  build={() => {
                    const b = baseChart();
                    return {
                      ...b,
                      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: tokenColor("subtle") } },
                      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
                      tooltip: { ...(b.tooltip as object), valueFormatter: (v: unknown) => `₹${Number(v).toFixed(1)} L` },
                      xAxis: { ...(b.xAxis as object), type: "category", data: k.cost_monthly.map((m) => m.month.slice(2)) },
                      yAxis: { ...(b.yAxis as object), type: "value" },
                      series: [
                        { type: "bar", name: "Parts", stack: "c", data: k.cost_monthly.map((m) => m.parts), barMaxWidth: 22, itemStyle: { color: tokenColor("series-1") } },
                        { type: "bar", name: "Labour", stack: "c", data: k.cost_monthly.map((m) => m.labour), barMaxWidth: 22, itemStyle: { color: tokenColor("series-3"), borderRadius: [4, 4, 0, 0] } },
                      ],
                    };
                  }}
                />
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title="Data exports" subtitle="CSV for spreadsheets and other systems" />
            <div className="flex flex-wrap gap-2 p-4">
              {[
                ["records", "Technical records"],
                ["fleet", "Fleet status"],
                ["missions", "Missions & coverage"],
              ].map(([d, l]) => (
                <Button key={d} variant="secondary" onClick={() => download("/api/reports/export.csv", `aeropulse-${d}.csv`, { dataset: d })} disabled={busy !== null}>
                  <Download size={14} strokeWidth={1.75} /> {l}
                </Button>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

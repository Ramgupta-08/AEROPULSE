import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Info, MessageSquareText } from "lucide-react";
import { useState } from "react";
import { Chart } from "@/components/charts/Chart";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { baseChart, tokenColor } from "@/lib/echartsTheme";
import { fmt } from "@/lib/format";

interface Metrics {
  rmse: number;
  mae: number;
  nasa_score?: number;
  interval_coverage: number;
  mean_interval_width: number;
  n: number;
  rmse_uncapped_truth?: number;
  raw_interval_coverage?: number;
}
interface DatasetResult {
  dataset: string;
  train_units: number;
  test_units: number;
  train_rows: number;
  operating_conditions: number;
  sensors_used: string[];
  sensors_used_named: { sensor: string; name: string }[];
  sensors_dropped: string[];
  n_features: number;
  conformal_adjustment: number;
  cv: Metrics;
  test: Metrics;
  top_features: { feature: string; gain_pct: number }[];
  calibration: { unit: number; actual: number; p10: number; p50: number; p90: number }[];
}
interface Card {
  trained_at: string;
  data_source: string;
  model: string;
  rul_cap: number;
  datasets: DatasetResult[];
  fleet_datasets: string[];
  anomaly: { dataset: string; threshold: number; n_train: number; contamination: number }[];
  assumptions: string[];
  limitations: string[];
  environment_multipliers: Record<string, Record<string, number>>;
  environment_notes: Record<string, string>;
  profile_multipliers: Record<string, Record<string, number>>;
  profile_notes: Record<string, string>;
  feedback: { total: number; correct: number; early: number; late: number; accuracy_pct: number | null; recent: { tail: string; verdict: string; predicted_p50: number; user: string; created_at: string }[] };
}

const KIND_LABEL: Record<string, string> = {
  apu: "APU", landing_gear: "Gear", hydraulics: "Hydraulics", avionics: "Avionics", fuel: "Fuel", flight_controls: "Flt ctrl", ecs: "ECS",
};

function featureLabel(f: string, named: Record<string, string>) {
  if (f === "cycle") return "Cycles since overhaul";
  const [s, stat] = f.split("_");
  const name = named[s] ?? s;
  if (!stat) return `${name} (latest)`;
  const m = stat.match(/(mean|std|slope)(\d+)/);
  if (!m) return name;
  return `${name} · ${m[1] === "mean" ? "mean" : m[1] === "std" ? "volatility" : "trend"} ${m[2]} cycles`;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3" title={hint}>
      <p className="label">{label}</p>
      <p className="mt-1 text-xl font-semibold text-strong tnum">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

function MultiplierMatrix({ title, data, notes }: { title: string; data: Record<string, Record<string, number>>; notes: Record<string, string> }) {
  const kinds = Object.keys(KIND_LABEL);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={title}>
        <thead>
          <tr className="text-left">
            <th className="label py-2 pr-3">{title}</th>
            {kinds.map((k) => (
              <th key={k} className="label px-2 py-2 text-right">
                {KIND_LABEL[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(data).map(([env, m]) => (
            <tr key={env} className="border-t border-border/70">
              <td className="py-2 pr-3">
                <span className="text-strong">{env.replace(/-/g, " ")}</span>
                <span className="block text-xs text-subtle">{notes[env]}</span>
              </td>
              {kinds.map((k) => (
                <td key={k} className={`px-2 py-2 text-right tnum ${m[k] ? "font-medium text-strong" : "text-subtle"}`}>
                  {m[k] ? `×${m[k].toFixed(2)}` : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ModelCard() {
  const { data, isLoading } = useQuery({ queryKey: ["model-card"], queryFn: () => api.get<Card>("/api/health/model-card") });
  const [ds, setDs] = useState("FD001");
  if (isLoading || !data) return <SkeletonRows rows={10} />;
  const d = data.datasets.find((x) => x.dataset === ds) ?? data.datasets[0];
  const named = Object.fromEntries(d.sensors_used_named.map((s) => [s.sensor, s.name]));
  const fb = data.feedback;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="RUL model card"
          subtitle={`${data.model} · trained ${fmt.dateTime(data.trained_at)} · data: ${data.data_source}`}
          actions={<Segmented ariaLabel="Dataset" value={d.dataset} onChange={setDs} options={data.datasets.map((x) => ({ value: x.dataset, label: x.dataset }))} />}
        />
        <CardBody className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Test RMSE" value={d.test.rmse.toFixed(2)} hint={`cycles · ${d.test.n} test engines`} />
            <Metric label="Test MAE" value={d.test.mae.toFixed(2)} hint="cycles" />
            <Metric label="NASA score" value={fmt.int(d.test.nasa_score ?? 0)} hint="PHM08, lower is better" />
            <Metric label="Interval coverage" value={`${(100 * d.test.interval_coverage).toFixed(0)}%`} hint="truth inside P10–P90 (target 80 %)" />
            <Metric label="Mean width" value={d.test.mean_interval_width.toFixed(0)} hint="cycles, P90 − P10" />
            <Metric label="Grouped CV RMSE" value={d.cv.rmse.toFixed(2)} hint={`5-fold by engine · ${fmt.int(d.cv.n)} rows`} />
          </div>
          <p className="flex items-start gap-2 text-sm text-body">
            <Info size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-info" aria-hidden />
            <span>
              Metrics are on the official NASA C-MAPSS {d.dataset} test set ({d.test_units} engines never seen in training), with true RUL capped at{" "}
              {data.rul_cap} cycles; RMSE against uncapped truth is {d.test.rmse_uncapped_truth?.toFixed(2)}. Intervals are conformalised by ±{d.conformal_adjustment.toFixed(1)} cycles
              {d.cv.raw_interval_coverage != null && ` (raw quantile coverage in CV was ${(100 * d.cv.raw_interval_coverage).toFixed(0)} %)`}.{" "}
              {data.fleet_datasets.includes(d.dataset) ? "This model drives fleet engines." : "Reported for completeness; fleet engines use FD001/FD003."}
            </span>
          </p>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="label mb-2">Calibration — predicted vs actual (test engines)</h3>
              <Chart
                ariaLabel="Predicted remaining life versus actual for each test engine"
                height={280}
                deps={[d.dataset]}
                build={() => {
                  const b = baseChart();
                  const pts = d.calibration.map((c) => [c.actual, c.p50, c.p10, c.p90, c.unit]);
                  return {
                    ...b,
                    grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
                    tooltip: {
                      ...(b.tooltip as object),
                      trigger: "item",
                      formatter: (p: unknown) => {
                        const v = (p as { value: number[] }).value;
                        return `Engine ${v[4]}<br/>Actual <b>${v[0]}</b> · predicted <b>${v[1].toFixed(0)}</b> <span style="opacity:.7">(${v[2].toFixed(0)}–${v[3].toFixed(0)})</span>`;
                      },
                    },
                    xAxis: { ...(b.xAxis as object), type: "value", min: 0, max: 130, name: "actual RUL (cycles)", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: tokenColor("subtle") } },
                    yAxis: { ...(b.yAxis as object), type: "value", min: 0, max: 140, name: "predicted P50", nameTextStyle: { color: tokenColor("subtle"), align: "left" } },
                    series: [
                      {
                        type: "line",
                        data: [
                          [0, 0],
                          [130, 130],
                        ],
                        symbol: "none",
                        lineStyle: { color: tokenColor("border-strong"), type: "dashed", width: 1 },
                        silent: true,
                        tooltip: { show: false },
                      },
                      { type: "scatter", data: pts, symbolSize: 8, itemStyle: { color: tokenColor("accent", 0.75), borderColor: tokenColor("surface"), borderWidth: 1 } },
                    ],
                  };
                }}
              />
            </div>
            <div>
              <h3 className="label mb-2">Most important features (gain)</h3>
              <ul className="space-y-2">
                {d.top_features.slice(0, 10).map((f) => (
                  <li key={f.feature} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate text-body">{featureLabel(f.feature, named)}</span>
                    <span className="h-1.5 w-28 overflow-hidden rounded-full bg-raised">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${(100 * f.gain_pct) / d.top_features[0].gain_pct}%` }} />
                    </span>
                    <span className="w-10 text-right text-xs text-subtle tnum">{f.gain_pct.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Data & features" />
          <CardBody className="space-y-3 text-sm text-body">
            <p>
              <b className="text-strong">{d.dataset}</b>: {d.train_units} training engines ({fmt.int(d.train_rows)} cycles), {d.test_units} test engines, {d.operating_conditions}{" "}
              operating condition{d.operating_conditions > 1 ? "s (sensors normalised per condition, k-means on settings)" : ""}.
            </p>
            <p>
              <b className="text-strong">{d.n_features} features</b>: each informative sensor's latest value, rolling mean and volatility over 5 / 10 / 20 cycles, and trend (least-squares slope)
              over 10 / 20 cycles, plus cycles since overhaul. Target: RUL capped at {data.rul_cap} cycles (piecewise linear).
            </p>
            <div>
              <p className="label mb-1.5">Sensors used</p>
              <div className="flex flex-wrap gap-1.5">
                {d.sensors_used_named.map((s) => (
                  <span key={s.sensor} className="rounded-md border border-border px-1.5 py-0.5 text-xs">
                    <span className="font-mono text-subtle">{s.sensor}</span> {s.name}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-subtle">Dropped as near-constant: {d.sensors_dropped.join(", ")}.</p>
            </div>
            <p>
              <b className="text-strong">Unknown-fault detector</b>: IsolationForest ({data.anomaly.map((a) => `${a.dataset}: ${fmt.int(a.n_train)} windows`).join(", ")}) on residuals from the
              learned degradation path, flagged at the 1 % tail.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Assumptions & limitations" />
          <CardBody className="space-y-4 text-sm">
            <ul className="space-y-2">
              {data.assumptions.map((a) => (
                <li key={a} className="flex gap-2 text-body">
                  <CircleCheck size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                  {a}
                </li>
              ))}
            </ul>
            <div>
              <p className="label mb-2">Limitations</p>
              <ul className="list-disc space-y-1.5 pl-5 text-body marker:text-subtle">
                {data.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Environment & sortie-profile multipliers" subtitle="Applied to non-engine component wear; shown transparently on each component" />
        <CardBody className="space-y-6">
          <MultiplierMatrix title="Base environment" data={data.environment_multipliers} notes={data.environment_notes} />
          <MultiplierMatrix title="Sortie profile" data={data.profile_multipliers} notes={data.profile_notes} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Technician feedback loop" subtitle="Continuous-learning ready: verdicts are stored with the prediction and chained to the audit log" />
        <CardBody>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Feedback received" value={String(fb.total)} />
            <Metric label="Prediction correct" value={String(fb.correct)} />
            <Metric label="Too early / too late" value={`${fb.early} / ${fb.late}`} />
            <Metric label="Field accuracy" value={fb.accuracy_pct == null ? "—" : `${fb.accuracy_pct}%`} hint={fb.accuracy_pct == null ? "awaiting first feedback" : undefined} />
          </div>
          {fb.recent.length > 0 ? (
            <ul className="mt-4 divide-y divide-border/70 text-sm">
              {fb.recent.map((r) => (
                <li key={r.created_at + r.tail} className="flex flex-wrap items-center gap-3 py-2">
                  <MessageSquareText size={14} strokeWidth={1.75} className="text-subtle" aria-hidden />
                  <span className="font-mono text-strong">{r.tail}</span>
                  <span className="text-body">marked {r.verdict}</span>
                  <span className="text-subtle">predicted {r.predicted_p50.toFixed(0)}</span>
                  <span className="ml-auto text-xs text-subtle">
                    {r.user} · {fmt.dateTime(r.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-subtle">Open any component and use “Technician feedback” after maintenance to record whether the prediction was right.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

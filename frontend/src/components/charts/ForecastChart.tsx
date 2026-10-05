import type { EChartsOption } from "echarts";
import { baseChart, tokenColor } from "@/lib/echartsTheme";
import { fmt } from "@/lib/format";
import type { ForecastSeries } from "@/lib/types";
import { Chart } from "./Chart";

/** Mission-capable forecast: P50 line, P10–P90 band, mission demand, red shading where demand > supply. */
export function ForecastChart({
  days,
  series,
  height = 280,
  compare,
  compareLabel,
  label = "Forecast mission-capable",
}: {
  days: string[];
  series: ForecastSeries;
  height?: number;
  compare?: number[];
  compareLabel?: string;
  label?: string;
}) {
  return (
    <Chart
      ariaLabel={`${label} versus mission demand over ${days.length} days`}
      height={height}
      deps={[JSON.stringify(series), days[0], compare?.join(",")]}
      build={() => {
        const base = baseChart();
        const accent = tokenColor("accent");
        const x = days.map((d) => fmt.shortDate(d));
        // Contiguous shortfall ranges for markArea
        const areas: [{ xAxis: string }, { xAxis: string }][] = [];
        let start: number | null = null;
        series.p50.forEach((v, i) => {
          const short = series.demand[i] > v;
          if (short && start === null) start = i;
          if ((!short || i === series.p50.length - 1) && start !== null) {
            const end = short ? i : i - 1;
            areas.push([{ xAxis: x[start] }, { xAxis: x[end] }]);
            start = null;
          }
        });
        const maxY = Math.max(series.total, ...series.demand) + 2;
        const opt: EChartsOption = {
          ...base,
          grid: { left: 8, right: 92, top: 18, bottom: 8, containLabel: true },
          legend: {
            top: 0,
            right: 0,
            itemWidth: 14,
            itemHeight: 2,
            textStyle: { color: tokenColor("subtle"), fontSize: 12 },
            data: [label, "Mission demand", ...(compare ? [compareLabel ?? "Baseline"] : [])],
          },
          tooltip: {
            ...(base.tooltip as object),
            formatter: (ps: unknown) => {
              const arr = ps as { dataIndex: number }[];
              const i = arr[0]?.dataIndex ?? 0;
              const short = series.demand[i] - series.p50[i];
              const rows = [
                `<div style="font-weight:600;margin-bottom:4px">${fmt.date(days[i])} · day ${i}</div>`,
                `${label}: <b>${series.p50[i]}</b> aircraft <span style="opacity:.7">(${series.low[i]}–${series.high[i]})</span>`,
                `Mission demand: <b>${series.demand[i]}</b>`,
                compare ? `${compareLabel}: <b>${compare[i]}</b>` : "",
                short > 0 ? `<span style="color:${tokenColor("grounded")}">Shortfall: ${short} aircraft</span>` : "",
              ];
              return rows.filter(Boolean).join("<br/>");
            },
          },
          xAxis: { ...(base.xAxis as object), type: "category", data: x, boundaryGap: false, axisLabel: { color: tokenColor("subtle"), interval: 4 } },
          yAxis: { ...(base.yAxis as object), type: "value", min: 0, max: maxY, minInterval: 1 },
          series: [
            { name: "band-low", type: "line", data: series.low, stack: "band", symbol: "none", lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
            {
              name: "band",
              type: "line",
              data: series.high.map((h, i) => h - series.low[i]),
              stack: "band",
              symbol: "none",
              lineStyle: { opacity: 0 },
              areaStyle: { color: tokenColor("accent", 0.14) },
              silent: true,
            },
            {
              name: label,
              type: "line",
              data: series.p50,
              symbol: "none",
              lineStyle: { width: 2, color: accent },
              itemStyle: { color: accent },
              endLabel: { show: true, formatter: `{c} ready`, color: tokenColor("body"), fontSize: 12 },
              markArea: {
                silent: true,
                itemStyle: { color: tokenColor("grounded", 0.12) },
                label: { show: true, position: "insideTop", color: tokenColor("grounded"), fontSize: 11, formatter: "Shortfall" },
                data: areas,
              },
            },
            {
              name: "Mission demand",
              type: "line",
              step: "middle",
              data: series.demand,
              symbol: "none",
              lineStyle: { width: 1.5, type: "dashed", color: tokenColor("strong", 0.7) },
              itemStyle: { color: tokenColor("strong", 0.7) },
              endLabel: { show: true, formatter: "{c} needed", color: tokenColor("subtle"), fontSize: 12 },
            },
            ...(compare
              ? [
                  {
                    name: compareLabel ?? "Baseline",
                    type: "line" as const,
                    data: compare,
                    symbol: "none",
                    lineStyle: { width: 1.5, color: tokenColor("subtle") },
                    itemStyle: { color: tokenColor("subtle") },
                  },
                ]
              : []),
          ],
        };
        return opt;
      }}
    />
  );
}

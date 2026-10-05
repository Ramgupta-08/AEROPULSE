import { tokenColor } from "@/lib/echartsTheme";
import { Chart } from "./Chart";

export function Sparkline({ data, tone = "accent", height = 32, ariaLabel }: { data: number[]; tone?: string; height?: number; ariaLabel: string }) {
  return (
    <Chart
      ariaLabel={ariaLabel}
      height={height}
      deps={[data.join(","), tone]}
      build={() => ({
        animation: false,
        grid: { left: 0, right: 0, top: 2, bottom: 2 },
        xAxis: { type: "category", show: false, boundaryGap: false, data: data.map((_, i) => i) },
        yAxis: { type: "value", show: false, scale: true },
        series: [
          {
            type: "line",
            data,
            symbol: "none",
            smooth: 0.3,
            lineStyle: { width: 1.5, color: tokenColor(tone) },
            areaStyle: { color: tokenColor(tone, 0.08) },
          },
        ],
      })}
    />
  );
}

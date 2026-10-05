import type { EChartsOption } from "echarts";

/** Read a design token (RGB triplet) and return a css colour string. */
export function tokenColor(name: string, alpha = 1): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const [r, g, b] = v.split(/\s+/);
  return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Base option shared by every chart: thin grid, no junk, token colours. */
export function baseChart(): EChartsOption {
  const subtle = tokenColor("subtle");
  const grid = tokenColor("chart-grid");
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: "Inter Variable, Inter, system-ui, sans-serif", color: subtle, fontSize: 12 },
    animationDuration: 250,
    animationEasing: "cubicOut",
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: tokenColor("raised"),
      borderColor: tokenColor("border"),
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: tokenColor("body"), fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: tokenColor("border-strong") } },
      extraCssText: "box-shadow:none;border-radius:8px;font-variant-numeric:tabular-nums;",
    },
    xAxis: {
      axisLine: { lineStyle: { color: grid } },
      axisTick: { show: false },
      axisLabel: { color: subtle, fontSize: 12, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: subtle, fontSize: 12 },
      splitLine: { lineStyle: { color: grid, width: 1 } },
    },
  };
}

export const STATUS_TOKEN = { ready: "ready", caution: "caution", grounded: "grounded" } as const;

/** Narrow containers (phones) drop end-of-line labels; the legend and tooltip still identify series. */
export const isNarrow = () => typeof window !== "undefined" && window.innerWidth < 640;

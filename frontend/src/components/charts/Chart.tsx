import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { useUi } from "@/lib/store";

/**
 * ECharts wrapper. `build` is re-run when the theme changes so token colours stay in sync.
 */
export function Chart({
  build,
  deps = [],
  height = 240,
  className,
  ariaLabel,
  onEvents,
}: {
  build: () => EChartsOption;
  deps?: unknown[];
  height?: number | string;
  className?: string;
  ariaLabel: string;
  onEvents?: Record<string, (params: unknown) => void>;
}) {
  const theme = useUi((s) => s.theme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(build, [theme, ...deps]);
  return (
    <div role="img" aria-label={ariaLabel} className={className}>
      <ReactECharts option={option} notMerge lazyUpdate style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} onEvents={onEvents} />
    </div>
  );
}

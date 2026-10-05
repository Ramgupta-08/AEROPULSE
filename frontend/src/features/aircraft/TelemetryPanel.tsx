import { CircleAlert, Radio, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Chart } from "@/components/charts/Chart";
import { Card, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { api } from "@/lib/api";
import { baseChart, tokenColor } from "@/lib/echartsTheme";
import { cn } from "@/lib/utils";

interface Signal {
  key: string;
  label: string;
  unit: string;
  normal: [number, number];
}
type Frame = Record<string, Record<string, number>>;

const WINDOW = 60;

function SignalChart({ s, values }: { s: Signal; values: number[] }) {
  const last = values[values.length - 1];
  const out = last != null && (last < s.normal[0] || last > s.normal[1]);
  return (
    <div className="min-w-0 rounded-lg border border-border bg-bg/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">{s.label}</span>
        <span className={cn("inline-flex items-center gap-1 font-mono text-md tnum", out ? "text-caution" : "text-strong")}>
          {out && <CircleAlert size={14} strokeWidth={2} aria-label="Outside normal range" />}
          {last != null ? last.toLocaleString("en-IN", { maximumFractionDigits: s.unit === "kg/h" ? 0 : s.unit === "°C" ? 1 : 2 }) : "—"}
          <span className="text-xs text-subtle">{s.unit}</span>
        </span>
      </div>
      <Chart
        ariaLabel={`${s.label} live trend`}
        height={84}
        deps={[values.length, last]}
        build={() => {
          const b = baseChart();
          // Fit the axis to the live data so small changes stay visible; the normal band shows where it overlaps.
          const lo = Math.min(...values);
          const hi = Math.max(...values);
          const pad = Math.max((hi - lo) * 0.6, Math.abs(hi) * 0.004, 0.05);
          return {
            ...b,
            animationDurationUpdate: 450,
            animationEasingUpdate: "linear",
            grid: { left: 0, right: 0, top: 6, bottom: 2 },
            tooltip: { ...(b.tooltip as object), valueFormatter: (v: unknown) => `${v} ${s.unit}` },
            xAxis: { type: "category", show: false, boundaryGap: false, data: values.map((_, i) => i) },
            yAxis: { type: "value", show: false, min: lo - pad, max: hi + pad },
            series: [
              {
                type: "line",
                name: s.label,
                data: values,
                symbol: "none",
                lineStyle: { width: 1.5, color: out ? tokenColor("caution") : tokenColor("accent") },
                markArea: {
                  silent: true,
                  itemStyle: { color: tokenColor("ready", 0.08) },
                  data: [[{ yAxis: s.normal[0] }, { yAxis: s.normal[1] }]],
                },
              },
            ],
          };
        }}
      />
      <p className="mt-1 text-[11px] text-subtle tnum">
        Normal {s.normal[0]}–{s.normal[1]} {s.unit}
      </p>
    </div>
  );
}

export function TelemetryPanel({ tail }: { tail: string }) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [engines, setEngines] = useState<string[]>([]);
  const [engine, setEngine] = useState<string>("");
  const [state, setState] = useState<"connecting" | "live" | "closed">("connecting");
  const buffer = useRef<Record<string, Record<string, number[]>>>({});
  const [, tick] = useState(0);

  useEffect(() => {
    buffer.current = {};
    setState("connecting");
    const ws = new WebSocket(api.wsUrl(`/ws/telemetry/${tail}`));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "meta") {
        setSignals(msg.signals);
        setEngines(msg.engines);
        setEngine((e) => (msg.engines.includes(e) ? e : msg.engines[msg.engines.length > 1 ? 1 : 0] ?? ""));
        setState("live");
      } else if (msg.type === "frame") {
        const f = msg.engines as Frame;
        for (const [eng, vals] of Object.entries(f)) {
          const b = (buffer.current[eng] ??= {});
          for (const [k, v] of Object.entries(vals)) {
            const arr = (b[k] ??= []);
            arr.push(v);
            if (arr.length > WINDOW) arr.shift();
          }
        }
        tick((n) => n + 1);
      }
    };
    ws.onclose = () => setState("closed");
    ws.onerror = () => setState("closed");
    return () => ws.close();
  }, [tail]);

  return (
    <Card>
      <CardHeader
        title="Live telemetry"
        subtitle="Simulated health-monitoring stream (WebSocket) replaying each engine's recent C-MAPSS sensor history"
        actions={
          <>
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", state === "live" ? "text-ready" : "text-subtle")} role="status">
              {state === "closed" ? <WifiOff size={14} strokeWidth={1.75} /> : <Radio size={14} strokeWidth={1.75} className={state === "live" ? "animate-pulse-dot" : ""} />}
              {state === "live" ? "Streaming 2 Hz" : state === "connecting" ? "Connecting" : "Stream closed"}
            </span>
            {engines.length > 1 && <Segmented ariaLabel="Engine" value={engine} onChange={setEngine} options={engines.map((e) => ({ value: e, label: e.replace("Engine ", "E") }))} />}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3">
        {signals.map((s) => (
          <SignalChart key={s.key} s={s} values={buffer.current[engine]?.[s.key] ?? []} />
        ))}
        {!signals.length && <p className="col-span-full py-8 text-center text-sm text-subtle">{state === "closed" ? "Telemetry stream unavailable." : "Waiting for first frame…"}</p>}
      </div>
    </Card>
  );
}

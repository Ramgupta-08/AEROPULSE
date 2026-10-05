import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, FlaskConical, MessageSquareText, TrendingDown } from "lucide-react";
import { Chart } from "@/components/charts/Chart";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { SkeletonRows } from "@/components/ui/skeleton";
import { COMPONENT_TONE_LABEL, StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { baseChart, tokenColor } from "@/lib/echartsTheme";
import { fmt } from "@/lib/format";
import { useMeta } from "@/lib/queries";
import type { ComponentDetail, RecordRow } from "@/lib/types";
import { cn } from "@/lib/utils";

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-t border-border pt-4", className)}>
      <h3 className="label mb-3">{title}</h3>
      {children}
    </section>
  );
}

function UsageBar({ label, used, limit, pct, unit }: { label: string; used: number; limit: number; pct: number; unit: string }) {
  const tone = pct >= 90 ? "bg-grounded" : pct >= 75 ? "bg-caution" : "bg-accent";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-body">{label}</span>
        <span className="text-subtle tnum">
          {fmt.int(used)} / {fmt.int(limit)} {unit} · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} life used`}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

export function RecordItem({ r, showTail }: { r: RecordRow; showTail?: boolean }) {
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
        <span className="tnum">{fmt.date(r.date)}</span>
        <span className="font-mono text-body">{r.defect_code}</span>
        {showTail && <span className="font-mono text-strong">{r.tail}</span>}
        {r.batch && <span className="font-mono">batch {r.batch}</span>}
        <span className="ml-auto">{r.technician}</span>
      </div>
      <p className="mt-1.5 text-sm text-strong">{r.narrative}</p>
      <p className="mt-1 text-sm text-body">{r.action_taken}</p>
    </li>
  );
}

export function ComponentDrawer({ tail, componentId, onClose }: { tail: string; componentId: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const { data: c, isLoading } = useQuery({
    queryKey: ["component", tail, componentId],
    queryFn: () => api.get<ComponentDetail>(`/api/aircraft/${tail}/components/${componentId}`),
    enabled: componentId != null,
  });
  const feedback = useMutation({
    mutationFn: (verdict: string) => api.post("/api/health/feedback", { component_id: componentId, verdict }),
    onSuccess: (_, verdict) => {
      toast.success("Feedback recorded", `Prediction marked “${verdict}”. It is logged to the audit chain and the model card.`);
      qc.invalidateQueries({ queryKey: ["model-card"] });
    },
    onError: (e) => toast.error("Could not record feedback", String(e)),
  });
  const canFeedback = meta?.role.areas.includes("health_write");
  const unit = c?.rul_unit === "sorties" ? "sorties" : "days";

  return (
    <Drawer
      open={componentId != null}
      onOpenChange={(o) => !o && onClose()}
      title={c ? c.position : "Component"}
      subtitle={c ? `${tail} · ${c.part_number} · S/N ${c.serial}` : undefined}
      width="max-w-[600px]"
    >
      {isLoading || !c ? (
        <SkeletonRows rows={10} />
      ) : (
        <div className="space-y-5" data-tour="component-drawer">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="label">Remaining useful life</p>
              <p className="mt-1 text-lg text-strong">
                {c.failed ? (
                  "Predicted failed — ground and rectify"
                ) : (
                  <>
                    Fails in <b className="font-semibold tnum">{c.p50.toFixed(0)}</b> {unit}{" "}
                    <span className="text-subtle">
                      (range {c.p10.toFixed(0)}–{c.p90.toFixed(0)}, 80 % interval)
                    </span>
                  </>
                )}
              </p>
              {c.rul_unit === "sorties" && (
                <p className="mt-1 text-sm text-subtle">
                  ≈ {c.p50_days.toFixed(0)} days at {c.sorties_per_day} sorties/day · 1 engine cycle ≈ 1 sortie
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="label">Health</p>
              <p className="mt-1 text-xl font-semibold text-strong tnum">{c.health.toFixed(0)}</p>
              <StatusPill tone={c.tone} label={COMPONENT_TONE_LABEL[c.tone]} />
            </div>
          </div>

          <Chart
            ariaLabel={`${c.position} remaining life history and projection`}
            height={180}
            deps={[c.id]}
            build={() => {
              const b = baseChart();
              const x = c.history.map((h) => h.day);
              return {
                ...b,
                grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
                tooltip: {
                  ...(b.tooltip as object),
                  formatter: (ps: unknown) => {
                    const i = (ps as { dataIndex: number }[])[0].dataIndex;
                    const h = c.history[i];
                    return `Day ${h.day > 0 ? "+" : ""}${h.day}${h.cycle ? ` · cycle ${h.cycle}` : ""}<br/>P50 <b>${h.p50.toFixed(0)}</b> ${unit} <span style="opacity:.7">(${h.p10.toFixed(0)}–${h.p90.toFixed(0)})</span>`;
                  },
                },
                xAxis: { ...(b.xAxis as object), type: "category", data: x, boundaryGap: false, axisLabel: { color: tokenColor("subtle"), formatter: (v: string) => `${Number(v) > 0 ? "+" : ""}${Math.round(Number(v))}d`, interval: Math.ceil(x.length / 6) } },
                yAxis: { ...(b.yAxis as object), type: "value", min: 0 },
                series: [
                  { type: "line", data: c.history.map((h) => h.p10), stack: "b", symbol: "none", lineStyle: { opacity: 0 }, silent: true },
                  { type: "line", data: c.history.map((h) => h.p90 - h.p10), stack: "b", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: tokenColor("accent", 0.14) }, silent: true },
                  {
                    type: "line",
                    name: "P50",
                    data: c.history.map((h) => h.p50),
                    symbol: "none",
                    lineStyle: { width: 2, color: tokenColor("accent") },
                    markLine: { silent: true, symbol: "none", lineStyle: { color: tokenColor("border-strong"), type: "dashed" }, label: { formatter: "today", color: tokenColor("subtle") }, data: [{ xAxis: String(c.history.reduce((best, h) => (Math.abs(h.day) < Math.abs(best) ? h.day : best), c.history[0].day)) }] },
                  },
                ],
              };
            }}
          />
          <p className="-mt-3 text-xs text-subtle">
            {c.model}
            {c.engine_ref ? ` · trajectory ${c.engine_ref}` : ""} · shaded band = P10–P90
          </p>

          {c.reasons.length > 0 && (
            <Section title="Why — top drivers (SHAP)">
              <ul className="space-y-2.5">
                {c.reasons.map((r) => {
                  const max = Math.max(...c.reasons.map((x) => Math.abs(x.impact)));
                  return (
                    <li key={r.sensor} className="flex items-center gap-3">
                      <TrendingDown size={15} strokeWidth={1.75} className="shrink-0 text-caution" aria-hidden />
                      <span className="min-w-0 flex-1 text-sm text-body">{r.text}</span>
                      <span className="flex w-24 shrink-0 items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
                          <span className="block h-full rounded-full bg-caution" style={{ width: `${(100 * Math.abs(r.impact)) / max}%` }} />
                        </span>
                        <span className="w-9 text-right text-xs text-subtle tnum">{r.impact.toFixed(0)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-subtle">Impact = cycles of remaining life this driver removes from the prediction.</p>
            </Section>
          )}

          {c.anomaly && (
            <Section title="Unknown-fault detector">
              <div className={cn("flex gap-3 rounded-lg border p-3", c.anomaly.flagged ? "border-caution/40 bg-caution/8" : "border-border")}>
                {c.anomaly.flagged ? <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-caution" /> : <Check size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ready" />}
                <div className="text-sm">
                  <p className="text-strong">{c.anomaly.flagged ? "Unusual behaviour — doesn't match known degradation" : "Behaviour consistent with known degradation"}</p>
                  <p className="mt-1 text-subtle">
                    Isolation score {c.anomaly.score.toFixed(3)} (threshold {c.anomaly.threshold.toFixed(3)}). Most deviant:{" "}
                    {c.anomaly.sensors.map((s) => `${s.name} (${s.kind === "drift" ? `${s.z > 0 ? "+" : ""}${s.z.toFixed(1)}σ drift` : `${s.volatility_ratio.toFixed(1)}× noise`})`).join(", ")}.
                  </p>
                </div>
              </div>
            </Section>
          )}

          <Section title="Life-limit usage">
            <div className="space-y-3">
              <UsageBar label="Flight hours" unit="h" {...c.life_usage.hours} />
              <UsageBar label="Cycles" unit="cyc" {...c.life_usage.cycles} />
              <UsageBar label="Calendar" unit="days" {...c.life_usage.calendar} />
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-subtle">
              <Clock size={13} strokeWidth={1.75} /> Hard life limit reached in {Math.max(0, c.life_due_days).toFixed(0)} days
            </p>
          </Section>

          {c.rul_unit === "days" && (
            <Section title="Environment & flight-profile adjustment">
              <p className="text-sm text-body">
                Base environment <b className="text-strong">{c.environment}</b> ×{c.env_multiplier.toFixed(2)} · sortie profile{" "}
                <b className="text-strong">{c.sortie_profile.replace(/-/g, " ")}</b> ×{c.profile_multiplier.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-subtle">Wear rate is multiplied by both factors; documented on the Model Card.</p>
            </Section>
          )}

          <Section title="Installed part">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-subtle">Part number</dt>
                <dd className="font-mono text-strong">{c.part_number}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Serial</dt>
                <dd className="font-mono text-strong">{c.serial}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Batch</dt>
                <dd className={cn("font-mono", c.bad_batch ? "text-grounded" : "text-strong")}>{c.batch}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Supplier</dt>
                <dd className="text-strong">{c.supplier}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Installed</dt>
                <dd className="text-strong">{fmt.date(c.installed_on)}</dd>
              </div>
            </dl>
            {c.bad_batch && (
              <div className="mt-3 flex gap-2 rounded-lg border border-grounded/40 bg-grounded/8 p-3 text-sm">
                <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-grounded" />
                <span className="text-body">
                  Batch <b className="font-mono text-strong">{c.batch}</b> failed early on {new Set(c.same_batch_records.map((r) => r.tail)).size} other
                  aircraft — likely bad batch. Plan replacement.
                </span>
              </div>
            )}
          </Section>

          {canFeedback && (
            <Section title="Technician feedback">
              <p className="mb-2 text-sm text-subtle">After maintenance, was this prediction right?</p>
              <div className="flex flex-wrap gap-2">
                {(["correct", "early", "late"] as const).map((v) => (
                  <Button key={v} size="sm" variant="secondary" disabled={feedback.isPending} onClick={() => feedback.mutate(v)}>
                    <MessageSquareText size={13} strokeWidth={1.75} /> {v === "correct" ? "Prediction correct" : v === "early" ? "Too early" : "Too late"}
                  </Button>
                ))}
              </div>
            </Section>
          )}

          <Section title={`Maintenance history · ${c.records.length}`}>
            {c.records.length ? (
              <ul className="space-y-2">
                {c.records.map((r) => (
                  <RecordItem key={r.id} r={r} />
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-subtle">
                <FlaskConical size={14} strokeWidth={1.75} /> No technical records for this component on {tail}.
              </p>
            )}
          </Section>

          {c.same_batch_records.length > 0 && (
            <Section title={`Linked logbook entries · same batch ${c.batch}`}>
              <ul className="space-y-2">
                {c.same_batch_records.map((r) => (
                  <RecordItem key={r.id} r={r} showTail />
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Play, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useUi, type RoleId } from "@/lib/store";
import type { AircraftDetail, Alert, ComponentDetail, Compare, Forecast, KpiOverview, MissionRow, PlanMeta } from "@/lib/types";

interface StepContent {
  title: string;
  body: string;
  route: string;
  target?: string;
  phone?: string; // route rendered inside a phone-width frame
}
interface Step {
  role: RoleId;
  prepare: (qc: QueryClient) => Promise<StepContent>;
}

const SYMPTOM = "Hydraulic pressure dropping on left side after landing";

const STEPS: Step[] = [
  {
    role: "engineering_officer",
    prepare: async () => {
      await api.post("/api/schedule/reset").catch(() => undefined);
      await api.post("/api/records/restore").catch(() => undefined);
      const [k, f, m] = await Promise.all([
        api.get<KpiOverview>("/api/kpi/overview"),
        api.get<Forecast>("/api/forecast"),
        api.get<{ missions: MissionRow[] }>("/api/missions"),
      ]);
      const big = [...m.missions].filter((x) => x.start_day > 0).sort((a, b) => b.required - a.required)[0];
      const fighters = f.types[big?.aircraft_type ?? "Fighter Type-A"];
      const short = Math.max(0, ...fighters.demand.map((d, i) => d - fighters.p50[i]));
      return {
        route: "/",
        target: '[data-tour="forecast"]',
        title: `Readiness ${k.readiness_pct.toFixed(0)} % — and a shortfall ahead`,
        body: `${k.mission_capable} of ${k.total} aircraft are mission-capable today. ${big.name} starts in ${big.start_day} days and needs ${big.required} ${big.aircraft_type.split(" ")[0].toLowerCase()}s. With today's reactive maintenance the 30-day forecast falls up to ${short} aircraft short — the red band.`,
      };
    },
  },
  {
    role: "engineering_officer",
    prepare: async () => {
      const alerts = await api.get<Alert[]>("/api/alerts", { limit: 1 });
      const top = alerts[0];
      const a = await api.get<AircraftDetail>(`/api/aircraft/${top.tail}`);
      const comp = a.components.find((c) => c.id === top.component_id) ?? a.components[0];
      const d = await api.get<ComponentDetail>(`/api/aircraft/${top.tail}/components/${comp.id}`);
      // Lower-case the first letter for mid-sentence use, but leave acronyms (HPC, EGT) intact.
      const reasons = d.reasons.slice(0, 2).map((r) => (/^[A-Z][a-z]/.test(r.text) ? r.text.charAt(0).toLowerCase() + r.text.slice(1) : r.text));
      return {
        route: `/aircraft/${top.tail}?component=${comp.id}`,
        target: '[data-tour="component-drawer"]',
        title: `Top alert: ${top.tail} ${comp.position}`,
        body: `The digital twin shows ${comp.position} in the warning colour: it ${d.rul_unit === "sorties" ? `fails in ${d.p50.toFixed(0)} sorties (${d.p10.toFixed(0)}–${d.p90.toFixed(0)}, 80 % interval)` : `fails in ${d.p50_days.toFixed(0)} days`}. Why: ${reasons.join("; ")}. Two more tasks on ${top.tail} fall due in the same window.`,
      };
    },
  },
  {
    role: "engineering_officer",
    prepare: async () => {
      const d = await api.get<{ insights: { type: string; message: string }[] }>("/api/logbook/insights");
      const batch = d.insights.find((i) => i.type === "bad-batch");
      return {
        route: "/copilot?tab=insights",
        target: '[data-tour="insights"]',
        title: "Logbook intelligence finds a bad batch",
        body: batch ? batch.message : "Logbook clustering surfaces recurring faults across bases.",
      };
    },
  },
  {
    role: "engineering_officer",
    prepare: async (qc) => {
      const r = await api.post<{ plan: PlanMeta; blocks: { tail: string; start_day: number; duration_days: number; tasks: unknown[] }[] }>("/api/schedule/optimise", undefined, {
        mission_aware: true,
        bundling_window_days: 20,
      });
      qc.invalidateQueries();
      const ap = r.blocks.find((b) => b.tail === "AP-112");
      const f = await api.get<Forecast>("/api/forecast");
      const fighters = f.types["Fighter Type-A"];
      return {
        route: "/planner?focus=AP-112",
        target: '[data-tour="bundling"]',
        title: "Optimise: mission-aware + bundling",
        body: `CP-SAT solved the plan (${r.plan.status.toLowerCase()}) in ${r.plan.solve_seconds.toFixed(1)} s. ${ap ? `AP-112 goes into the hangar on days ${ap.start_day}–${ap.start_day + ap.duration_days - 1}, before the exercise, with ${ap.tasks.length} tasks bundled into one visit` : "Bundled visits are placed around surge days"} — ${r.plan.bundling.groundings_saved} groundings and ${r.plan.bundling.downtime_avoided_hours} aircraft-hours saved. ${fighters.shortfall_days.length ? "" : "The fighter shortfall is gone."}`,
      };
    },
  },
  {
    role: "engineering_officer",
    prepare: async () => {
      const c = await api.get<Compare>("/api/schedule/compare");
      const d = c.delta!;
      return {
        route: "/planner?focus=AP-112",
        target: '[data-tour="compare"]',
        title: "Reactive vs AeroPulse",
        body: `Same fleet, same 30 days: average readiness ${c.reactive.avg_readiness_pct}% → ${c.aeropulse!.avg_readiness_pct}% (+${d.avg_readiness_pts} pts), ${d.downtime_avoided_aircraft_days} aircraft-days of downtime avoided, ${d.failures_avoided} in-service failures prevented and ${c.reactive.missions_short - c.aeropulse!.missions_short} short missions covered.`,
      };
    },
  },
  {
    role: "engineering_officer",
    prepare: async () => ({
      route: "/whatif?preset=seal",
      target: '[data-tour="preset-seal"]',
      title: "What-If: seal delivery slips 10 days",
      body: "The scenario re-optimises the plan with the supplier delay. Without action, AP-125's seal arrives after its P10 point; AeroPulse proposes transferring a seal kit from Jodhpur so readiness is unaffected — compare both on the right.",
    }),
  },
  {
    role: "technician",
    prepare: async () => ({
      route: "/copilot",
      phone: `/copilot?tab=ask&q=${encodeURIComponent(SYMPTOM)}`,
      title: "On the flight line: Technician Copilot",
      body: "On a phone, the technician describes the symptom and gets ranked causes, checks and similar past cases with citations — offline. The Log entry tab structures a spoken Hindi or English note into a signed record.",
    }),
  },
  {
    role: "auditor",
    prepare: async () => {
      await api.post("/api/records/restore").catch(() => undefined);
      await api.post("/api/records/tamper");
      return {
        route: `/records?verify=${Date.now()}`,
        target: '[data-tour="verify"]',
        title: "Records: tamper-evident by design",
        body: "We just edited one signed AP-112 record directly in the database, as an insider might. Verification recomputes the SHA-256 chain and pinpoints the altered record. Finishing the tour restores it.",
      };
    },
  },
];

export const useDemo = create<{ active: boolean; step: number; start: () => void; stop: () => void; go: (n: number) => void }>((set) => ({
  active: false,
  step: 0,
  start: () => set({ active: true, step: 0 }),
  stop: () => set({ active: false }),
  go: (step) => set({ step }),
}));

function useTargetRect(selector: string | undefined, key: string) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    setRect(null);
    if (!selector) return;
    let el: Element | null = null;
    let tries = 0;
    let raf = 0;
    const measure = () => el && setRect(el.getBoundingClientRect());
    const find = () => {
      el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setTimeout(measure, 450);
      } else if (tries++ < 60) setTimeout(find, 150);
    };
    find();
    const loop = () => {
      measure();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [selector, key]);
  return rect;
}

function PhoneFrame({ src }: { src: string }) {
  return (
    <div className="fixed left-1/2 top-1/2 z-[75] -translate-x-1/2 -translate-y-1/2 max-[900px]:hidden" role="region" aria-label="Phone-width preview">
      <div className="rounded-[36px] border border-border-strong bg-black p-2.5">
        <iframe title="Copilot on a phone" src={src} className="h-[min(760px,calc(100vh-120px))] w-[390px] rounded-[28px] bg-bg" />
      </div>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-white/80">
        <Smartphone size={13} strokeWidth={1.75} /> 390 px phone view
      </p>
    </div>
  );
}

export function GuidedDemo() {
  const { active, step, stop, go } = useDemo();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setRole = useUi((s) => s.setRole);
  const setBaseFilter = useUi((s) => s.setBaseFilter);
  const reduce = useReducedMotion();
  const [content, setContent] = useState<StepContent | null>(null);
  const [loading, setLoading] = useState(false);

  const finish = useCallback(async () => {
    stop();
    setContent(null);
    await api.post("/api/records/restore").catch(() => undefined);
    setRole("engineering_officer");
    qc.invalidateQueries();
  }, [stop, setRole, qc]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const s = STEPS[step];
    setLoading(true);
    setRole(s.role);
    setBaseFilter(null);
    // Role switch must reach the API client before the step's requests.
    setTimeout(async () => {
      try {
        const c = await s.prepare(qc);
        if (cancelled) return;
        qc.invalidateQueries();
        setContent(c);
        navigate(c.route);
      } catch (e) {
        toast.error("Demo step failed", String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
    };
  }, [active, step, navigate, qc, setRole, setBaseFilter]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" && step < STEPS.length - 1 && !loading) go(step + 1);
      if (e.key === "ArrowLeft" && step > 0 && !loading) go(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, step, loading, go, finish]);

  const rect = useTargetRect(active && !loading && !content?.phone ? content?.target : undefined, `${step}-${content?.route}`);
  if (!active) return null;
  const pad = 8;
  return (
    <>
      {content?.phone && !loading ? (
        <>
          <div className="fixed inset-0 z-[70] bg-black/55" aria-hidden />
          <PhoneFrame src={content.phone} />
        </>
      ) : rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[70] rounded-card ring-2 ring-accent transition-all duration-200 ease-out"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad, boxShadow: "0 0 0 9999px rgba(5,8,12,0.55)" }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 z-[70] bg-black/40" aria-hidden />
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          role="dialog"
          aria-modal="false"
          aria-label="Guided demo"
          data-testid="demo-panel"
          className="pointer-events-auto fixed bottom-4 left-4 right-4 z-[80] rounded-card border border-border-strong bg-surface p-4 sm:left-auto sm:w-[400px]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="label">
              Guided demo · {step + 1} / {STEPS.length}
            </span>
            <button type="button" onClick={finish} aria-label="Exit demo" className="grid h-7 w-7 place-items-center rounded-md text-subtle hover:bg-raised hover:text-strong">
              <X size={15} strokeWidth={1.75} />
            </button>
          </div>
          <div className="mt-2 flex gap-1" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-raised"}`} />
            ))}
          </div>
          {loading || !content ? (
            <div className="mt-3 space-y-2" aria-busy="true">
              <div className="h-4 w-2/3 animate-pulse rounded bg-raised" />
              <div className="h-3 w-full animate-pulse rounded bg-raised" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-raised" />
            </div>
          ) : (
            <>
              <p className="mt-3 text-md font-semibold text-strong" data-testid="demo-title">
                {content.title}
              </p>
              <p className="mt-1 text-sm leading-6 text-body">{content.body}</p>
            </>
          )}
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => go(step - 1)} disabled={step === 0 || loading}>
              <ChevronLeft size={14} strokeWidth={1.75} /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" size="sm" onClick={() => go(step + 1)} disabled={loading} data-testid="demo-next">
                Next <ChevronRight size={14} strokeWidth={1.75} />
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={finish} data-testid="demo-finish">
                Finish
              </Button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}

export function DemoButton() {
  const start = useDemo((s) => s.start);
  return (
    <Button variant="secondary" size="sm" onClick={start} className="hidden sm:inline-flex" data-testid="demo-start">
      <Play size={13} strokeWidth={1.75} /> Guided demo
    </Button>
  );
}

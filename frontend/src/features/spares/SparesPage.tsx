import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCheck, Package, PackageX, Search, ShieldAlert, Truck, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StatusPill, type Tone } from "@/components/ui/status-pill";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useMeta } from "@/lib/queries";
import { useUi } from "@/lib/store";
import { cn } from "@/lib/utils";

interface InvRow {
  part_number: string;
  name: string;
  component_kind: string;
  base_id: string;
  base_name: string;
  on_hand: number;
  reorder_point: number;
  on_order: number;
  order_eta: string | null;
  lead_time_days: number;
  unit_cost: number;
  demand_30d: number;
  demand_60d: number;
  projected_balance: number;
  status: "shortfall" | "transfer" | "reorder" | "ok";
  needs: { tail: string; need_day: number; source: string; task: string }[];
  inbound_transfers: number;
}
interface Transfer {
  part_number: string;
  part_name: string;
  from_name: string;
  to_name: string;
  tail: string;
  need_day: number;
  days_saved: number;
  transfer_days: number;
  lead_time_days: number;
  unit_cost: number;
  message: string;
}
interface Cannib {
  suggestions: {
    recipient: string;
    recipient_base: string;
    donor: string;
    donor_base: string;
    part_number: string;
    part_name: string;
    component: string;
    serial: string;
    donor_component_health: number;
    recipient_wait_days: number;
    recipient_back_day_rob: number;
    recipient_back_day_wait: number;
    donor_back_day_before: number;
    donor_back_day_after: number;
    readiness_gain_aircraft_days: number;
    extra_man_hours: number;
    donor_reason: string;
    message: string;
  }[];
  tracked: { id: number; donor: string; recipient: string; part_number: string; serial: string; status: string; approved_by: string; created_at: string; replacement_eta: string | null }[];
}
interface Batch {
  batch: string;
  supplier: string | null;
  failures_total: number;
  failures_window: number;
  window_days: number;
  aircraft: string[];
  bases: string[];
  ratio_vs_fleet: number;
  median_hours_at_failure: number | null;
  fleet_median_hours: number | null;
  flagged: boolean;
  installed_at_risk: { tail: string; position: string; serial: string }[];
  insight: string | null;
}

const STATUS: Record<InvRow["status"], { tone: Tone; label: string }> = {
  shortfall: { tone: "grounded", label: "Shortfall" },
  transfer: { tone: "info", label: "Transfer planned" },
  reorder: { tone: "caution", label: "Reorder" },
  ok: { tone: "ready", label: "OK" },
};

const invCols: Column<InvRow>[] = [
  { key: "pn", header: "Part", cell: (r) => <span className="font-mono text-strong">{r.part_number}</span>, sortValue: (r) => r.part_number },
  { key: "name", header: "Description", cell: (r) => r.name, sortValue: (r) => r.name, hideBelow: "md" },
  { key: "base", header: "Base", cell: (r) => r.base_name, sortValue: (r) => r.base_name },
  { key: "oh", header: "On hand", cell: (r) => r.on_hand, sortValue: (r) => r.on_hand, align: "right" },
  { key: "rop", header: "Reorder pt", cell: (r) => r.reorder_point, sortValue: (r) => r.reorder_point, align: "right", hideBelow: "lg" },
  { key: "oo", header: "On order", cell: (r) => (r.on_order ? `${r.on_order} · ${fmt.shortDate(r.order_eta)}` : "—"), sortValue: (r) => r.on_order, align: "right", hideBelow: "xl" },
  {
    key: "d30",
    header: "Predicted need 30 d",
    cell: (r) => (
      <span className={cn("tnum", r.demand_30d > r.on_hand ? "font-semibold text-grounded" : r.demand_30d ? "text-strong" : "text-subtle")} title={r.needs.map((n) => `${n.tail} day ${n.need_day}: ${n.task}`).join("\n")}>
        {r.demand_30d}
        {r.needs[0] && <span className="ml-1 text-xs font-normal text-subtle">({r.needs.map((n) => n.tail).slice(0, 2).join(", ")})</span>}
      </span>
    ),
    sortValue: (r) => r.demand_30d,
    align: "right",
  },
  { key: "lead", header: "Lead time", cell: (r) => `${r.lead_time_days} d`, sortValue: (r) => r.lead_time_days, align: "right", hideBelow: "lg" },
  { key: "st", header: "Status", cell: (r) => <StatusPill tone={STATUS[r.status].tone} label={STATUS[r.status].label} />, sortValue: (r) => ["shortfall", "transfer", "reorder", "ok"].indexOf(r.status) },
];

function InventoryTab() {
  const base = useUi((s) => s.baseFilter);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("attention");
  const { data, isLoading } = useQuery({ queryKey: ["spares", base], queryFn: () => api.get<{ items: InvRow[]; summary: Record<string, number> }>("/api/spares", { base_id: base }) });
  const rows = useMemo(
    () => (data?.items ?? []).filter((r) => (status === "all" || (status === "attention" ? r.status !== "ok" : r.status === status)) && (!q || `${r.part_number} ${r.name} ${r.base_name}`.toLowerCase().includes(q.toLowerCase()))),
    [data, q, status],
  );
  const s = data?.summary;
  return (
    <div className="space-y-4">
      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ["Stock lines", fmt.int(s.lines)],
            ["Shortfalls", fmt.int(s.shortfall)],
            ["Covered by transfer", fmt.int(s.transfer)],
            ["Reorder alerts", fmt.int(s.reorder)],
            ["Predicted demand · 30 d", fmt.int(s.demand_30d)],
          ].map(([l, v]) => (
            <div key={l} className="card p-3">
              <p className="label">{l}</p>
              <p className="mt-1 text-xl font-semibold text-strong tnum">{v}</p>
            </div>
          ))}
        </div>
      )}
      <Card>
        <CardHeader
          title="Inventory & predicted demand"
          subtitle="Demand derived from component RUL: parts needed before predicted failures, open work orders and life limits"
          actions={
            <>
              <div className="relative w-56">
                <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part or base" className="pl-8" aria-label="Search parts" />
              </div>
              <Select
                ariaLabel="Status filter"
                value={status}
                onChange={setStatus}
                className="w-[170px]"
                options={[
                  { value: "attention", label: "Needs attention" },
                  { value: "all", label: "All lines" },
                  { value: "shortfall", label: "Shortfall" },
                  { value: "transfer", label: "Transfer planned" },
                  { value: "reorder", label: "Reorder" },
                ]}
              />
            </>
          }
        />
        {isLoading ? (
          <SkeletonRows rows={10} className="p-4" />
        ) : (
          <DataTable ariaLabel="Inventory" rows={rows} columns={invCols} rowKey={(r) => `${r.part_number}-${r.base_id}`} maxHeight="calc(100vh - 380px)" empty={<EmptyState icon={Package} title="Nothing needs attention" description="All stock lines cover predicted demand." />} />
        )}
      </Card>
    </div>
  );
}

function TransfersTab() {
  const { data, isLoading } = useQuery({ queryKey: ["transfers"], queryFn: () => api.get<Transfer[]>("/api/spares/transfers") });
  if (isLoading) return <SkeletonRows rows={6} />;
  const saved = (data ?? []).reduce((a, t) => a + t.days_saved, 0);
  return (
    <Card>
      <CardHeader title="Inter-base transfer suggestions" subtitle={`${data?.length ?? 0} transfers · ${fmt.int(saved)} days of lead time saved versus ordering`} />
      <ul className="divide-y divide-border">
        {data?.map((t) => (
          <li key={`${t.part_number}-${t.tail}`} className="flex flex-wrap items-center gap-4 px-4 py-3">
            <Truck size={18} strokeWidth={1.75} className="text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm text-strong">
                {t.from_name} <ArrowRight size={13} strokeWidth={1.75} className="text-subtle" /> {t.to_name}
                <span className="font-mono text-xs text-subtle">{t.part_number}</span>
              </p>
              <p className="text-sm text-body">{t.message}</p>
            </div>
            <div className="text-right text-xs text-subtle tnum">
              <p className="text-md font-semibold text-ready">−{t.days_saved} d</p>
              <p>{t.transfer_days} d transfer vs {t.lead_time_days} d order</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CannibalisationTab() {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const canApprove = !!meta?.role.areas.includes("approvals");
  const { data, isLoading } = useQuery({ queryKey: ["cannibalisation"], queryFn: () => api.get<Cannib>("/api/spares/cannibalisation") });
  const [confirm, setConfirm] = useState<Cannib["suggestions"][number] | null>(null);
  const refresh = () => ["cannibalisation", "schedule", "forecast", "kpi", "aircraft", "alerts", "spares", "missions", "compare"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const approve = useMutation({
    mutationFn: (s: { recipient: string; donor: string }) => api.post("/api/spares/cannibalisation/approve", s),
    onSuccess: () => {
      refresh();
      toast.success("Cannibalisation approved", "Recorded in the audit chain; the robbed part is now tracked until replaced. Re-optimise the plan to use it.");
    },
    onError: (e) => toast.error("Approval failed", String(e)),
  });
  const replaced = useMutation({
    mutationFn: (id: number) => api.post(`/api/spares/cannibalisation/${id}/replaced`),
    onSuccess: () => {
      refresh();
      toast.success("Marked replaced");
    },
  });
  if (isLoading || !data) return <SkeletonRows rows={6} />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Cannibalisation advisor" subtitle="Robbing a part from an aircraft already in long maintenance to return a grounded aircraft sooner — Engineering Officer approval required" />
        {data.suggestions.length ? (
          <ul className="divide-y divide-border">
            {data.suggestions.map((s) => (
              <li key={`${s.donor}-${s.recipient}`} className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-strong">
                    <Link to={`/aircraft/${s.donor}`} className="font-mono hover:text-accent">{s.donor}</Link>
                    <ArrowRight size={13} strokeWidth={1.75} className="text-subtle" />
                    <Link to={`/aircraft/${s.recipient}`} className="font-mono hover:text-accent">{s.recipient}</Link>
                    <span className="text-subtle">· {s.part_name} ({s.part_number})</span>
                  </p>
                  <p className="mt-1 text-sm text-body">{s.message}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-subtle">Readiness gain</dt>
                      <dd className="text-md font-semibold text-ready tnum">+{s.readiness_gain_aircraft_days} aircraft-days</dd>
                    </div>
                    <div>
                      <dt className="text-subtle">{s.recipient} returns</dt>
                      <dd className="text-strong tnum">day {s.recipient_back_day_rob} <span className="text-subtle">instead of {s.recipient_back_day_wait}</span></dd>
                    </div>
                    <div>
                      <dt className="text-subtle">{s.donor} returns</dt>
                      <dd className="text-strong tnum">day {s.donor_back_day_after} <span className="text-subtle">instead of {s.donor_back_day_before}</span></dd>
                    </div>
                    <div>
                      <dt className="text-subtle">Extra work</dt>
                      <dd className="text-strong tnum">{s.extra_man_hours} man-hours</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex items-start">
                  {canApprove ? (
                    <Button variant="primary" onClick={() => setConfirm(s)}>
                      <CheckCheck size={14} strokeWidth={1.75} /> Approve
                    </Button>
                  ) : (
                    <StatusPill tone="info" label="Awaiting Engineering Officer" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Wrench} title="No cannibalisation needed" description="No grounded aircraft is waiting more than a week for a part that a long-maintenance aircraft could supply." />
        )}
      </Card>
      <Card>
        <CardHeader title="Robbed parts being tracked" subtitle="Each robbed part stays open until the donor receives its replacement" />
        {data.tracked.length ? (
          <ul className="divide-y divide-border">
            {data.tracked.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <StatusPill tone={t.status === "replaced" ? "ready" : "caution"} label={t.status === "replaced" ? "Replaced" : "Open"} />
                <span className="font-mono text-strong">{t.serial}</span>
                <span className="text-body">
                  {t.part_number} · {t.donor} → {t.recipient}
                </span>
                <span className="text-xs text-subtle">
                  approved by {t.approved_by} · {fmt.dateTime(t.created_at)}
                  {t.replacement_eta && t.status !== "replaced" ? ` · replacement due ${fmt.date(t.replacement_eta)}` : ""}
                </span>
                {t.status !== "replaced" && canApprove && (
                  <Button size="sm" variant="secondary" className="ml-auto" onClick={() => replaced.mutate(t.id)}>
                    Mark replaced
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-subtle">No robbed parts outstanding.</p>
        )}
      </Card>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Approve cannibalisation?"
        description={confirm ? `${confirm.component} S/N ${confirm.serial} will be removed from ${confirm.donor} and fitted to ${confirm.recipient}. ${confirm.donor}'s return slips to day ${confirm.donor_back_day_after}. This approval is signed into the audit chain.` : ""}
        confirmLabel="Approve as Engineering Officer"
        onConfirm={() => confirm && approve.mutate({ recipient: confirm.recipient, donor: confirm.donor })}
      />
    </div>
  );
}

function BatchTab() {
  const { data, isLoading } = useQuery({ queryKey: ["batch-watch"], queryFn: () => api.get<Batch[]>("/api/spares/batch-watch") });
  if (isLoading || !data) return <SkeletonRows rows={6} />;
  const flagged = data.filter((b) => b.flagged);
  return (
    <div className="space-y-4">
      {flagged.map((b) => (
        <div key={b.batch} className="card border-grounded/40 p-4" data-tour="batch">
          <div className="flex flex-wrap items-start gap-3">
            <ShieldAlert size={20} strokeWidth={1.75} className="mt-0.5 text-grounded" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-md font-semibold text-strong">
                Bad-batch alert · <span className="font-mono">{b.batch}</span> {b.supplier && <span className="text-sm font-normal text-subtle">· {b.supplier}</span>}
              </p>
              <p className="mt-1 text-sm text-body">{b.insight}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-md border border-border px-2 py-1">{b.failures_window} failures / {b.window_days} d</span>
                <span className="rounded-md border border-border px-2 py-1">{b.ratio_vs_fleet}× fleet batch average</span>
                <span className="rounded-md border border-border px-2 py-1">Bases: {b.bases.join(", ")}</span>
                <span className="rounded-md border border-border px-2 py-1">Failed on: {b.aircraft.join(", ")}</span>
              </div>
              {b.installed_at_risk.length > 0 && (
                <p className="mt-3 text-sm text-body">
                  Still installed on:{" "}
                  {b.installed_at_risk.map((r, i) => (
                    <span key={r.serial}>
                      {i > 0 && ", "}
                      <Link to={`/aircraft/${r.tail}`} className="font-mono text-accent hover:underline">
                        {r.tail}
                      </Link>{" "}
                      <span className="text-subtle">({r.serial})</span>
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
      <Card>
        <CardHeader title="Counterfeit / bad-batch watch" subtitle="Defect records grouped by part batch; flagged when failures cluster across aircraft or occur far earlier than fleet norm" />
        <DataTable
          ariaLabel="Batches"
          rows={data}
          rowKey={(b) => b.batch}
          initialSort={{ key: "win", dir: "desc" }}
          columns={[
            { key: "b", header: "Batch", cell: (b) => <span className="font-mono text-strong">{b.batch}</span>, sortValue: (b) => b.batch },
            { key: "win", header: `Failures · 90 d`, cell: (b) => b.failures_window, sortValue: (b) => b.failures_window, align: "right" },
            { key: "tot", header: "All-time", cell: (b) => b.failures_total, sortValue: (b) => b.failures_total, align: "right", hideBelow: "sm" },
            { key: "ac", header: "Aircraft", cell: (b) => b.aircraft.length, sortValue: (b) => b.aircraft.length, align: "right" },
            { key: "h", header: "Median hours at failure", cell: (b) => (b.median_hours_at_failure ? fmt.int(b.median_hours_at_failure) : "—"), sortValue: (b) => b.median_hours_at_failure ?? 0, align: "right", hideBelow: "md" },
            { key: "f", header: "Status", cell: (b) => (b.flagged ? <StatusPill tone="grounded" label="Suspect batch" /> : <StatusPill tone="ready" label="Normal" />), sortValue: (b) => (b.flagged ? 0 : 1) },
          ]}
          empty={<EmptyState icon={PackageX} title="No batch data" />}
        />
      </Card>
    </div>
  );
}

export default function SparesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "inventory";
  return (
    <>
      <PageHeader title="Spares & Logistics" description="Predicted demand from remaining-life forecasts, inter-base transfers, cannibalisation with approval, and bad-batch detection." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList
          className="mb-4"
          tabs={[
            { value: "inventory", label: "Inventory & demand" },
            { value: "transfers", label: "Transfers" },
            { value: "cannibalisation", label: "Cannibalisation" },
            { value: "batch", label: "Batch watch" },
          ]}
        />
        <TabsContent value="inventory">
          <InventoryTab />
        </TabsContent>
        <TabsContent value="transfers">
          <TransfersTab />
        </TabsContent>
        <TabsContent value="cannibalisation">
          <CannibalisationTab />
        </TabsContent>
        <TabsContent value="batch">
          <BatchTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

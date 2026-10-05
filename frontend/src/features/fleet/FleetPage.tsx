import { Bookmark, Download, FileText, LayoutGrid, Plane, Search, Table2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { api, saveBlob, toCsv } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useAircraftList } from "@/lib/queries";
import { useUi } from "@/lib/store";
import type { AircraftRow } from "@/lib/types";
import { cn } from "@/lib/utils";

interface View {
  name: string;
  q: string;
  type: string;
  status: string;
  builtin?: boolean;
}

const BUILTIN: View[] = [
  { name: "All aircraft", q: "", type: "all", status: "all", builtin: true },
  { name: "Needs attention", q: "", type: "all", status: "attention", builtin: true },
  { name: "Grounded", q: "", type: "all", status: "grounded", builtin: true },
  { name: "Fighters", q: "", type: "Fighter Type-A", status: "all", builtin: true },
];
const VIEWS_KEY = "aeropulse-fleet-views";

function loadViews(): View[] {
  try {
    return JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function HealthBar({ value }: { value: number }) {
  const tone = value >= 75 ? "bg-ready" : value >= 50 ? "bg-caution" : "bg-grounded";
  return (
    <div className="flex items-center gap-2" aria-label={`Health ${value.toFixed(0)} of 100`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-raised">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(3, value)}%` }} />
      </div>
      <span className="w-7 text-right text-sm text-strong tnum">{value.toFixed(0)}</span>
    </div>
  );
}

function dueLabel(days: number) {
  if (days <= 0) return "now";
  return `${Math.floor(days)} d`;
}

const columns: Column<AircraftRow>[] = [
  { key: "tail", header: "Tail", cell: (r) => <span className="font-mono font-medium text-strong">{r.tail}</span>, sortValue: (r) => r.tail },
  { key: "type", header: "Type", cell: (r) => r.type, sortValue: (r) => r.type, hideBelow: "md" },
  { key: "base", header: "Base", cell: (r) => r.base_name, sortValue: (r) => r.base_name },
  { key: "sq", header: "Squadron", cell: (r) => <span className="text-subtle">{r.squadron}</span>, sortValue: (r) => r.squadron, hideBelow: "2xl" },
  { key: "status", header: "Status", cell: (r) => <StatusPill tone={r.status} />, sortValue: (r) => ({ grounded: 0, caution: 1, ready: 2 })[r.status] },
  { key: "health", header: "Health", cell: (r) => <HealthBar value={r.health} />, sortValue: (r) => r.health },
  {
    key: "rul",
    header: "Lowest RUL",
    cell: (r) => (
      <span className="text-sm">
        <span className="text-subtle">{r.lowest_component} · </span>
        <span className="text-strong tnum">{r.lowest_rul_label}</span>
      </span>
    ),
    sortValue: (r) => r.lowest_rul_days,
    hideBelow: "lg",
  },
  {
    key: "due",
    header: "Next due",
    cell: (r) => (
      <span className={cn("tnum", r.next_due_days <= 7 ? "text-grounded" : r.next_due_days <= 21 ? "text-caution" : "text-body")}>
        {r.next_due_component} · {dueLabel(r.next_due_days)}
      </span>
    ),
    sortValue: (r) => r.next_due_days,
    hideBelow: "sm",
  },
  { key: "def", header: "Defects 30 d", cell: (r) => r.defects_30d, sortValue: (r) => r.defects_30d, align: "right", hideBelow: "lg" },
  { key: "hours", header: "Hours", cell: (r) => fmt.int(r.total_hours), sortValue: (r) => r.total_hours, align: "right", hideBelow: "2xl" },
  { key: "cycles", header: "Cycles", cell: (r) => fmt.int(r.total_cycles), sortValue: (r) => r.total_cycles, align: "right", hideBelow: "2xl" },
];

function AircraftCard({ a, onOpen }: { a: AircraftRow; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="card flex flex-col gap-2 p-3 text-left transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-md font-medium text-strong">{a.tail}</span>
        <StatusPill tone={a.status} />
      </div>
      <p className="text-xs text-subtle">
        {a.type} · {a.base_name}
      </p>
      <HealthBar value={a.health} />
      <p className="truncate text-xs text-body">
        Next: {a.next_due_component} · {dueLabel(a.next_due_days)}
      </p>
      {a.status_reason && <p className="truncate text-xs text-subtle">{a.status_reason}</p>}
    </button>
  );
}

export default function FleetPage() {
  const { data, isLoading } = useAircraftList();
  const navigate = useNavigate();
  const { density, setDensity, baseFilter } = useUi();
  const [view, setView] = useState<"table" | "grid">("table");
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [views, setViews] = useState<View[]>(loadViews);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [peek, setPeek] = useState<AircraftRow | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (a) =>
        (type === "all" || a.type === type) &&
        (status === "all" || (status === "attention" ? a.status !== "ready" : a.status === status)) &&
        (!needle || [a.tail, a.base_name, a.squadron, a.type, a.status_reason, a.next_due_component].join(" ").toLowerCase().includes(needle)),
    );
  }, [data, q, type, status]);

  const applyView = (v: View) => {
    setQ(v.q);
    setType(v.type);
    setStatus(v.status);
  };
  const persist = (vs: View[]) => {
    setViews(vs);
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(vs));
    } catch {
      /* storage unavailable: views stay for this session */
    }
  };
  const active = [...BUILTIN, ...views].find((v) => v.q === q && v.type === type && v.status === status);

  const exportCsv = () => {
    const csv = toCsv(
      rows.map((r) => ({
        tail: r.tail, type: r.type, base: r.base_name, squadron: r.squadron, status: r.status, health: r.health,
        lowest_component: r.lowest_component, lowest_rul: r.lowest_rul_label, next_due: r.next_due_component,
        next_due_days: r.next_due_days, defects_30d: r.defects_30d, hours: r.total_hours, cycles: r.total_cycles,
      })),
    );
    saveBlob(new Blob([csv], { type: "text/csv" }), "aeropulse-fleet.csv");
    toast.success("CSV exported", `${rows.length} aircraft`);
  };
  const exportPdf = async () => {
    try {
      await api.download("/api/aircraft/export.pdf", "aeropulse-fleet.pdf", { base_id: baseFilter });
      toast.success("PDF exported");
    } catch (e) {
      toast.error("Export failed", String(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Fleet"
        description={data ? `${rows.length} of ${data.length} aircraft${baseFilter ? " at the selected base" : ""} · health, remaining life and next due maintenance` : "Loading fleet"}
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}>
              <Download size={14} strokeWidth={1.75} /> CSV
            </Button>
            <Button variant="secondary" onClick={exportPdf}>
              <FileText size={14} strokeWidth={1.75} /> PDF
            </Button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[...BUILTIN, ...views].map((v) => (
          <span key={v.name} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => applyView(v)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                active?.name === v.name ? "border-accent bg-accent/12 text-strong" : "border-border text-subtle hover:text-strong",
              )}
            >
              {!v.builtin && <Bookmark size={12} strokeWidth={1.75} aria-hidden />}
              {v.name}
            </button>
            {!v.builtin && (
              <button
                type="button"
                aria-label={`Delete view ${v.name}`}
                className="ml-0.5 grid h-7 w-6 place-items-center text-subtle hover:text-grounded"
                onClick={() => persist(views.filter((x) => x.name !== v.name))}
              >
                <Trash2 size={12} strokeWidth={1.75} />
              </button>
            )}
          </span>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setSaveOpen(true)} disabled={!!active}>
          <Bookmark size={13} strokeWidth={1.75} /> Save view
        </Button>
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tail, base, squadron…" className="pl-8" aria-label="Search aircraft" />
          </div>
          <Select
            ariaLabel="Aircraft type"
            value={type}
            onChange={setType}
            className="w-[170px]"
            options={[
              { value: "all", label: "All types" },
              { value: "Fighter Type-A", label: "Fighter Type-A" },
              { value: "Transport Type-C", label: "Transport Type-C" },
              { value: "Trainer Type-T", label: "Trainer Type-T" },
            ]}
          />
          <Select
            ariaLabel="Status"
            value={status}
            onChange={setStatus}
            className="w-[160px]"
            options={[
              { value: "all", label: "Any status" },
              { value: "attention", label: "Needs attention" },
              { value: "ready", label: "Ready" },
              { value: "caution", label: "Caution" },
              { value: "grounded", label: "Grounded" },
            ]}
          />
          <div className="ml-auto flex items-center gap-2">
            {view === "table" && (
              <Segmented
                ariaLabel="Row density"
                value={density}
                onChange={setDensity}
                options={[
                  { value: "comfortable", label: "Comfortable", title: "Comfortable rows" },
                  { value: "compact", label: "Compact", title: "Compact rows" },
                ]}
              />
            )}
            <Segmented
              ariaLabel="Layout"
              value={view}
              onChange={setView}
              options={[
                { value: "table", label: <Table2 size={14} strokeWidth={1.75} />, title: "Table view" },
                { value: "grid", label: <LayoutGrid size={14} strokeWidth={1.75} />, title: "Grid view" },
              ]}
            />
          </div>
        </div>
        {isLoading ? (
          <SkeletonRows rows={12} className="p-4" />
        ) : view === "table" ? (
          <DataTable
            ariaLabel="Fleet"
            rows={rows}
            columns={columns}
            rowKey={(r) => r.tail}
            initialSort={{ key: "health", dir: "asc" }}
            onRowClick={setPeek}
            rowTitle={(r) => `${r.tail} · ${r.status_reason || "Serviceable"} · health ${r.health.toFixed(0)}`}
            maxHeight="calc(100vh - 290px)"
            empty={<EmptyState icon={Plane} title="No aircraft match" description="Clear the search or filters to see the whole fleet." />}
          />
        ) : rows.length ? (
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {[...rows].sort((a, b) => a.health - b.health).map((a) => (
              <AircraftCard key={a.tail} a={a} onOpen={() => setPeek(a)} />
            ))}
          </div>
        ) : (
          <EmptyState icon={Plane} title="No aircraft match" description="Clear the search or filters to see the whole fleet." />
        )}
      </Card>

      <Drawer
        open={!!peek}
        onOpenChange={(o) => !o && setPeek(null)}
        title={<span className="font-mono">{peek?.tail}</span>}
        subtitle={peek ? `${peek.type} · ${peek.base_name} · ${peek.squadron}` : undefined}
        width="max-w-[420px]"
        footer={
          <Button variant="primary" className="w-full" onClick={() => peek && navigate(`/aircraft/${peek.tail}`)}>
            Open digital twin
          </Button>
        }
      >
        {peek && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            <div className="col-span-2 flex items-center gap-3">
              <StatusPill tone={peek.status} />
              <span className="text-body">{peek.status_reason || "Serviceable, no predicted work due within 21 days"}</span>
            </div>
            <div>
              <dt className="label">Health</dt>
              <dd className="mt-1">
                <HealthBar value={peek.health} />
              </dd>
            </div>
            <div>
              <dt className="label">Sortie profile</dt>
              <dd className="mt-1 text-strong">{peek.sortie_profile.replace(/-/g, " ")}</dd>
            </div>
            <div className="col-span-2">
              <dt className="label">Lowest remaining life</dt>
              <dd className="mt-1 text-strong">
                {peek.lowest_component} · {peek.lowest_rul_label}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="label">Next due maintenance</dt>
              <dd className="mt-1 text-strong">
                {peek.next_due_component} in {dueLabel(peek.next_due_days)}
              </dd>
            </div>
            <div>
              <dt className="label">Total hours</dt>
              <dd className="mt-1 text-strong tnum">{fmt.int(peek.total_hours)}</dd>
            </div>
            <div>
              <dt className="label">Total cycles</dt>
              <dd className="mt-1 text-strong tnum">{fmt.int(peek.total_cycles)}</dd>
            </div>
            <div>
              <dt className="label">Defects (30 d)</dt>
              <dd className="mt-1 text-strong tnum">{peek.defects_30d}</dd>
            </div>
            <div>
              <dt className="label">Records</dt>
              <dd className="mt-1">
                <Link to={`/aircraft/${peek.tail}`} className="text-accent hover:underline">
                  View history
                </Link>
              </dd>
            </div>
          </dl>
        )}
      </Drawer>

      <Modal open={saveOpen} onOpenChange={setSaveOpen} title="Save view" description="Saves the current search and filters on this device.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = saveName.trim();
            if (!name) return;
            persist([...views.filter((v) => v.name !== name), { name, q, type, status }]);
            setSaveName("");
            setSaveOpen(false);
            toast.success("View saved", name);
          }}
          className="space-y-4"
        >
          <Input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Gwalior fighters due soon" aria-label="View name" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!saveName.trim()}>
              Save view
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

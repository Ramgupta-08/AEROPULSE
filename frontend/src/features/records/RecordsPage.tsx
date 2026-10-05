import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Link2, RotateCcw, ShieldAlert, ShieldCheck, Skull } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Verify {
  total: number;
  verified: number;
  ok: boolean;
  broken: { seq: number; entity_id: string; tail: string | null; problems: string[] }[];
  head: string;
  tamper_demo_active: boolean;
}
interface AuditRow {
  seq: number;
  ts: string;
  actor: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  tail: string | null;
  summary: string;
  hash: string;
  prev_hash: string;
}
interface Audit {
  total: number;
  items: AuditRow[];
  facets: { actions: string[]; roles: string[]; actors: string[] };
}

const cols: Column<AuditRow>[] = [
  { key: "seq", header: "#", cell: (r) => <span className="text-subtle tnum">{r.seq}</span>, sortValue: (r) => r.seq },
  { key: "ts", header: "Time", cell: (r) => fmt.dateTime(r.ts), sortValue: (r) => r.ts, hideBelow: "sm" },
  { key: "actor", header: "Actor", cell: (r) => <span className="text-strong">{r.actor}</span>, sortValue: (r) => r.actor, hideBelow: "md" },
  { key: "role", header: "Role", cell: (r) => r.role.replace(/_/g, " "), sortValue: (r) => r.role, hideBelow: "2xl" },
  { key: "action", header: "Action", cell: (r) => <span className="font-mono text-xs text-body">{r.action}</span>, sortValue: (r) => r.action },
  { key: "tail", header: "Aircraft", cell: (r) => (r.tail ? <span className="font-mono">{r.tail}</span> : "—"), sortValue: (r) => r.tail ?? "", hideBelow: "md" },
  { key: "sum", header: "Summary", cell: (r) => <span className="block max-w-[420px] truncate" title={r.summary}>{r.summary}</span>, hideBelow: "lg" },
  {
    key: "hash",
    header: "Hash",
    cell: (r) => (
      <span className="font-mono text-xs text-subtle" title={`${r.hash}\nprevious ${r.prev_hash}`}>
        {r.hash.slice(0, 10)}…
      </span>
    ),
  },
];

export default function RecordsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ action: "all", role: "all", tail: "", q: "" });
  const [confirmTamper, setConfirmTamper] = useState(false);
  const verify = useQuery({ queryKey: ["verify"], queryFn: () => api.get<Verify>("/api/records/verify"), enabled: false });
  const audit = useQuery({
    queryKey: ["audit", filters],
    queryFn: () =>
      api.get<Audit>("/api/audit", {
        action: filters.action === "all" ? null : filters.action,
        role: filters.role === "all" ? null : filters.role,
        tail: filters.tail.trim().toUpperCase() || null,
        q: filters.q.trim() || null,
        limit: 200,
      }),
  });
  const status = useQuery({ queryKey: ["verify-status"], queryFn: () => api.get<Verify>("/api/records/verify") });
  const tamper = useMutation({
    mutationFn: () => api.post<{ record_id: number; tail: string }>("/api/records/tamper"),
    onSuccess: (r) => {
      toast.info("Record altered directly in the database", `Record #${r.record_id} (${r.tail}) was edited outside AeroPulse. Run verification.`);
      qc.invalidateQueries({ queryKey: ["verify-status"] });
      qc.removeQueries({ queryKey: ["verify"] });
    },
    onError: (e) => toast.error("Tamper demo failed", String(e)),
  });
  const restore = useMutation({
    mutationFn: () => api.post("/api/records/restore"),
    onSuccess: () => {
      toast.success("Original record restored");
      qc.invalidateQueries({ queryKey: ["verify-status"] });
      verify.refetch();
    },
  });
  const [params] = useSearchParams();
  const auto = params.get("verify");
  const { refetch } = verify;
  useEffect(() => {
    if (auto) refetch();
  }, [auto, refetch]);
  const v = verify.data;
  const tampered = status.data?.tamper_demo_active;

  return (
    <>
      <PageHeader title="Records & Audit" description="Every technical record, schedule change and approval is appended to a SHA-256 hash chain; any later edit breaks the chain and is detected." />
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card className="p-5" data-tour="verify">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "grid h-12 w-12 shrink-0 place-items-center rounded-full",
                !v ? "bg-raised text-subtle" : v.ok ? "bg-ready/12 text-ready" : "bg-grounded/12 text-grounded",
              )}
            >
              {!v ? <Fingerprint size={22} strokeWidth={1.75} /> : v.ok ? <ShieldCheck size={22} strokeWidth={1.75} /> : <ShieldAlert size={22} strokeWidth={1.75} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-md font-semibold text-strong">
                {verify.isFetching
                  ? "Verifying chain…"
                  : !v
                    ? "Integrity not yet verified this session"
                    : v.ok
                      ? `All ${v.total.toLocaleString("en-IN")} records verified`
                      : `${(v.total - v.verified).toLocaleString("en-IN")} of ${v.total.toLocaleString("en-IN")} entries fail verification`}
              </p>
              <p className="mt-1 text-sm text-subtle">
                {v ? (
                  <>
                    Chain head <span className="font-mono">{v.head.slice(0, 16)}…</span> · recomputed {v.total.toLocaleString("en-IN")} SHA-256 links and compared each signed record with
                    its current database row.
                  </>
                ) : (
                  "Recomputes every SHA-256 link and compares each signed technical record with the database."
                )}
              </p>
              {v && !v.ok && (
                <ul className="mt-3 space-y-1.5">
                  {v.broken.map((b) => (
                    <li key={b.seq} className="rounded-lg border border-grounded/40 bg-grounded/8 px-3 py-2 text-sm text-body">
                      Entry #{b.seq} · record {b.entity_id}
                      {b.tail ? ` · ${b.tail}` : ""}: <b className="text-strong">{b.problems.join("; ")}</b>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => verify.refetch()} disabled={verify.isFetching}>
                  <ShieldCheck size={15} strokeWidth={1.75} /> Verify integrity
                </Button>
                {tampered ? (
                  <Button variant="secondary" onClick={() => restore.mutate()}>
                    <RotateCcw size={15} strokeWidth={1.75} /> Restore original record
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmTamper(true)} data-tour="tamper">
                    <Skull size={15} strokeWidth={1.75} /> Tamper demo
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <p className="label mb-3">How the chain works</p>
          <ol className="grid gap-3 text-sm text-body sm:grid-cols-3">
            {[
              ["Sign", "Each new record, plan change or approval is serialised canonically and hashed together with the previous entry's hash."],
              ["Link", "Entries form a single append-only chain — altering any entry changes its hash and breaks every link after it."],
              ["Verify", "Verification recomputes all hashes and also checks every technical record still matches what was signed."],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-lg border border-border p-3">
                <p className="flex items-center gap-1.5 text-strong">
                  <Link2 size={14} strokeWidth={1.75} className="text-accent" aria-hidden /> {i + 1}. {t}
                </p>
                <p className="mt-1 text-subtle">{d}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Audit log"
          subtitle={audit.data ? `${audit.data.total.toLocaleString("en-IN")} entries match` : "Loading"}
          actions={
            <>
              <Input value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Search summary" className="w-44" aria-label="Search audit summaries" />
              <Input value={filters.tail} onChange={(e) => setFilters((f) => ({ ...f, tail: e.target.value }))} placeholder="Tail" className="w-24 font-mono" aria-label="Filter by tail" />
              <Select
                ariaLabel="Role"
                value={filters.role}
                onChange={(v) => setFilters((f) => ({ ...f, role: v }))}
                className="w-[170px]"
                options={[{ value: "all", label: "All roles" }, ...(audit.data?.facets.roles ?? []).map((r) => ({ value: r, label: r.replace(/_/g, " ") }))]}
              />
              <Select
                ariaLabel="Action"
                value={filters.action}
                onChange={(v) => setFilters((f) => ({ ...f, action: v }))}
                className="w-[190px]"
                options={[{ value: "all", label: "All actions" }, ...(audit.data?.facets.actions ?? []).map((a) => ({ value: a, label: a }))]}
              />
            </>
          }
        />
        {audit.isLoading ? (
          <SkeletonRows rows={10} className="p-4" />
        ) : (
          <DataTable ariaLabel="Audit log" rows={audit.data?.items ?? []} columns={cols} rowKey={(r) => r.seq} initialSort={{ key: "seq", dir: "desc" }} maxHeight="calc(100vh - 420px)" rowTitle={(r) => r.summary} />
        )}
      </Card>
      <ConfirmDialog
        open={confirmTamper}
        onOpenChange={setConfirmTamper}
        title="Run the tamper demo?"
        description="This simulates an insider editing a signed technical record directly in the database (changing the action taken and man-hours on an AP-112 defect). Verification should then detect it. You can restore the original afterwards."
        confirmLabel="Alter a record"
        destructive
        onConfirm={() => tamper.mutate()}
      />
    </>
  );
}

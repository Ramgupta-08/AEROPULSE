import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowRight, BookOpenText, Building2, Download, ExternalLink, FileSpreadsheet, Package, Upload, Wrench } from "lucide-react";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { api, saveBlob } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useMeta } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface Source {
  id: string;
  name: string;
  system: string;
  records: number;
  entities: string;
  last_sync: string;
  mode: string;
  keys: string[];
  missing_pct: number;
  duplicate_pct: number;
  out_of_range_pct: number;
  score: number;
}
interface Sources {
  as_of: string;
  sources: Source[];
  lineage: { join_path: string[]; links: { from: string; to: string; on: string; coverage_pct: number }[]; components: number; serials: number; aircraft: number };
}
interface UploadResult {
  filename: string;
  columns: string[];
  mapping: Record<string, string | null>;
  target_fields: Record<string, string>;
  rows: number;
  valid: number;
  invalid: number;
  preview: { line: number; record: Record<string, string | number | null>; errors: string[] }[];
  dry_run: boolean;
  imported: number;
}

const ICON: Record<string, typeof Activity> = { hms: Activity, records: Wrench, spares: Package, agencies: Building2 };

function QualityBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-subtle">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
        <span className={cn("block h-full rounded-full", pct > 5 ? "bg-grounded" : pct > 1 ? "bg-caution" : "bg-ready")} style={{ width: `${Math.max(2, Math.min(100, pct * 5))}%` }} />
      </span>
      <span className="w-12 text-right text-body tnum">{pct.toFixed(2)}%</span>
    </div>
  );
}

function Lineage({ data }: { data: Sources }) {
  return (
    <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-center">
      <div className="grid flex-1 gap-2">
        {data.lineage.links.map((l) => (
          <div key={l.from} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="w-40 shrink-0 text-strong">{l.from}</span>
            <ArrowRight size={14} strokeWidth={1.75} className="shrink-0 text-subtle" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-subtle" title={l.on}>
              {l.on}
            </span>
            <span className="text-xs text-body tnum">{l.coverage_pct}% linked</span>
          </div>
        ))}
      </div>
      <ArrowRight size={18} strokeWidth={1.75} className="hidden shrink-0 text-subtle lg:block" aria-hidden />
      <div className="flex flex-col items-center gap-1.5 lg:w-56">
        {data.lineage.join_path.map((p, i) => (
          <div key={p} className="w-full">
            <div className={cn("rounded-lg border px-3 py-2 text-center text-sm", i === 0 ? "border-accent bg-accent/12 text-strong" : "border-border text-body")}>{p}</div>
            {i < data.lineage.join_path.length - 1 && <div className="mx-auto h-3 w-px bg-border-strong" aria-hidden />}
          </div>
        ))}
        <p className="mt-1 text-center text-xs text-subtle">
          {data.lineage.aircraft} aircraft · {data.lineage.components} components · {data.lineage.serials} serials
        </p>
      </div>
    </div>
  );
}

function Uploader() {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const send = useMutation({
    mutationFn: ({ f, dry, m }: { f: File; dry: boolean; m?: Record<string, string | null> }) => {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("dry_run", String(dry));
      if (m) fd.append("mapping", JSON.stringify(m));
      return api.upload<UploadResult>("/api/datahub/upload", fd);
    },
    onSuccess: (r) => {
      setRes(r);
      setMapping(r.mapping);
      if (!r.dry_run) {
        toast.success(`Imported ${r.imported} records`, "Each one was signed into the audit chain.");
        qc.invalidateQueries();
      }
    },
    onError: (e) => toast.error("Upload failed", String(e)),
  });
  const canImport = meta?.role.areas.includes("datahub");
  return (
    <Card>
      <CardHeader
        title="Ingest technical records (CSV)"
        subtitle="Map your columns, validate and preview before anything is written"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const t = await api.get<string>("/api/datahub/template");
              saveBlob(new Blob([t], { type: "text/csv" }), "aeropulse-records-template.csv");
            }}
          >
            <Download size={14} strokeWidth={1.75} /> Sample file
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            id="csv-file"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setRes(null);
              if (f) send.mutate({ f, dry: true });
            }}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={15} strokeWidth={1.75} /> Choose CSV
          </Button>
          {file && (
            <span className="flex items-center gap-1.5 text-sm text-body">
              <FileSpreadsheet size={15} strokeWidth={1.75} className="text-subtle" /> {file.name}
            </span>
          )}
        </div>
        {res && (
          <>
            <div>
              <p className="label mb-2">Column mapping</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {Object.entries(res.target_fields).map(([field, help]) => (
                  <div key={field}>
                    <p className="mb-1 text-xs text-body" title={help}>
                      {field.replace(/_/g, " ")}
                    </p>
                    <Select
                      ariaLabel={`Column for ${field}`}
                      value={mapping[field] ?? "__none"}
                      onChange={(v) => setMapping((m) => ({ ...m, [field]: v === "__none" ? null : v }))}
                      className="w-full"
                      options={[{ value: "__none", label: "— not mapped —" }, ...res.columns.map((c) => ({ value: c, label: c }))]}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => file && send.mutate({ f: file, dry: true, m: mapping })} disabled={send.isPending}>
                  Re-validate
                </Button>
                <StatusPill tone="ready" label={`${res.valid} valid`} />
                {res.invalid > 0 && <StatusPill tone="grounded" label={`${res.invalid} with errors`} />}
                <span className="text-xs text-subtle">{res.rows} rows read</span>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm" aria-label="Import preview">
                <thead>
                  <tr className="bg-raised/50">
                    <th className="label px-3 py-2 text-left">Line</th>
                    {Object.keys(res.target_fields).map((f) => (
                      <th key={f} className="label whitespace-nowrap px-3 py-2 text-left">
                        {f.replace(/_/g, " ")}
                      </th>
                    ))}
                    <th className="label px-3 py-2 text-left">Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {res.preview.map((p) => (
                    <tr key={p.line} className="border-t border-border/70">
                      <td className="px-3 py-2 text-subtle tnum">{p.line}</td>
                      {Object.keys(res.target_fields).map((f) => (
                        <td key={f} className="max-w-[220px] truncate px-3 py-2 text-body" title={String(p.record[f] ?? "")}>
                          {String(p.record[f] ?? "")}
                        </td>
                      ))}
                      <td className="px-3 py-2">{p.errors.length ? <span className="text-grounded">{p.errors.join("; ")}</span> : <StatusPill tone="ready" label="OK" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="primary" disabled={!canImport || !res.valid || send.isPending || !res.dry_run} onClick={() => file && send.mutate({ f: file, dry: false, m: mapping })}>
              {res.dry_run ? `Import ${res.valid} valid record${res.valid === 1 ? "" : "s"}` : `Imported ${res.imported}`}
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default function DataHubPage() {
  const { data } = useQuery({ queryKey: ["datahub"], queryFn: () => api.get<Sources>("/api/datahub/sources") });
  return (
    <>
      <PageHeader
        title="Data Hub"
        description="One model per aircraft joining health monitoring, technical records, spares and maintenance agencies."
        actions={
          <Button asChild variant="secondary">
            <a href="/docs" target="_blank" rel="noreferrer">
              <BookOpenText size={14} strokeWidth={1.75} /> REST API docs <ExternalLink size={12} strokeWidth={1.75} />
            </a>
          </Button>
        }
      />
      {!data ? (
        <SkeletonRows rows={10} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {data.sources.map((s) => {
              const Icon = ICON[s.id] ?? Activity;
              return (
                <Card key={s.id} className="flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
                      <Icon size={17} strokeWidth={1.75} aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-strong">{s.name}</p>
                      <p className="text-xs text-subtle">{s.system}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-2xl font-semibold text-strong tnum">{fmt.int(s.records)}</p>
                  <p className="text-xs text-subtle">records · {s.entities}</p>
                  <div className="mt-3 space-y-1.5">
                    <QualityBar label="Missing" pct={s.missing_pct} />
                    <QualityBar label="Duplicates" pct={s.duplicate_pct} />
                    <QualityBar label="Out of range" pct={s.out_of_range_pct} />
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-3 text-xs">
                    <span className="text-subtle">
                      Synced {fmt.dateTime(s.last_sync)} · {s.mode}
                    </span>
                    <StatusPill tone={s.score >= 95 ? "ready" : s.score >= 85 ? "caution" : "grounded"} label={`Quality ${s.score.toFixed(0)}`} />
                  </div>
                </Card>
              );
            })}
          </div>
          <Card>
            <CardHeader title="Lineage" subtitle="How the four sources join into one record per aircraft → component → serial" />
            <CardBody>
              <Lineage data={data} />
            </CardBody>
          </Card>
          <Uploader />
          <p className="text-xs text-subtle">Integration-ready: every view in AeroPulse is backed by the documented REST + WebSocket API at /docs, so existing systems can push or pull the same data.</p>
        </div>
      )}
    </>
  );
}

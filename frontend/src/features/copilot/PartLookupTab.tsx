import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Camera, CameraOff, Printer, QrCode, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Modal } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StatusPill, toneForHealth } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

interface PartHistory {
  serial: string;
  part_number: string;
  name: string;
  batch: string;
  supplier: string;
  installed_on: string;
  tail: string;
  aircraft_type: string;
  base_id: string;
  position: string;
  health: number;
  rul: string;
  robbed: boolean;
  life_usage: Record<string, { used: number; limit: number; pct: number }>;
  records: { id: number; date: string; defect_code: string; narrative: string; action_taken: string; technician: string }[];
  repairs: { agency: string; sent_on: string; returned_on: string | null; repeat_failure: boolean }[];
}

export function qrUrl(serial: string) {
  return `${location.origin}/copilot?tab=qr&serial=${encodeURIComponent(serial)}`;
}

function serialFromScan(text: string): string {
  try {
    const u = new URL(text);
    return u.searchParams.get("serial") ?? text;
  } catch {
    return text.trim();
  }
}

function Scanner({ onResult }: { onResult: (s: string) => void }) {
  const [on, setOn] = useState(false);
  const ref = useRef<{ stop: () => Promise<void> } | null>(null);
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled) return;
      const q = new Html5Qrcode("qr-reader");
      ref.current = q;
      try {
        await q.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, (text) => {
          onResult(serialFromScan(text));
          setOn(false);
        }, () => undefined);
      } catch (e) {
        toast.error("Camera unavailable", `${String(e).slice(0, 120)} — enter the serial manually.`);
        setOn(false);
      }
    })();
    return () => {
      cancelled = true;
      ref.current?.stop().catch(() => undefined);
      ref.current = null;
    };
  }, [on, onResult]);
  return (
    <div className="space-y-3">
      <div id="qr-reader" className={on ? "overflow-hidden rounded-lg border border-border" : "hidden"} />
      <Button variant={on ? "danger" : "primary"} className="w-full" onClick={() => setOn((v) => !v)}>
        {on ? <CameraOff size={15} strokeWidth={1.75} /> : <Camera size={15} strokeWidth={1.75} />} {on ? "Stop camera" : "Scan part QR"}
      </Button>
    </div>
  );
}

function QrSheet({ tail, open, onOpenChange }: { tail: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data } = useQuery({
    queryKey: ["qr-parts", tail],
    queryFn: () => api.get<{ serial: string; part_number: string; tail: string; position: string; batch: string }[]>("/api/parts", { tail }),
    enabled: open && !!tail,
  });
  const [codes, setCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    Promise.all(data.map(async (p) => [p.serial, await QRCode.toDataURL(qrUrl(p.serial), { margin: 1, width: 160 })] as const)).then((pairs) => setCodes(Object.fromEntries(pairs)));
  }, [data]);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`QR sheet · ${tail}`} description="Print and attach to parts; scanning opens the part's full history." className="max-w-3xl">
      <div className="mb-3 flex justify-end print:hidden">
        <Button variant="primary" onClick={() => window.print()}>
          <Printer size={14} strokeWidth={1.75} /> Print sheet
        </Button>
      </div>
      <div id="qr-sheet" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {data?.map((p) => (
          <div key={p.serial} className="flex flex-col items-center rounded-lg border border-border bg-white p-3 text-center text-black">
            {codes[p.serial] ? <img src={codes[p.serial]} alt={`QR code for ${p.serial}`} width={120} height={120} /> : <div className="h-[120px] w-[120px] animate-pulse bg-black/10" />}
            <p className="mt-1 font-mono text-xs font-semibold">{p.serial}</p>
            <p className="text-[11px]">{p.part_number}</p>
            <p className="text-[11px]">
              {p.tail} · {p.position}
            </p>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function PartLookupTab() {
  const [params, setParams] = useSearchParams();
  const serial = params.get("serial") ?? "";
  const [input, setInput] = useState(serial);
  const [sheetTail, setSheetTail] = useState("AP-112");
  const [sheetOpen, setSheetOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["part", serial],
    queryFn: () => api.get<PartHistory>(`/api/parts/${encodeURIComponent(serial)}`),
    enabled: !!serial,
    retry: 0,
  });
  const lookup = (s: string) => {
    const v = s.trim().toUpperCase();
    if (!v) return;
    setInput(v);
    setParams({ tab: "qr", serial: v });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Part lookup" subtitle="Scan the QR on a part or type its serial" />
          <CardBody className="space-y-3">
            <Scanner onResult={lookup} />
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                lookup(input);
              }}
            >
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Serial, e.g. ENG-10443" aria-label="Part serial" className="font-mono" />
              <Button type="submit" variant="secondary" aria-label="Look up">
                <Search size={15} strokeWidth={1.75} />
              </Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Printable QR sheet" subtitle="One code per installed part of an aircraft" />
          <CardBody className="flex gap-2">
            <Input value={sheetTail} onChange={(e) => setSheetTail(e.target.value.toUpperCase())} aria-label="Tail number for QR sheet" className="font-mono" />
            <Button variant="secondary" onClick={() => setSheetOpen(true)}>
              <QrCode size={15} strokeWidth={1.75} /> Generate
            </Button>
          </CardBody>
        </Card>
      </div>
      <div>
        {!serial ? (
          <Card>
            <EmptyState icon={QrCode} title="No part selected" description="Scan a part QR code or enter a serial to see installation, health, life usage and every maintenance action." />
          </Card>
        ) : isLoading ? (
          <SkeletonRows rows={8} />
        ) : error || !data ? (
          <Card>
            <EmptyState icon={Search} title={`No part with serial ${serial}`} description="Check the serial on the data plate." />
          </Card>
        ) : (
          <Card>
            <CardHeader
              title={`${data.name}`}
              subtitle={
                <span className="font-mono">
                  S/N {data.serial} · P/N {data.part_number}
                </span>
              }
              actions={<StatusPill tone={toneForHealth(data.health)} label={`Health ${data.health.toFixed(0)}`} />}
            />
            <CardBody className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-subtle">Installed on</dt>
                  <dd className="text-strong">
                    <Link to={`/aircraft/${data.tail}`} className="font-mono text-accent hover:underline">
                      {data.tail}
                    </Link>{" "}
                    · {data.position}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle">Since</dt>
                  <dd className="text-strong">{fmt.date(data.installed_on)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle">Remaining life</dt>
                  <dd className="text-strong">{data.rul}</dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle">Batch</dt>
                  <dd className="font-mono text-strong">{data.batch}</dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle">Supplier</dt>
                  <dd className="text-strong">{data.supplier}</dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle">Life used</dt>
                  <dd className="text-strong tnum">{Math.max(...Object.values(data.life_usage).map((u) => u.pct)).toFixed(0)}%</dd>
                </div>
              </dl>
              {data.robbed && <StatusPill tone="caution" label="Robbed for another aircraft — replacement pending" />}
              <div>
                <p className="label mb-2">Maintenance history</p>
                <ul className="space-y-2">
                  {data.records.map((r) => (
                    <li key={r.id} className="rounded-lg border border-border p-2.5 text-sm">
                      <p className="text-xs text-subtle">
                        {fmt.date(r.date)} · <span className="font-mono">{r.defect_code}</span> · {r.technician}
                      </p>
                      <p className="text-body">{r.narrative}</p>
                      <p className="text-subtle">→ {r.action_taken}</p>
                    </li>
                  ))}
                  {!data.records.length && <li className="text-sm text-subtle">No defects recorded against this part.</li>}
                </ul>
              </div>
              {data.repairs.length > 0 && (
                <div>
                  <p className="label mb-2">Repair agency visits</p>
                  <ul className="space-y-1 text-sm">
                    {data.repairs.map((r, i) => (
                      <li key={i} className="text-body">
                        {r.agency} · sent {fmt.date(r.sent_on)} · {r.returned_on ? `returned ${fmt.date(r.returned_on)}` : "in work"}
                        {r.repeat_failure && <span className="ml-2 text-grounded">repeat failure</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>
        )}
      </div>
      <QrSheet tail={sheetTail} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Mic, MicOff, ShieldCheck, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Draft {
  tail: string | null;
  component_kind: string | null;
  defect_code: string | null;
  action: string | null;
  side: string | null;
  parts_used: string[];
  confidence: number;
  narrative: string;
  similar: { id: number; tail: string; defect_code: string; narrative: string }[];
}

// Minimal typing for the browser Web Speech API (not in TS lib.dom).
interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type SpeechCtor = new () => SpeechRec;

const KINDS = [
  ["engine", "Engine"],
  ["apu", "APU"],
  ["landing_gear", "Landing Gear"],
  ["hydraulics", "Hydraulics"],
  ["avionics", "Avionics"],
  ["fuel", "Fuel System"],
  ["flight_controls", "Flight Controls"],
  ["ecs", "Environmental Control"],
];

export function LogEntryTab() {
  const qc = useQueryClient();
  const Rec = (window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition;
  const [lang, setLang] = useState<"en-IN" | "hi-IN">("en-IN");
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState({ tail: "", component_kind: "", defect_code: "", narrative: "", action_taken: "", man_hours: "2", parts: "" });
  const rec = useRef<SpeechRec | null>(null);

  useEffect(() => () => rec.current?.stop(), []);

  const toggleMic = () => {
    if (!Rec) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Rec();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let s = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) s += e.results[i][0].transcript;
      if (s) setText((t) => (t ? `${t} ${s}` : s).trim());
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      toast.error("Voice input stopped", e.error === "not-allowed" ? "Microphone permission was denied — type the entry instead." : e.error);
    };
    rec.current = r;
    r.start();
    setListening(true);
  };

  const parse = useMutation({
    mutationFn: () => api.post<Draft>("/api/logbook/parse", { text }),
    onSuccess: (d) => {
      setDraft(d);
      const action =
        d.action === "replaced" ? "Replaced" : d.action === "inspected" ? "Inspected" : d.action === "serviced" ? "Serviced" : d.action === "adjusted" ? "Adjusted" : "";
      setForm({
        tail: d.tail ?? "",
        component_kind: d.component_kind ?? "",
        defect_code: d.defect_code ?? "",
        narrative: d.narrative,
        action_taken: action ? `${action}${d.parts_used.length ? ` (${d.parts_used.join(", ")})` : ""}. Functional check satisfactory.` : "",
        man_hours: "2",
        parts: d.parts_used.join(", "),
      });
    },
    onError: (e) => toast.error("Could not structure the entry", String(e)),
  });

  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: number; ledger_seq: number; hash: string }>("/api/logbook/entry", {
        tail: form.tail.toUpperCase(),
        component_kind: form.component_kind,
        defect_code: form.defect_code,
        narrative: form.narrative,
        action_taken: form.action_taken,
        man_hours: Number(form.man_hours),
        parts_used: form.parts.split(/[,\s]+/).filter(Boolean),
      }),
    onSuccess: (r) => {
      toast.success(`Record #${r.id} saved and signed`, `Ledger entry ${r.ledger_seq} · ${r.hash.slice(0, 12)}…`);
      setText("");
      setDraft(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error("Save failed", String(e)),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.tail && form.component_kind && form.defect_code && form.narrative.length >= 5 && form.action_taken.length >= 3;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Speak or type the entry" subtitle="Hindi or English — AeroPulse structures it into a technical record for you to review" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              ariaLabel="Speech language"
              value={lang}
              onChange={setLang}
              options={[
                { value: "en-IN", label: "English" },
                { value: "hi-IN", label: "हिन्दी / Hinglish" },
              ]}
            />
            {Rec ? (
              <Button type="button" variant={listening ? "danger" : "primary"} onClick={toggleMic} aria-pressed={listening} data-tour="voice">
                {listening ? <MicOff size={15} strokeWidth={1.75} /> : <Mic size={15} strokeWidth={1.75} />}
                {listening ? "Stop" : "Start voice entry"}
              </Button>
            ) : (
              <span className="text-xs text-subtle">Voice input isn't available in this browser — type the entry below.</span>
            )}
            {listening && (
              <span className="inline-flex items-center gap-1.5 text-xs text-grounded" role="status">
                <span className="h-2 w-2 animate-pulse-dot rounded-full bg-grounded" /> Listening
              </span>
            )}
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="e.g. AP-112 left side hydraulic pressure drop after landing, seal kit badla, leak check OK"
            aria-label="Entry text"
            className="text-base sm:text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => parse.mutate()} disabled={text.trim().length < 3 || parse.isPending}>
              <Wand2 size={14} strokeWidth={1.75} /> {parse.isPending ? "Structuring…" : "Structure entry"}
            </Button>
            <button
              type="button"
              className="text-sm text-subtle underline-offset-2 hover:text-strong hover:underline"
              onClick={() => setText("AP-112 left side hydraulic pressure drop after landing, seal kit badla, leak check OK")}
            >
              Use sample
            </button>
          </div>
          {draft && (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="flex items-center gap-2 text-strong">
                <Check size={15} strokeWidth={1.75} className="text-ready" /> Structured with {Math.round(draft.confidence * 100)}% confidence
              </p>
              {draft.similar.length > 0 && (
                <p className="mt-1 text-xs text-subtle">
                  Closest past entries: {draft.similar.map((s) => `${s.tail} ${s.defect_code}`).join(" · ")}
                </p>
              )}
            </div>
          )}
        </CardBody>
      </Card>
      <Card className={cn(!draft && "opacity-60")}>
        <CardHeader title="Review & save" subtitle="Saved records are appended to the SHA-256 audit chain" />
        <CardBody>
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) save.mutate();
            }}
          >
            <Field label="Tail" htmlFor="le-tail">
              <Input id="le-tail" value={form.tail} onChange={set("tail")} placeholder="AP-112" className="font-mono" />
            </Field>
            <Field label="System">
              <Select ariaLabel="System" value={form.component_kind} onChange={(v) => setForm((f) => ({ ...f, component_kind: v }))} className="w-full" placeholder="Select" options={KINDS.map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Defect code" htmlFor="le-code">
              <Input id="le-code" value={form.defect_code} onChange={set("defect_code")} placeholder="HYD-LKS" className="font-mono" />
            </Field>
            <Field label="Man-hours" htmlFor="le-mh">
              <Input id="le-mh" type="number" min={0} step={0.5} value={form.man_hours} onChange={set("man_hours")} />
            </Field>
            <div className="col-span-2">
              <Field label="Defect description" htmlFor="le-narr">
                <Textarea id="le-narr" rows={3} value={form.narrative} onChange={set("narrative")} />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Action taken" htmlFor="le-act">
                <Textarea id="le-act" rows={2} value={form.action_taken} onChange={set("action_taken")} />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Parts used" htmlFor="le-parts" hint="Part numbers, comma separated">
                <Input id="le-parts" value={form.parts} onChange={set("parts")} className="font-mono" />
              </Field>
            </div>
            <Button type="submit" variant="primary" className="col-span-2" disabled={!valid || save.isPending}>
              <ShieldCheck size={15} strokeWidth={1.75} /> {save.isPending ? "Saving…" : "Save signed record"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

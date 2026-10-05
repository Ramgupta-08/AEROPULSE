import { useMutation } from "@tanstack/react-query";
import { BookOpen, ChevronDown, Cpu, History, SendHorizontal, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CopilotAnswer {
  question: string;
  mode: "llm" | "retrieval" | "retrieval-fallback";
  model: string | null;
  answer: string;
  manual: { id: string; ref: string; title: string; chapter: string; text: string; score: number }[];
  cases: { id: string; tail: string; date: string; defect_code: string; narrative: string; action_taken: string; base_id: string; score: number }[];
  causes: { cause: string; past_cases: number }[];
  checks: string[];
  past_fixes: { action: string; count: number }[];
  component: string | null;
}

const EXAMPLES = [
  "Hydraulic pressure dropping on left side after landing",
  "APU start nahi ho raha subah thand me",
  "EGT rising on engine 2 over last few sorties",
  "Corrosion on main gear axle",
];

/** Renders answer text with [M1]/[C2] citations as clickable chips. */
function AnswerText({ text, onCite }: { text: string; onCite: (id: string) => void }) {
  return (
    <div className="space-y-1.5 text-sm leading-6 text-body">
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        const heading = /:$/.test(line.trim()) && line.length < 60;
        const parts = line.split(/(\[[MC]\d+\])/g);
        return (
          <p key={i} className={cn(heading && "pt-1 font-semibold text-strong", /^(\d+\.|•|-)/.test(line.trim()) && "pl-3")}>
            {parts.map((p, j) =>
              /^\[[MC]\d+\]$/.test(p) ? (
                <button
                  key={j}
                  type="button"
                  onClick={() => onCite(p.slice(1, -1))}
                  className="mx-0.5 inline-flex h-5 items-center rounded border border-accent/40 bg-accent/12 px-1 font-mono text-[11px] text-accent hover:bg-accent/20"
                  aria-label={`Source ${p.slice(1, -1)}`}
                >
                  {p.slice(1, -1)}
                </button>
              ) : (
                <span key={j}>{p.replace(/\*\*/g, "")}</span>
              ),
            )}
          </p>
        );
      })}
    </div>
  );
}

function Sources({ a, open, setOpen }: { a: CopilotAnswer; open: string | null; setOpen: (id: string | null) => void }) {
  return (
    <div className="space-y-3">
      {a.manual.length > 0 && (
        <div>
          <p className="label mb-1.5 flex items-center gap-1.5">
            <BookOpen size={13} strokeWidth={1.75} /> Manual sections
          </p>
          <ul className="space-y-1.5">
            {a.manual.map((m) => (
              <li key={m.id} id={`src-${m.id}`} className={cn("rounded-lg border p-2.5", open === m.id ? "border-accent" : "border-border")}>
                <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                  <span className="font-mono text-[11px] text-accent">{m.id}</span>
                  <span className="min-w-0 flex-1 text-sm text-strong">
                    {m.ref} · {m.title}
                    <span className="block text-xs text-subtle">{m.chapter}</span>
                  </span>
                  <ChevronDown size={14} strokeWidth={1.75} className={cn("mt-1 shrink-0 text-subtle transition-transform", open === m.id && "rotate-180")} />
                </button>
                {open === m.id && <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-5 text-body">{m.text}</pre>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.cases.length > 0 && (
        <div>
          <p className="label mb-1.5 flex items-center gap-1.5">
            <History size={13} strokeWidth={1.75} /> Similar past cases
          </p>
          <ul className="space-y-1.5">
            {a.cases.map((c) => (
              <li key={c.id} id={`src-${c.id}`} className={cn("rounded-lg border p-2.5 text-sm", open === c.id ? "border-accent" : "border-border")}>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-subtle">
                  <span className="font-mono text-accent">{c.id}</span>
                  <span className="font-mono text-strong">{c.tail}</span>
                  <span>{fmt.date(c.date)}</span>
                  <span className="font-mono">{c.defect_code}</span>
                  <span className="ml-auto tnum">{Math.round(c.score * 100)}% match</span>
                </div>
                <p className="mt-1 text-body">{c.narrative}</p>
                <p className="mt-0.5 text-subtle">→ {c.action_taken}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface Turn {
  q: string;
  a?: CopilotAnswer;
}

export function AskTab() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const ask = useMutation({
    mutationFn: (question: string) => api.post<CopilotAnswer>("/api/copilot/ask", { question }),
    onSuccess: (a) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x))),
    onError: (e) => {
      setTurns((t) => t.slice(0, -1));
      toast.error("Copilot unavailable", String(e));
    },
  });
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [turns, ask.isPending]);
  const send = (text: string) => {
    const t = text.trim();
    if (t.length < 3 || ask.isPending) return;
    setTurns((x) => [...x, { q: t }]);
    setQ("");
    ask.mutate(t);
  };
  const cite = (id: string) => {
    setOpen(id);
    setTimeout(() => document.getElementById(`src-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-5 pb-4">
        {turns.length === 0 && (
          <div className="card p-5">
            <div className="flex items-center gap-2 text-strong">
              <Sparkles size={18} strokeWidth={1.75} className="text-accent" aria-hidden />
              <p className="text-md font-semibold">Describe the symptom</p>
            </div>
            <p className="mt-1 text-sm text-subtle">English or Hinglish. Answers cite the maintenance manual and similar past cases from the fleet logbook.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} type="button" onClick={() => send(e)} className="rounded-full border border-border px-3 py-1.5 text-left text-sm text-body hover:border-border-strong hover:text-strong">
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-3">
            <div className="ml-auto w-fit max-w-[85%] rounded-card rounded-br-sm bg-accent px-3.5 py-2 text-sm text-accent-fg">{t.q}</div>
            {t.a ? (
              <div className="card space-y-4 p-4" data-tour={i === 0 ? "copilot-answer" : undefined}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
                  <Cpu size={13} strokeWidth={1.75} aria-hidden />
                  {t.a.mode === "llm" ? `Claude (${t.a.model}) · grounded in local sources` : t.a.mode === "retrieval" ? "Offline retrieval · manual + logbook" : "Offline retrieval (language model unavailable)"}
                  {t.a.component && <span className="ml-auto rounded border border-border px-1.5 py-0.5">{t.a.component}</span>}
                </div>
                <AnswerText text={t.a.answer} onCite={cite} />
                <div className="border-t border-border pt-3">
                  <Sources a={t.a} open={open} setOpen={setOpen} />
                </div>
              </div>
            ) : (
              <div className="card space-y-2 p-4" aria-busy="true">
                <div className="h-3 w-2/3 animate-pulse rounded bg-raised" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-raised" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-raised" />
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="sticky bottom-0 -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur-sm sm:mx-0 sm:rounded-card sm:border"
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(q);
              }
            }}
            rows={2}
            placeholder="e.g. hydraulic pressure dropping on left side after landing"
            aria-label="Describe the symptom"
            className="min-h-[44px] resize-none text-base sm:text-sm"
          />
          <Button type="submit" variant="primary" size="lg" disabled={q.trim().length < 3 || ask.isPending} aria-label="Ask Copilot">
            <SendHorizontal size={16} strokeWidth={1.75} />
          </Button>
        </div>
      </form>
    </div>
  );
}

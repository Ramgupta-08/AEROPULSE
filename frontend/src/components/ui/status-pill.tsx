import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "ready" | "caution" | "grounded" | "info" | "neutral";

const toneClass: Record<Tone, string> = {
  ready: "bg-ready/12 text-ready",
  caution: "bg-caution/12 text-caution",
  grounded: "bg-grounded/12 text-grounded",
  info: "bg-info/12 text-info",
  neutral: "bg-raised text-subtle",
};

const toneIcon = { ready: CircleCheck, caution: CircleAlert, grounded: CircleX, info: Info, neutral: Info };

const defaultLabel: Record<Tone, string> = {
  ready: "Ready",
  caution: "Caution",
  grounded: "Grounded",
  info: "Info",
  neutral: "—",
};

/** Status is always conveyed by icon + text, never colour alone. */
export function StatusPill({ tone, label, className, iconOnly }: { tone: Tone; label?: string; className?: string; iconOnly?: boolean }) {
  const Icon = toneIcon[tone];
  const text = label ?? defaultLabel[tone];
  return (
    <span
      className={cn("inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-xs font-medium", toneClass[tone], iconOnly && "w-[22px] justify-center px-0", className)}
      title={iconOnly ? text : undefined}
      aria-label={iconOnly ? text : undefined}
    >
      <Icon size={13} strokeWidth={2} aria-hidden />
      {!iconOnly && <span className="whitespace-nowrap">{text}</span>}
    </span>
  );
}

export function toneForHealth(score: number): Tone {
  return score >= 75 ? "ready" : score >= 50 ? "caution" : "grounded";
}

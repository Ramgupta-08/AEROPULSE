import * as TG from "@radix-ui/react-toggle-group";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <TG.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={ariaLabel}
      className={cn("inline-flex h-8 items-center rounded-[7px] border border-border bg-bg p-0.5", className)}
    >
      {options.map((o) => (
        <TG.Item
          key={o.value}
          value={o.value}
          title={o.title}
          aria-label={o.title}
          className="inline-flex h-full items-center gap-1.5 rounded-[5px] px-2.5 text-sm text-subtle transition-colors hover:text-strong data-[state=on]:bg-raised data-[state=on]:text-strong"
        >
          {o.label}
        </TG.Item>
      ))}
    </TG.Root>
  );
}

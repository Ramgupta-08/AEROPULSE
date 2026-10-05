import * as S from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: ReactNode;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  ariaLabel,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  ariaLabel: string;
  icon?: ReactNode;
}) {
  return (
    <S.Root value={value} onValueChange={onChange}>
      <S.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-8 min-w-0 items-center gap-2 rounded-[7px] border border-border bg-raised px-2.5 text-sm text-strong transition-colors hover:border-border-strong data-[placeholder]:text-subtle",
          className,
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-left">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronDown size={14} strokeWidth={1.75} className="text-subtle" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={4} className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-raised p-1 shadow-[0_8px_24px_rgb(0_0_0/0.25)]">
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex h-8 cursor-pointer select-none items-center rounded-md pl-7 pr-3 text-sm text-body outline-none data-[highlighted]:bg-surface data-[highlighted]:text-strong"
              >
                <S.ItemIndicator className="absolute left-2">
                  <Check size={14} strokeWidth={2} className="text-accent" />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

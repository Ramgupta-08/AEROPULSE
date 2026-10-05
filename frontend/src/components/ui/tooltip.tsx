import * as TT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = TT.Provider;

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <TT.Root delayDuration={250}>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md border border-border bg-raised px-2 py-1 text-xs text-strong">
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

import * as T from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ tabs, className }: { tabs: { value: string; label: React.ReactNode }[]; className?: string }) {
  return (
    <T.List className={cn("flex gap-1 overflow-x-auto border-b border-border scrollbar-none", className)}>
      {tabs.map((t) => (
        <T.Trigger
          key={t.value}
          value={t.value}
          className="relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm text-subtle transition-colors hover:text-strong data-[state=active]:border-accent data-[state=active]:text-strong"
        >
          {t.label}
        </T.Trigger>
      ))}
    </T.List>
  );
}

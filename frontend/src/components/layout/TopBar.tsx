import * as D from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MapPin, Menu, Moon, Search, Sun, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useBases, useMeta } from "@/lib/queries";
import { useUi } from "@/lib/store";
import { cn } from "@/lib/utils";
import { usePalette } from "./CommandPalette";
import { Logo } from "./Logo";
import { RoleSwitcher } from "./RoleSwitcher";
import { NavList } from "./Sidebar";

function LiveStatus() {
  const { isError, isSuccess } = useQuery({
    queryKey: ["ping"],
    queryFn: () => api.get<{ status: string }>("/api/ping"),
    refetchInterval: 10_000,
    retry: 0,
  });
  const live = isSuccess && !isError;
  return (
    <Tooltip content={live ? "Connected to on-premise AeroPulse server" : "Server unreachable — showing cached data"}>
      <span className="inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-xs font-medium text-subtle" role="status" aria-live="polite">
        <span className={cn("h-2 w-2 rounded-full", live ? "animate-pulse-dot bg-ready" : "bg-grounded")} aria-hidden />
        <span className="hidden sm:inline">{live ? "Live" : "Offline"}</span>
      </span>
    </Tooltip>
  );
}

export function BaseFilter({ className }: { className?: string }) {
  const { data: bases } = useBases();
  const { baseFilter, setBaseFilter } = useUi();
  return (
    <Select
      ariaLabel="Filter by base"
      className={className}
      value={baseFilter ?? "all"}
      onChange={(v) => setBaseFilter(v === "all" ? null : v)}
      icon={<MapPin size={14} strokeWidth={1.75} className="text-subtle" aria-hidden />}
      options={[{ value: "all", label: "All bases" }, ...(bases ?? []).map((b) => ({ value: b.id, label: b.name }))]}
    />
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu size={18} strokeWidth={1.75} />
        </Button>
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <D.Content className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-border bg-surface outline-none data-[state=open]:animate-[fade-in_150ms_ease-out]">
          <D.Title className="sr-only">Navigation</D.Title>
          <D.Description className="sr-only">Main navigation</D.Description>
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <Logo />
            <D.Close className="grid h-8 w-8 place-items-center rounded-md text-subtle hover:bg-raised" aria-label="Close navigation">
              <X size={16} strokeWidth={1.75} />
            </D.Close>
          </div>
          <div className="border-b border-border p-3">
            <BaseFilter className="w-full" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <NavList onNavigate={() => setOpen(false)} />
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function TopBar({ extra }: { extra?: ReactNode }) {
  const setOpen = usePalette((s) => s.setOpen);
  const { theme, toggleTheme } = useUi();
  const { data: meta } = useMeta();
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg/95 px-3 backdrop-blur-sm sm:px-4 lg:px-6">
      <MobileNav />
      <div className="lg:hidden">
        <Logo collapsed />
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-full max-w-[320px] items-center gap-2 rounded-[7px] border border-border bg-surface px-2.5 text-sm text-subtle transition-colors hover:border-border-strong md:flex"
        aria-label="Open command palette"
      >
        <Search size={14} strokeWidth={1.75} aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded border border-border px-1.5 font-mono text-[11px]">⌘K</kbd>
      </button>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Search">
        <Search size={17} strokeWidth={1.75} />
      </Button>
      <div className="flex-1" />
      <BaseFilter className="hidden w-[168px] lg:inline-flex" />
      {meta?.as_of && (
        <Tooltip content="Data as-of date (simulated fleet)">
          <span className="hidden h-8 items-center gap-1.5 rounded-[7px] border border-border px-2.5 text-sm text-body xl:inline-flex">
            <CalendarDays size={14} strokeWidth={1.75} className="text-subtle" aria-hidden />
            {fmt.date(meta.as_of)}
          </span>
        </Tooltip>
      )}
      <LiveStatus />
      {extra}
      <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
        {theme === "dark" ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
      </Button>
      <RoleSwitcher />
    </header>
  );
}

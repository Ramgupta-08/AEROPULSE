import { Command } from "cmdk";
import { Moon, Plane, Search, Sun, UserRound } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import * as D from "@radix-ui/react-dialog";
import { create } from "zustand";
import { useMeta } from "@/lib/queries";
import { useUi, type RoleId } from "@/lib/store";
import { useAllowedNav } from "./Sidebar";
import { usePaletteExtras } from "./paletteExtras";

export const usePalette = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const itemCls =
  "flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-sm text-body data-[selected=true]:bg-raised data-[selected=true]:text-strong";
const groupCls = "[&_[cmdk-group-heading]]:label [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3";

export function CommandPalette() {
  const { open, setOpen } = usePalette();
  const nav = useAllowedNav();
  const navigate = useNavigate();
  const { theme, toggleTheme, setRole } = useUi();
  const { data: meta } = useMeta();
  const extras = usePaletteExtras();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!usePalette.getState().open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card border border-border bg-surface">
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search pages, aircraft and actions</D.Description>
          <Command label="Command palette" loop>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search size={16} strokeWidth={1.75} className="text-subtle" aria-hidden />
              <Command.Input
                autoFocus
                placeholder="Search pages, aircraft, actions…"
                className="h-12 flex-1 bg-transparent text-base text-strong outline-none placeholder:text-subtle"
              />
              <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-subtle">esc</kbd>
            </div>
            <Command.List className="max-h-[50vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-subtle">No matches.</Command.Empty>
              <Command.Group heading="Go to" className={groupCls}>
                {nav.map((n) => (
                  <Command.Item key={n.path} value={`go ${n.label} ${n.description}`} onSelect={() => go(() => navigate(n.path))} className={itemCls}>
                    <n.icon size={16} strokeWidth={1.75} className="text-subtle" aria-hidden />
                    <span className="flex-1">{n.label}</span>
                    {n.keys && <span className="font-mono text-[11px] text-subtle">{n.keys}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
              {extras.aircraft.length > 0 && (
                <Command.Group heading="Aircraft" className={groupCls}>
                  {extras.aircraft.map((a) => (
                    <Command.Item key={a.tail} value={`aircraft ${a.tail} ${a.type} ${a.base}`} onSelect={() => go(() => navigate(`/aircraft/${a.tail}`))} className={itemCls}>
                      <Plane size={16} strokeWidth={1.75} className="text-subtle" aria-hidden />
                      <span className="font-mono text-strong">{a.tail}</span>
                      <span className="truncate text-subtle">
                        {a.type} · {a.base}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Actions" className={groupCls}>
                {extras.actions.map((a) => (
                  <Command.Item key={a.id} value={a.label} onSelect={() => go(a.run)} className={itemCls}>
                    <a.icon size={16} strokeWidth={1.75} className="text-subtle" aria-hidden />
                    {a.label}
                  </Command.Item>
                ))}
                <Command.Item value="toggle theme dark light" onSelect={() => go(toggleTheme)} className={itemCls}>
                  {theme === "dark" ? <Sun size={16} strokeWidth={1.75} className="text-subtle" /> : <Moon size={16} strokeWidth={1.75} className="text-subtle" />}
                  Switch to {theme === "dark" ? "light" : "dark"} theme
                </Command.Item>
                {meta?.roles
                  .filter((r) => r.id !== meta.role.id)
                  .map((r) => (
                    <Command.Item key={r.id} value={`switch role ${r.label}`} onSelect={() => go(() => setRole(r.id as RoleId))} className={itemCls}>
                      <UserRound size={16} strokeWidth={1.75} className="text-subtle" aria-hidden />
                      Switch role to {r.label}
                    </Command.Item>
                  ))}
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

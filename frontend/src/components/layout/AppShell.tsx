import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useEffect, useMemo, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { NAV } from "@/app/nav";
import { useDemo } from "@/features/demo/GuidedDemo";
import { api } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import { useMeta } from "@/lib/queries";
import type { AircraftRow } from "@/lib/types";
import { useUi } from "@/lib/store";
import { CommandPalette, usePalette } from "./CommandPalette";
import { usePaletteExtras } from "./paletteExtras";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/** Feeds the command palette with the aircraft list when the role may see the fleet. */
function PaletteAircraft() {
  const { data: meta } = useMeta();
  const allowed = !!meta?.role.areas.includes("fleet");
  const setAircraft = usePaletteExtras((s) => s.setAircraft);
  const { data } = useQuery({
    queryKey: ["aircraft", "palette", meta?.role.id],
    queryFn: () => api.get<AircraftRow[]>("/api/aircraft"),
    enabled: allowed,
    staleTime: 60_000,
  });
  useEffect(() => {
    setAircraft(allowed && data ? data.map((a) => ({ tail: a.tail, type: a.type, base: a.base_name })) : []);
  }, [allowed, data, setAircraft]);
  const setActions = usePaletteExtras((s) => s.setActions);
  useEffect(() => {
    setActions([{ id: "demo", label: "Start guided demo", icon: Play, run: () => useDemo.getState().start() }]);
  }, [setActions]);
  return null;
}

export function AppShell({ topBarExtra, overlay }: { topBarExtra?: ReactNode; overlay?: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const reduce = useReducedMotion();
  const toggleTheme = useUi((s) => s.toggleTheme);
  const setOpen = usePalette((s) => s.setOpen);

  const keys = useMemo(() => {
    const m: Record<string, () => void> = { "/": () => setOpen(true), t: toggleTheme };
    for (const n of NAV) if (n.keys) m[n.keys] = () => navigate(n.path);
    return m;
  }, [navigate, toggleTheme, setOpen]);
  useHotkeys(keys);

  return (
    <div className="flex h-full min-h-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar extra={topBarExtra} />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname.split("/")[1] ?? ""}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-6 lg:py-6"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette />
      <PaletteAircraft />
      {overlay}
    </div>
  );
}

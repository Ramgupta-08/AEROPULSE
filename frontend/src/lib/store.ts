import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";
export type RoleId = "commander" | "engineering_officer" | "technician" | "logistics" | "auditor";
export type Density = "comfortable" | "compact";

interface UiState {
  theme: Theme;
  role: RoleId;
  baseFilter: string | null;
  sidebarCollapsed: boolean;
  density: Density;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setRole: (r: RoleId) => void;
  setBaseFilter: (b: string | null) => void;
  toggleSidebar: () => void;
  setDensity: (d: Density) => void;
}

export function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.dataset.theme = t;
  el.classList.toggle("dark", t === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0B0E13" : "#F6F7F9");
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      role: "engineering_officer",
      baseFilter: null,
      sidebarCollapsed: false,
      density: "comfortable",
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
      setRole: (role) => set({ role }),
      setBaseFilter: (baseFilter) => set({ baseFilter }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setDensity: (density) => set({ density }),
    }),
    { name: "aeropulse-ui" },
  ),
);

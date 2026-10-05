import type { LucideIcon } from "lucide-react";
import { create } from "zustand";

export interface PaletteAction {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

/** Features register extra palette entries (aircraft list, demo actions) here. */
export const usePaletteExtras = create<{
  aircraft: { tail: string; type: string; base: string }[];
  actions: PaletteAction[];
  setAircraft: (a: { tail: string; type: string; base: string }[]) => void;
  setActions: (a: PaletteAction[]) => void;
}>((set) => ({
  aircraft: [],
  actions: [],
  setAircraft: (aircraft) => set({ aircraft }),
  setActions: (actions) => set({ actions }),
}));

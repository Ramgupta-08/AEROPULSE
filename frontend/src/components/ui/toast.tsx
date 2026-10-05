import * as T from "@radix-ui/react-toast";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { create } from "zustand";
import { cn } from "@/lib/utils";

type Kind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: Kind;
  title: string;
  description?: string;
}

const useToasts = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, "id">) => void; remove: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => set((s) => ({ items: [...s.items.slice(-3), { ...t, id: Date.now() + Math.random() }] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export const toast = {
  success: (title: string, description?: string) => useToasts.getState().push({ kind: "success", title, description }),
  error: (title: string, description?: string) => useToasts.getState().push({ kind: "error", title, description }),
  info: (title: string, description?: string) => useToasts.getState().push({ kind: "info", title, description }),
};

const icon = { success: CircleCheck, error: CircleAlert, info: Info };
const tone = { success: "text-ready", error: "text-grounded", info: "text-info" };

export function Toaster() {
  const { items, remove } = useToasts();
  return (
    <T.Provider swipeDirection="right" duration={4500}>
      {items.map((t) => {
        const Icon = icon[t.kind];
        return (
          <T.Root
            key={t.id}
            onOpenChange={(o) => !o && remove(t.id)}
            className="flex w-full items-start gap-3 rounded-card border border-border bg-raised p-3 data-[state=open]:animate-[slide-in_200ms_ease-out]"
          >
            <Icon size={16} strokeWidth={2} className={cn("mt-0.5 shrink-0", tone[t.kind])} aria-hidden />
            <div className="min-w-0 flex-1">
              <T.Title className="text-sm font-medium text-strong">{t.title}</T.Title>
              {t.description && <T.Description className="mt-0.5 text-sm text-subtle">{t.description}</T.Description>}
            </div>
            <T.Close aria-label="Dismiss" className="text-subtle hover:text-strong">
              <X size={14} strokeWidth={1.75} />
            </T.Close>
          </T.Root>
        );
      })}
      <T.Viewport className="fixed bottom-4 right-4 z-[60] flex w-[calc(100%-32px)] max-w-sm flex-col gap-2 outline-none" />
    </T.Provider>
  );
}

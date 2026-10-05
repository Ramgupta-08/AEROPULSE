import * as DM from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useMeta } from "@/lib/queries";
import { useUi, type RoleId } from "@/lib/store";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name
    .replace(/^(Gp Capt|Wg Cdr|Sqn Ldr|Sgt|Mr|Ms)\s+/, "")
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
}

export function RoleSwitcher({ compact }: { compact?: boolean }) {
  const { data } = useMeta();
  const setRole = useUi((s) => s.setRole);
  const qc = useQueryClient();
  const current = data?.role;
  return (
    <DM.Root>
      <DM.Trigger
        className="flex h-8 items-center gap-2 rounded-[7px] border border-border bg-raised pl-1 pr-2 text-sm text-strong hover:border-border-strong"
        aria-label={`Current role ${current?.label ?? ""}. Switch role`}
      >
        <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-accent/16 text-[11px] font-semibold text-accent">{current ? initials(current.user) : "··"}</span>
        {!compact && (
          <span className="hidden max-w-[150px] truncate xl:inline" data-testid="role-label">
            {current?.label ?? "Loading"}
          </span>
        )}
        <ChevronDown size={14} strokeWidth={1.75} className="text-subtle" aria-hidden />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className="z-50 w-64 rounded-lg border border-border bg-raised p-1">
          <DM.Label className="label px-2.5 pb-1 pt-2">Demo login — switch role</DM.Label>
          {data?.roles.map((r) => (
            <DM.Item
              key={r.id}
              onSelect={() => {
                setRole(r.id as RoleId);
                qc.invalidateQueries();
              }}
              className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 outline-none data-[highlighted]:bg-surface")}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface text-[11px] font-semibold text-body">{initials(r.user)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-strong">{r.label}</span>
                <span className="block truncate text-xs text-subtle">{r.user}</span>
              </span>
              {r.id === current?.id && <Check size={14} strokeWidth={2} className="text-accent" />}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

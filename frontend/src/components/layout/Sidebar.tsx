import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router-dom";
import { GROUPS, NAV } from "@/app/nav";
import { Tooltip } from "@/components/ui/tooltip";
import { useMeta } from "@/lib/queries";
import { useUi } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";

export function useAllowedNav() {
  const { data } = useMeta();
  const areas = data?.role.areas;
  return NAV.filter((n) => !areas || areas.includes(n.area));
}

export function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const items = useAllowedNav();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-4">
      {GROUPS.map((g) => {
        const group = items.filter((i) => i.group === g);
        if (!group.length) return null;
        return (
          <div key={g}>
            {!collapsed && <p className="label mb-1.5 px-2.5 text-[11px]">{g}</p>}
            <ul className="flex flex-col gap-0.5">
              {group.map((n) => {
                const link = (
                  <NavLink
                    to={n.path}
                    end={n.path === "/"}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
                        isActive ? "bg-raised font-medium text-strong" : "text-subtle hover:bg-raised/60 hover:text-strong",
                        collapsed && "justify-center px-0",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute left-0 top-1.5 h-5 w-0.5 rounded-full bg-accent" aria-hidden />}
                        <n.icon size={16} strokeWidth={1.75} aria-hidden className={isActive ? "text-accent" : undefined} />
                        {collapsed ? <span className="sr-only">{n.label}</span> : <span className="truncate">{n.label}</span>}
                      </>
                    )}
                  </NavLink>
                );
                return (
                  <li key={n.path}>
                    {collapsed ? (
                      <Tooltip content={n.label} side="right">
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const { sidebarCollapsed: collapsed, toggleSidebar } = useUi();
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out lg:flex",
        collapsed ? "w-[60px]" : "w-[232px]",
      )}
    >
      <div className={cn("flex h-14 items-center border-b border-border", collapsed ? "justify-center" : "px-4")}>
        <Logo collapsed={collapsed} />
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto py-4", collapsed ? "px-2" : "px-3")}>
        <NavList collapsed={collapsed} />
      </div>
      <div className={cn("border-t border-border p-2", collapsed && "flex justify-center")}>
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-sm text-subtle hover:bg-raised hover:text-strong"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} strokeWidth={1.75} /> : <PanelLeftClose size={16} strokeWidth={1.75} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

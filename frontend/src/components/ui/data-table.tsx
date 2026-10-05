import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useUi } from "@/lib/store";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string | null;
  align?: "left" | "right" | "center";
  className?: string;
  /** Hide below this breakpoint to keep phone layouts readable. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  width?: string;
}

const hideClass = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" };

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  initialSort,
  maxHeight,
  empty,
  rowTitle,
  rowClassName,
  ariaLabel,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string | number;
  onRowClick?: (r: T) => void;
  initialSort?: { key: string; dir: "asc" | "desc" };
  maxHeight?: string;
  empty?: ReactNode;
  rowTitle?: (r: T) => string;
  rowClassName?: (r: T) => string | undefined;
  ariaLabel: string;
}) {
  const density = useUi((s) => s.density);
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = sv(a);
      const y = sv(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, sort, columns]);

  const cellPad = density === "compact" ? "h-8 px-3" : "h-11 px-3";

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-separate border-spacing-0 text-sm" aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const Icon = !active ? ChevronsUpDown : sort?.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: c.width }}
                  aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    "sticky top-0 z-10 h-9 border-b border-border bg-surface px-3 text-xs font-medium uppercase tracking-label text-subtle whitespace-nowrap",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.hideBelow && hideClass[c.hideBelow],
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      className={cn("inline-flex items-center gap-1 hover:text-strong", active && "text-strong", c.align === "right" && "flex-row-reverse")}
                      onClick={() => setSort(active && sort?.dir === "desc" ? { key: c.key, dir: "asc" } : { key: c.key, dir: active ? "desc" : "asc" })}
                    >
                      {c.header}
                      <Icon size={12} strokeWidth={1.75} aria-hidden className={active ? "" : "opacity-50"} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={rowKey(r)}
              title={rowTitle?.(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick(r)) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn("group transition-colors", onRowClick && "cursor-pointer hover:bg-raised/60 focus-visible:bg-raised", rowClassName?.(r))}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    cellPad,
                    "border-b border-border/70 text-body whitespace-nowrap",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.hideBelow && hideClass[c.hideBelow],
                    c.className,
                  )}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && empty}
    </div>
  );
}

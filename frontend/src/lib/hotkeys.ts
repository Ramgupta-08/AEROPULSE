import { useEffect } from "react";

/** Registers single keys and two-key "g x" sequences. Ignored while typing in inputs. */
export function useHotkeys(map: Record<string, () => void>) {
  useEffect(() => {
    let prefix: string | null = null;
    let timer: number | undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (prefix) {
        const seq = `${prefix} ${k}`;
        prefix = null;
        window.clearTimeout(timer);
        if (map[seq]) {
          e.preventDefault();
          map[seq]();
        }
        return;
      }
      if (Object.keys(map).some((s) => s.startsWith(`${k} `))) {
        prefix = k;
        timer = window.setTimeout(() => (prefix = null), 900);
        return;
      }
      if (map[k]) {
        e.preventDefault();
        map[k]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}

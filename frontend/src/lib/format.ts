const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmt = {
  int: (n: number | null | undefined) => (n == null ? "—" : nf0.format(n)),
  one: (n: number | null | undefined) => (n == null ? "—" : nf1.format(n)),
  pct: (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${n.toFixed(digits)}%`),
  signed: (n: number, digits = 1, unit = "") => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(digits)}${unit}`,
  date: (iso: string | null | undefined) =>
    iso ? new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—",
  shortDate: (iso: string | null | undefined) =>
    iso ? new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—",
  dateTime: (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—",
  lakh: (n: number) => `₹${nf1.format(n)} L`,
};

/** Add `days` to an ISO date (yyyy-mm-dd) and return ISO. */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

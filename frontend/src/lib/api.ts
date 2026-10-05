import { useUi } from "./store";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function headers(extra?: HeadersInit): HeadersInit {
  return { "X-Role": useUi.getState().role, ...extra };
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

function withParams(path: string, params?: Record<string, string | number | boolean | null | undefined>) {
  if (!params) return path;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | null | undefined>) =>
    fetch(withParams(path, params), { headers: headers() }).then((r) => handle<T>(r)),
  post: <T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | null | undefined>) =>
    fetch(withParams(path, params), {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  patch: <T>(path: string, body: unknown) =>
    fetch(path, { method: "PATCH", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) }).then((r) =>
      handle<T>(r),
    ),
  upload: <T>(path: string, form: FormData, params?: Record<string, string>) =>
    fetch(withParams(path, params), { method: "POST", headers: headers(), body: form }).then((r) => handle<T>(r)),
  /** Download a server-generated file (CSV/PDF) with role header and save it. */
  download: async (path: string, filename: string, params?: Record<string, string | number | boolean | null | undefined>) => {
    const res = await fetch(withParams(path, params), { headers: headers() });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    saveBlob(await res.blob(), filename);
  },
  wsUrl: (path: string) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}${path}?role=${useUi.getState().role}`;
  },
};

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useUi } from "./store";
import type { AircraftDetail, AircraftRow, Alert, BaseInfo, Forecast, KpiOverview, Meta, MissionRow } from "./types";

export function useMeta() {
  const role = useUi((s) => s.role);
  return useQuery({ queryKey: ["meta", role], queryFn: () => api.get<Meta>("/api/meta"), staleTime: 60_000 });
}

export function useBases() {
  return useQuery({ queryKey: ["bases"], queryFn: () => api.get<BaseInfo[]>("/api/bases"), staleTime: 30_000 });
}

export function useKpis() {
  const base = useUi((s) => s.baseFilter);
  return useQuery({ queryKey: ["kpi", base], queryFn: () => api.get<KpiOverview>("/api/kpi/overview", { base_id: base }) });
}

export function useForecast() {
  const base = useUi((s) => s.baseFilter);
  return useQuery({ queryKey: ["forecast", base], queryFn: () => api.get<Forecast>("/api/forecast", { base_id: base }) });
}

export function useAlerts() {
  const base = useUi((s) => s.baseFilter);
  return useQuery({ queryKey: ["alerts", base], queryFn: () => api.get<Alert[]>("/api/alerts", { base_id: base, limit: 8 }) });
}

export function useMissions() {
  const base = useUi((s) => s.baseFilter);
  return useQuery({
    queryKey: ["missions", base],
    queryFn: () => api.get<{ plan: string; missions: MissionRow[] }>("/api/missions", { base_id: base }),
  });
}

export function useAircraftList() {
  const base = useUi((s) => s.baseFilter);
  return useQuery({ queryKey: ["aircraft", base], queryFn: () => api.get<AircraftRow[]>("/api/aircraft", { base_id: base }) });
}

export function useAircraft(tail: string | undefined) {
  return useQuery({
    queryKey: ["aircraft", "detail", tail],
    queryFn: () => api.get<AircraftDetail>(`/api/aircraft/${tail}`),
    enabled: !!tail,
  });
}

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useUi } from "./store";
import type { BaseInfo, Meta } from "./types";

export function useMeta() {
  const role = useUi((s) => s.role);
  return useQuery({ queryKey: ["meta", role], queryFn: () => api.get<Meta>("/api/meta"), staleTime: 60_000 });
}

export function useBases() {
  return useQuery({ queryKey: ["bases"], queryFn: () => api.get<BaseInfo[]>("/api/bases"), staleTime: 30_000 });
}

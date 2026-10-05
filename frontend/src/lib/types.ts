export type Status = "ready" | "caution" | "grounded";

export interface RoleInfo {
  id: string;
  label: string;
  user: string;
  areas: string[];
}

export interface Meta {
  as_of: string | null;
  engine_data_source: string | null;
  fleet_data: string;
  llm_enabled: boolean;
  deployment: string;
  role: RoleInfo;
  roles: RoleInfo[];
}

export interface BaseInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
  environment: string;
  hangar_bays: number;
  aircraft: number;
  ready: number;
  caution: number;
  grounded: number;
  readiness_pct: number;
}

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

export interface KpiOverview {
  as_of: string;
  total: number;
  readiness_pct: number;
  readiness_delta: number | null;
  readiness_spark: number[];
  ready: number;
  caution: number;
  grounded: number;
  mission_capable: number;
  predicted_failures_14d: number;
  predicted_failures_delta: number;
  aog_hours_week: number;
  aog_hours_delta: number;
  aog_spark: number[];
  mtbf_hours: number;
  mtbf_delta: number;
  mttr_hours: number;
  mttr_delta: number;
}

export interface ForecastSeries {
  total: number;
  p50: number[];
  low: number[];
  high: number[];
  demand: number[];
  shortfall_days: number[];
}

export interface Forecast {
  plan: "reactive" | "aeropulse";
  days: string[];
  types: Record<string, ForecastSeries>;
}

export interface Alert {
  tail: string;
  base_id: string;
  aircraft_type: string;
  task_id: string;
  component_id: number | null;
  position: string;
  kind: string;
  source: string;
  headline: string;
  due_day: number;
  score: number;
  also_due: { task_id: string; title: string; position: string; due_day: number }[];
  missions: string[];
  severity: Status;
  part_source: string;
  planned: boolean;
  planned_start_day: number | null;
}

export interface MissionRow {
  id: string;
  name: string;
  kind: string;
  base_id: string;
  base_name: string;
  aircraft_type: string;
  required: number;
  start_date: string;
  end_date: string;
  start_day: number;
  end_day: number;
  priority: number;
  scope: "base" | "fleet";
  available: number | null;
  shortfall: number | null;
  worst_day: number | null;
  status: Status | "info";
  in_forecast: boolean;
}

export interface AircraftRow {
  tail: string;
  type: string;
  base_id: string;
  base_name: string;
  squadron: string;
  status: Status;
  status_reason: string;
  health: number;
  lowest_component: string;
  lowest_rul_days: number;
  lowest_rul_label: string;
  next_due_component: string;
  next_due_days: number;
  defects_30d: number;
  total_hours: number;
  total_cycles: number;
  sortie_profile: string;
}

export interface ComponentBrief {
  id: number;
  kind: string;
  position: string;
  health: number;
  tone: Status;
  rul_unit: "sorties" | "days";
  p10: number;
  p50: number;
  p90: number;
  p10_days: number;
  p50_days: number;
  p90_days: number;
  life_due_days: number;
  due_days: number;
  failed: boolean;
}

export interface RecordRow {
  id: number;
  tail: string;
  date: string;
  record_type: string;
  defect_code: string;
  component_kind: string;
  narrative: string;
  action_taken: string;
  man_hours: number;
  downtime_days: number;
  batch: string | null;
  technician: string;
  parts_used: string[];
}

export interface PlanBlock {
  id: number;
  tail: string;
  base_id: string;
  bay_id: string;
  start_day: number;
  duration_days: number;
  tasks: { id: string; title: string; source: string; position: string; due_day: number; [k: string]: unknown }[];
  bundled_count: number;
  locked: boolean;
}

export interface AircraftDetail {
  tail: string;
  type: string;
  base_id: string;
  base_name: string;
  environment: string;
  squadron: string;
  sortie_profile: string;
  sorties_per_day: number;
  status: Status;
  status_reason: string;
  health: number;
  total_hours: number;
  total_cycles: number;
  entered_service: string;
  work_order: { title: string; status: string; remaining_days: number; opened_on: string; part_number: string | null } | null;
  components: ComponentBrief[];
  recent_records: RecordRow[];
  planned_blocks: PlanBlock[];
}

export interface Reason {
  sensor: string;
  name: string;
  text: string;
  impact: number;
}

export interface LifeUsage {
  used: number;
  limit: number;
  pct: number;
}

export interface AnomalySensor {
  sensor: string;
  name: string;
  z: number;
  volatility_ratio: number;
  kind: string;
}

export interface ComponentDetail extends ComponentBrief {
  rul_label: string;
  part_number: string;
  serial: string;
  batch: string;
  supplier: string;
  installed_on: string;
  life_usage: { hours: LifeUsage; cycles: LifeUsage; calendar: LifeUsage };
  model: string;
  engine_ref: string | null;
  cycle: number | null;
  env_multiplier: number;
  profile_multiplier: number;
  adjustment_note: string;
  environment: string;
  sortie_profile: string;
  sorties_per_day: number;
  reasons: (Reason & { evidence?: Record<string, number> })[];
  anomaly: { score: number; threshold: number; flagged: boolean; sensors: AnomalySensor[] } | null;
  history: { day: number; cycle?: number; p10: number; p50: number; p90: number; health?: number }[];
  records: RecordRow[];
  same_batch_records: RecordRow[];
  bad_batch: boolean;
}

export interface EngineRow {
  component_id: number;
  tail: string;
  aircraft_type: string;
  base_id: string;
  position: string;
  serial: string;
  engine_ref: string;
  sorties_since_overhaul: number;
  p10: number;
  p50: number;
  p90: number;
  p10_days: number;
  p50_days: number;
  p90_days: number;
  health: number;
  tone: Status;
  reasons: Reason[];
  anomaly: boolean;
}

export interface AnomalyRow {
  component_id: number;
  tail: string;
  base_id: string;
  position: string;
  score: number;
  threshold: number;
  flagged: boolean;
  p50: number;
  message: string;
  sensors: AnomalySensor[];
}

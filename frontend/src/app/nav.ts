import {
  Activity,
  BookOpenCheck,
  Building2,
  CalendarRange,
  Database,
  FileBarChart,
  FlaskConical,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Plane,
  Settings,
  ShieldCheck,
  Target,
  Wrench,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  area: string;
  group: "Command" | "Engineering" | "Logistics" | "Field" | "Governance" | "System";
  keys?: string;
  description: string;
}

export const NAV: NavItem[] = [
  { path: "/", label: "Overview", icon: LayoutDashboard, area: "overview", group: "Command", keys: "g o", description: "Fleet readiness, forecast and priority alerts" },
  { path: "/fleet", label: "Fleet", icon: Plane, area: "fleet", group: "Command", keys: "g f", description: "All aircraft with health and next due maintenance" },
  { path: "/missions", label: "Missions", icon: Target, area: "missions", group: "Command", keys: "g m", description: "Missions, exercises and coverage" },
  { path: "/health", label: "Predictive Health", icon: Activity, area: "health", group: "Engineering", keys: "g h", description: "Remaining useful life, anomalies and model card" },
  { path: "/planner", label: "Planner", icon: CalendarRange, area: "schedule", group: "Engineering", keys: "g p", description: "Readiness-first maintenance schedule" },
  { path: "/whatif", label: "What-If", icon: FlaskConical, area: "whatif", group: "Engineering", keys: "g w", description: "Scenario simulator" },
  { path: "/spares", label: "Spares", icon: Package, area: "spares", group: "Logistics", keys: "g s", description: "Inventory, transfers, cannibalisation and batch watch" },
  { path: "/agencies", label: "Agencies", icon: Building2, area: "agencies", group: "Logistics", keys: "g a", description: "Maintenance agency scorecard" },
  { path: "/copilot", label: "Technician Copilot", icon: Wrench, area: "copilot", group: "Field", keys: "g c", description: "Troubleshooting assistant, logbook intelligence, voice log and QR" },
  { path: "/records", label: "Records & Audit", icon: ShieldCheck, area: "records", group: "Governance", keys: "g r", description: "Hash-chained records and audit log" },
  { path: "/datahub", label: "Data Hub", icon: Database, area: "datahub", group: "Governance", keys: "g d", description: "Integrated sources, quality and ingestion" },
  { path: "/reports", label: "Reports", icon: FileBarChart, area: "reports", group: "Governance", keys: "g e", description: "KPIs and commander readiness brief" },
  { path: "/settings", label: "Settings", icon: Settings, area: "shared", group: "System", description: "Deployment, security and roadmap" },
];

export const GROUPS: NavItem["group"][] = ["Command", "Engineering", "Logistics", "Field", "Governance", "System"];

export const AIRCRAFT_AREA = "fleet";
export const ManualIcon = BookOpenCheck;

import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { RoleGate } from "@/components/layout/RoleGate";
import { SkeletonRows } from "@/components/ui/skeleton";

const Overview = lazy(() => import("@/features/overview/OverviewPage"));
const Fleet = lazy(() => import("@/features/fleet/FleetPage"));
const Aircraft = lazy(() => import("@/features/aircraft/AircraftPage"));
const Health = lazy(() => import("@/features/health/HealthPage"));
const Planner = lazy(() => import("@/features/planner/PlannerPage"));
const WhatIf = lazy(() => import("@/features/whatif/WhatIfPage"));
const Missions = lazy(() => import("@/features/missions/MissionsPage"));
const Spares = lazy(() => import("@/features/spares/SparesPage"));
const Agencies = lazy(() => import("@/features/agencies/AgenciesPage"));
const Copilot = lazy(() => import("@/features/copilot/CopilotPage"));
const Records = lazy(() => import("@/features/records/RecordsPage"));
const DataHub = lazy(() => import("@/features/datahub/DataHubPage"));
const Reports = lazy(() => import("@/features/reports/ReportsPage"));
const Settings = lazy(() => import("@/features/settings/SettingsPage"));
const NotFound = lazy(() => import("@/features/NotFound"));

function page(area: string, el: ReactNode) {
  return (
    <RoleGate area={area}>
      <Suspense fallback={<SkeletonRows rows={10} />}>{el}</Suspense>
    </RoleGate>
  );
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: page("overview", <Overview />) },
      { path: "/fleet", element: page("fleet", <Fleet />) },
      { path: "/aircraft/:tail", element: page("fleet", <Aircraft />) },
      { path: "/health", element: page("health", <Health />) },
      { path: "/planner", element: page("schedule", <Planner />) },
      { path: "/whatif", element: page("whatif", <WhatIf />) },
      { path: "/missions", element: page("missions", <Missions />) },
      { path: "/spares", element: page("spares", <Spares />) },
      { path: "/agencies", element: page("agencies", <Agencies />) },
      { path: "/copilot", element: page("copilot", <Copilot />) },
      { path: "/records", element: page("records", <Records />) },
      { path: "/datahub", element: page("datahub", <DataHub />) },
      { path: "/reports", element: page("reports", <Reports />) },
      { path: "/settings", element: page("shared", <Settings />) },
      { path: "*", element: page("shared", <NotFound />) },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

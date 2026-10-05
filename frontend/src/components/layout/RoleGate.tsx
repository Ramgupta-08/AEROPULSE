import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useMeta } from "@/lib/queries";
import { useUi } from "@/lib/store";

/** Pages are also protected server-side; this gives a clear, helpful state instead of 403 errors. */
export function RoleGate({ area, children }: { area: string; children: ReactNode }) {
  const { data, isLoading } = useMeta();
  const setRole = useUi((s) => s.setRole);
  if (isLoading || !data) return <SkeletonRows rows={8} />;
  if (data.role.areas.includes(area)) return <>{children}</>;
  const allowed = data.roles.filter((r) => r.areas.includes(area));
  return (
    <div className="card">
      <EmptyState
        icon={Lock}
        title={`Not available to ${data.role.label}`}
        description={`This area is restricted by role-based access control. It is available to: ${allowed.map((r) => r.label).join(", ")}.`}
        action={
          allowed[0] && (
            <Button variant="primary" onClick={() => setRole(allowed[0].id as never)}>
              Switch to {allowed[0].label}
            </Button>
          )
        }
      />
    </div>
  );
}

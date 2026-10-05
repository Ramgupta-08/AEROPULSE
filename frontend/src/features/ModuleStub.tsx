import { Layers } from "lucide-react";
import { NAV } from "@/app/nav";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/** Foundation-phase shell for a module whose data services arrive in a later build phase. */
export function ModuleStub({ path, title }: { path: string; title: string }) {
  const n = NAV.find((x) => x.path === path);
  return (
    <>
      <PageHeader title={title} description={n?.description} />
      <Card>
        <EmptyState icon={n?.icon ?? Layers} title="Module shell ready" description="Data services for this module are connected in the next build phase." />
      </Card>
    </>
  );
}

import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <div className="card">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The address doesn't match any AeroPulse page. Use ⌘K to search pages and aircraft."
        action={
          <Button asChild variant="primary">
            <Link to="/">Back to Overview</Link>
          </Button>
        }
      />
    </div>
  );
}

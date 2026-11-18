import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ledger-ui";
import { WarehousePanel } from "@/components/warehouse-panel";
import { Warehouse } from "lucide-react";

export const Route = createFileRoute("/app/warehouse")({
  component: WarehousePage,
});

export function WarehousePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Warehouse"
        title={<span className="inline-flex items-center gap-2"><Warehouse className="h-5 w-5 text-primary" /> Warehouse</span>}
        description="Physical stock flow from receiving to dispatch."
      />
      <div className="mt-4">
        <WarehousePanel />
      </div>
    </div>
  );
}

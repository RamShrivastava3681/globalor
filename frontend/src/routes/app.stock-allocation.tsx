import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";
import { PageHeader } from "@/components/ledger-ui";
import { TableSkeleton } from "@/components/workbench";
import { Boxes } from "lucide-react";

const Panel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.StockAllocationPanel })));

export const Route = createFileRoute("/app/stock-allocation")({
  component: () => (
    <div>
      <PageHeader eyebrow="Warehouse" title={<span className="inline-flex items-center gap-2"><Boxes className="h-5 w-5 text-primary" /> Stock Allocation</span>} description="Allocate on-hand stock to open order lines." />
      <div className="mt-4"><Suspense fallback={<TableSkeleton rows={6} cols={8} />}><Panel /></Suspense></div>
    </div>
  ),
});

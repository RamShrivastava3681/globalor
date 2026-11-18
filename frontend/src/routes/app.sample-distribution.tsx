import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";
import { PageHeader } from "@/components/ledger-ui";
import { TableSkeleton } from "@/components/workbench";
import { FlaskConical } from "lucide-react";

const Panel = lazy(() => import("@/components/wb-panels").then((m) => ({ default: m.SamplesPanel })));

export const Route = createFileRoute("/app/sample-distribution")({
  component: () => (
    <div>
      <PageHeader eyebrow="Warehouse" title={<span className="inline-flex items-center gap-2"><FlaskConical className="h-5 w-5 text-primary" /> Samples</span>} description="Sample distributions queue." />
      <div className="mt-4"><Suspense fallback={<TableSkeleton rows={6} cols={8} />}><Panel /></Suspense></div>
    </div>
  ),
});

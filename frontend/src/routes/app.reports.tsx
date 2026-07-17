import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/app/reports")({
  component: ReportsLayout,
});

function ReportsLayout() {
  return <Outlet />;
}

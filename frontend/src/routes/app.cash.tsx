import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/app/cash")({
  component: CashRedirect,
});

/**
 * Legacy standalone Cash route — Cash Command Centre now lives as the
 * "Cash Command" tab inside Finance Workbench with the same logic.
 * Keep this alias so bookmarks still work.
 */
function CashRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/app/finance-workbench", search: { section: "cash" }, replace: true });
  }, [navigate]);
  return null;
}

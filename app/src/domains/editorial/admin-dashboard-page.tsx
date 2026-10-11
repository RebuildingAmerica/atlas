import { parseEnvBoolean } from "@/platform/config/env-boolean";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { loadAdminDashboardSummary } from "./admin-dashboard.functions";
import { AdminDashboardView } from "./admin-dashboard-view";
import { loadEditorialTriage } from "./editorial-triage.functions";

const ADMIN_DASHBOARD_QUERY_KEY = ["editorial", "dashboard"] as const;
const EDITORIAL_TRIAGE_QUERY_KEY = ["editorial", "triage"] as const;

export function AdminDashboardPage() {
  const hydrated = useHydrated();
  const dashboardQuery = useQuery({
    enabled: hydrated,
    queryFn: () => loadAdminDashboardSummary(),
    queryKey: ADMIN_DASHBOARD_QUERY_KEY,
  });
  const triageQuery = useQuery({
    enabled: hydrated,
    queryFn: () => loadEditorialTriage(),
    queryKey: EDITORIAL_TRIAGE_QUERY_KEY,
  });

  const errorMessage = dashboardQuery.isError
    ? userFacingErrorMessage(dashboardQuery.error, "Service status could not load.")
    : !dashboardQuery.isPending && !dashboardQuery.data
      ? "Service status could not load."
      : undefined;

  return (
    <AdminDashboardView
      showWaitlist={
        parseEnvBoolean(import.meta.env.ATLAS_MANAGED, false, "ATLAS_MANAGED") &&
        parseEnvBoolean(import.meta.env.ATLAS_MULTI_USER, true, "ATLAS_MULTI_USER")
      }
      errorMessage={errorMessage}
      isLoading={dashboardQuery.isPending}
      now={triageQuery.dataUpdatedAt}
      summary={dashboardQuery.data}
      triage={triageQuery.data}
      triageError={
        triageQuery.isError
          ? userFacingErrorMessage(triageQuery.error, "Review queues could not load.")
          : undefined
      }
    />
  );
}

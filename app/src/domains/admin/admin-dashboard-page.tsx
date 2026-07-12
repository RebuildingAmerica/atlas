import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import { loadAdminDashboardSummary } from "./admin-dashboard.functions";
import { AdminDashboardView } from "./admin-dashboard-view";

const ADMIN_DASHBOARD_QUERY_KEY = ["admin", "dashboard"] as const;

export function AdminDashboardPage() {
  const hydrated = useHydrated();
  const dashboardQuery = useQuery({
    enabled: hydrated,
    queryFn: () => loadAdminDashboardSummary(),
    queryKey: ADMIN_DASHBOARD_QUERY_KEY,
  });

  const errorMessage = dashboardQuery.isError
    ? dashboardQuery.error instanceof Error
      ? dashboardQuery.error.message
      : "Admin status could not load."
    : !dashboardQuery.isPending && !dashboardQuery.data
      ? "Admin status could not load."
      : undefined;

  return (
    <AdminDashboardView
      errorMessage={errorMessage}
      isLoading={dashboardQuery.isPending}
      summary={dashboardQuery.data}
    />
  );
}

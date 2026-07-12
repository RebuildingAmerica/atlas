import { useQuery } from "@tanstack/react-query";
import { loadAdminDashboardSummary } from "./admin-dashboard.functions";
import { AdminErrorState, AdminLoadingState } from "./admin-portal";
import { AdminDashboardView } from "./admin-dashboard-view";

const ADMIN_DASHBOARD_QUERY_KEY = ["admin", "dashboard"] as const;

export function AdminDashboardPage() {
  const dashboardQuery = useQuery({
    queryFn: () => loadAdminDashboardSummary(),
    queryKey: ADMIN_DASHBOARD_QUERY_KEY,
  });

  if (dashboardQuery.isLoading) {
    return <AdminLoadingState />;
  }

  if (dashboardQuery.isError) {
    return (
      <AdminErrorState
        message={
          dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : "Admin status could not load."
        }
      />
    );
  }

  if (!dashboardQuery.data) {
    return <AdminErrorState message="Admin status could not load." />;
  }

  return <AdminDashboardView summary={dashboardQuery.data} />;
}

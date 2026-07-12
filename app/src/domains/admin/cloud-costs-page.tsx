import { useQuery } from "@tanstack/react-query";
import { AdminErrorState, AdminLoadingState } from "./admin-portal";
import { loadCloudCostPosture } from "./cloud-costs.functions";
import { CloudCostsView } from "./cloud-costs-view";

const CLOUD_COST_QUERY_KEY = ["admin", "cloud-costs"] as const;

export function CloudCostsAdminPage() {
  const postureQuery = useQuery({
    queryFn: () => loadCloudCostPosture(),
    queryKey: CLOUD_COST_QUERY_KEY,
  });

  if (postureQuery.isLoading) {
    return <AdminLoadingState />;
  }

  if (postureQuery.isError) {
    return (
      <AdminErrorState
        message={
          postureQuery.error instanceof Error
            ? postureQuery.error.message
            : "Cloud costs could not load."
        }
      />
    );
  }

  if (!postureQuery.data) {
    return <AdminErrorState message="Cloud costs could not load." />;
  }

  return <CloudCostsView posture={postureQuery.data} />;
}

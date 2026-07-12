import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import { loadCloudCostPosture } from "./cloud-costs.functions";
import { CloudCostsView } from "./cloud-costs-view";

const CLOUD_COST_QUERY_KEY = ["admin", "cloud-costs"] as const;

export function CloudCostsAdminPage() {
  const hydrated = useHydrated();
  const postureQuery = useQuery({
    enabled: hydrated,
    queryFn: () => loadCloudCostPosture(),
    queryKey: CLOUD_COST_QUERY_KEY,
  });

  const errorMessage = postureQuery.isError
    ? postureQuery.error instanceof Error
      ? postureQuery.error.message
      : "Cloud costs could not load."
    : !postureQuery.isPending && !postureQuery.data
      ? "Cloud costs could not load."
      : undefined;

  return (
    <CloudCostsView
      errorMessage={errorMessage}
      isLoading={postureQuery.isPending}
      posture={postureQuery.data}
    />
  );
}

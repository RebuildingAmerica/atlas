import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@/platform/error-message";
import { loadCloudCostPosture } from "./cloud-costs.functions";
import { CloudCostsView } from "./cloud-costs-view";

const CLOUD_COSTS_KEY = ["platform", "cloud-costs"] as const;

export function CloudCostsPage() {
  const posture = useQuery({
    queryKey: CLOUD_COSTS_KEY,
    queryFn: () => loadCloudCostPosture(),
  });

  return (
    <CloudCostsView
      errorMessage={
        posture.isError
          ? errorMessage(posture.error, "Cloud costs could not load.")
          : undefined
      }
      isLoading={posture.isPending}
      posture={posture.data}
    />
  );
}

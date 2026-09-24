import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import {
  decideDiscoveryReview,
  listDiscoveryReviews,
  prepareLasVegasWebsiteReviews,
} from "./discovery-reviews.functions";
import { DiscoveryReviewsView } from "./discovery-reviews-view";

const PAGE_SIZE = 25;

export function DiscoveryReviewsPage() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [prepareMessage, setPrepareMessage] = useState<string>();
  const reviews = useQuery({
    enabled: hydrated,
    queryFn: () => listDiscoveryReviews({ data: { offset } }),
    queryKey: ["admin", "discovery-reviews", offset],
  });
  const decision = useMutation({
    mutationFn: decideDiscoveryReview,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "discovery-reviews"] });
    },
  });
  const prepare = useMutation({
    mutationFn: prepareLasVegasWebsiteReviews,
    onSuccess: ({ enqueued }) => {
      setPrepareMessage(
        enqueued === 0
          ? "No new website proposals."
          : `${enqueued} website proposal${enqueued === 1 ? "" : "s"} ready for review.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin", "discovery-reviews"] });
    },
  });

  return (
    <DiscoveryReviewsView
      decisionError={
        decision.isError
          ? userFacingErrorMessage(
              decision.error,
              "Decision could not be saved. Reload and review the current facts.",
            )
          : undefined
      }
      errorMessage={
        reviews.isError
          ? userFacingErrorMessage(reviews.error, "Discovery reviews could not load.")
          : undefined
      }
      items={reviews.data?.items ?? []}
      isLoading={reviews.isPending}
      onDecision={(itemId, selectedDecision) => {
        decision.reset();
        decision.mutate({ data: { decision: selectedDecision, itemId } });
      }}
      onPageChange={setOffset}
      onPrepareWebsiteReviews={() => {
        setPrepareMessage(undefined);
        prepare.reset();
        prepare.mutate(undefined);
      }}
      offset={offset}
      pendingItemId={decision.isPending ? decision.variables.data.itemId : undefined}
      prepareError={
        prepare.isError
          ? userFacingErrorMessage(prepare.error, "Website candidates could not be prepared.")
          : undefined
      }
      prepareMessage={prepareMessage}
      preparing={prepare.isPending}
      total={reviews.data?.total ?? 0}
      pageSize={PAGE_SIZE}
    />
  );
}

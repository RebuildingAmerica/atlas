import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@/platform/error-message";
import {
  loadDiscountRequests,
  reviewDiscountRequest,
} from "./discounts.functions";
import {
  DiscountReviewView,
  type DiscountDecision,
} from "./discount-review-view";

const DISCOUNT_REQUESTS_KEY = ["platform", "discount-requests"] as const;

export function DiscountReviewPage() {
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: DISCOUNT_REQUESTS_KEY,
    queryFn: () => loadDiscountRequests(),
  });
  const review = useMutation({
    mutationFn: (decision: DiscountDecision) =>
      reviewDiscountRequest({ data: decision }),
    // A failed email still leaves a saved decision, so the list is reloaded either way.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: DISCOUNT_REQUESTS_KEY }),
  });

  return (
    <DiscountReviewView
      decisionMessage={
        review.isError
          ? errorMessage(review.error, "The decision could not be saved.")
          : undefined
      }
      errorMessage={
        requests.isError
          ? errorMessage(requests.error, "Discount requests could not load.")
          : undefined
      }
      isLoading={requests.isPending}
      onDecide={(decision) => {
        review.mutate(decision);
      }}
      records={requests.data?.records ?? []}
      reviewPending={review.isPending}
      total={requests.data?.total ?? 0}
    />
  );
}

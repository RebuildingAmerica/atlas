import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { VerificationRecordResponse } from "@/lib/generated/atlas-schemas/access/verificationRecordResponse";
import type { VerificationUpdateRequest } from "@/lib/generated/atlas-schemas/access/verificationUpdateRequest";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import {
  listDiscountVerifications,
  reviewDiscountVerification,
} from "../../discount-verifications.functions";
import { DiscountAdminView } from "./discount-admin-view";

type VerificationReviewStatus = VerificationUpdateRequest["status"];

interface VerificationReviewInput {
  notes: string;
  status: VerificationReviewStatus;
  verificationId: string;
}

export function DiscountAdminPage() {
  const queryClient = useQueryClient();
  const hydrated = useHydrated();
  const verificationQuery = useQuery({
    enabled: hydrated,
    queryKey: ["admin", "verifications"],
    queryFn: async () => {
      return await listDiscountVerifications({ data: {} });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ notes, status, verificationId }: VerificationReviewInput) => {
      return await reviewDiscountVerification({
        data: { notes, status, verificationId },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "verifications"] });
    },
  });

  const records = verificationQuery.data?.records || [];
  const total = verificationQuery.data?.total || 0;
  const errorMessage = verificationQuery.isError
    ? verificationQuery.error instanceof Error
      ? verificationQuery.error.message
      : "Discount verifications could not load."
    : undefined;
  const reviewRecord = (record: VerificationRecordResponse, status: VerificationReviewStatus) => {
    reviewMutation.mutate({
      notes: status === "verified" ? "Approved from admin review." : "Rejected from admin review.",
      status,
      verificationId: record.id,
    });
  };

  return (
    <DiscountAdminView
      errorMessage={errorMessage}
      isLoading={verificationQuery.isPending}
      onReview={reviewRecord}
      records={records}
      reviewPending={reviewMutation.isPending}
      total={total}
    />
  );
}

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";
import { sendDiscountRequestOperatorNotification } from "./server/discount-verification-emails";

// Requests are reviewed in the Atlas platform admin; this module only lets a
// workspace apply and see where its request stands.

const discountSegmentSchema = z.enum([
  "student",
  "independent_journalist",
  "grassroots_nonprofit",
  "civic_tech_worker",
]);

const submitDiscountVerificationInputSchema = z.object({
  organizationId: z.string().min(1),
  segment: discountSegmentSchema,
  submission: z.record(z.string(), z.string()),
});

const currentDiscountVerificationInputSchema = z.object({
  organizationId: z.string().min(1),
});

type DiscountSegmentInput = z.infer<typeof discountSegmentSchema>;
type VerificationStatusInput = "pending" | "verified" | "rejected" | "expired";

interface VerificationSubmissionResponse {
  id: string;
  message?: string;
  organization_id: string;
  status: "pending";
  verification_method?: string | null;
}

interface CurrentDiscountVerificationRecord {
  id: string;
  organization_id: string;
  segment: DiscountSegmentInput;
  status: VerificationStatusInput;
  submitted_at: string;
  verified_at?: string | null;
}

export interface CurrentDiscountVerificationStatus {
  record: CurrentDiscountVerificationRecord | null;
}

export const submitDiscountVerification = createServerFn({ method: "POST" })
  .validator(submitDiscountVerificationInputSchema)
  .handler(async ({ data }) => {
    const response = await requestAtlasApi<VerificationSubmissionResponse>(
      "/access/verify-discount",
      {
        body: JSON.stringify({
          data: data.submission,
          organization_id: data.organizationId,
          segment: data.segment,
        }),
        method: "POST",
      },
    );

    await sendDiscountRequestOperatorNotification({
      organizationId: data.organizationId,
      segment: data.segment,
      verificationId: response.id,
    });

    return response;
  });

export const getCurrentDiscountVerificationStatus = createServerFn({ method: "GET" })
  .validator(currentDiscountVerificationInputSchema)
  .handler(async () => {
    return await requestAtlasApi<CurrentDiscountVerificationStatus>(
      "/access/discount-verification/current",
    );
  });

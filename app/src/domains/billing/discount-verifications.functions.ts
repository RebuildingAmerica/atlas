import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";
import type { VerificationListResponse } from "@/lib/generated/atlas-schemas/access/verificationListResponse";
import type { VerificationUpdateRequest } from "@/lib/generated/atlas-schemas/access/verificationUpdateRequest";
import type { VerificationUpdateResponse } from "@/lib/generated/atlas-schemas/access/verificationUpdateResponse";
import {
  sendDiscountRequestOperatorNotification,
  sendDiscountReviewResultEmail,
} from "./server/discount-verification-emails";

const verificationStatusSchema = z.enum(["pending", "verified", "rejected", "expired"]);
const discountSegmentSchema = z.enum([
  "student",
  "independent_journalist",
  "grassroots_nonprofit",
  "civic_tech_worker",
]);

const listDiscountVerificationsInputSchema = z.object({
  organizationId: z.string().min(1).optional(),
  segment: discountSegmentSchema.optional(),
  status: verificationStatusSchema.optional(),
});

const reviewDiscountVerificationInputSchema = z.object({
  notes: z.string().nullable().optional(),
  status: z.enum(["verified", "rejected"]),
  verificationId: z.string().min(1),
});

const submitDiscountVerificationInputSchema = z.object({
  organizationId: z.string().min(1),
  segment: discountSegmentSchema,
  submission: z.record(z.string(), z.string()),
});

const currentDiscountVerificationInputSchema = z.object({
  organizationId: z.string().min(1),
});

type ListDiscountVerificationsInput = z.infer<typeof listDiscountVerificationsInputSchema>;
type DiscountSegmentInput = z.infer<typeof discountSegmentSchema>;
type VerificationStatusInput = z.infer<typeof verificationStatusSchema>;

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

function buildVerificationQuery(data: ListDiscountVerificationsInput): string {
  const params = new URLSearchParams();
  if (data.organizationId) {
    params.set("organization_id", data.organizationId);
  }
  if (data.status) {
    params.set("status", data.status);
  }
  if (data.segment) {
    params.set("segment", data.segment);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const listDiscountVerifications = createServerFn({ method: "GET" })
  .validator(listDiscountVerificationsInputSchema)
  .handler(async ({ data }) => {
    return await requestAtlasApi<VerificationListResponse>(
      `/admin/verifications${buildVerificationQuery(data)}`,
    );
  });

export const reviewDiscountVerification = createServerFn({ method: "POST" })
  .validator(reviewDiscountVerificationInputSchema)
  .handler(async ({ data }) => {
    const body = {
      notes: data.notes ?? null,
      status: data.status,
    } satisfies VerificationUpdateRequest;

    const response = await requestAtlasApi<VerificationUpdateResponse>(
      `/admin/verifications/${data.verificationId}`,
      {
        body: JSON.stringify(body),
        method: "PATCH",
      },
    );

    await sendDiscountReviewResultEmail({
      segment: response.record.segment,
      status: response.status,
      userId: response.record.user_id,
    });

    return response;
  });

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

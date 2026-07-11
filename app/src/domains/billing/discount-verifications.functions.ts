import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";
import type { VerificationListResponse } from "@/lib/generated/atlas-schemas/access/verificationListResponse";
import type { VerificationUpdateRequest } from "@/lib/generated/atlas-schemas/access/verificationUpdateRequest";
import type { VerificationUpdateResponse } from "@/lib/generated/atlas-schemas/access/verificationUpdateResponse";

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

type ListDiscountVerificationsInput = z.infer<typeof listDiscountVerificationsInputSchema>;

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
      `/api/admin/verifications${buildVerificationQuery(data)}`,
    );
  });

export const reviewDiscountVerification = createServerFn({ method: "POST" })
  .validator(reviewDiscountVerificationInputSchema)
  .handler(async ({ data }) => {
    const body = {
      notes: data.notes ?? null,
      status: data.status,
    } satisfies VerificationUpdateRequest;

    return await requestAtlasApi<VerificationUpdateResponse>(
      `/api/admin/verifications/${data.verificationId}`,
      {
        body: JSON.stringify(body),
        method: "PATCH",
      },
    );
  });

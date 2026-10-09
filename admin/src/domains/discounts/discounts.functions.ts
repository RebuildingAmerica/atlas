import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  listVerifications,
  updateVerification,
} from "@/generated/platform-api";

const reviewInputSchema = z.object({
  notes: z
    .string()
    .trim()
    .min(1, "Say why, so the decision can be explained later."),
  status: z.enum(["verified", "rejected"]),
  verificationId: z.string().min(1),
});

/** Loads every discount request, newest first, with the evidence each applicant gave. */
export const loadDiscountRequests = createServerFn({ method: "GET" }).handler(
  async () => {
    return await listVerifications();
  },
);

/**
 * Records the operator's decision on one request. The API saves it, writes
 * the audit entry under the operator's email, and emails the applicant.
 */
export const reviewDiscountRequest = createServerFn({ method: "POST" })
  .validator(reviewInputSchema)
  .handler(async ({ data }) => {
    return await updateVerification(data.verificationId, {
      notes: data.notes,
      status: data.status,
    });
  });

import "@tanstack/react-start/server-only";

import { z } from "zod";
import { hasCallbackSecret } from "@/domains/access/server/callback-secret";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";
import { DISCOUNT_SEGMENTS } from "../discount-segments";
import { sendDiscountReviewResultEmail } from "./discount-verification-emails";

/**
 * The decision the API reports once the platform admin has decided a
 * discount request. The app owns the applicant's account and mail, so it
 * sends the email.
 */
const reviewResultSchema = z.object({
  segment: z.enum(DISCOUNT_SEGMENTS),
  status: z.enum(["verified", "rejected"]),
  user_id: z.string().min(1),
});

/**
 * Emails the applicant the outcome of their discount request.
 *
 * @param request - The API's callback, carrying `X-Atlas-Callback-Secret`.
 * @returns 204 once the email is sent; 401 without the callback secret; 400
 *   for a malformed decision; 502 when the email could not be sent, so the API
 *   tells the operator the applicant was not emailed.
 */
export async function handleDiscountReviewResultRequest(request: Request): Promise<Response> {
  const runtime = getAuthRuntimeConfig();
  if (!hasCallbackSecret(request, runtime.callbackSecret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = reviewResultSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_review_result" }, { status: 400 });
  }

  try {
    await sendDiscountReviewResultEmail({
      segment: parsed.data.segment,
      status: parsed.data.status,
      userId: parsed.data.user_id,
    });
  } catch (error) {
    console.error("Discount review email was not sent", {
      error: error instanceof Error ? error.message : String(error),
      userId: parsed.data.user_id,
    });
    return Response.json({ error: "email_not_sent" }, { status: 502 });
  }

  return new Response(null, { status: 204 });
}

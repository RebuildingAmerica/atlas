import "@tanstack/react-start/server-only";
import { z } from "zod";
import { UserFacingError } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { hasCallbackSecret } from "@/domains/access/server/callback-secret";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";
import { isManagedWaitlist } from "./runtime";
import { inviteRequests, listStaffRequests, staffAction, staffDetail } from "./platform-service";

const operator = { operatorEmail: z.string().email().max(254) };
const id = z.string().min(1).max(200);
const callbackSchema = z
  .discriminatedUnion("operation", [
    z.object({ ...operator, operation: z.literal("list") }).strict(),
    z.object({ ...operator, operation: z.literal("detail"), id }).strict(),
    z
      .object({ ...operator, operation: z.literal("invite"), ids: z.array(id).min(1).max(50) })
      .strict(),
    z
      .object({
        ...operator,
        operation: z.literal("action"),
        id,
        action: z.enum(["revoke", "resend", "retry"]),
        deliveryId: id.optional(),
      })
      .strict(),
  ])
  .refine(
    (input) =>
      input.operation !== "action" || input.action !== "retry" || Boolean(input.deliveryId),
  );

/** The API supplies its verified operator; app sessions never authorize staff access. */
export async function handlePlatformWaitlistRequest(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (!isManagedWaitlist()) return Response.json({ error: "Not found." }, { status: 404, headers });
  if (!hasCallbackSecret(request, getAuthRuntimeConfig().callbackSecret)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers });
  }
  const parsed = callbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "invalid_waitlist_operation" }, { status: 400, headers });
  const input = parsed.data;
  try {
    switch (input.operation) {
      case "list":
        return Response.json(await listStaffRequests(), { headers });
      case "detail":
        return Response.json(await staffDetail(input.id), { headers });
      case "invite":
        return Response.json(await inviteRequests(input.ids, input.operatorEmail), { headers });
      case "action":
        return Response.json(await staffAction(input, input.operatorEmail), { headers });
    }
  } catch (error) {
    if (error instanceof UserFacingError)
      return Response.json({ error: error.message }, { status: 400, headers });
    throw error;
  }
}

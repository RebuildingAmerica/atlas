import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  listWaitlistRequests as listRequests,
  loadWaitlistStaffDetail as loadDetail,
  inviteWaitlistRequests as inviteRequests,
  actOnWaitlistRequest as actOnRequest,
} from "@/generated/platform-api";
export type { StaffWaitlistAction } from "@rebuildingamerica/atlas-api-client/waitlist";

const id = z.string().min(1).max(200);
// POST keeps private applicants out of shared caches and records each read
// under the platform operator, just like account lookups.
export const listWaitlistRequests = createServerFn({ method: "POST" }).handler(
  async () => listRequests(),
);
export const loadWaitlistStaffDetail = createServerFn({ method: "POST" })
  .validator(z.object({ id }).strict())
  .handler(async ({ data }) => loadDetail(data));
export const inviteWaitlistRequests = createServerFn({ method: "POST" })
  .validator(z.object({ ids: z.array(id).min(1).max(50) }).strict())
  .handler(async ({ data }) => inviteRequests(data));
export const actOnWaitlistRequest = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        id,
        action: z.enum(["revoke", "resend", "retry"]),
        deliveryId: id.optional(),
      })
      .strict()
      .refine(
        (input) => input.action !== "retry" || Boolean(input.deliveryId),
        "Choose an invitation email to retry.",
      ),
  )
  .handler(async ({ data }) => actOnRequest(data));

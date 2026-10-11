import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { waitlistDetailsSchema, waitlistProductSchema, waitlistSignupSchema } from "./contracts";
import type { PaidAccessDecision, WaitlistLinkKind } from "./contracts";

async function server() {
  if (import.meta.env.SSR) return import("./server/service");
  throw new Error("Waitlist operations require the server.");
}
export const submitWaitlist = createServerFn({ method: "POST" })
  .validator(waitlistSignupSchema)
  .handler(async ({ data }) => (await server()).submitRequest(data));
export const loadPaidAccess = createServerFn({ method: "GET" }).handler(
  async (): Promise<PaidAccessDecision> => (await server()).loadAccess(),
);
const linkSchema = z.object({
  token: z.string().min(1).max(100),
  kind: z.enum(["confirm", "manage", "invite"]),
});
export const loadWaitlistLink = createServerFn({ method: "POST" })
  .validator(linkSchema)
  .handler(async ({ data }) => (await server()).loadLink(data.token, data.kind));
export const confirmWaitlist = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(1).max(100) }))
  .handler(async ({ data }) => (await server()).confirmRequest(data.token));
const privateInput = z.object({
  id: z.string().min(1),
  token: z.string().max(100).optional(),
  kind: z.enum(["manage", "invite", "confirm"]).optional(),
});
export const loadWaitlistRequest = createServerFn({ method: "POST" })
  .validator(privateInput)
  .handler(async ({ data }) => (await server()).loadPrivateRequest(data));
export const updateWaitlistRequest = createServerFn({ method: "POST" })
  .validator(privateInput.extend({ details: waitlistDetailsSchema }))
  .handler(async ({ data }) => (await server()).updatePrivateRequest(data));
export const changeWaitlistRequest = createServerFn({ method: "POST" })
  .validator(privateInput.extend({ action: z.enum(["withdraw", "rejoin", "confirm"]) }))
  .handler(async ({ data }) => (await server()).changePrivateRequest(data));
export const listWaitlistRequests = createServerFn({ method: "GET" }).handler(async () =>
  (await server()).listStaffRequests(),
);
export const loadWaitlistStaffDetail = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => (await server()).staffDetail(data.id));
export const inviteWaitlistRequests = createServerFn({ method: "POST" })
  .validator(z.object({ ids: z.array(z.string().min(1)).min(1).max(50) }))
  .handler(async ({ data }) => (await server()).inviteRequests(data.ids));
export const actOnWaitlistRequest = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().min(1),
      action: z.enum(["revoke", "resend", "retry"]),
      deliveryId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => (await server()).staffAction(data));
export const loadWaitlistStaffAccess = createServerFn({ method: "GET" }).handler(async () =>
  (await server()).staffAccess(),
);
export interface PrivateWaitlistInput {
  id: string;
  token?: string;
  kind?: WaitlistLinkKind;
}
export type { StaffWaitlistAction } from "./contracts";
export { waitlistProductSchema };

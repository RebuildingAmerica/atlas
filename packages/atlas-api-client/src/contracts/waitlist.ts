import { z } from "zod";

export const waitlistProductSchema = z.enum([
  "atlas_pro",
  "atlas_team",
  "atlas_research_pass",
]);
export type WaitlistProduct = z.infer<typeof waitlistProductSchema>;
export type WaitlistStatus =
  "unconfirmed" | "waiting" | "invited" | "withdrawn" | "revoked";
export type WaitlistLinkKind = "confirm" | "manage" | "invite";
export type WaitlistDeliveryStatus =
  "pending" | "sending" | "sent" | "failed" | "unresolved";
export const waitlistDetailsSchema = z.object({
  name: z.string().trim().max(120).default(""),
  organization: z.string().trim().max(200).default(""),
  intendedUse: z.string().trim().max(2000).default(""),
});
export const waitlistSignupSchema = waitlistDetailsSchema
  .extend({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    product: waitlistProductSchema,
    interval: z
      .enum(["monthly", "yearly", "four_month", "weekly", "once"])
      .optional(),
    website: z.string().max(200).default(""),
  })
  .refine(
    (data) =>
      !data.interval ||
      (data.product === "atlas_research_pass"
        ? ["weekly", "once"].includes(data.interval)
        : data.product === "atlas_team"
          ? ["monthly", "yearly"].includes(data.interval)
          : ["monthly", "yearly", "four_month"].includes(data.interval)),
    { message: "Choose a billing interval for this plan.", path: ["interval"] },
  );
export type WaitlistSignup = z.input<typeof waitlistSignupSchema>;
export type WaitlistDetails = z.output<typeof waitlistDetailsSchema>;
export interface WaitlistRequest extends WaitlistDetails {
  id: string;
  email: string;
  product: WaitlistProduct;
  interval: string | null;
  status: WaitlistStatus;
  createdAt: string;
  confirmedAt: string | null;
  invitedAt: string | null;
  purchasedAt: string | null;
}
export interface WaitlistEvent {
  id: string;
  requestId: string;
  action: string;
  actorId: string | null;
  createdAt: string;
}
export interface WaitlistDelivery {
  id: string;
  requestId: string;
  kind: WaitlistLinkKind;
  status: WaitlistDeliveryStatus;
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
  attempts: number;
}
export interface PaidAccessDecision {
  mode: "open" | "waitlist" | "unavailable";
  admittedProducts: WaitlistProduct[];
  requests: WaitlistRequest[];
}

export const PRODUCT_LABELS: Record<WaitlistProduct, string> = {
  atlas_pro: "Atlas Pro",
  atlas_team: "Atlas Team",
  atlas_research_pass: "Atlas Research Pass",
};
export interface StaffWaitlistAction {
  id: string;
  action: "revoke" | "resend" | "retry";
  deliveryId?: string;
}

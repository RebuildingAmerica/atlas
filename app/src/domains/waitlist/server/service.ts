import "@tanstack/react-start/server-only";
import { setResponseHeader } from "@tanstack/react-start/server";
import { UserFacingError } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";
import { loadAtlasSession } from "@/domains/access/server/session-state";
import { getServerFnRequest } from "@/domains/access/server/request-headers";
import { resolveClientIp } from "@/domains/access/server/anonymous-rate-limit";
import { resolveCheckoutAvailability } from "@/domains/billing/server/checkout-availability";
import type {
  PaidAccessDecision,
  WaitlistDetails,
  WaitlistLinkKind,
  WaitlistSignup,
} from "../contracts";
import type { PrivateWaitlistInput, StaffWaitlistAction } from "../waitlist.functions";
import {
  getWaitlistMailer,
  getWaitlistStore,
  isManagedWaitlist,
  paidAccessMode,
  requireWaitlistStaff,
} from "./runtime";

function privateResponse() {
  setResponseHeader("Cache-Control", "no-store");
}
export async function submitRequest(data: WaitlistSignup) {
  privateResponse();
  const store = await getWaitlistStore();
  const runtime = getAuthRuntimeConfig();
  const ip = resolveClientIp(getServerFnRequest(), runtime.anonymousRateLimit.trustedProxyHops);
  await store.rateLimit(`ip:${ip ?? "unknown"}`, 10, 60_000);
  // The honeypot returns the same receipt but never queues unsolicited mail.
  if (data.website) return { status: "confirmation_pending" as const };
  await store.rateLimit(`email-minute:${data.email.toLowerCase()}`, 1, 60_000);
  await store.rateLimit(`email-hour:${data.email.toLowerCase()}`, 5, 3600_000);
  const request = await store.submit(data);
  const kind = request.confirmedAt ? "manage" : "confirm";
  const delivery = await getWaitlistMailer(store).sendLink(
    request,
    kind,
    await store.createLink(request.id, kind),
  );
  if (delivery.status !== "sent")
    throw new UserFacingError(
      "Your request is saved, but the email could not be sent. Try again in a minute.",
    );
  return { status: "confirmation_pending" as const };
}
export async function loadAccess(): Promise<PaidAccessDecision> {
  privateResponse();
  if (!isManagedWaitlist()) return { mode: "unavailable", admittedProducts: [], requests: [] };
  const mode = paidAccessMode();
  const session = await loadAtlasSession();
  if (!session?.user.emailVerified) return { mode, admittedProducts: [], requests: [] };
  const requests = await (await getWaitlistStore()).list(session.user.email);
  return {
    mode,
    requests,
    admittedProducts: requests
      .filter((request) => request.status === "invited")
      .map((request) => request.product),
  };
}
export async function loadLink(token: string, kind: WaitlistLinkKind) {
  privateResponse();
  return (await getWaitlistStore()).readLink(token, kind);
}
export async function confirmRequest(token: string) {
  privateResponse();
  return (await getWaitlistStore()).confirm(token);
}
async function privateRequest(input: PrivateWaitlistInput) {
  privateResponse();
  const store = await getWaitlistStore();
  const request = await store.get(input.id);
  if (input.token && input.kind) {
    const linked = await store.readLink(input.token, input.kind);
    if (linked.id === request.id && (input.kind !== "confirm" || request.confirmedAt))
      return { store, request };
  }
  const session = await loadAtlasSession();
  if (session?.user.emailVerified && session.user.email.toLowerCase() === request.email)
    return { store, request };
  throw new UserFacingError("Sign in with the email on this request, or request a new email link.");
}
export async function loadPrivateRequest(input: PrivateWaitlistInput) {
  return (await privateRequest(input)).request;
}
export async function updatePrivateRequest(
  input: PrivateWaitlistInput & { details: WaitlistDetails },
) {
  const { store } = await privateRequest(input);
  return store.update(input.id, input.details);
}
export async function changePrivateRequest(
  input: PrivateWaitlistInput & { action: "withdraw" | "rejoin" | "confirm" },
) {
  const { store } = await privateRequest(input);
  if (input.action === "confirm") return store.confirm(await store.createLink(input.id, "confirm"));
  return input.action === "withdraw" ? store.withdraw(input.id) : store.rejoin(input.id);
}
export async function staffAccess() {
  privateResponse();
  await requireWaitlistStaff();
  return { allowed: true };
}
export async function listStaffRequests() {
  privateResponse();
  await requireWaitlistStaff();
  const store = await getWaitlistStore();
  const mailer = getWaitlistMailer(store);
  const [requests, availability] = await Promise.all([store.list(), resolveCheckoutAvailability()]);
  const records = await Promise.all(
    requests.map(async (request) => ({ request, deliveries: await mailer.list(request.id) })),
  );
  return { records, availability };
}
export async function staffDetail(id: string) {
  privateResponse();
  await requireWaitlistStaff();
  const store = await getWaitlistStore();
  const [request, events, deliveries] = await Promise.all([
    store.get(id),
    store.events(id),
    getWaitlistMailer(store).list(id),
  ]);
  return { request, events, deliveries };
}
async function requirePurchasable(product: string) {
  const availability = await resolveCheckoutAvailability();
  if (
    !availability.available ||
    !availability.allowedOffers.some((offer) => offer.startsWith(`${product}:`))
  )
    throw new UserFacingError("Purchases for this plan are paused. Invitations are unavailable.");
}
export async function inviteRequests(ids: string[]) {
  privateResponse();
  const session = await requireWaitlistStaff();
  const store = await getWaitlistStore();
  const mailer = getWaitlistMailer(store);
  const uniqueIds = [...new Set(ids)];
  const entries = uniqueIds.entries();
  const results: { id: string; status: string; message: string }[] = [];
  // Ten bounded workers keep all 50 recipients within the hosting deadline even
  // when every provider attempt times out. A slow recipient cannot stall the queue.
  await Promise.all(
    uniqueIds.slice(0, 10).map(async () => {
      for (const [index, id] of entries) {
        try {
          const request = await store.get(id);
          await requirePurchasable(request.product);
          const invited = await store.invite(id, session.user.id);
          const delivery = await mailer.sendLink(
            invited,
            "invite",
            await store.createLink(id, "invite"),
            `invite:${id}:${invited.invitedAt}`,
          );
          results[index] = {
            id,
            status: delivery.status,
            message:
              delivery.status === "sent"
                ? "Invitation sent."
                : "Approved; invitation email needs attention.",
          };
        } catch (error) {
          results[index] = {
            id,
            status: "failed",
            message:
              error instanceof UserFacingError
                ? error.message
                : "This invitation could not be sent.",
          };
        }
      }
    }),
  );
  return { results };
}
export async function staffAction(input: StaffWaitlistAction) {
  privateResponse();
  const session = await requireWaitlistStaff();
  const store = await getWaitlistStore();
  if (input.action === "revoke") return { request: await store.revoke(input.id, session.user.id) };
  const request = await store.get(input.id);
  if (request.status !== "invited")
    throw new UserFacingError("This request has no active invitation.");
  await requirePurchasable(request.product);
  const mailer = getWaitlistMailer(store);
  if (input.action === "retry") {
    const delivery = (await mailer.list(input.id)).find(
      (item) => item.id === input.deliveryId && item.kind === "invite",
    );
    if (!delivery) throw new UserFacingError("This invitation email is unavailable.");
    await store.recordEvent(input.id, "email_retried", session.user.id);
    return { delivery: await mailer.retry(delivery.id) };
  }
  await store.recordEvent(input.id, "email_resent", session.user.id);
  const delivery = await mailer.sendLink(
    request,
    "invite",
    await store.createLink(input.id, "invite"),
  );
  return { delivery };
}

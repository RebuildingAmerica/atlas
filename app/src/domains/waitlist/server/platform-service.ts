import "@tanstack/react-start/server-only";
import { UserFacingError } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { resolveCheckoutAvailability } from "@/domains/billing/server/checkout-availability";
import type { StaffWaitlistAction } from "../contracts";
import { getWaitlistStore, getWaitlistMailer } from "./runtime";
export async function listStaffRequests() {
  const store = await getWaitlistStore();
  const mailer = getWaitlistMailer(store);
  const [requests, availability] = await Promise.all([store.list(), resolveCheckoutAvailability()]);
  const records = await Promise.all(
    requests.map(async (request) => ({ request, deliveries: await mailer.list(request.id) })),
  );
  return { records, availability };
}
export async function staffDetail(id: string) {
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
export async function inviteRequests(ids: string[], operatorEmail: string) {
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
          const invited = await store.invite(id, operatorEmail);
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
export async function staffAction(input: StaffWaitlistAction, operatorEmail: string) {
  const store = await getWaitlistStore();
  if (input.action === "revoke") return { request: await store.revoke(input.id, operatorEmail) };
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
    await store.recordEvent(input.id, "email_retried", operatorEmail);
    return { delivery: await mailer.retry(delivery.id) };
  }
  await store.recordEvent(input.id, "email_resent", operatorEmail);
  const delivery = await mailer.sendLink(
    request,
    "invite",
    await store.createLink(input.id, "invite"),
  );
  return { delivery };
}

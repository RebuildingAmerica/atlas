import "@tanstack/react-start/server-only";
import { setResponseHeader } from "@tanstack/react-start/server";
import { UserFacingError } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";
import { loadAtlasSession } from "@/domains/access/server/session-state";
import { getServerFnRequest } from "@/domains/access/server/request-headers";
import { resolveClientIp } from "@/domains/access/server/anonymous-rate-limit";
import type {
  PaidAccessDecision,
  WaitlistDetails,
  WaitlistLinkKind,
  WaitlistSignup,
} from "../contracts";
import type * as platformService from "./platform-service";
import type { StaffWaitlistAction } from "../contracts";
import type { PrivateWaitlistInput } from "../waitlist.functions";
import {
  getWaitlistMailer,
  getWaitlistStore,
  isManagedWaitlist,
  paidAccessMode,
  requireWaitlistStaff,
} from "./runtime";

import { WaitlistLinkUnavailable } from "./store";

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
  try {
    return await (await getWaitlistStore()).readLink(token, kind);
  } catch (error) {
    if (error instanceof WaitlistLinkUnavailable) return null;
    throw error;
  }
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
// Old customer-session server functions fail closed. Private applicants belong
// exclusively to platform operators verified by Access and the platform API.
export function staffAccess(): Promise<{ allowed: boolean }> {
  return requireWaitlistStaff();
}
export function listStaffRequests(): Promise<
  Awaited<ReturnType<typeof platformService.listStaffRequests>>
> {
  return requireWaitlistStaff();
}
export function staffDetail(
  _id: string,
): Promise<Awaited<ReturnType<typeof platformService.staffDetail>>> {
  return requireWaitlistStaff();
}
export function inviteRequests(
  _ids: string[],
): Promise<Awaited<ReturnType<typeof platformService.inviteRequests>>> {
  return requireWaitlistStaff();
}
export function staffAction(
  _input: StaffWaitlistAction,
): Promise<Awaited<ReturnType<typeof platformService.staffAction>>> {
  return requireWaitlistStaff();
}

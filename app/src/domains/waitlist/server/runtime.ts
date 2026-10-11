import "@tanstack/react-start/server-only";
import { UserFacingError } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { parseEnvBoolean } from "@/platform/config/env-boolean";
import { getAuthRuntimeConfig } from "@/domains/access/server/runtime";
import { ensureAuthReady } from "@/domains/access/server/auth";
import { createEmailService } from "@/platform/email/server/service";
import { WaitlistStore } from "./store";
import { getWaitlistDatabase } from "./database";
import { WaitlistMailer } from "./delivery";

export function isManagedWaitlist(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    parseEnvBoolean(env.ATLAS_MANAGED, false, "ATLAS_MANAGED") &&
    parseEnvBoolean(env.ATLAS_MULTI_USER, true, "ATLAS_MULTI_USER")
  );
}
export function paidAccessMode(env: NodeJS.ProcessEnv = process.env): "open" | "waitlist" {
  if (!isManagedWaitlist(env)) return "open";
  const mode = env.ATLAS_PAID_ACCESS_MODE;
  if (mode !== "open" && mode !== "waitlist")
    throw new Error(
      "ATLAS_PAID_ACCESS_MODE must explicitly be open or waitlist for managed Atlas.",
    );
  return mode;
}
export function requireManagedWaitlist() {
  if (!isManagedWaitlist())
    throw new UserFacingError("The Atlas waitlist is unavailable on this instance.");
  paidAccessMode();
}
export async function getWaitlistStore() {
  requireManagedWaitlist();
  await ensureAuthReady();
  return new WaitlistStore(getWaitlistDatabase());
}
export function getWaitlistMailer(store: WaitlistStore) {
  const runtime = getAuthRuntimeConfig();
  return new WaitlistMailer(
    store.database,
    createEmailService(runtime),
    runtime.internalSecret,
    runtime.publicBaseUrl,
  );
}
export function requireWaitlistStaff(): Promise<never> {
  return Promise.reject(new UserFacingError("This is done in the Atlas platform admin."));
}

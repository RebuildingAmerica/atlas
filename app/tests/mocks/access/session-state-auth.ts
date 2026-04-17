import { vi } from "vitest";
import type { getAuth } from "@/domains/access/server/auth";
import {
  createBetterAuthOrganization,
  createBetterAuthSession,
} from "../../fixtures/access/sessions";

/**
 * Builds the Better Auth API mock object used by `session-state` tests.
 *
 * The returned object uses the real Better Auth method names so tests can
 * override only the calls they care about.
 */
export function createSessionStateAuthApi() {
  return {
    getActiveMemberRole: vi.fn().mockResolvedValue({ role: "owner" }),
    getSession: vi.fn().mockResolvedValue(createBetterAuthSession()),
    listOrganizations: vi.fn().mockResolvedValue([createBetterAuthOrganization()]),
    listPasskeys: vi.fn().mockResolvedValue([{}]),
    listUserInvitations: vi.fn().mockResolvedValue([]),
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    signInMagicLink: vi.fn().mockResolvedValue(undefined),
  } satisfies Pick<
    ReturnType<typeof getAuth>["api"],
    | "getActiveMemberRole"
    | "getSession"
    | "listOrganizations"
    | "listPasskeys"
    | "listUserInvitations"
    | "sendVerificationEmail"
    | "signInMagicLink"
  >;
}

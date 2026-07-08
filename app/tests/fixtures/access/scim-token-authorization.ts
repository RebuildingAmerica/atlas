import type { User } from "better-auth";
import type { SCIMOptions } from "@better-auth/scim";

export type ScimTokenAuthorization = NonNullable<SCIMOptions["canGenerateToken"]>;
export type ScimTokenAuthorizationPayload = Parameters<ScimTokenAuthorization>[0];

const scimUser: User = {
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  email: "admin@atlas.test",
  emailVerified: true,
  id: "user_admin",
  image: null,
  name: "Admin User",
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

export function buildScimTokenAuthorizationPayload(
  organizationId: string | undefined,
): ScimTokenAuthorizationPayload {
  const payloadWithoutOrganization = {
    member: null,
    providerId: "google-workspace",
    user: scimUser,
  };
  return organizationId
    ? { ...payloadWithoutOrganization, organizationId }
    : payloadWithoutOrganization;
}

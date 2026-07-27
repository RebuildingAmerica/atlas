import type {
  AtprotoIdentityDelegationResponse,
  AtprotoIdentityResponse,
  OrganizationAtprotoIdentityResponse,
} from "@rebuildingamerica/atlas-api-client/generated/atlas-schemas";
import type { AtlasOrganizationMemberRecord } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import {
  stubFetch,
  type StubbedFetch,
  type StubbedResponse,
} from "../../../../../helpers/stub-fetch";

/**
 * Canned replies for each endpoint the organization-identity section talks to.
 * Anything omitted answers with the quiet, empty version of that resource.
 */
export interface OrganizationIdentityApiOptions {
  accountIdentities?: StubbedEndpoint;
  attach?: StubbedEndpoint;
  delegations?: StubbedEndpoint;
  detach?: StubbedEndpoint;
  grant?: StubbedEndpoint;
  organizationIdentity?: StubbedEndpoint;
  revoke?: StubbedEndpoint;
}

/**
 * One endpoint's reply: fixed, or recomputed per request so a test can model an
 * endpoint whose answer changes after a write.
 */
export type StubbedEndpoint = StubbedResponse | (() => StubbedResponse);

/**
 * Builds one controlled account identity as the identities endpoint returns it.
 *
 * @param overrides - Fields this test cares about.
 */
export function createAccountIdentity(
  overrides: Partial<AtprotoIdentityResponse> = {},
): AtprotoIdentityResponse {
  return {
    connected_at: "2026-07-01T00:00:00.000Z",
    control_status: "active",
    current_handle: "existing.example",
    did: "did:plc:existing",
    id: "identity-existing",
    pds_url: "https://pds.example",
    resolution_status: "verified",
    ...overrides,
  };
}

/**
 * Builds the organization's active identity assignment.
 *
 * @param overrides - Fields this test cares about.
 */
export function createOrganizationIdentity(
  overrides: Partial<OrganizationAtprotoIdentityResponse> = {},
): OrganizationAtprotoIdentityResponse {
  return {
    attached_at: "2026-07-02T00:00:00.000Z",
    attached_by: "owner-1",
    id: "organization-identity-1",
    identity_id: "identity-existing",
    organization_id: "org-1",
    status: "active",
    ...overrides,
  };
}

/**
 * Builds one active delegation of identity administration.
 *
 * @param overrides - Fields this test cares about.
 */
export function createIdentityDelegation(
  overrides: Partial<AtprotoIdentityDelegationResponse> = {},
): AtprotoIdentityDelegationResponse {
  return {
    controller_user_id: "owner-1",
    delegate_user_id: "delegate-1",
    granted_at: "2026-07-03T00:00:00.000Z",
    granted_by: "owner-1",
    id: "delegation-1",
    identity_id: "identity-existing",
    organization_id: "org-1",
    status: "active",
    ...overrides,
  };
}

/**
 * Builds the workspace roster the section maps delegate ids back onto.
 */
export function createIdentityWorkspaceMembers(): AtlasOrganizationMemberRecord[] {
  return [
    {
      createdAt: "2026-07-01T00:00:00.000Z",
      email: "owner@atlas.test",
      id: "membership-owner",
      image: null,
      name: "Owner",
      role: "owner",
      userId: "owner-1",
    },
    {
      createdAt: "2026-07-01T00:00:00.000Z",
      email: "delegate@atlas.test",
      id: "membership-delegate",
      image: null,
      name: "Delegate",
      role: "member",
      userId: "delegate-1",
    },
  ];
}

/**
 * Routes a request to the endpoint it belongs to.
 *
 * @param url - The request URL the section produced.
 * @param method - The HTTP method it used.
 * @param options - The canned replies for this test.
 */
function resolveReply(
  url: string,
  method: string,
  options: OrganizationIdentityApiOptions,
): StubbedResponse {
  const path = new URL(url, "http://atlas.test").pathname;

  if (path === "/api/atproto/identities") {
    return settle(options.accountIdentities, { body: [] });
  }
  if (/\/delegations\/[^/]+$/.test(path)) {
    return settle(options.revoke, { body: createIdentityDelegation({ status: "revoked" }) });
  }
  if (path.endsWith("/delegations")) {
    if (method === "POST") {
      return settle(options.grant, { body: createIdentityDelegation() });
    }
    return settle(options.delegations, { body: [] });
  }
  if (/\/atproto-identities\/[^/]+$/.test(path)) {
    return settle(options.detach, { status: 204 });
  }
  if (method === "POST") {
    return settle(options.attach, { body: createOrganizationIdentity() });
  }
  return settle(options.organizationIdentity, { body: null });
}

/**
 * Resolves an endpoint's configured reply, or the quiet default.
 *
 * @param endpoint - The configured reply, if this test set one.
 * @param fallback - The reply used when the test did not configure this endpoint.
 */
function settle(endpoint: StubbedEndpoint | undefined, fallback: StubbedResponse): StubbedResponse {
  if (endpoint === undefined) {
    return fallback;
  }
  return typeof endpoint === "function" ? endpoint() : endpoint;
}

/**
 * Serves the real Atlas REST endpoints the generated organization-identity
 * client calls, so the section runs its own queries and mutations instead of
 * being handed a react-query stub.
 *
 * @param options - Per-endpoint replies for this test.
 * @returns The installed fetch stub and its request log.
 */
export function stubOrganizationIdentityApi(
  options: OrganizationIdentityApiOptions = {},
): StubbedFetch {
  return stubFetch((input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return resolveReply(url, init?.method ?? "GET", options);
  });
}

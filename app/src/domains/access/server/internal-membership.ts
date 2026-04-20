import "@tanstack/react-start/server-only";

import { timingSafeEqual } from "node:crypto";
import { normalizeAtlasOrganizationMetadata } from "../organization-metadata";
import { ensureAuthReady } from "./auth";
import { getAuthRuntimeConfig } from "./runtime";

/**
 * Response shape returned by the internal membership verification endpoint
 * when the user is confirmed as a member of the organization.
 */
interface MembershipVerificationResponse {
  name: string;
  role: string;
  slug: string;
  workspaceType: "individual" | "team";
}

/**
 * Private app-to-API membership verification endpoint.
 *
 * The Python API service calls this to confirm whether a user belongs to a
 * given organization and, if so, retrieve the member's role and workspace
 * metadata.
 */
export async function verifyMembershipRequest(
  request: Request,
  organizationId: string,
  userId: string,
): Promise<Response> {
  const runtime = getAuthRuntimeConfig();
  const providedSecret = request.headers.get("x-atlas-internal-secret");
  const secretMatches =
    !!runtime.internalSecret &&
    !!providedSecret &&
    runtime.internalSecret.length === providedSecret.length &&
    timingSafeEqual(Buffer.from(runtime.internalSecret), Buffer.from(providedSecret));

  if (!secretMatches) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const auth = await ensureAuthReady();
  const fullOrganization = await auth.api.getFullOrganization({
    headers: new Headers(),
    query: { organizationId },
  });

  if (!fullOrganization) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const member = fullOrganization.members.find((m: { userId: string }) => m.userId === userId);

  if (!member) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const metadata = normalizeAtlasOrganizationMetadata(fullOrganization.metadata);

  const body: MembershipVerificationResponse = {
    name: fullOrganization.name,
    role: member.role,
    slug: fullOrganization.slug,
    workspaceType: metadata.workspaceType,
  };

  return Response.json(body, { status: 200 });
}

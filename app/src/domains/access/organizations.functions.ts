import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  atlasWorkspaceTypeSchema,
  normalizeAtlasOrganizationMetadata,
} from "./organization-metadata";
import {
  invitationResultSchema,
  organizationDetailsSchema,
  toAtlasOrganizationDetails,
  workspaceSlugSchema,
} from "./organization-contracts";
import { buildWorkspaceSSOState, rawWorkspaceSSOProviderListSchema } from "./organization-sso";
import {
  assertOrganizationManagementEnabled,
  loadOrganizationRequestContext,
  requireManagedTeamWorkspace,
} from "./organization-server-helpers";
import { ensureStripeCustomerForWorkspace } from "@/domains/billing/server/stripe-customer";
import { ensureAuthReady } from "./server/auth";
import { getBrowserSessionHeaders } from "./server/request-headers";
import { getAuthRuntimeConfig } from "./server/runtime";
import { requireReadyAtlasSessionState } from "./server/session-state";

/**
 * Loads the active workspace details for the organization-management page.
 */
export const getOrganizationDetails = createServerFn({ method: "GET" }).handler(async () => {
  const { auth, headers, session } = await loadOrganizationRequestContext();
  const activeWorkspace = session.workspace.activeOrganization;

  if (!activeWorkspace) {
    return null;
  }

  const [detailsValue, providerListValue] = await Promise.all([
    auth.api.getFullOrganization({
      headers,
      query: {
        organizationId: activeWorkspace.id,
      },
    }),
    auth.api.listSSOProviders({ headers }),
  ]);
  const details = organizationDetailsSchema.parse(detailsValue);
  const providerList = rawWorkspaceSSOProviderListSchema.parse(providerListValue);
  const runtime = getAuthRuntimeConfig();

  if (!details) {
    return null;
  }

  const metadata = normalizeAtlasOrganizationMetadata(details.metadata);
  const sso = buildWorkspaceSSOState({
    organizationId: details.id,
    organizationSlug: details.slug,
    operatorEmail: session.user.email,
    primaryProviderId: metadata.ssoPrimaryProviderId,
    providers: providerList.providers,
    publicBaseUrl: runtime.publicBaseUrl,
  });

  return toAtlasOrganizationDetails(details, session, sso);
});

const workspaceDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, {
    message: "Enter a domain like example.com (no scheme, no path).",
  });

/**
 * Returns whether the supplied workspace slug is available for a new
 * workspace.  Wraps Better Auth's `/organization/check-slug` endpoint so the
 * creation form can disable Save and surface inline validation while the
 * operator is still typing.
 */
export const checkWorkspaceSlugAvailability = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      slug: workspaceSlugSchema,
    }),
  )
  .handler(async ({ data }) => {
    assertOrganizationManagementEnabled();
    await requireReadyAtlasSessionState();
    const auth = await ensureAuthReady();
    const headers = getBrowserSessionHeaders();
    try {
      const result = await auth.api.checkOrganizationSlug({
        body: { slug: data.slug },
        headers,
      });
      const status = result.status as unknown;
      return { available: status === true };
    } catch {
      // Better Auth throws when the slug is taken; treat that as unavailable
      // rather than surfacing the error to the operator.
      return { available: false };
    }
  });

/**
 * Creates a new Atlas workspace and activates it for the current operator.
 *
 * When `delegatedAdminEmail` is supplied, Atlas sends an admin invitation to
 * that address after the workspace is created so an integrator can stand up
 * the workspace on behalf of a customer who will manage it day-to-day.  The
 * creator stays as owner since Better Auth does not support owner transfer
 * inline; a follow-up role change can hand the workspace over once the
 * invited admin accepts.
 */
export const createWorkspace = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      delegatedAdminEmail: z.string().email().optional(),
      name: z.string().trim().min(1).max(80),
      slug: workspaceSlugSchema,
      workspaceDomain: workspaceDomainSchema.optional(),
      workspaceType: atlasWorkspaceTypeSchema,
    }),
  )
  .handler(async ({ data }) => {
    assertOrganizationManagementEnabled();

    const session = await requireReadyAtlasSessionState();
    const auth = await ensureAuthReady();
    const headers = getBrowserSessionHeaders();
    const createdOrganization = await auth.api.createOrganization({
      body: {
        keepCurrentActiveOrganization: false,
        metadata: {
          workspaceType: data.workspaceType,
          ...(data.workspaceDomain ? { workspaceDomain: data.workspaceDomain } : {}),
        },
        name: data.name,
        slug: data.slug,
        userId: session.user.id,
      },
      headers,
    });

    // Pre-create a Stripe customer so billing operations always have a
    // customer ID.  Failures here are non-fatal — the checkout flow will
    // fall back to customer_email if the Stripe customer is missing.
    try {
      await ensureStripeCustomerForWorkspace(createdOrganization.id, session.user.email, data.name);
    } catch {
      // Stripe may be unreachable in local dev or during outages.
    }

    // Delegated handoff: send an admin invite so the eventual workspace
    // operator can finish onboarding without the integrator's session.
    // Failures are non-fatal — the integrator still owns the workspace and
    // can resend the invite from the members panel.
    if (data.delegatedAdminEmail && data.workspaceType === "team") {
      try {
        await auth.api.createInvitation({
          body: {
            email: data.delegatedAdminEmail,
            organizationId: createdOrganization.id,
            role: "admin",
          },
          headers,
        });
      } catch {
        // Invite delivery may fail in local dev; surface via the members panel.
      }
    }

    return {
      id: createdOrganization.id,
      slug: createdOrganization.slug,
    };
  });

/**
 * Switches the current operator into another workspace they already belong to.
 */
export const setActiveWorkspace = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      organizationId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers } = await loadOrganizationRequestContext();

    await auth.api.setActiveOrganization({
      body: {
        organizationId: data.organizationId,
      },
      headers,
    });

    return { ok: true };
  });

/**
 * Updates the active team's basic workspace profile.
 */
export const updateWorkspaceProfile = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().trim().min(1).max(80),
      slug: workspaceSlugSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers, session } = await loadOrganizationRequestContext();
    const activeWorkspace = requireManagedTeamWorkspace(session);

    await auth.api.updateOrganization({
      body: {
        data: {
          name: data.name,
          slug: data.slug,
        },
        organizationId: activeWorkspace.id,
      },
      headers,
    });

    return { ok: true };
  });

/**
 * Invites a new member into the active team workspace.
 */
export const inviteWorkspaceMember = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email(),
      role: z.enum(["admin", "member"]),
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers, session } = await loadOrganizationRequestContext();
    const activeWorkspace = requireManagedTeamWorkspace(session);
    const invitationValue = await auth.api.createInvitation({
      body: {
        email: data.email,
        organizationId: activeWorkspace.id,
        role: data.role,
      },
      headers,
    });
    const invitation = invitationResultSchema.parse(invitationValue);

    return {
      id: invitation.id,
      status: invitation.status,
    };
  });

/**
 * Cancels an outstanding invitation for the active team workspace.
 */
export const cancelWorkspaceInvitation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      invitationId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers, session } = await loadOrganizationRequestContext();

    requireManagedTeamWorkspace(session);

    await auth.api.cancelInvitation({
      body: {
        invitationId: data.invitationId,
      },
      headers,
    });

    return { ok: true };
  });

/**
 * Accepts one of the current operator's pending workspace invitations.
 */
export const acceptWorkspaceInvitation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      invitationId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers } = await loadOrganizationRequestContext();

    await auth.api.acceptInvitation({
      body: {
        invitationId: data.invitationId,
      },
      headers,
    });

    return { ok: true };
  });

/**
 * Rejects one of the current operator's pending workspace invitations.
 */
export const rejectWorkspaceInvitation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      invitationId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers } = await loadOrganizationRequestContext();

    await auth.api.rejectInvitation({
      body: {
        invitationId: data.invitationId,
      },
      headers,
    });

    return { ok: true };
  });

/**
 * Updates one team member's role inside the active workspace.
 */
export const updateWorkspaceMemberRole = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      memberId: z.string().min(1),
      role: z.enum(["admin", "member"]),
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers, session } = await loadOrganizationRequestContext();
    const activeWorkspace = requireManagedTeamWorkspace(session);

    await auth.api.updateMemberRole({
      body: {
        memberId: data.memberId,
        organizationId: activeWorkspace.id,
        role: data.role,
      },
      headers,
    });

    return { ok: true };
  });

/**
 * Removes a member from the active team workspace.
 */
export const removeWorkspaceMember = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      memberIdOrEmail: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers, session } = await loadOrganizationRequestContext();
    const activeWorkspace = requireManagedTeamWorkspace(session);

    await auth.api.removeMember({
      body: {
        memberIdOrEmail: data.memberIdOrEmail,
        organizationId: activeWorkspace.id,
      },
      headers,
    });

    return { ok: true };
  });

/**
 * Removes the current non-owner operator from the active team workspace.
 */
export const leaveWorkspace = createServerFn({ method: "POST" }).handler(async () => {
  const { auth, headers, session } = await loadOrganizationRequestContext();
  const activeWorkspace = requireManagedTeamWorkspace(session);

  if (activeWorkspace.role === "owner") {
    throw new Error("Transfer workspace ownership before leaving this team.");
  }

  await auth.api.leaveOrganization({
    body: {
      organizationId: activeWorkspace.id,
    },
    headers,
  });

  return { ok: true };
});

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  invitationResultSchema,
  organizationDetailsSchema,
  workspaceSlugSchema,
} from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import {
  loadOrganizationRequestContext,
  requireManagedTeamWorkspace,
} from "./organization-server-helpers";
import { syncTeamSeatsBestEffort } from "./organizations.functions";

export const setActiveWorkspace = createServerFn({ method: "POST" })
  .validator(
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

export const updateWorkspaceProfile = createServerFn({ method: "POST" })
  .validator(
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

export const inviteWorkspaceMember = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().email(),
      role: z.enum(["admin", "member"]),
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers, session } = await loadOrganizationRequestContext();
    const activeWorkspace = requireManagedTeamWorkspace(session);

    if (!session.workspace.activeProducts.includes("atlas_team")) {
      throw new Error("Subscribe to Atlas Team to invite members to this workspace.");
    }

    const maxMembers = session.workspace.resolvedCapabilities.limits.max_members;
    if (maxMembers !== null) {
      const details = organizationDetailsSchema.parse(
        await auth.api.getFullOrganization({
          headers,
          query: { organizationId: activeWorkspace.id },
        }),
      );
      if (details) {
        const pendingInvites = details.invitations.filter(
          (invitation) => invitation.status === "pending",
        ).length;
        if (details.members.length + pendingInvites >= maxMembers) {
          throw new Error(
            `This workspace has reached its limit of ${maxMembers} members. Remove a member or cancel a pending invitation before inviting someone new.`,
          );
        }
      }
    }

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

export const resendWorkspaceInvitation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().email(),
      role: z.enum(["admin", "member"]),
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers, session } = await loadOrganizationRequestContext();
    const activeWorkspace = requireManagedTeamWorkspace(session);

    if (!session.workspace.activeProducts.includes("atlas_team")) {
      throw new Error("Subscribe to Atlas Team to invite members to this workspace.");
    }

    await auth.api.createInvitation({
      body: {
        email: data.email,
        organizationId: activeWorkspace.id,
        role: data.role,
        resend: true,
      },
      headers,
    });

    return { ok: true };
  });

export const cancelWorkspaceInvitation = createServerFn({ method: "POST" })
  .validator(
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

export const acceptWorkspaceInvitation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      invitationId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { auth, headers, session } = await loadOrganizationRequestContext();

    await auth.api.acceptInvitation({
      body: {
        invitationId: data.invitationId,
      },
      headers,
    });

    const organizationId = session.workspace.pendingInvitations.find(
      (invitation) => invitation.id === data.invitationId,
    )?.organizationId;
    if (organizationId) {
      await syncTeamSeatsBestEffort(organizationId);
    }

    return { ok: true };
  });

export const rejectWorkspaceInvitation = createServerFn({ method: "POST" })
  .validator(
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

export const updateWorkspaceMemberRole = createServerFn({ method: "POST" })
  .validator(
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

export const removeWorkspaceMember = createServerFn({ method: "POST" })
  .validator(
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

    await syncTeamSeatsBestEffort(activeWorkspace.id);

    return { ok: true };
  });

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

  await syncTeamSeatsBestEffort(activeWorkspace.id);

  return { ok: true };
});

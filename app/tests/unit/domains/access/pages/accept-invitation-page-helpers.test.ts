import { describe, expect, it } from "vitest";
import type { AtlasSessionPayload } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import {
  buildInvitationSignInPath,
  resolveInvitationDecision,
} from "@/domains/access/pages/auth/accept-invitation-page-helpers";

describe("buildInvitationSignInPath", () => {
  it("carries the invitation through sign-in and back to the landing page", () => {
    expect(buildInvitationSignInPath("inv_42")).toBe(
      "/sign-in?invitation=inv_42&redirect=%2Faccept-invitation%2Finv_42",
    );
  });

  it("encodes ids containing URL-significant characters", () => {
    expect(buildInvitationSignInPath("a/b")).toBe(
      "/sign-in?invitation=a%2Fb&redirect=%2Faccept-invitation%2Fa%252Fb",
    );
  });
});

describe("resolveInvitationDecision", () => {
  interface SessionOverrides {
    email: string;
    invitations: AtlasSessionPayload["workspace"]["pendingInvitations"];
  }

  function buildSession(overrides: SessionOverrides): AtlasSessionPayload {
    return {
      accountReady: true,
      hasPasskey: true,
      isLocal: false,
      passkeyCount: 1,
      session: { id: "sess_1" },
      user: {
        email: overrides.email,
        emailVerified: true,
        id: "user_1",
        name: "Operator",
      },
      workspace: {
        activeOrganization: null,
        activeProducts: [],
        capabilities: {} as AtlasSessionPayload["workspace"]["capabilities"],
        memberships: [],
        onboarding: { hasPendingInvitations: true, needsWorkspace: false },
        pendingInvitations: overrides.invitations,
        resolvedCapabilities: {} as AtlasSessionPayload["workspace"]["resolvedCapabilities"],
      },
    };
  }

  function buildInvitation(
    overrides: Partial<AtlasSessionPayload["workspace"]["pendingInvitations"][number]>,
  ): AtlasSessionPayload["workspace"]["pendingInvitations"][number] {
    return {
      email: "invitee@atlas.test",
      expiresAt: null,
      id: "inv_1",
      organizationId: "org_1",
      organizationName: "Invited Team",
      organizationSlug: "invited-team",
      role: "member",
      workspaceType: "team",
      ...overrides,
    };
  }

  it("returns the matching invitation when the operator email matches", () => {
    const invitation = buildInvitation({ email: "Invitee@Atlas.test", id: "inv_1" });
    const session = buildSession({ email: "invitee@atlas.test", invitations: [invitation] });

    expect(resolveInvitationDecision(session, "inv_1")).toEqual({
      kind: "accept",
      invitation,
    });
  });

  it("flags a wrong account when the invitation is addressed to a different email", () => {
    const invitation = buildInvitation({ email: "someone-else@atlas.test", id: "inv_1" });
    const session = buildSession({ email: "operator@atlas.test", invitations: [invitation] });

    expect(resolveInvitationDecision(session, "inv_1")).toEqual({ kind: "wrong_account" });
  });

  it("proceeds with a null invitation when the cached session predates the invite", () => {
    const session = buildSession({ email: "operator@atlas.test", invitations: [] });

    expect(resolveInvitationDecision(session, "inv_missing")).toEqual({
      kind: "accept",
      invitation: null,
    });
  });
});

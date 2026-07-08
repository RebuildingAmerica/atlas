// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { organizationPageDependencyMocks } from "../../../../helpers/access/organization-page-test-state";
import { createOrganizationDetailsFixture } from "../../../../fixtures/access/organizations";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../../fixtures/access/sessions";
import {
  renderOrganizationPage,
  setAtlasSession,
  setOrganizationDetails,
} from "../../../../helpers/access/organization-page-test-harness";

describe("OrganizationPage", () => {
  it("lets non-owner members leave the active team workspace", async () => {
    const memberSession = createAtlasSessionFixture({
      user: {
        id: "user_member",
      },
      workspace: createAtlasWorkspace({
        activeOrganization: {
          id: "org_team",
          name: "Atlas Team",
          role: "member",
          slug: "atlas-team",
          workspaceType: "team",
        },
        memberships: [
          {
            id: "org_team",
            name: "Atlas Team",
            role: "member",
            slug: "atlas-team",
            workspaceType: "team",
          },
        ],
      }),
    });
    const memberOrganization = createOrganizationDetailsFixture({
      role: "member",
    });

    setAtlasSession(memberSession);
    setOrganizationDetails(memberOrganization);

    await renderOrganizationPage();

    fireEvent.click(screen.getByRole("button", { name: "Leave workspace" }));

    await waitFor(() => {
      expect(organizationPageDependencyMocks.leaveWorkspace).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps team invitations and enterprise SSO hidden for individual workspaces", async () => {
    const individualWorkspace = createAtlasWorkspace({
      activeOrganization: {
        id: "org_personal",
        name: "Solo Desk",
        role: "owner",
        slug: "solo-desk",
        workspaceType: "individual",
      },
      capabilities: {
        canInviteMembers: false,
        canManageOrganization: false,
        canSwitchOrganizations: false,
        canUseTeamFeatures: false,
      },
      memberships: [
        {
          id: "org_personal",
          name: "Solo Desk",
          role: "owner",
          slug: "solo-desk",
          workspaceType: "individual",
        },
      ],
    });
    const individualOrganization = createOrganizationDetailsFixture({
      capabilities: {
        canInviteMembers: false,
        canManageOrganization: false,
        canSwitchOrganizations: false,
        canUseTeamFeatures: false,
      },
      invitations: [],
      members: [],
      name: "Solo Desk",
      role: "owner",
      slug: "solo-desk",
      workspaceType: "individual",
    });

    setAtlasSession(
      createAtlasSessionFixture({
        workspace: individualWorkspace,
      }),
    );
    setOrganizationDetails(individualOrganization);

    await renderOrganizationPage();

    expect(screen.queryByText("Invitations")).toBeNull();
    expect(screen.queryByText("Enterprise sign-in")).toBeNull();
    expect(screen.getByText("This is a personal workspace.")).not.toBeNull();
  });
});

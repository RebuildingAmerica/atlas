// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { buildController } from "../../../../../helpers/access/organization-workspace-page-view-test-bed";
import { OrganizationWorkspacePageView } from "@/domains/access/components/organization/organization-workspace-page-view";

afterEach(() => {
  cleanup();
});

describe("OrganizationWorkspacePageView", () => {
  it("shows the invite upsell instead of the form when a team lacks the shared capability", () => {
    const controller = buildController({
      session: {
        user: { id: "user_1" },
        workspace: {
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
        },
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(
      screen.getByText(/Subscribe to Atlas Team to invite members to this workspace/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Send invitation/i)).not.toBeInTheDocument();
  });

  it("offers an upgrade prompt on an individual workspace the operator manages", () => {
    const onUpgradeToTeam = vi.fn();
    const controller = buildController({
      canUseTeamFeatures: false,
      canManageOrganization: false,
      activeWorkspace: { id: "org_1", name: "Solo", role: "owner" },
      organization: {
        id: "org_1",
        name: "Solo",
        slug: "solo",
        members: [{ id: "mem_1", userId: "user_1", role: "owner" }],
        invitations: [],
        metadata: { workspaceType: "individual" },
        capabilities: { canUseTeamFeatures: false },
        role: "owner",
        workspaceType: "individual",
        sso: { providers: [] },
      },
      onUpgradeToTeam,
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    fireEvent.click(screen.getByRole("button", { name: /Upgrade to a team workspace/i }));
    expect(onUpgradeToTeam).toHaveBeenCalled();
  });

  it("hides the upgrade prompt on an individual workspace the operator cannot manage", () => {
    const controller = buildController({
      canUseTeamFeatures: false,
      canManageOrganization: false,
      activeWorkspace: {
        id: "org_1",
        name: "Solo",
        role: "member",
        slug: "solo",
        workspaceType: "individual",
      },
      organization: {
        id: "org_1",
        name: "Solo",
        slug: "solo",
        members: [{ id: "mem_1", userId: "user_1", role: "member" }],
        invitations: [],
        metadata: { workspaceType: "individual" },
        capabilities: { canUseTeamFeatures: false },
        role: "member",
        workspaceType: "individual",
        sso: { providers: [] },
      },
    });

    render(<OrganizationWorkspacePageView controller={controller} />);
    expect(
      screen.queryByRole("button", { name: /Upgrade to a team workspace/i }),
    ).not.toBeInTheDocument();
  });
});

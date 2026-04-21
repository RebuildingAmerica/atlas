// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";
import { WorkspaceProfileSection } from "@/domains/access/components/organization/workspace-profile-section";

describe("WorkspaceProfileSection", () => {
  const organization = {
    id: "org_1",
    name: "Atlas",
    slug: "atlas",
    workspaceType: "team",
    role: "owner",
    capabilities: { canUseTeamFeatures: true },
  };

  const defaultProps = {
    canManageOrganization: true,
    isPending: false,
    organization: organization as unknown as AtlasOrganizationDetails,
    profileName: "Atlas",
    profileSlug: "atlas",
    onNameChange: vi.fn(),
    onSlugChange: vi.fn(),
    onSubmit: vi.fn((e: { preventDefault: () => void }) => {
      e.preventDefault();
    }),
  };

  afterEach(() => {
    cleanup();
  });

  it("renders the profile form for managers", () => {
    render(<WorkspaceProfileSection {...defaultProps} />);
    expect(screen.getByLabelText(/Workspace name/i)).toHaveValue("Atlas");
    expect(screen.getByLabelText(/Workspace slug/i)).toHaveValue("atlas");
    expect(screen.getByText(/Your role: owner/i)).toBeInTheDocument();
  });

  it("renders read-only view for non-managers", () => {
    render(<WorkspaceProfileSection {...defaultProps} canManageOrganization={false} />);
    expect(screen.queryByLabelText(/Workspace name/i)).not.toBeInTheDocument();
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    expect(screen.getByText(/atlas · owner/i)).toBeInTheDocument();
  });

  it("triggers handlers on input change", () => {
    render(<WorkspaceProfileSection {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Workspace name/i), { target: { value: "New Name" } });
    expect(defaultProps.onNameChange).toHaveBeenCalledWith("New Name");
  });

  it("disables save button when pending", () => {
    render(<WorkspaceProfileSection {...defaultProps} isPending={true} />);
    expect(screen.getByText(/Saving.../i)).toBeDisabled();
  });

  it("shows personal workspace message when team features are disabled", () => {
    const personalOrg = { ...organization, capabilities: { canUseTeamFeatures: false } };
    render(
      <WorkspaceProfileSection
        {...defaultProps}
        organization={personalOrg as unknown as AtlasOrganizationDetails}
      />,
    );
    expect(screen.getByText(/This is a personal workspace/i)).toBeInTheDocument();
  });
});

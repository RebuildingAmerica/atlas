// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkspaceMembershipSection } from "@/domains/access/components/organization/workspace-membership-section";

type MembershipOrganization = Parameters<typeof WorkspaceMembershipSection>[0]["organization"];

describe("WorkspaceMembershipSection", () => {
  const organization = {
    id: "org_1",
    name: "Atlas",
    slug: "atlas",
    workspaceType: "team",
    role: "member",
    capabilities: { canUseTeamFeatures: true },
  };

  const defaultProps = {
    isPending: false,
    onLeave: vi.fn(),
    organization: organization as unknown as MembershipOrganization,
  };

  afterEach(() => {
    cleanup();
  });

  it("renders the membership info", () => {
    render(<WorkspaceMembershipSection {...defaultProps} />);
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    expect(screen.getByText(/Role: member/i)).toBeInTheDocument();
  });

  it("allows members to leave the workspace", () => {
    render(<WorkspaceMembershipSection {...defaultProps} />);
    expect(screen.getByText(/Leave this workspace/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Leave workspace/i));
    expect(defaultProps.onLeave).toHaveBeenCalled();
  });

  it("blocks owners from leaving the workspace", () => {
    const ownerOrg = { ...organization, role: "owner" };
    render(
      <WorkspaceMembershipSection
        {...defaultProps}
        organization={ownerOrg as unknown as MembershipOrganization}
      />,
    );

    expect(screen.getByText(/Owner leave is blocked/i)).toBeInTheDocument();
    expect(screen.queryByText(/Leave workspace/i)).not.toBeInTheDocument();
  });

  it("shows leaving state when pending", () => {
    render(<WorkspaceMembershipSection {...defaultProps} isPending={true} />);
    expect(screen.getByText(/Leaving.../i)).toBeDisabled();
  });
});

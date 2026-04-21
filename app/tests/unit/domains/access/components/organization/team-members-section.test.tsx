// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamMembersSection } from "@/domains/access/components/organization/team-members-section";
import type { AtlasOrganizationMemberRecord } from "@/domains/access/organization-contracts";

describe("TeamMembersSection", () => {
  const members: AtlasOrganizationMemberRecord[] = [
    {
      id: "mem_1",
      userId: "user_1",
      name: "Owner User",
      email: "owner@atlas.test",
      image: null,
      role: "owner",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "mem_2",
      userId: "user_2",
      name: "Admin User",
      email: "admin@atlas.test",
      image: null,
      role: "admin",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "mem_3",
      userId: "user_3",
      name: "Member User",
      email: "member@atlas.test",
      image: null,
      role: "member",
      createdAt: "2026-01-03T00:00:00.000Z",
    },
  ];

  const defaultProps = {
    canManageOrganization: true,
    currentUserId: "user_1",
    isRemovePending: false,
    members,
    onRemove: vi.fn(),
    onRoleChange: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  it("renders the member roster", () => {
    render(<TeamMembersSection {...defaultProps} />);

    expect(screen.getByText(/3 members/i)).toBeInTheDocument();
    expect(screen.getByText("Owner User")).toBeInTheDocument();
    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByText("Member User")).toBeInTheDocument();
  });

  it("marks the current user", () => {
    render(<TeamMembersSection {...defaultProps} currentUserId="user_1" />);
    expect(screen.getByText(/owner · you/i)).toBeInTheDocument();
  });

  it("allows admins/owners to edit other non-owner members", () => {
    render(
      <TeamMembersSection {...defaultProps} canManageOrganization={true} currentUserId="user_1" />,
    );

    // Admin user (mem_2) should be editable
    expect(screen.getByLabelText(/Role for admin@atlas.test/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Remove/i)).toHaveLength(2); // For mem_2 and mem_3
  });

  it("prevents editing the owner even for admins", () => {
    render(
      <TeamMembersSection {...defaultProps} canManageOrganization={true} currentUserId="user_2" />,
    );

    // Owner (mem_1) should NOT be editable
    expect(screen.queryByLabelText(/Role for owner@atlas.test/i)).not.toBeInTheDocument();
  });

  it("triggers onRoleChange when a role is selected", () => {
    render(<TeamMembersSection {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/Role for admin@atlas.test/i), {
      target: { value: "member" },
    });
    expect(defaultProps.onRoleChange).toHaveBeenCalledWith("mem_2", "member");
  });

  it("triggers onRemove when the remove button is clicked", () => {
    render(<TeamMembersSection {...defaultProps} />);

    const removeButtons = screen.getAllByText(/Remove/i);
    const firstRemoveButton = removeButtons[0];
    if (!firstRemoveButton) throw new Error("Expected at least one remove button");
    fireEvent.click(firstRemoveButton);
    expect(defaultProps.onRemove).toHaveBeenCalledWith("mem_2");
  });

  it("disables remove buttons when a removal is pending", () => {
    render(<TeamMembersSection {...defaultProps} isRemovePending={true} />);

    const removeButtons = screen.getAllByText(/Remove/i);
    const firstButton = removeButtons[0];
    if (!firstButton) throw new Error("Expected at least one remove button");
    expect(firstButton).toBeDisabled();
  });
});

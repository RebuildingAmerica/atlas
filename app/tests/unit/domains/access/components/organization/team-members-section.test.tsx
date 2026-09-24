// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamMembersSection } from "@/domains/access/components/organization/team-members-section";
import { ConfirmDialogProvider } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";
import type { AtlasOrganizationMemberRecord } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";

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

  function renderRoster(props: Parameters<typeof TeamMembersSection>[0] = defaultProps) {
    return render(<TeamMembersSection {...props} />, { wrapper: ConfirmDialogProvider });
  }

  afterEach(() => {
    cleanup();
  });

  it("renders the member roster", () => {
    renderRoster();

    expect(screen.getByText(/3 members/i)).toBeInTheDocument();
    const roster = screen.getByRole("table", { name: "Workspace members" });
    expect(within(roster).getByText("Owner User")).toBeInTheDocument();
    expect(within(roster).getByText("Admin User")).toBeInTheDocument();
    expect(within(roster).getByText("Member User")).toBeInTheDocument();
  });

  it("keeps the role guide out of the roster table", () => {
    renderRoster();

    const roster = screen.getByRole("table", { name: "Workspace members" });
    expect(screen.queryByRole("region", { name: "Role guide" })).not.toBeInTheDocument();
    expect(
      within(roster).queryByText("Workspace settings, billing, members, and shared research."),
    ).not.toBeInTheDocument();
  });

  it("marks the current user", () => {
    renderRoster({ ...defaultProps, currentUserId: "user_1" });
    expect(screen.getByText(/owner · you/i)).toBeInTheDocument();
  });

  it("allows admins/owners to edit other non-owner members", () => {
    const { container } = renderRoster({
      ...defaultProps,
      canManageOrganization: true,
      currentUserId: "user_1",
    });

    // Admin user (mem_2) should be editable
    expect(screen.getByLabelText(/Role for admin@atlas.test/i)).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-shield")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-chevron-down")).toBeInTheDocument();
    expect(screen.getAllByText(/Remove/i)).toHaveLength(2); // For mem_2 and mem_3
  });

  it("prevents editing the owner even for admins", () => {
    renderRoster({ ...defaultProps, canManageOrganization: true, currentUserId: "user_2" });

    // Owner (mem_1) should NOT be editable
    expect(screen.queryByLabelText(/Role for owner@atlas.test/i)).not.toBeInTheDocument();
  });

  it("triggers onRoleChange when a role is selected", () => {
    renderRoster();

    fireEvent.change(screen.getByLabelText(/Role for admin@atlas.test/i), {
      target: { value: "member" },
    });
    expect(defaultProps.onRoleChange).toHaveBeenCalledWith("mem_2", "member");
  });

  it("asks an owner before giving another member ownership", async () => {
    const onRoleChange = vi.fn();
    renderRoster({ ...defaultProps, onRoleChange });

    fireEvent.change(screen.getByLabelText(/Role for admin@atlas.test/i), {
      target: { value: "owner" },
    });
    expect(onRoleChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("full control");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRoleChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Role for admin@atlas.test/i), {
      target: { value: "owner" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make owner" }));
    await waitFor(() => {
      expect(onRoleChange).toHaveBeenCalledWith("mem_2", "owner");
    });
  });

  it("does not offer ownership to an admin", () => {
    const onRoleChange = vi.fn();
    renderRoster({ ...defaultProps, currentUserId: "user_2", onRoleChange });
    expect(screen.getByLabelText(/Role for member@atlas.test/i)).not.toHaveValue("owner");
    expect(screen.queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Role for member@atlas.test/i), {
      target: { value: "owner" },
    });
    expect(onRoleChange).not.toHaveBeenCalled();
  });

  it("reviews the lost access before removing a member", async () => {
    const onRemove = vi.fn();
    renderRoster({ ...defaultProps, onRemove });

    fireEvent.click(screen.getByRole("button", { name: "Remove Admin User" }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("lose access to this workspace");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove Admin User" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove member" }));
    await waitFor(() => {
      expect(onRemove).toHaveBeenCalledOnce();
    });
    expect(onRemove).toHaveBeenCalledWith("mem_2");
  });

  it("disables remove buttons when a removal is pending", () => {
    renderRoster({ ...defaultProps, isRemovePending: true });

    const removeButtons = screen.getAllByRole("button", { name: /Remove/i });
    const firstButton = removeButtons[0];
    if (!firstButton) throw new Error("Expected at least one remove button");
    expect(firstButton).toBeDisabled();
  });

  it("ignores role-select changes that fall outside the admin/member union", () => {
    renderRoster();

    const select = screen.getByLabelText(/Role for admin@atlas.test/i);
    fireEvent.change(select, { target: { value: "unknown" } });
    expect(defaultProps.onRoleChange).not.toHaveBeenCalledWith("mem_2", "unknown");
  });

  it("can promote an accepted member to admin", () => {
    const onRoleChange = vi.fn();
    renderRoster({ ...defaultProps, onRoleChange });
    fireEvent.change(screen.getByLabelText(/Role for member@atlas.test/i), {
      target: { value: "admin" },
    });
    expect(onRoleChange).toHaveBeenCalledWith("mem_3", "admin");
  });
});

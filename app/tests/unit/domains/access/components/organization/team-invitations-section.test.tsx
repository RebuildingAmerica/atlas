// @vitest-environment jsdom
import type { FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamInvitationsSection } from "@/domains/access/components/organization/team-invitations-section";
import type { AtlasOrganizationInvitationRecord } from "@/domains/access/organization-contracts";

describe("TeamInvitationsSection", () => {
  const invitations: AtlasOrganizationInvitationRecord[] = [
    {
      id: "inv_1",
      email: "pending@atlas.test",
      role: "admin",
      status: "pending",
      createdAt: "2026-04-01T00:00:00.000Z",
      expiresAt: "2026-05-01T00:00:00.000Z",
    },
  ];

  const defaultProps = {
    canManageOrganization: true,
    invitations,
    inviteEmail: "new@atlas.test",
    inviteRole: "member" as const,
    isCancelPending: false,
    isInvitePending: false,
    onCancel: vi.fn(),
    onEmailChange: vi.fn(),
    onInviteRoleChange: vi.fn(),
    onSubmit: vi.fn((e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
    }),
  };

  afterEach(() => {
    cleanup();
  });

  it("renders pending invitations", () => {
    render(<TeamInvitationsSection {...defaultProps} />);
    expect(screen.getByText("pending@atlas.test")).toBeInTheDocument();
    expect(screen.getByText(/admin · pending/i)).toBeInTheDocument();
  });

  it("renders a call to action when no invitations exist", () => {
    render(<TeamInvitationsSection {...defaultProps} invitations={[]} />);
    expect(screen.getByText(/No pending invitations/i)).toBeInTheDocument();
  });

  it("calls handlers on input change", () => {
    render(<TeamInvitationsSection {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "another@atlas.test" } });
    expect(defaultProps.onEmailChange).toHaveBeenCalledWith("another@atlas.test");
  });

  it("triggers onSubmit when send button is clicked", () => {
    render(<TeamInvitationsSection {...defaultProps} />);
    fireEvent.click(screen.getByText(/Send invitation/i));
    expect(defaultProps.onSubmit).toHaveBeenCalled();
  });

  it("triggers onCancel when cancel button is clicked", () => {
    render(<TeamInvitationsSection {...defaultProps} />);
    fireEvent.click(screen.getByText(/Cancel/i));
    expect(defaultProps.onCancel).toHaveBeenCalledWith("inv_1");
  });

  it("hides the form when the user cannot manage organization", () => {
    render(<TeamInvitationsSection {...defaultProps} canManageOrganization={false} />);
    expect(screen.queryByLabelText(/Email/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Only owners and admins can invite/i)).toBeInTheDocument();
  });
});

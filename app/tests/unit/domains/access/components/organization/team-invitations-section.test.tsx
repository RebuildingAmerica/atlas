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
    isResendPending: false,
    onCancel: vi.fn(),
    onEmailChange: vi.fn(),
    onInviteRoleChange: vi.fn(),
    onResend: vi.fn(),
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

  it("renders the in-flight label when an invite is pending", () => {
    render(<TeamInvitationsSection {...defaultProps} isInvitePending={true} />);
    expect(screen.getByText(/Sending\.\.\./)).toBeInTheDocument();
  });

  it("hides the per-invitation cancel button when the user cannot manage organization", () => {
    render(<TeamInvitationsSection {...defaultProps} canManageOrganization={false} />);
    expect(screen.queryByRole("button", { name: /Cancel/i })).not.toBeInTheDocument();
  });

  it("resends an invitation with its email and normalized admin role", () => {
    render(<TeamInvitationsSection {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    expect(defaultProps.onResend).toHaveBeenCalledWith("pending@atlas.test", "admin");
  });

  it("normalizes a non-admin invitation role to member when resending", () => {
    const memberInvitations: AtlasOrganizationInvitationRecord[] = [
      {
        id: "inv_1",
        email: "pending@atlas.test",
        role: "member",
        status: "pending",
        createdAt: "2026-04-01T00:00:00.000Z",
        expiresAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    render(<TeamInvitationsSection {...defaultProps} invitations={memberInvitations} />);
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    expect(defaultProps.onResend).toHaveBeenCalledWith("pending@atlas.test", "member");
  });

  it("disables the resend button while a resend is pending", () => {
    render(<TeamInvitationsSection {...defaultProps} isResendPending={true} />);
    expect(screen.getByRole("button", { name: "Resend" })).toBeDisabled();
  });

  it("hides the resend button when the user cannot manage organization", () => {
    render(<TeamInvitationsSection {...defaultProps} canManageOrganization={false} />);
    expect(screen.queryByRole("button", { name: "Resend" })).not.toBeInTheDocument();
  });
});

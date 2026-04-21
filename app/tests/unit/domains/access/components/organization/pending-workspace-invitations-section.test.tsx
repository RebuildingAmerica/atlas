// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PendingWorkspaceInvitationsSection } from "@/domains/access/components/organization/pending-workspace-invitations-section";

describe("PendingWorkspaceInvitationsSection", () => {
  const invitations = [
    {
      id: "inv_1",
      organizationId: "org_1",
      organizationName: "Atlas Team",
      organizationSlug: "atlas-team",
      role: "admin",
      workspaceType: "team" as const,
      email: "user@atlas.test",
      expiresAt: "2026-05-01T00:00:00.000Z",
    },
  ];

  const defaultProps = {
    invitations,
    isPending: false,
    onDecision: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  it("renders pending invitations", () => {
    render(<PendingWorkspaceInvitationsSection {...defaultProps} />);
    expect(screen.getByText("Atlas Team")).toBeInTheDocument();
    expect(screen.getByText(/admin access · team workspace/i)).toBeInTheDocument();
  });

  it("triggers onDecision with 'accept' when clicking Accept", () => {
    render(<PendingWorkspaceInvitationsSection {...defaultProps} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(defaultProps.onDecision).toHaveBeenCalledWith("inv_1", "accept");
  });

  it("triggers onDecision with 'reject' when clicking Decline", () => {
    render(<PendingWorkspaceInvitationsSection {...defaultProps} />);
    fireEvent.click(screen.getByText("Decline"));
    expect(defaultProps.onDecision).toHaveBeenCalledWith("inv_1", "reject");
  });

  it("disables buttons when pending", () => {
    render(<PendingWorkspaceInvitationsSection {...defaultProps} isPending={true} />);
    expect(screen.getByText("Accept")).toBeDisabled();
    expect(screen.getByText("Decline")).toBeDisabled();
  });
});

// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountWorkspaceCards } from "@/domains/access/pages/workspace/components/account-workspace-cards";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("AccountWorkspaceCards", () => {
  it("renders nothing for local-mode operators", () => {
    const { container } = render(
      <AccountWorkspaceCards
        activeWorkspaceName="Atlas Local"
        hasPendingInvitations={true}
        isLocal={true}
        needsWorkspace={true}
      />,
    );

    expect(container.textContent).toBe("");
  });

  it("renders all three cards when workspace is needed, invitations pending, and an active workspace exists", () => {
    render(
      <AccountWorkspaceCards
        activeWorkspaceName="Atlas Team"
        hasPendingInvitations={true}
        isLocal={false}
        needsWorkspace={true}
      />,
    );

    expect(screen.getByText("Workspace setup is waiting")).not.toBeNull();
    expect(screen.getByText("Workspace invitations waiting")).not.toBeNull();
    expect(screen.getByText("Current workspace")).not.toBeNull();
    expect(screen.getByText("Atlas Team")).not.toBeNull();
  });

  it("hides the workspace-needed and pending-invitation cards when the operator is fully onboarded", () => {
    render(
      <AccountWorkspaceCards
        activeWorkspaceName={null}
        hasPendingInvitations={false}
        isLocal={false}
        needsWorkspace={false}
      />,
    );

    expect(screen.queryByText("Workspace setup is waiting")).toBeNull();
    expect(screen.queryByText("Workspace invitations waiting")).toBeNull();
    expect(screen.queryByText("Current workspace")).toBeNull();
  });
});

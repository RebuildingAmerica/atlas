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
  it("renders nothing in local mode", () => {
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

  it("renders workspace and invitation rows", () => {
    render(
      <AccountWorkspaceCards
        activeWorkspaceName="Atlas Team"
        hasPendingInvitations={true}
        isLocal={false}
        needsWorkspace={true}
      />,
    );

    expect(screen.getByRole("heading", { name: "Workspace" })).not.toBeNull();
    expect(screen.getByText("Atlas Team")).not.toBeNull();
    expect(screen.getByText("Invitations")).not.toBeNull();
    expect(screen.getByText("Pending")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Manage" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Review" })).not.toBeNull();
  });

  it("renders setup state when no workspace is active", () => {
    render(
      <AccountWorkspaceCards
        activeWorkspaceName={null}
        hasPendingInvitations={false}
        isLocal={false}
        needsWorkspace={true}
      />,
    );

    expect(screen.getByRole("heading", { name: "Workspace" })).not.toBeNull();
    expect(screen.getByText("Not set")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open" })).not.toBeNull();
  });

  it("renders nothing when no workspace state needs attention", () => {
    const { container } = render(
      <AccountWorkspaceCards
        activeWorkspaceName={null}
        hasPendingInvitations={false}
        isLocal={false}
        needsWorkspace={false}
      />,
    );

    expect(container.textContent).toBe("");
  });
});

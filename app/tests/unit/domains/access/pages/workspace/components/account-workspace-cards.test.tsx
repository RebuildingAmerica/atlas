// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountProfileSection } from "@/domains/access/pages/workspace/components/account/profile";

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

describe("AccountProfileSection", () => {
  it("keeps workspace context out of local mode", () => {
    render(
      <AccountProfileSection
        activeWorkspaceName="Atlas Local"
        email="person@atlas.test"
        hasPendingInvitations={true}
        isLocal={true}
        name="Willie"
        needsWorkspace={true}
      />,
    );

    expect(screen.getByRole("heading", { name: "Profile" })).not.toBeNull();
    expect(screen.getByText("Personal details")).not.toBeNull();
    expect(screen.queryByText("Workspace context")).toBeNull();
  });

  it("renders workspace and invitation context", () => {
    render(
      <AccountProfileSection
        activeWorkspaceName="Atlas Team"
        email="person@atlas.test"
        hasPendingInvitations={true}
        isLocal={false}
        name="Willie"
        needsWorkspace={true}
      />,
    );

    expect(screen.getByRole("heading", { name: "Profile" })).not.toBeNull();
    expect(screen.getByText("Workspace context")).not.toBeNull();
    expect(screen.getByText("Atlas Team")).not.toBeNull();
    expect(screen.getByText("Invitations")).not.toBeNull();
    expect(screen.getByText("Pending")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Manage" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Review" })).not.toBeNull();
  });

  it("renders setup state when no workspace is active", () => {
    render(
      <AccountProfileSection
        activeWorkspaceName={null}
        email="person@atlas.test"
        hasPendingInvitations={false}
        isLocal={false}
        name="Willie"
        needsWorkspace={true}
      />,
    );

    expect(screen.getByText("Workspace context")).not.toBeNull();
    expect(screen.getByText("Not set")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open" })).not.toBeNull();
  });

  it("renders personal details when no workspace state needs attention", () => {
    render(
      <AccountProfileSection
        activeWorkspaceName={null}
        email="person@atlas.test"
        hasPendingInvitations={false}
        isLocal={false}
        name={null}
        needsWorkspace={false}
      />,
    );

    expect(screen.getByText("Personal details")).not.toBeNull();
    expect(screen.getByText("Not set")).not.toBeNull();
    expect(screen.queryByText("Workspace context")).toBeNull();
  });
});

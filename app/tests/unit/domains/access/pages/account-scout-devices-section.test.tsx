// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountScoutDevicesSection } from "@/domains/access/pages/workspace/components/account-scout-devices-section";

vi.mock("lucide-react", () => {
  const makeIcon = (label: string) => () => <span>{label}</span>;

  return {
    MonitorUp: makeIcon("MonitorUp"),
    Trash2: makeIcon("Trash2"),
  };
});

vi.mock("@/platform/ui/button", () => ({
  Button: ({
    ariaLabel,
    children,
    disabled,
    onClick,
    type = "button",
  }: {
    ariaLabel?: string;
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("AccountScoutDevicesSection", () => {
  it("renders enrolled Scout devices and revokes one", () => {
    const onRevoke = vi.fn();

    render(
      <AccountScoutDevicesSection
        devices={[
          {
            createdAt: "2026-07-04T16:00:00.000Z",
            defaultUploadTarget: "workspace",
            id: "worker-123",
            lastSeenAt: "2026-07-04T17:15:00.000Z",
            revokedAt: null,
            searchKeyConfigured: true,
            workerName: "Willie's MacBook Pro",
            workspaceId: "org-123",
          },
          {
            createdAt: "2026-07-04T16:05:00.000Z",
            defaultUploadTarget: "public",
            id: "worker-456",
            lastSeenAt: "2026-07-04T17:00:00.000Z",
            revokedAt: null,
            searchKeyConfigured: false,
            workerName: "Studio desktop",
            workspaceId: null,
          },
        ]}
        isError={false}
        isRevokePending={false}
        onRevoke={onRevoke}
      />,
    );

    expect(screen.getByText("Willie's MacBook Pro")).not.toBeNull();
    expect(screen.getByText("Studio desktop")).not.toBeNull();
    expect(screen.getByText("Workspace uploads")).not.toBeNull();
    expect(screen.getByText("Public uploads")).not.toBeNull();
    expect(screen.getByText("Search enabled")).not.toBeNull();
    expect(screen.getByText("Search key needed")).not.toBeNull();

    const firstRevokeButton = screen.getAllByRole("button", { name: /Revoke device/i }).at(0);
    if (!firstRevokeButton) {
      throw new Error("Expected at least one revoke device button.");
    }
    fireEvent.click(firstRevokeButton);

    expect(onRevoke).toHaveBeenCalledWith("worker-123");
  });

  it("renders empty and error states", () => {
    const { rerender } = render(
      <AccountScoutDevicesSection
        devices={[]}
        isError={true}
        isRevokePending={false}
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.getByText("Could not load Scout devices.")).not.toBeNull();
    expect(screen.getByText("Unavailable")).not.toBeNull();
    expect(screen.queryByText("No Scout devices.")).toBeNull();

    rerender(
      <AccountScoutDevicesSection
        devices={[]}
        isError={false}
        isRevokePending={false}
        onRevoke={vi.fn()}
      />,
    );

    expect(screen.getByText("No Scout devices.")).not.toBeNull();
  });
});

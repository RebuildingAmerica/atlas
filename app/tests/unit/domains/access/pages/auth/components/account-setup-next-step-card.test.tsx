// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountSetupNextStepCard } from "@/domains/access/pages/auth/components/account-setup-next-step-card";

vi.mock("@rebuildingamerica/atlas-ui/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("AccountSetupNextStepCard", () => {
  it("calls onRefresh and onSignOut when the buttons are clicked", () => {
    const onRefresh = vi.fn();
    const onSignOut = vi.fn();
    render(
      <AccountSetupNextStepCard
        isRefreshing={false}
        isSignOutPending={false}
        onRefresh={onRefresh}
        onSignOut={onSignOut}
      />,
    );

    fireEvent.click(screen.getByText("Refresh status"));
    fireEvent.click(screen.getByText("Sign out"));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("renders the pending labels for both actions", () => {
    render(
      <AccountSetupNextStepCard
        isRefreshing={true}
        isSignOutPending={true}
        onRefresh={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    expect(screen.getByText("Refreshing...")).not.toBeNull();
    expect(screen.getByText("Signing out...")).not.toBeNull();
  });
});

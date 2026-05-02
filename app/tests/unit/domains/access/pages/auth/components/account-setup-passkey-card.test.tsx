// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountSetupPasskeyCard } from "@/domains/access/pages/auth/components/account-setup-passkey-card";

vi.mock("@/platform/ui/button", () => ({
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

describe("AccountSetupPasskeyCard", () => {
  it("uses the email-not-verified heading and disables the continue-without action", () => {
    const onAddPasskey = vi.fn();
    const onContinueWithoutPasskey = vi.fn();
    render(
      <AccountSetupPasskeyCard
        emailVerified={false}
        errorMessage={null}
        isAddPending={false}
        isContinuingWithoutPasskey={false}
        onAddPasskey={onAddPasskey}
        onContinueWithoutPasskey={onContinueWithoutPasskey}
      />,
    );

    expect(screen.getAllByText("Add a passkey").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Continue without a passkey/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Add a passkey/ }));
    expect(onAddPasskey).toHaveBeenCalledTimes(1);
  });

  it("renders the email-verified path with a continue-without-passkey escape hatch", () => {
    const onContinueWithoutPasskey = vi.fn();
    render(
      <AccountSetupPasskeyCard
        emailVerified={true}
        errorMessage="Atlas could not register that passkey."
        isAddPending={true}
        isContinuingWithoutPasskey={false}
        onAddPasskey={vi.fn()}
        onContinueWithoutPasskey={onContinueWithoutPasskey}
      />,
    );

    expect(screen.getByText("Almost there — add a passkey or skip")).not.toBeNull();
    expect(screen.getByText("Adding passkey...")).not.toBeNull();
    expect(screen.getByText("Atlas could not register that passkey.")).not.toBeNull();

    fireEvent.click(screen.getByText(/Continue without a passkey/));
    expect(onContinueWithoutPasskey).toHaveBeenCalledTimes(1);
  });

  it("renders the continuing-pending state on the escape-hatch button", () => {
    render(
      <AccountSetupPasskeyCard
        emailVerified={true}
        errorMessage={null}
        isAddPending={false}
        isContinuingWithoutPasskey={true}
        onAddPasskey={vi.fn()}
        onContinueWithoutPasskey={vi.fn()}
      />,
    );

    expect(screen.getByText("Continuing...")).not.toBeNull();
  });
});

// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountSetupPasskeyCard } from "@/domains/access/pages/auth/components/account-setup-passkey-card";

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

describe("AccountSetupPasskeyCard", () => {
  it("uses the email-not-verified heading and omits the continue-without action", () => {
    const onAddPasskey = vi.fn();
    render(
      <AccountSetupPasskeyCard
        emailVerified={false}
        errorMessage={null}
        isAddPending={false}
        onAddPasskey={onAddPasskey}
      />,
    );

    expect(screen.getAllByText("Add a passkey").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Continue without a passkey/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Add a passkey/ }));
    expect(onAddPasskey).toHaveBeenCalledTimes(1);
  });

  it("renders the email-verified path without a continue-without-passkey escape hatch", () => {
    render(
      <AccountSetupPasskeyCard
        emailVerified={true}
        errorMessage="Atlas could not register that passkey."
        isAddPending={true}
        onAddPasskey={vi.fn()}
      />,
    );

    expect(screen.getByText("Almost there — add a passkey")).not.toBeNull();
    expect(screen.getByText("Adding passkey...")).not.toBeNull();
    expect(screen.getByText("Atlas could not register that passkey.")).not.toBeNull();
    expect(screen.queryByText(/Continue without a passkey/)).toBeNull();
  });
});

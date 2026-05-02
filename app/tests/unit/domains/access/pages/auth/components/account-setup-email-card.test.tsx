// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountSetupEmailCard } from "@/domains/access/pages/auth/components/account-setup-email-card";

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

describe("AccountSetupEmailCard", () => {
  it("renders the verification CTA and calls onSend", () => {
    const onSend = vi.fn();
    render(
      <AccountSetupEmailCard
        email="ops@atlas.test"
        isError={false}
        isPending={false}
        isSent={false}
        onSend={onSend}
      />,
    );

    expect(screen.getByText(/ops@atlas.test/)).not.toBeNull();
    fireEvent.click(screen.getByText("Send verification email"));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("renders the pending and sent feedback states", () => {
    render(
      <AccountSetupEmailCard
        email="ops@atlas.test"
        isError={false}
        isPending={true}
        isSent={true}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByText("Sending verification...")).not.toBeNull();
    expect(screen.getByText("Verification email sent.")).not.toBeNull();
  });

  it("renders the error feedback when send fails", () => {
    render(
      <AccountSetupEmailCard
        email="ops@atlas.test"
        isError={true}
        isPending={false}
        isSent={false}
        onSend={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Atlas could not send the verification email right now."),
    ).not.toBeNull();
  });
});

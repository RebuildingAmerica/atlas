// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignInPasskeyButton } from "@/domains/access/pages/auth/components/sign-in-passkey-button";

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

describe("SignInPasskeyButton", () => {
  it("renders the idle CTA and forwards clicks", () => {
    const onClick = vi.fn();
    render(<SignInPasskeyButton isLastUsed={false} isPending={false} onClick={onClick} />);

    fireEvent.click(screen.getByText("Sign in with passkey"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Last used")).toBeNull();
  });

  it("renders the pending label and the last-used badge when the props are set", () => {
    render(<SignInPasskeyButton isLastUsed={true} isPending={true} onClick={vi.fn()} />);

    expect(screen.getByText("Waiting for passkey...")).not.toBeNull();
    const lastUsedBadge = screen.getByText("Last used");
    expect(lastUsedBadge).not.toBeNull();
    expect(lastUsedBadge.className.split(/\s+/)).not.toContain("absolute");
  });
});

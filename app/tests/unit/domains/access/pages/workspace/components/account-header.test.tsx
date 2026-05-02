// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountHeader } from "@/domains/access/pages/workspace/components/account-header";

vi.mock("@/platform/ui/button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("AccountHeader", () => {
  it("falls back to the email when the operator's name is missing", () => {
    render(
      <AccountHeader
        email="ops@atlas.test"
        isLocal={true}
        name={undefined}
        rpLogoutAvailable={null}
        onSignOut={vi.fn()}
      />,
    );

    // When local mode is on, no sign-out button should render.
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
    expect(screen.getAllByText("ops@atlas.test").length).toBeGreaterThan(0);
  });

  it("renders the IdP-aware caption when rpLogoutAvailable is true", () => {
    render(
      <AccountHeader
        email="ops@atlas.test"
        isLocal={false}
        name="Operator"
        rpLogoutAvailable={true}
        onSignOut={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Atlas will also sign you out of your identity provider."),
    ).not.toBeNull();
  });

  it("renders the IdP stay-active caption when rpLogoutAvailable is false", () => {
    render(
      <AccountHeader
        email="ops@atlas.test"
        isLocal={false}
        name="Operator"
        rpLogoutAvailable={false}
        onSignOut={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Your identity provider session may stay active until it expires on its own.",
      ),
    ).not.toBeNull();
  });

  it("forwards click events to onSignOut", () => {
    const onSignOut = vi.fn();
    render(
      <AccountHeader
        email="ops@atlas.test"
        isLocal={false}
        name="Operator"
        rpLogoutAvailable={null}
        onSignOut={onSignOut}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

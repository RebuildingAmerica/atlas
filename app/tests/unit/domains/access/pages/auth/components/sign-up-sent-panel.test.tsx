// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignUpSentPanel } from "@/domains/access/pages/auth/components/sign-up-sent-panel";

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

vi.mock("@/domains/access/pages/auth/dev-mail-capture-banner", () => ({
  DevMailCaptureBanner: ({ url }: { url: string }) => (
    <div data-testid="dev-mail-banner">{url}</div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SignUpSentPanel", () => {
  it("renders the active expiry countdown and a disabled resend during the cooldown", () => {
    render(
      <SignUpSentPanel
        captureMailboxUrl="http://localhost:1080"
        email="ops@atlas.test"
        isResending={false}
        isTeamSso={false}
        resendStatus="Sent. Check your inbox."
        secondsUntilExpiry={304}
        secondsUntilResend={29}
        onResend={vi.fn()}
        onUseDifferentEmail={vi.fn()}
      />,
    );

    expect(screen.getByText(/Link expires in 5:04/)).not.toBeNull();
    expect(screen.getByText("Sent. Check your inbox.")).not.toBeNull();
    expect(screen.getByTestId("dev-mail-banner")).not.toBeNull();
    const resend = screen.getByRole("button", { name: /Resend in 29s/ });
    expect(resend).toBeInstanceOf(HTMLButtonElement);
    if (resend instanceof HTMLButtonElement) {
      expect(resend.disabled).toBe(true);
    }
  });

  it("renders the expired-link copy and the resending label when the link has lapsed and a resend is in flight", () => {
    render(
      <SignUpSentPanel
        captureMailboxUrl={null}
        email="ops@atlas.test"
        isResending={true}
        isTeamSso={true}
        resendStatus={null}
        secondsUntilExpiry={0}
        secondsUntilResend={0}
        onResend={vi.fn()}
        onUseDifferentEmail={vi.fn()}
      />,
    );

    expect(screen.getByText(/Link expired — request a new one below./)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Resending..." })).not.toBeNull();
    expect(screen.queryByTestId("dev-mail-banner")).toBeNull();
    expect(screen.getByText("Atlas Team")).not.toBeNull();
  });

  it("triggers onResend and onUseDifferentEmail callbacks", () => {
    const onResend = vi.fn();
    const onUseDifferentEmail = vi.fn();
    render(
      <SignUpSentPanel
        captureMailboxUrl={null}
        email="ops@atlas.test"
        isResending={false}
        isTeamSso={false}
        resendStatus={null}
        secondsUntilExpiry={120}
        secondsUntilResend={0}
        onResend={onResend}
        onUseDifferentEmail={onUseDifferentEmail}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resend link" }));
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));

    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onUseDifferentEmail).toHaveBeenCalledTimes(1);
  });
});

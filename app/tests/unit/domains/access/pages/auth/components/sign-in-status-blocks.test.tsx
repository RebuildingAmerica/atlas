// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SignInStatusBlocks } from "@/domains/access/pages/auth/components/sign-in-status-blocks";

vi.mock("@/domains/access/pages/auth/dev-mail-capture-banner", () => ({
  DevMailCaptureBanner: ({ url }: { url: string }) => (
    <div data-testid="dev-mail-banner">{url}</div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SignInStatusBlocks", () => {
  it("renders only the status message when no other props are set", () => {
    render(
      <SignInStatusBlocks
        captureMailboxUrl={null}
        errorCode={undefined}
        errorMessage={null}
        oauthOriginSignIn={false}
        ssoErrorMessage={null}
        statusMessage="A sign-in link is on the way."
      />,
    );
    expect(screen.getByText("A sign-in link is on the way.")).not.toBeNull();
    expect(screen.queryByTestId("dev-mail-banner")).toBeNull();
  });

  it("renders the dev-mail banner and the OAuth-origin block when both flags are set with a status message", () => {
    render(
      <SignInStatusBlocks
        captureMailboxUrl="http://localhost:1080"
        errorCode={undefined}
        errorMessage={null}
        oauthOriginSignIn={true}
        ssoErrorMessage={null}
        statusMessage="A sign-in link is on the way."
      />,
    );
    expect(screen.getByTestId("dev-mail-banner")).not.toBeNull();
    expect(screen.getByText(/Connecting an MCP client/)).not.toBeNull();
  });

  it("renders the magic-link error message and the SSO failure block with the reference code", () => {
    render(
      <SignInStatusBlocks
        captureMailboxUrl={null}
        errorCode="missing_provider"
        errorMessage="Atlas could not send the link."
        oauthOriginSignIn={false}
        ssoErrorMessage="No identity provider matched your email."
        statusMessage={null}
      />,
    );
    expect(screen.getByText("Atlas could not send the link.")).not.toBeNull();
    expect(screen.getByText(/No identity provider matched your email/)).not.toBeNull();
    expect(screen.getByText("missing_provider")).not.toBeNull();
  });

  it("falls back to the generic SSO failure copy when no ssoErrorMessage is provided", () => {
    render(
      <SignInStatusBlocks
        captureMailboxUrl={null}
        errorCode="unknown"
        errorMessage={null}
        oauthOriginSignIn={false}
        ssoErrorMessage={null}
        statusMessage={null}
      />,
    );
    expect(screen.getByText(/Atlas couldn't complete the SSO sign-in/)).not.toBeNull();
  });
});

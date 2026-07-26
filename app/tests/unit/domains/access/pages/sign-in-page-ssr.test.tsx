import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SignInPage } from "@/domains/access/pages/auth/sign-in-page";

const mocks = vi.hoisted(() => ({
  getAuthClient: vi.fn(),
  getAuthConfig: vi.fn(),
  readLastUsedAtlasEmail: vi.fn(),
}));

vi.mock("@/domains/access/client/auth-client", () => ({
  getAuthClient: mocks.getAuthClient,
}));

vi.mock("@/domains/access/config", () => ({
  getAuthConfig: mocks.getAuthConfig,
}));

vi.mock("@/domains/access/session.functions", () => ({
  requestMagicLink: vi.fn(),
}));

vi.mock("@/domains/access/sso.functions", () => ({
  resolveWorkspaceSSOSignIn: vi.fn(),
}));

vi.mock("@/domains/access/client/session-confirmation", () => ({
  waitForAtlasAuthenticatedSession: vi.fn(),
}));

vi.mock("@/domains/access/client/last-login-method", () => ({
  setLastUsedAtlasLoginMethod: vi.fn(),
}));

vi.mock("@/domains/access/client/last-used-email", () => ({
  rememberLastUsedAtlasEmail: vi.fn(),
  readLastUsedAtlasEmail: mocks.readLastUsedAtlasEmail,
}));

vi.mock("@/domains/access/client/sso-diagnostics-log", () => ({
  recordSsoDiagnostics: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("SignInPage SSR", () => {
  it("does not render browser-only remembered sign-in state into server markup", () => {
    mocks.getAuthClient.mockReturnValue({
      getLastUsedLoginMethod: vi.fn(() => "magic-link"),
      signIn: {
        passkey: vi.fn(),
        sso: vi.fn(),
      },
    });
    mocks.getAuthConfig.mockReturnValue({ localMode: false, authBasePath: "/api/auth" });
    mocks.readLastUsedAtlasEmail.mockReturnValue("stored@example.com");

    const markup = renderToString(<SignInPage />);

    expect(markup).toContain("Sign in to Atlas");
    expect(markup).not.toContain("stored@example.com");
    expect(markup).not.toContain("Last used");
  });
});

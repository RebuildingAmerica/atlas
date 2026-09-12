// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SignInPage } from "@/domains/access/pages/auth/sign-in-page";
import {
  clearSsoDiagnostics,
  readSsoDiagnostics,
} from "@/domains/access/client/sso-diagnostics-log";

const mocks = vi.hoisted(() => ({
  requestMagicLink: vi.fn(),
  resolveWorkspaceSSOSignIn: vi.fn(),
  waitForAtlasAuthenticatedSession: vi.fn(),
  setLastUsedAtlasLoginMethod: vi.fn(),
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
  requestMagicLink: mocks.requestMagicLink,
}));

vi.mock("@/domains/access/sso.functions", () => ({
  resolveWorkspaceSSOSignIn: mocks.resolveWorkspaceSSOSignIn,
}));

vi.mock("@/domains/access/client/session-confirmation", () => ({
  waitForAtlasAuthenticatedSession: mocks.waitForAtlasAuthenticatedSession,
}));

vi.mock("@/domains/access/client/last-login-method", () => ({
  setLastUsedAtlasLoginMethod: mocks.setLastUsedAtlasLoginMethod,
}));

vi.mock("@/domains/access/client/last-used-email", () => ({
  rememberLastUsedAtlasEmail: vi.fn(),
  readLastUsedAtlasEmail: mocks.readLastUsedAtlasEmail,
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("SignInPage", () => {
  const authClient = {
    getLastUsedLoginMethod: vi.fn(),
    signIn: {
      passkey: vi.fn(),
      sso: vi.fn(),
    },
  };

  const originalLocation = window.location;
  const mockLocationAssign = vi.fn();

  function revealEmailFallback(): HTMLFormElement {
    fireEvent.click(screen.getByRole("button", { name: /Can't use a passkey/i }));
    const form = screen.getByRole("button", { name: /Continue with email/i }).closest("form");
    if (!form) throw new Error("Expected form element");
    return form;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthClient.mockReturnValue(authClient);
    mocks.getAuthConfig.mockReturnValue({ localMode: false, authBasePath: "/api/auth" });
    mocks.readLastUsedAtlasEmail.mockReturnValue(null);
    authClient.getLastUsedLoginMethod.mockReturnValue(null);

    // Direct result mocks bypassing createServerFn complications
    mocks.resolveWorkspaceSSOSignIn.mockResolvedValue(null);
    mocks.requestMagicLink.mockResolvedValue({ ok: true });
    mocks.waitForAtlasAuthenticatedSession.mockResolvedValue({});

    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign: mockLocationAssign },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it("redirects to the SSO provider when resolveWorkspaceSSOSignIn returns a match", async () => {
    mocks.resolveWorkspaceSSOSignIn.mockResolvedValue({
      organizationName: "Acme",
      providerId: "provider_acme",
      providerType: "oidc",
    });
    authClient.signIn.sso.mockResolvedValue({
      data: { url: "https://idp.acme.test/login" },
    });

    render(<SignInPage initialEmail="ops@acme.test" />);
    const form = revealEmailFallback();
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(authClient.signIn.sso).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockLocationAssign).toHaveBeenCalledWith("https://idp.acme.test/login");
    });
  });

  it("uses a generic organization label when SSO resolution omits the name", async () => {
    mocks.resolveWorkspaceSSOSignIn.mockResolvedValue({
      organizationName: null,
      providerId: "provider_acme",
      providerType: "oidc",
    });
    authClient.signIn.sso.mockResolvedValue({ data: { url: null } });

    render(<SignInPage initialEmail="ops@acme.test" />);
    const form = revealEmailFallback();
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(screen.getByText(/Redirecting to your organization's sign-in/)).toBeInTheDocument();
    });
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it("explains a failed SSO round trip and keeps a local record for triage", async () => {
    clearSsoDiagnostics();

    render(<SignInPage errorCode="certificate_invalid" initialEmail="ops@acme.test" />);

    expect(
      await screen.findByText(/Atlas could not validate the IdP signing certificate/),
    ).toBeInTheDocument();
    expect(readSsoDiagnostics()[0]).toMatchObject({
      code: "certificate_invalid",
      email: "ops@acme.test",
    });
  });

  it("records an unrecognised SSO error code even without an email to attribute it to", async () => {
    clearSsoDiagnostics();

    render(<SignInPage errorCode="mystery_failure" />);

    await vi.waitFor(() => {
      expect(readSsoDiagnostics()[0]).toMatchObject({
        code: "mystery_failure",
        email: null,
        message: null,
      });
    });
  });
});

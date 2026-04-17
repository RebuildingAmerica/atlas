// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { signInPageDependencyMocks } from "../../../../mocks/access/sign-in-page-dependencies";
import { TestButton, TestInput } from "../../../../utils/ui-stubs";

vi.mock("@/platform/ui/button", () => ({
  Button: TestButton,
}));

vi.mock("@/platform/ui/input", () => ({
  Input: TestInput,
}));

vi.mock("@/domains/access/config", () => ({
  getAuthConfig: signInPageDependencyMocks.getAuthConfig,
}));

vi.mock("@/domains/access/client/auth-client", () => ({
  getAuthClient: signInPageDependencyMocks.getAuthClient,
}));

vi.mock("@/domains/access/client/last-login-method", () => ({
  setLastUsedAtlasLoginMethod: signInPageDependencyMocks.setLastUsedAtlasLoginMethod,
}));

vi.mock("@/domains/access/client/session-confirmation", () => ({
  waitForAtlasAuthenticatedSession: signInPageDependencyMocks.waitForAtlasAuthenticatedSession,
}));

vi.mock("@/domains/access/session.functions", () => ({
  requestMagicLink: signInPageDependencyMocks.requestMagicLink,
}));

vi.mock("@/domains/access/sso.functions", () => ({
  resolveWorkspaceSSOSignIn: signInPageDependencyMocks.resolveWorkspaceSSOSignIn,
}));

afterEach(() => {
  cleanup();
});

/**
 * Loads and renders the sign-in page under test.
 *
 * @param props - Optional sign-in page props.
 */
async function renderSignInPage(
  props: {
    invitationId?: string;
    redirectTo?: string;
  } = {},
) {
  const signInPageModule = await import("@/domains/access/pages/sign-in-page");
  const { SignInPage } = signInPageModule;

  return render(<SignInPage {...props} />);
}

describe("SignInPage", () => {
  const originalPublicKeyCredential = globalThis.PublicKeyCredential;
  const originalWindow = globalThis.window;
  let assignMock: ReturnType<typeof vi.fn>;
  let passkeySignIn: ReturnType<typeof vi.fn>;
  let ssoSignIn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();

    signInPageDependencyMocks.getAuthClient.mockReset();
    signInPageDependencyMocks.getAuthConfig.mockReset();
    signInPageDependencyMocks.requestMagicLink.mockReset();
    signInPageDependencyMocks.resolveWorkspaceSSOSignIn.mockReset();
    signInPageDependencyMocks.setLastUsedAtlasLoginMethod.mockReset();
    signInPageDependencyMocks.waitForAtlasAuthenticatedSession.mockReset();

    passkeySignIn = vi.fn().mockResolvedValue({});
    ssoSignIn = vi.fn().mockResolvedValue({});

    signInPageDependencyMocks.getAuthConfig.mockReturnValue({
      localMode: false,
    });
    signInPageDependencyMocks.getAuthClient.mockReturnValue({
      getLastUsedLoginMethod: vi.fn().mockReturnValue("magic-link"),
      signIn: {
        passkey: passkeySignIn,
        sso: ssoSignIn,
      },
    });
    signInPageDependencyMocks.requestMagicLink.mockResolvedValue(undefined);
    signInPageDependencyMocks.resolveWorkspaceSSOSignIn.mockResolvedValue(null);
    signInPageDependencyMocks.waitForAtlasAuthenticatedSession.mockResolvedValue(undefined);

    assignMock = vi.fn();

    const testWindow = Object.create(originalWindow) as Window & typeof globalThis;

    Object.defineProperty(testWindow, "location", {
      configurable: true,
      value: { assign: assignMock },
    });

    vi.stubGlobal("window", testWindow);
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: originalPublicKeyCredential,
    });
  });

  it("renders the local-mode notice when auth is disabled", async () => {
    signInPageDependencyMocks.getAuthConfig.mockReturnValue({
      localMode: true,
    });

    await renderSignInPage();

    expect(screen.getByText("Local mode is active")).not.toBeNull();
  });

  it("falls back to magic link when no enterprise provider matches the email", async () => {
    await renderSignInPage({
      redirectTo: "/account",
    });

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "operator@atlas.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));

    await waitFor(() => {
      expect(signInPageDependencyMocks.resolveWorkspaceSSOSignIn).toHaveBeenCalledWith({
        data: {
          email: "operator@atlas.test",
          invitationId: undefined,
        },
      });
      expect(signInPageDependencyMocks.requestMagicLink).toHaveBeenCalledWith({
        data: {
          callbackURL: "/account",
          email: "operator@atlas.test",
        },
      });
      expect(signInPageDependencyMocks.setLastUsedAtlasLoginMethod).toHaveBeenCalledWith(
        "magic-link",
      );
    });

    expect(
      screen.getByText("If the email can access Atlas, a sign-in link is on the way."),
    ).not.toBeNull();
    expect(ssoSignIn).not.toHaveBeenCalled();
  });

  it("routes matching invitation sign-in attempts through enterprise SSO", async () => {
    signInPageDependencyMocks.resolveWorkspaceSSOSignIn.mockResolvedValue({
      organizationName: "Policy Desk",
      organizationSlug: "policy-desk",
      providerId: "policy-desk-google-saml",
      providerType: "saml",
    });

    await renderSignInPage({
      invitationId: "invite_123",
    });

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@policy.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));

    await waitFor(() => {
      expect(ssoSignIn).toHaveBeenCalledWith({
        callbackURL: "/organization",
        email: "owner@policy.example",
        errorCallbackURL: "/sign-in?invitation=invite_123",
        loginHint: "owner@policy.example",
        providerId: "policy-desk-google-saml",
        providerType: "saml",
      });
    });

    expect(signInPageDependencyMocks.requestMagicLink).not.toHaveBeenCalled();
    expect(screen.getByText("Redirecting to Policy Desk sign-in...")).not.toBeNull();
  });

  it("redirects when the Better Auth SSO client returns a URL explicitly", async () => {
    signInPageDependencyMocks.resolveWorkspaceSSOSignIn.mockResolvedValue({
      organizationName: "Policy Desk",
      organizationSlug: "policy-desk",
      providerId: "policy-desk-google-oidc",
      providerType: "oidc",
    });
    ssoSignIn.mockResolvedValue({
      data: {
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc",
      },
    });

    await renderSignInPage();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@policy.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc",
      );
    });
  });

  it("shows passkey errors from explicit sign-in attempts", async () => {
    passkeySignIn.mockResolvedValue({
      error: { message: "No matching passkey" },
    });
    signInPageDependencyMocks.getAuthClient.mockReturnValue({
      getLastUsedLoginMethod: vi.fn().mockReturnValue("passkey"),
      signIn: {
        passkey: passkeySignIn,
        sso: ssoSignIn,
      },
    });

    await renderSignInPage({
      redirectTo: "/discovery",
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign in with passkey" }));

    await waitFor(() => {
      expect(screen.getByText("No matching passkey")).not.toBeNull();
    });
  });

  it("redirects after a successful explicit passkey sign-in", async () => {
    await renderSignInPage({
      redirectTo: "/discovery",
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign in with passkey" }));

    await waitFor(() => {
      expect(passkeySignIn).toHaveBeenCalledTimes(1);
      expect(signInPageDependencyMocks.waitForAtlasAuthenticatedSession).toHaveBeenCalledTimes(1);
      expect(signInPageDependencyMocks.setLastUsedAtlasLoginMethod).toHaveBeenCalledWith("passkey");
      expect(assignMock).toHaveBeenCalledWith("/discovery");
    });
  });

  it("uses conditional mediation autofill when the browser supports it", async () => {
    passkeySignIn.mockImplementation(((input?: {
      autoFill?: boolean;
      fetchOptions?: {
        onSuccess?: () => Promise<void>;
      };
    }) => {
      const onSuccess = input?.fetchOptions?.onSuccess;

      if (onSuccess) {
        return onSuccess().then(() => ({}));
      }

      return Promise.resolve({});
    }) as (...args: unknown[]) => unknown);

    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: {
        isConditionalMediationAvailable: vi.fn().mockResolvedValue(true),
      },
    });

    await renderSignInPage({
      redirectTo: "/account",
    });

    await waitFor(() => {
      expect(passkeySignIn).toHaveBeenCalledWith({
        autoFill: true,
        fetchOptions: {
          onSuccess: expect.any(Function) as unknown,
        },
      });
      expect(signInPageDependencyMocks.waitForAtlasAuthenticatedSession).toHaveBeenCalledTimes(1);
      expect(signInPageDependencyMocks.setLastUsedAtlasLoginMethod).toHaveBeenCalledWith("passkey");
      expect(assignMock).toHaveBeenCalledWith("/account");
    });
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SignInPage } from "@/domains/access/pages/auth/sign-in-page";
import {
  stubDeferredPasskeyCredentialApi,
  stubLegacyPasskeyCredentialApi,
  stubPasskeyCredentialApi,
  type PasskeySignInOptions,
} from "./sign-in-page-test-support";

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

  it("handles passkey sign-in", async () => {
    authClient.signIn.passkey.mockResolvedValue({ data: { session: {} } });

    render(<SignInPage />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Sign in with passkey/i));
      await Promise.resolve();
    });

    expect(authClient.signIn.passkey).toHaveBeenCalled();
    expect(mockLocationAssign).toHaveBeenCalled();
  });

  it("forgets a passkey the server no longer knows and explains the dead end", async () => {
    const credentialApi = stubPasskeyCredentialApi(() => Promise.resolve(false));
    authClient.signIn.passkey.mockResolvedValue({
      error: { code: "PASSKEY_NOT_FOUND", message: "no credential" },
      webauthn: { response: { id: "stale-credential" } },
    });

    render(<SignInPage />);

    fireEvent.click(screen.getByRole("button", { name: /Sign in with passkey/i }));

    expect(
      await screen.findByText(
        "This passkey is no longer linked to your account. Please sign in another way.",
      ),
    ).toBeInTheDocument();
    expect(credentialApi.signalUnknownCredential).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: "stale-credential" }),
    );
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it("completes a conditionally autofilled passkey by landing on the post-sign-in destination", async () => {
    stubPasskeyCredentialApi(() => Promise.resolve(true));
    authClient.signIn.passkey.mockImplementation(async (options: PasskeySignInOptions) => {
      await options.fetchOptions?.onSuccess();
      return {};
    });

    render(<SignInPage redirectTo="/workspace/billing" />);

    expect(await screen.findByText("Last used")).toBeInTheDocument();
    expect(mocks.waitForAtlasAuthenticatedSession).toHaveBeenCalled();
    expect(mockLocationAssign).toHaveBeenCalledWith("/workspace/billing");
  });

  it("forgets an autofilled passkey the server rejects without disturbing the page", async () => {
    const credentialApi = stubPasskeyCredentialApi(() => Promise.resolve(true));
    authClient.signIn.passkey.mockImplementation((options: PasskeySignInOptions) => {
      options.fetchOptions?.onError();
      return Promise.resolve({
        error: { code: "PASSKEY_NOT_FOUND" },
        webauthn: { response: { id: "autofilled-credential" } },
      });
    });

    render(<SignInPage />);

    await vi.waitFor(() => {
      expect(credentialApi.signalUnknownCredential).toHaveBeenCalledWith(
        expect.objectContaining({ credentialId: "autofilled-credential" }),
      );
    });
    expect(mockLocationAssign).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /Sign in to Atlas/i })).toBeInTheDocument();
  });

  it("never starts autofill when the browser cannot mediate credentials", async () => {
    const credentialApi = stubPasskeyCredentialApi(() => Promise.resolve(false));

    render(<SignInPage />);

    await vi.waitFor(() => {
      expect(credentialApi.isConditionalMediationAvailable).toHaveBeenCalled();
    });
    expect(authClient.signIn.passkey).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Sign in with passkey/i })).toBeInTheDocument();
  });

  it("never starts autofill on a browser whose WebAuthn API predates conditional mediation", async () => {
    stubLegacyPasskeyCredentialApi();

    render(<SignInPage />);

    await vi.waitFor(() => {
      expect(authClient.getLastUsedLoginMethod).toHaveBeenCalled();
    });
    expect(authClient.signIn.passkey).not.toHaveBeenCalled();
  });

  it("abandons autofill when the operator leaves before the browser answers the probe", async () => {
    const deferred = stubDeferredPasskeyCredentialApi();

    const view = render(<SignInPage />);
    await vi.waitFor(() => {
      expect(deferred.api.isConditionalMediationAvailable).toHaveBeenCalled();
    });
    view.unmount();
    deferred.settle(true);

    await vi.waitFor(() => {
      expect(authClient.signIn.passkey).not.toHaveBeenCalled();
    });
  });

  it("does not navigate when an autofilled credential arrives after the page is gone", async () => {
    stubPasskeyCredentialApi(() => Promise.resolve(true));
    let confirmSession: (() => Promise<void>) | undefined;
    authClient.signIn.passkey.mockImplementation((options: PasskeySignInOptions) => {
      confirmSession = options.fetchOptions?.onSuccess;
      return Promise.resolve({});
    });

    const view = render(<SignInPage />);
    await vi.waitFor(() => {
      expect(confirmSession).toBeDefined();
    });
    view.unmount();
    await confirmSession?.();

    expect(mocks.waitForAtlasAuthenticatedSession).not.toHaveBeenCalled();
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it("stays on the sign-in form when the browser refuses the conditional-mediation probe", async () => {
    const credentialApi = stubPasskeyCredentialApi(() => Promise.reject(new Error("blocked")));

    render(<SignInPage />);

    await vi.waitFor(() => {
      expect(credentialApi.isConditionalMediationAvailable).toHaveBeenCalled();
    });
    expect(screen.getByRole("heading", { name: /Sign in to Atlas/i })).toBeInTheDocument();
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it("reports a cancelled passkey prompt without touching the credential store", async () => {
    const credentialApi = stubPasskeyCredentialApi(() => Promise.resolve(false));
    authClient.signIn.passkey.mockResolvedValue({
      error: { message: "NotAllowedError: the operation was cancelled" },
    });

    render(<SignInPage />);

    fireEvent.click(screen.getByRole("button", { name: /Sign in with passkey/i }));

    expect(await screen.findByText("Passkey authentication was cancelled.")).toBeInTheDocument();
    expect(credentialApi.signalUnknownCredential).not.toHaveBeenCalled();
  });

  it("reports a device that cannot do passkeys at all", async () => {
    const credentialApi = stubPasskeyCredentialApi(() => Promise.resolve(false));
    authClient.signIn.passkey.mockResolvedValue({
      error: { code: "WEBAUTHN_ERROR", message: "NotSupportedError" },
    });

    render(<SignInPage />);

    fireEvent.click(screen.getByRole("button", { name: /Sign in with passkey/i }));

    expect(
      await screen.findByText("Passkeys are not supported on this device or browser."),
    ).toBeInTheDocument();
    expect(credentialApi.signalUnknownCredential).not.toHaveBeenCalled();
  });

  it("explains an unknown passkey it cannot identify well enough to forget", async () => {
    const credentialApi = stubPasskeyCredentialApi(() => Promise.resolve(false));
    authClient.signIn.passkey.mockResolvedValue({ error: { code: "PASSKEY_NOT_FOUND" } });

    render(<SignInPage />);

    fireEvent.click(screen.getByRole("button", { name: /Sign in with passkey/i }));

    expect(
      await screen.findByText(
        "This passkey is no longer linked to your account. Please sign in another way.",
      ),
    ).toBeInTheDocument();
    expect(credentialApi.signalUnknownCredential).not.toHaveBeenCalled();
  });

  it("reports a passkey attempt the browser aborts outright", async () => {
    authClient.signIn.passkey.mockRejectedValue(new Error("NotAllowedError"));

    render(<SignInPage />);

    fireEvent.click(screen.getByRole("button", { name: /Sign in with passkey/i }));

    expect(
      await screen.findByText("Passkey sign-in failed. Please try again."),
    ).toBeInTheDocument();
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });
});

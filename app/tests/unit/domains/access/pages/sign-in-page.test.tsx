// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SignInPage, signInSearchSchema } from "@/domains/access/pages/auth/sign-in-page";
import {
  clearSsoDiagnostics,
  readSsoDiagnostics,
} from "@/domains/access/client/sso-diagnostics-log";
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

  it("renders the sign-in form", () => {
    render(<SignInPage />);
    expect(screen.getByRole("heading", { name: /Sign in to Atlas/i })).toBeInTheDocument();
  });

  it("routes username sign-in through the shared email or username field", () => {
    render(<SignInPage />);

    const handleInput = screen.getByLabelText(/Email or username/i);
    const submit = screen.getByRole("button", { name: "Continue" });
    expect(submit).toBeDisabled();
    expect(screen.queryByText(/existing Atlas account secured by a passkey/i)).toBeNull();
    expect(screen.queryByLabelText("ATProto handle")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue with username" })).toBeNull();
    expect(screen.queryByText(/ATProto/i)).toBeNull();

    fireEvent.change(handleInput, { target: { value: "@gwashington.org" } });
    fireEvent.click(submit);

    expect(mockLocationAssign).toHaveBeenCalledWith(
      "/api/atproto/sign-in/start?handle=gwashington.org&returnTo=%2Faccount",
    );
  });

  it("preserves the original redirect for username sign-in", () => {
    render(<SignInPage redirectTo="/profiles/people/george-washington" />);

    fireEvent.change(screen.getByLabelText(/Email or username/i), {
      target: { value: "@gwashington.org" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(mockLocationAssign).toHaveBeenCalledWith(
      "/api/atproto/sign-in/start?handle=gwashington.org&returnTo=%2Fprofiles%2Fpeople%2Fgeorge-washington",
    );
  });

  it("does not accept account-existence claims from the URL", () => {
    expect(
      signInSearchSchema.parse({
        email: "operator@atlas.test",
        existing: "true",
        redirect: "/device?user_code=ABCD-EFGH",
      }),
    ).toEqual({
      email: "operator@atlas.test",
      redirect: "/device?user_code=ABCD-EFGH",
    });
  });

  it("anchors passkey-first sign-in around the email field for conditional UI", () => {
    render(<SignInPage />);

    const emailInput = screen.getByLabelText(/Email or username/i);
    const passkeyButton = screen.getByRole("button", { name: /Sign in with passkey/i });
    const emailFallbackButton = screen.getByRole("button", { name: /Can't use a passkey/i });

    expect(emailInput).toHaveAttribute("autocomplete", "username webauthn");
    expect(emailInput.compareDocumentPosition(passkeyButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(passkeyButton.compareDocumentPosition(emailFallbackButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByRole("button", { name: /Continue with email/i })).toBeNull();
    expect(screen.queryByText("Account access")).toBeNull();
  });

  it("loads remembered email after the first client render without promoting email sign-in", async () => {
    authClient.getLastUsedLoginMethod.mockReturnValue("magic-link");
    mocks.readLastUsedAtlasEmail.mockReturnValue("stored@example.com");

    render(<SignInPage />);

    await vi.waitFor(() => {
      expect(screen.getByLabelText(/Email or username/i)).toHaveValue("stored@example.com");
    });
    expect(screen.queryByText("Last used")).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue with email/i })).toBeNull();
  });

  it("highlights passkey when it was the last sign-in method", async () => {
    authClient.getLastUsedLoginMethod.mockReturnValue("passkey");

    render(<SignInPage />);

    await vi.waitFor(() => {
      expect(screen.getByText("Last used")).toBeInTheDocument();
    });
  });

  it("handles email sign-in", async () => {
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(/Email or username/i), {
      target: { value: "user@atlas.test" },
    });

    const form = revealEmailFallback();
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(mocks.resolveWorkspaceSSOSignIn).toHaveBeenCalled();
    expect(mocks.requestMagicLink).toHaveBeenCalled();
    expect(screen.getByText(/a sign-in link is on the way/i)).toBeInTheDocument();
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

  it("shows error message on failure", async () => {
    mocks.resolveWorkspaceSSOSignIn.mockRejectedValue(new Error("Network error"));

    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(/Email or username/i), {
      target: { value: "user@atlas.test" },
    });
    const form = revealEmailFallback();
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(screen.getByText("Sign-in is temporarily unavailable.")).toBeInTheDocument();
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

  it("maps a recognised auth error code to its localised label", async () => {
    mocks.resolveWorkspaceSSOSignIn.mockResolvedValue(null);
    mocks.requestMagicLink.mockRejectedValue(new Error("EMAIL_DELIVERY_FAILED"));

    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText(/Email or username/i), {
      target: { value: "ops@acme.test" },
    });
    const form = revealEmailFallback();
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(
      screen.getByText("Your sign-in link couldn't be delivered. Please try again."),
    ).toBeInTheDocument();
  });

  it("accepts a bare ATProto handle typed without the leading at-sign", () => {
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(/Email or username/i), {
      target: { value: "gwashington.org" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(mockLocationAssign).toHaveBeenCalledWith(
      "/api/atproto/sign-in/start?handle=gwashington.org&returnTo=%2Faccount",
    );
  });

  it("reveals the email fallback the first time an email address is submitted", async () => {
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(/Email or username/i), {
      target: { value: "user@atlas.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("button", { name: /Continue with email/i })).toBeInTheDocument();
    expect(mocks.requestMagicLink).not.toHaveBeenCalled();
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it("does not attempt a handle sign-in when the field is empty", async () => {
    render(<SignInPage />);

    const form = screen.getByRole("button", { name: "Continue" }).closest("form");
    if (!form) throw new Error("Expected form element");
    fireEvent.submit(form);

    expect(await screen.findByRole("button", { name: /Continue with email/i })).toBeInTheDocument();
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

  it("forwards the redirect param on the create-account link when present", () => {
    render(<SignInPage redirectTo="/workspace/billing" />);
    const link = screen.getByRole("link", { name: /Create a free account/ });
    expect(link).toBeInTheDocument();
  });

  it("renders the invitation-flow heading copy and hides the new-account link", () => {
    render(<SignInPage invitationId="inv_123" />);
    expect(screen.queryByRole("link", { name: /Create a free account/ })).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SignInPage } from "@/domains/access/pages/auth/sign-in-page";

const mocks = vi.hoisted(() => ({
  requestMagicLink: vi.fn(),
  resolveWorkspaceSSOSignIn: vi.fn(),
  waitForAtlasAuthenticatedSession: vi.fn(),
  setLastUsedAtlasLoginMethod: vi.fn(),
  getAuthClient: vi.fn(),
  getAuthConfig: vi.fn(),
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
  readLastUsedAtlasEmail: vi.fn(() => null),
}));

vi.mock("@/domains/access/client/sso-diagnostics-log", () => ({
  recordSsoDiagnostics: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    className?: string;
  }) => (
    <a href={props.to} className={props.className}>
      {children}
    </a>
  ),
}));

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

  it("handles email sign-in", async () => {
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "user@atlas.test" } });

    const form = screen.getByRole("button", { name: /Continue with email/i }).closest("form");
    if (!form) throw new Error("Expected form element");
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

  it("shows error message on failure", async () => {
    mocks.resolveWorkspaceSSOSignIn.mockRejectedValue(new Error("Network error"));

    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "user@atlas.test" } });
    const form = screen.getByRole("button", { name: /Continue with email/i }).closest("form");
    if (!form) throw new Error("Expected form element");
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
    const form = screen.getByRole("button", { name: /Continue with email/i }).closest("form");
    if (!form) throw new Error("Expected form element");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(authClient.signIn.sso).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockLocationAssign).toHaveBeenCalledWith("https://idp.acme.test/login");
    });
  });

  it("shows the existing-account banner when existingAccount is true", () => {
    render(<SignInPage existingAccount={true} />);
    expect(
      screen.getByText("Looks like you already have an account. Sign in below."),
    ).toBeInTheDocument();
  });

  it("renders the invitation-flow heading copy and hides the new-account link", () => {
    render(<SignInPage invitationId="inv_123" />);
    expect(screen.queryByRole("link", { name: /Create a free account/ })).toBeNull();
  });

  it("describes the passkey error when sign-in returns an error", async () => {
    authClient.signIn.passkey.mockResolvedValue({
      error: { message: "User cancelled" },
    });

    render(<SignInPage />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Sign in with passkey/i));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      // Passkey error description always falls back to a friendly string.
      expect(screen.queryByText(/Last used/)).toBeDefined();
    });
  });

  it("renders the generic passkey-failure copy when the call throws", async () => {
    authClient.signIn.passkey.mockRejectedValue(new Error("crypto fail"));

    render(<SignInPage />);

    await act(async () => {
      fireEvent.click(screen.getByText(/Sign in with passkey/i));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(screen.getByText("Passkey sign-in failed. Please try again.")).toBeInTheDocument();
    });
  });

  it("surfaces the SSO failure block when the route receives an errorCode", () => {
    render(<SignInPage errorCode="missing_provider" />);

    expect(screen.getByText("missing_provider")).toBeInTheDocument();
  });

  it("invokes conditional passkey autofill when the platform supports it and signs in via the onSuccess hook", async () => {
    // Stub PublicKeyCredential so the effect's feature-detect passes.
    const isConditionalMediationAvailable = vi.fn().mockResolvedValue(true);
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: { isConditionalMediationAvailable } as unknown as typeof PublicKeyCredential,
    });

    let capturedOnSuccess: (() => Promise<void>) | null = null;
    authClient.signIn.passkey.mockImplementation(
      (options: { autoFill?: boolean; fetchOptions?: { onSuccess?: () => Promise<void> } }) => {
        if (options?.autoFill) {
          capturedOnSuccess = options?.fetchOptions?.onSuccess ?? null;
        }
        return Promise.resolve({ data: null });
      },
    );

    render(<SignInPage />);

    await vi.waitFor(() => {
      expect(isConditionalMediationAvailable).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(authClient.signIn.passkey).toHaveBeenCalledWith(
        expect.objectContaining({ autoFill: true }),
      );
    });

    if (capturedOnSuccess) {
      await act(async () => {
        await capturedOnSuccess?.();
      });
      expect(mockLocationAssign).toHaveBeenCalled();
    }

    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  });

  it("bails the conditional autofill when the call rejects", async () => {
    const isConditionalMediationAvailable = vi.fn().mockResolvedValue(true);
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: { isConditionalMediationAvailable } as unknown as typeof PublicKeyCredential,
    });
    authClient.signIn.passkey.mockRejectedValueOnce(new Error("user gesture required"));

    render(<SignInPage />);

    await vi.waitFor(() => {
      expect(isConditionalMediationAvailable).toHaveBeenCalled();
    });

    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  });

  it("skips the conditional autofill when isConditionalMediationAvailable returns false", async () => {
    const isConditionalMediationAvailable = vi.fn().mockResolvedValue(false);
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: { isConditionalMediationAvailable } as unknown as typeof PublicKeyCredential,
    });

    render(<SignInPage />);

    await vi.waitFor(() => {
      expect(isConditionalMediationAvailable).toHaveBeenCalled();
    });
    expect(authClient.signIn.passkey).not.toHaveBeenCalledWith(
      expect.objectContaining({ autoFill: true }),
    );

    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  });
});

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
});

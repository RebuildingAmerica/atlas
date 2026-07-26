// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readRouterMocks, resetRouterMocks } from "@/../tests/helpers/router-harness";

const mocks = vi.hoisted(() => ({
  checkAccountExists: vi.fn(),
  invalidateQueries: vi.fn(),
  requestMagicLink: vi.fn(),
  useAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/access/session.functions", () => ({
  checkAccountExists: mocks.checkAccountExists,
  requestMagicLink: mocks.requestMagicLink,
}));

import { SignUpPage } from "@/domains/access/pages/auth/sign-up-page";

describe("SignUpPage", () => {
  beforeEach(() => {
    mocks.checkAccountExists.mockReset();
    mocks.invalidateQueries.mockReset();
    resetRouterMocks();
    mocks.requestMagicLink.mockReset();
    mocks.useAtlasSession.mockReturnValue({ data: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders generic copy and a team-sso CTA when no intent is set", () => {
    render(<SignUpPage />);
    expect(screen.getByText("Join Atlas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start the team plan/i })).toBeInTheDocument();
  });

  it("renders team-buyer copy when intent is team-sso", () => {
    render(<SignUpPage intent="team-sso" />);
    expect(screen.getByText("Set up SSO for your team")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with team setup/i })).toBeInTheDocument();
  });

  it("redirects existing-account emails to sign-in without URL account-state claims", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: true });
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "operator@atlas.test" },
    });

    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const navArgs = readRouterMocks().navigate.mock.calls[0]?.[0] as
      { to: string; search: { email: string } } | undefined;
    expect(navArgs?.to).toBe("/sign-in");
    expect(navArgs?.search.email).toBe("operator@atlas.test");
    expect(navArgs?.search).not.toHaveProperty("existing");
    expect(mocks.requestMagicLink).not.toHaveBeenCalled();
  });

  it("transitions to the sent-confirmation phase after a successful magic-link request", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockResolvedValue({ ok: true, captureMailboxUrl: null });
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });

    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(screen.getByText("Check your inbox")).toBeInTheDocument();
    expect(screen.getByText(/Link expires in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resend in/i })).toBeDisabled();
  });

  it("re-enables Resend after the cooldown elapses", async () => {
    vi.useFakeTimers();
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockResolvedValue({ ok: true, captureMailboxUrl: null });
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });

    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(31_000);
    });

    expect(screen.getByRole("button", { name: "Resend link" })).not.toBeDisabled();
  });

  it("resends the magic link and surfaces the success status", async () => {
    vi.useFakeTimers();
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockResolvedValue({ ok: true, captureMailboxUrl: null });
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(31_000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend link" }));
      await Promise.resolve();
    });

    expect(mocks.requestMagicLink).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(screen.getByText("Sent. Check your inbox.")).toBeInTheDocument();
    });
  });

  it("returns to the form when the operator chooses to use a different email", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockResolvedValue({ ok: true, captureMailboxUrl: null });
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /Use a different email/ }));
    expect(screen.getByText("Join Atlas")).toBeInTheDocument();
  });

  it("renders the resend-error message when requestMagicLink rejects with the email-delivery code", async () => {
    vi.useFakeTimers();
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink
      .mockResolvedValueOnce({ ok: true, captureMailboxUrl: null })
      .mockRejectedValueOnce(new Error("EMAIL_DELIVERY_FAILED"));
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(31_000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend link" }));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(
        screen.getByText("Your sign-up link couldn't be delivered. Please try again."),
      ).toBeInTheDocument();
    });
  });

  it("renders the generic resend-error message for unrelated rejections", async () => {
    vi.useFakeTimers();
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink
      .mockResolvedValueOnce({ ok: true, captureMailboxUrl: null })
      .mockRejectedValueOnce(new Error("unknown"));
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(31_000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend link" }));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(screen.getByText("Could not resend the link. Please try again.")).toBeInTheDocument();
    });
  });

  it("redirects ready accounts to the effective redirect path when the session lands on the sent screen", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockResolvedValue({ ok: true, captureMailboxUrl: null });
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, assign: assignSpy },
    });
    mocks.useAtlasSession.mockReturnValue({ data: null });

    const { rerender } = render(<SignUpPage redirectTo="/workspace" />);
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    mocks.useAtlasSession.mockReturnValue({ data: { accountReady: true, user: { id: "u1" } } });
    rerender(<SignUpPage redirectTo="/workspace" />);

    expect(assignSpy).toHaveBeenCalledWith("/workspace");
  });

  it("does not assign protocol-relative redirects after sign-up", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockResolvedValue({ ok: true, captureMailboxUrl: null });
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, assign: assignSpy },
    });
    mocks.useAtlasSession.mockReturnValue({ data: null });

    const { rerender } = render(<SignUpPage redirectTo="//evil.example" />);
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    mocks.useAtlasSession.mockReturnValue({ data: { accountReady: true, user: { id: "u1" } } });
    rerender(<SignUpPage redirectTo="//evil.example" />);

    expect(assignSpy).toHaveBeenCalledWith("/account");
  });

  it("sends incomplete accounts to setup when no redirect is configured and the session arrives", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockResolvedValue({ ok: true, captureMailboxUrl: null });
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, assign: assignSpy },
    });
    mocks.useAtlasSession.mockReturnValue({ data: null });

    const { rerender } = render(<SignUpPage />);
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    mocks.useAtlasSession.mockReturnValue({ data: { accountReady: false, user: { id: "u1" } } });
    rerender(<SignUpPage />);

    expect(assignSpy).toHaveBeenCalledWith("/setup?redirect=%2Faccount");
  });

  it("does not put unsafe redirects into setup for incomplete accounts", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockResolvedValue({ ok: true, captureMailboxUrl: null });
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, assign: assignSpy },
    });
    mocks.useAtlasSession.mockReturnValue({ data: null });

    const { rerender } = render(<SignUpPage redirectTo="//evil.example" />);
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    mocks.useAtlasSession.mockReturnValue({ data: { accountReady: false, user: { id: "u1" } } });
    rerender(<SignUpPage redirectTo="//evil.example" />);

    expect(assignSpy).toHaveBeenCalledWith("/setup?redirect=%2Faccount");
  });

  it("keeps incomplete paid sign-ups in the purchase start flow", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockResolvedValue({ ok: true, captureMailboxUrl: null });
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, assign: assignSpy },
    });
    mocks.useAtlasSession.mockReturnValue({ data: null });

    const { rerender } = render(<SignUpPage intent="team-sso" />);
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Continue with team setup" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    mocks.useAtlasSession.mockReturnValue({ data: { accountReady: false, user: { id: "u1" } } });
    rerender(<SignUpPage intent="team-sso" />);

    expect(assignSpy).toHaveBeenCalledWith("/onboarding?product=atlas_team&interval=monthly");
  });

  it("renders the generic submit-error when the magic-link send rejects on the form", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockRejectedValue(new Error("network"));
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(screen.getByText("Sign-up is temporarily unavailable.")).toBeInTheDocument();
    });
  });

  it("preserves the redirect param when bouncing an existing account to /sign-in", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: true });
    render(<SignUpPage redirectTo="/workspace/billing" />);

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "operator@atlas.test" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const navArgs = readRouterMocks().navigate.mock.calls[0]?.[0] as
      { to: string; search: { email: string; redirect?: string } } | undefined;
    expect(navArgs?.search.redirect).toBe("/workspace/billing");
    expect(navArgs?.search).not.toHaveProperty("existing");
  });

  it("maps a recognised auth-error code to its localised submit label", async () => {
    mocks.checkAccountExists.mockResolvedValue({ exists: false });
    mocks.requestMagicLink.mockRejectedValue(new Error("EMAIL_DELIVERY_FAILED"));
    render(<SignUpPage />);

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "new@example.com" },
    });
    const form = screen.getByRole("button", { name: "Create account" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(
        screen.getByText("Your sign-up link couldn't be delivered. Please try again."),
      ).toBeInTheDocument();
    });
  });
});

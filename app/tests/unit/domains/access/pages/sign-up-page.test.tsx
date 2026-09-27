// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readRouterMocks, resetRouterMocks } from "@/../tests/helpers/router-harness";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  requestMagicLink: vi.fn(),
  useAtlasSession: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: mocks.useQuery,
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/access/session.functions", () => ({
  requestMagicLink: mocks.requestMagicLink,
}));

import { SignUpPage } from "@/domains/access/pages/auth/sign-up-page";

describe("SignUpPage", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    resetRouterMocks();
    mocks.requestMagicLink.mockReset();
    mocks.useAtlasSession.mockReturnValue({ data: null });
    mocks.useQuery.mockReturnValue({
      data: { available: true, allowedOffers: ["atlas_team:monthly"] },
      isError: false,
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("sends generic sign-ups to Team pricing before a paid signup", () => {
    render(<SignUpPage />);
    expect(screen.getByText("Join Atlas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Compare Team plans/i })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  it("renders team-buyer copy when intent is team-sso", () => {
    render(<SignUpPage intent="team-sso" />);
    expect(screen.getByText("Start your Atlas Team workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with team setup/i })).toBeInTheDocument();
  });

  it("does not collect an email for Team when checkout is closed", () => {
    mocks.useQuery.mockReturnValue({
      data: { available: false, allowedOffers: [], reason: "disabled" },
      isError: false,
      isPending: false,
    });

    render(<SignUpPage intent="team-sso" />);

    expect(
      screen.getByRole("heading", { name: "Atlas Team sign-up is unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create a free account/i })).toHaveAttribute(
      "href",
      "/sign-up",
    );
    expect(screen.getByRole("link", { name: /Compare plans/i })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.getByRole("link", { name: /Browse Atlas/i })).toHaveAttribute("href", "/browse");
    expect(mocks.requestMagicLink).not.toHaveBeenCalled();
  });

  it("does not collect an email when checkout is open but Team is not offered", () => {
    mocks.useQuery.mockReturnValue({
      data: { available: true, allowedOffers: ["atlas_pro:monthly"], reason: null },
      isError: false,
      isPending: false,
    });

    render(<SignUpPage intent="team-sso" />);

    expect(
      screen.getByRole("heading", { name: "Atlas Team sign-up is unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Email/i)).not.toBeInTheDocument();
  });

  it("waits for confirmed availability before showing the Team form", () => {
    mocks.useQuery.mockReturnValue({ data: undefined, isError: false, isPending: true });

    render(<SignUpPage intent="team-sso" />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking Team plan availability");
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("blocks the Team form if the availability check fails", () => {
    mocks.useQuery.mockReturnValue({ data: undefined, isError: true, isPending: false });

    render(<SignUpPage intent="team-sso" />);

    expect(
      screen.getByRole("heading", { name: "Atlas Team sign-up is unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("uses the yearly purchase path when it is the only available Team offer", async () => {
    mocks.useQuery.mockReturnValue({
      data: { available: true, allowedOffers: ["atlas_team:yearly"], reason: null },
      isError: false,
      isPending: false,
    });
    mocks.requestMagicLink.mockResolvedValue({ ok: true, captureMailboxUrl: null });
    render(<SignUpPage intent="team-sso" />);

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "team@example.com" } });
    const form = screen.getByRole("button", { name: "Continue with team setup" }).closest("form");
    if (!form) throw new Error("expected sign-up form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const magicLinkArgs = mocks.requestMagicLink.mock.calls[0]?.[0] as
      { data: { callbackURL: string } } | undefined;
    const callbackURL = magicLinkArgs?.data.callbackURL;
    expect(callbackURL).toBe("/onboarding?product=atlas_team&interval=yearly");
  });

  it("gives an existing account the same answer as a new one", async () => {
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

    // Same response either way, so the page reveals nothing about the address.
    const magicLinkArgs = mocks.requestMagicLink.mock.calls[0]?.[0] as
      { data: { email: string } } | undefined;
    expect(magicLinkArgs?.data.email).toBe("operator@atlas.test");
    expect(readRouterMocks().navigate).not.toHaveBeenCalled();
  });

  it("transitions to the sent-confirmation phase after a successful magic-link request", async () => {
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

  it("maps a recognised auth-error code to its localised submit label", async () => {
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

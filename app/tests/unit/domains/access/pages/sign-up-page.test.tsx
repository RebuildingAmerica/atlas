// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  checkAccountExists: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  requestMagicLink: vi.fn(),
  useAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => mocks.navigate,
}));

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
    mocks.navigate.mockReset();
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

  it("redirects to /sign-in with existing=true when the email is already an Atlas account", async () => {
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

    const navArgs = mocks.navigate.mock.calls[0]?.[0] as
      | { to: string; search: { existing: boolean; email: string } }
      | undefined;
    expect(navArgs?.to).toBe("/sign-in");
    expect(navArgs?.search.existing).toBe(true);
    expect(navArgs?.search.email).toBe("operator@atlas.test");
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
});

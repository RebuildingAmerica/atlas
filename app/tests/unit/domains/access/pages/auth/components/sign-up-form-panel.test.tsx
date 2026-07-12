// @vitest-environment jsdom

import type { ReactNode } from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignUpFormPanel } from "@/domains/access/pages/auth/components/sign-up-form-panel";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/platform/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type ?? "button"} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/platform/ui/input", () => ({
  Input: ({
    label,
    onChange,
    placeholder,
    value,
  }: {
    label?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    value?: string;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("SignUpFormPanel", () => {
  it("renders the consumer copy and the team-sso CTA when isTeamSso is false", () => {
    render(
      <SignUpFormPanel
        effectiveRedirect={undefined}
        email=""
        errorMessage={null}
        isPending={false}
        isTeamSso={false}
        onEmailChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Join Atlas")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeNull();
    expect(screen.getByText(/Setting up SSO for your team/)).not.toBeNull();
  });

  it("renders the team-sso copy and CTA when isTeamSso is true", () => {
    render(
      <SignUpFormPanel
        effectiveRedirect="/start?product=atlas_team&interval=monthly"
        email="ops@atlas.test"
        errorMessage="Sign-up failed."
        isPending={false}
        isTeamSso={true}
        onEmailChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Set up SSO for your team")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue with team setup" })).not.toBeNull();
    expect(screen.queryByText(/Setting up SSO for your team\?/)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-up failed.");
  });

  it("renders the pending CTA label and forwards email changes", () => {
    const onEmailChange = vi.fn();
    render(
      <SignUpFormPanel
        effectiveRedirect={undefined}
        email=""
        errorMessage={null}
        isPending={true}
        isTeamSso={false}
        onEmailChange={onEmailChange}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Creating account..." })).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@atlas.test" } });
    expect(onEmailChange).toHaveBeenCalledWith("new@atlas.test");
  });
});

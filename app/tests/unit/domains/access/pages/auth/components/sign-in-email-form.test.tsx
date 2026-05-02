// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignInEmailForm } from "@/domains/access/pages/auth/components/sign-in-email-form";

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

describe("SignInEmailForm", () => {
  it("renders the form, swaps in the pending label, and toggles the last-used badge", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => {
      event.preventDefault();
    });
    const onEmailChange = vi.fn();
    render(
      <SignInEmailForm
        domainSuggestion={null}
        email="ops@atlas.test"
        isLastUsed={true}
        isPending={true}
        onEmailChange={onEmailChange}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("Continuing...")).not.toBeNull();
    expect(screen.getByText("Last used")).not.toBeNull();
  });

  it("invokes onEmailChange with the suggested domain when the suggestion link is clicked", () => {
    const onEmailChange = vi.fn();
    render(
      <SignInEmailForm
        domainSuggestion="ops@gmail.com"
        email="ops@gmial.com"
        isLastUsed={false}
        isPending={false}
        onEmailChange={onEmailChange}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "ops@gmail.com" }));
    expect(onEmailChange).toHaveBeenCalledWith("ops@gmail.com");
  });

  it("submits the form when the operator presses the CTA", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => {
      event.preventDefault();
    });
    render(
      <SignInEmailForm
        domainSuggestion={null}
        email="ops@atlas.test"
        isLastUsed={false}
        isPending={false}
        onEmailChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const form = screen.getByRole("button", { name: "Continue with email" }).closest("form");
    if (!form) throw new Error("expected form");
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalled();
  });
});

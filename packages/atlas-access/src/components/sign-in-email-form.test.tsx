// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignInEmailForm } from "./sign-in-email-form";

vi.mock("@rebuildingamerica/atlas-ui/ui/button", () => ({
  Button: ({
    children,
    className,
    disabled,
    onClick,
    type,
  }: {
    children: ReactNode;
    className?: string;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) => (
    <button className={className} type={type ?? "button"} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/input", () => ({
  Input: ({
    labelAdornment,
    label,
    onChange,
    placeholder,
    value,
  }: {
    labelAdornment?: ReactNode;
    label?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    value?: string;
  }) => (
    <label>
      {label}
      {labelAdornment}
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
  it("keeps protocol-specific username help behind the info control", () => {
    render(
      <SignInEmailForm
        domainSuggestion={null}
        email=""
        isEmailFallbackVisible={false}
        isPending={false}
        onEmailChange={vi.fn()}
        onRevealEmailFallback={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText("you@example.com or @gwashington.org")).not.toBeNull();
    expect(screen.queryByText(/ATProto handle/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "How usernames work" }));

    expect(screen.getByText(/If you have an ATProto handle/i)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Learn more" })).not.toBeNull();
  });

  it("keeps email-link sign-in collapsed behind a passkey recovery control", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => {
      event.preventDefault();
    });
    const onEmailChange = vi.fn();
    const onRevealEmailFallback = vi.fn();

    render(
      <SignInEmailForm
        domainSuggestion={null}
        email="ops@atlas.test"
        isEmailFallbackVisible={false}
        isPending={false}
        onEmailChange={onEmailChange}
        onRevealEmailFallback={onRevealEmailFallback}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: "Continue with email" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Can't use a passkey?" }));
    expect(onRevealEmailFallback).toHaveBeenCalledOnce();
  });

  it("renders the email fallback submit action only after it is revealed", () => {
    render(
      <SignInEmailForm
        domainSuggestion={null}
        email="ops@atlas.test"
        isEmailFallbackVisible={true}
        isPending={true}
        onEmailChange={vi.fn()}
        onRevealEmailFallback={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Sending..." })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Can't use a passkey?" })).toBeNull();
  });

  it("invokes onEmailChange with the suggested domain when the suggestion link is clicked", () => {
    const onEmailChange = vi.fn();
    render(
      <SignInEmailForm
        domainSuggestion="ops@gmail.com"
        email="ops@gmial.com"
        isEmailFallbackVisible={false}
        isPending={false}
        onEmailChange={onEmailChange}
        onRevealEmailFallback={vi.fn()}
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
        isEmailFallbackVisible={true}
        isPending={false}
        onEmailChange={vi.fn()}
        onRevealEmailFallback={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const form = screen.getByRole("button", { name: "Continue with email" }).closest("form");
    if (!form) throw new Error("expected form");
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalled();
  });
});

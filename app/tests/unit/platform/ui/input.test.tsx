// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Input } from "@/platform/ui/input";

describe("Input", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with label and required marker", () => {
    render(<Input label="Username" required={true} />);
    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("renders label adornment beside the field label", () => {
    render(
      <Input label="Username" labelAdornment={<button type="button">How usernames work</button>} />,
    );

    expect(screen.getByRole("button", { name: "How usernames work" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
  });

  it("triggers onChange when value changes", () => {
    const handleChange = vi.fn();
    render(<Input label="Username" onChange={handleChange} />);

    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: "atlas" } });
    expect(handleChange).toHaveBeenCalledWith("atlas");
  });

  it("renders with icon and associated padding", () => {
    render(<Input label="Search" icon={<span data-testid="icon" />} />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByLabelText(/Search/i)).toHaveClass("pl-10");
  });

  it("renders error message and applies error styles", () => {
    render(<Input label="Email" error="Invalid email" />);
    const input = screen.getByLabelText(/Email/i);
    const error = screen.getByText("Invalid email");

    expect(screen.getByText("Invalid email")).toBeInTheDocument();
    expect(input).toHaveClass("border-on-error-container");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(error.id).not.toBe("");
    expect(input).toHaveAttribute("aria-describedby", error.id);
  });

  it("respects disabled state", () => {
    render(<Input label="Disabled" disabled={true} />);
    expect(screen.getByLabelText(/Disabled/i)).toBeDisabled();
  });
});

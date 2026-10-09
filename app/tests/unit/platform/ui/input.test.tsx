// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";

describe("Input", () => {
  afterEach(() => {
    cleanup();
  });

  it("preserves native field metadata and accessibility", () => {
    render(
      <Input
        id="native-field"
        name="notes"
        aria-label="Research notes"
        aria-invalid="true"
        aria-describedby="notes-help"
        maxLength={120}
        spellCheck={false}
      />,
    );
    const control = screen.getByRole("textbox", { name: "Research notes" });
    expect(control).toHaveAttribute("id", "native-field");
    expect(control).toHaveAttribute("name", "notes");
    expect(control).toHaveAttribute("maxlength", "120");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-describedby", "notes-help");
  });
  it("enforces the required native field constraint", () => {
    render(<Input label="Email" required />);
    const control = screen.getByRole("textbox");
    expect(control).toBeRequired();
    expect(control).toBeInvalid();
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

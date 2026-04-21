// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Select } from "@/platform/ui/select";

describe("Select", () => {
  const options = [
    { value: "v1", label: "Option 1" },
    { value: "v2", label: "Option 2" },
  ];

  afterEach(() => {
    cleanup();
  });

  it("renders with label and required marker", () => {
    render(<Select label="Choice" required={true} options={options} />);
    expect(screen.getByText("Choice")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("renders with placeholder and options", () => {
    render(<Select placeholder="Select one" options={options} />);
    expect(screen.getByText("Select one")).toBeInTheDocument();
    expect(screen.getByText("Option 1")).toBeInTheDocument();
    expect(screen.getByText("Option 2")).toBeInTheDocument();
  });

  it("triggers onChange when selection changes", () => {
    const handleChange = vi.fn();
    render(<Select options={options} onChange={handleChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "v2" } });
    expect(handleChange).toHaveBeenCalledWith("v2");
  });

  it("renders error message and applies error styles", () => {
    render(<Select options={options} error="Selection required" />);
    expect(screen.getByText("Selection required")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveClass("border-red-500");
  });

  it("respects disabled state", () => {
    render(<Select options={options} disabled={true} />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("handles missing label and optional props", () => {
    const { container } = render(<Select options={options} />);
    expect(container.querySelector("label")).not.toBeInTheDocument();
  });

  it("handles missing onChange gracefully", () => {
    render(<Select options={options} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "v1" } });
    // No error should be thrown
  });

  it("applies custom className", () => {
    render(<Select options={options} className="custom-class" />);
    expect(screen.getByRole("combobox")).toHaveClass("custom-class");
  });

  it("handles empty options and null value", () => {
    render(<Select options={[]} value={undefined} />);
    expect(screen.getByRole("combobox").getAttribute("value")).toBe(null);
    // Alternatively just check it renders
  });
});

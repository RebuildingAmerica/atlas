// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Button } from "@/platform/ui/button";

describe("Button", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders with children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });

  it("triggers onClick when clicked", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    fireEvent.click(screen.getByText("Click me"));
    expect(handleClick).toHaveBeenCalled();
  });

  it("is disabled when requested", () => {
    const handleClick = vi.fn();
    render(
      <Button disabled={true} onClick={handleClick}>
        Click me
      </Button>,
    );
    const button = screen.getByText("Click me");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("supports variants", () => {
    const { rerender } = render(<Button variant="primary">P</Button>);
    expect(screen.getByText("P")).toHaveClass("bg-primary");

    rerender(<Button variant="secondary">S</Button>);
    expect(screen.getByText("S")).toHaveClass("bg-surface-container-lowest");

    rerender(<Button variant="ghost">G</Button>);
    expect(screen.getByText("G")).toHaveClass("bg-transparent");
  });

  it("supports sizes", () => {
    const { rerender } = render(<Button size="sm">S</Button>);
    expect(screen.getByText("S")).toHaveClass("px-3");

    rerender(<Button size="md">M</Button>);
    expect(screen.getByText("M")).toHaveClass("px-4");

    rerender(<Button size="lg">L</Button>);
    expect(screen.getByText("L")).toHaveClass("px-6");
  });
});

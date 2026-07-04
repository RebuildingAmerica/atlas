// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Textarea } from "@/platform/ui/textarea";

describe("Textarea", () => {
  afterEach(() => {
    cleanup();
  });

  it("forwards label, value, and onChange like a controlled component", () => {
    let value = "initial";
    render(
      <Textarea
        label="Notes"
        value={value}
        onChange={(next) => {
          value = next;
        }}
      />,
    );
    const textarea = screen.getByLabelText("Notes");
    fireEvent.change(textarea, { target: { value: "updated" } });
    expect(value).toBe("updated");
  });

  it("auto-expands its inline height once autoExpand is enabled", () => {
    const { rerender } = render(<Textarea label="Cert" autoExpand value="" />);
    const node = screen.getByLabelText("Cert");
    if (!(node instanceof HTMLTextAreaElement)) throw new Error("expected textarea");
    Object.defineProperty(node, "scrollHeight", { configurable: true, value: 600 });
    rerender(<Textarea label="Cert" autoExpand value={"a\n".repeat(20)} />);
    expect(node.style.height).not.toBe("");
  });

  it("flips overflowY to auto when scrollHeight exceeds the maxRows budget", () => {
    const { rerender } = render(<Textarea label="Body" autoExpand maxRows={4} value="" />);
    const node = screen.getByLabelText("Body");
    if (!(node instanceof HTMLTextAreaElement)) throw new Error("expected textarea");
    Object.defineProperty(node, "scrollHeight", { configurable: true, value: 5000 });
    rerender(<Textarea label="Body" autoExpand maxRows={4} value="long" />);
    expect(node.style.overflowY).toBe("auto");
  });

  it("renders the error message and applies the danger border", () => {
    render(<Textarea label="Cert" error="Bad cert" value="" />);
    const node = screen.getByLabelText("Cert");
    const error = screen.getByText("Bad cert");

    expect(error).toBeInTheDocument();
    expect(node.className).toMatch(/border-red-500/);
    expect(node).toHaveAttribute("aria-invalid", "true");
    expect(error.id).not.toBe("");
    expect(node).toHaveAttribute("aria-describedby", error.id);
  });

  it("renders the required asterisk next to the label", () => {
    const { container } = render(<Textarea label="Cert" required value="" />);
    expect(container.querySelector(".text-red-500")?.textContent).toBe("*");
  });

  it("renders without a label or error message", () => {
    const { container } = render(<Textarea value="" />);
    expect(container.querySelector("label")).toBeNull();
    expect(container.querySelector(".text-red-500")).toBeNull();
  });

  it("skips the auto-expand resize when autoExpand is disabled", () => {
    render(<Textarea label="Cert" value="" />);
    const node = screen.getByLabelText("Cert");
    if (!(node instanceof HTMLTextAreaElement)) throw new Error("expected textarea");
    expect(node.style.height).toBe("");
  });
});

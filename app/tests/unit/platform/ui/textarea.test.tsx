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
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

afterEach(cleanup);

describe("legacy form primitives", () => {
  it("associates input errors with the field", () => {
    render(<Input label="Name" value="" onChange={vi.fn()} error="Name is required" />);

    const input = screen.getByLabelText("Name");
    const error = screen.getByRole("alert", { name: "" });

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Name is required");
    expect(error).toHaveTextContent("Name is required");
  });

  it("associates select errors with the field", () => {
    render(
      <Select
        label="State"
        value=""
        onChange={vi.fn()}
        error="State is required"
        options={[{ value: "NV", label: "Nevada" }]}
      />,
    );

    const select = screen.getByLabelText("State");
    const error = screen.getByRole("alert", { name: "" });

    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAccessibleDescription("State is required");
    expect(error).toHaveTextContent("State is required");
  });
});

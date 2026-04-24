// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { cn } from "@/lib/utils";
import { PageLayout } from "@/platform/layout/page-layout";
import { Badge } from "@/platform/ui/badge";
import { Button } from "@/platform/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/platform/ui/card";
import { Input } from "@/platform/ui/input";
import { Select } from "@/platform/ui/select";
import { Spinner } from "@/platform/ui/spinner";

afterEach(() => {
  cleanup();
});

describe("ui components", () => {
  it("renders layout and badge variants", () => {
    const { rerender } = render(
      <PageLayout className="extra-space">
        <Badge variant="success">Ready</Badge>
      </PageLayout>,
    );

    expect(screen.getByText("Ready").className).toContain("bg-green-100");
    expect(screen.getByText("Ready").closest("div")?.className).toContain("extra-space");

    rerender(
      <PageLayout>
        <Badge>Fallback layout</Badge>
      </PageLayout>,
    );

    expect(screen.getByText("Fallback layout").closest("div")?.className).not.toContain(
      "undefined",
    );
  });

  it("renders buttons and handles clicks", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="secondary" size="lg" onClick={onClick}>
        Save
      </Button>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save" }).className).toContain("cursor-pointer");

    rerender(
      <Button variant="ghost" disabled>
        Disabled
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Disabled" }).className).toContain(
      "cursor-not-allowed",
    );
  });

  it("renders card subcomponents", () => {
    render(
      <Card hoverable className="custom-card">
        <CardHeader>
          <CardTitle>Card title</CardTitle>
        </CardHeader>
        <CardContent>Card body</CardContent>
      </Card>,
    );

    expect(screen.getByText("Card title")).not.toBeNull();
    expect(screen.getByText("Card body").closest(".custom-card")).not.toBeNull();
  });

  it("renders inputs and propagates field changes", () => {
    const onChange = vi.fn();
    render(
      <Input
        label="Email"
        required
        error="Required"
        value="initial"
        onChange={onChange}
        icon={<span>i</span>}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "operator@atlas.test" },
    });

    expect(onChange).toHaveBeenCalledWith("operator@atlas.test");
    expect(screen.getByText("Required")).not.toBeNull();
  });

  it("renders selects and propagates option changes", () => {
    const onChange = vi.fn();
    render(
      <Select
        label="State"
        required
        error="Pick one"
        placeholder="Choose a state"
        options={[
          { value: "MO", label: "Missouri" },
          { value: "KS", label: "Kansas" },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "KS" },
    });

    expect(onChange).toHaveBeenCalledWith("KS");
    expect(screen.getByText("Pick one")).not.toBeNull();
  });

  it("renders spinners and merges utility classes", () => {
    const { container } = render(<Spinner size="lg" className="outer" />);

    expect((container.firstChild as HTMLElement | null)?.className).toContain("outer");
    expect(container.querySelector(".w-12")).not.toBeNull();
    expect(cn("px-4", "px-6", "font-semibold")).toBe("px-6 font-semibold");
  });
});

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvatarRow } from "@/domains/catalog/components/profiles/avatar-row";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("AvatarRow", () => {
  it("opens on the first person and details them below the row", () => {
    render(
      <AvatarRow
        people={[
          createEntryFixture({ name: "Jane Doe", source_count: 3 }),
          createEntryFixture({ id: "entry-2", name: "Ada Reyes" }),
        ]}
      />,
    );

    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Jane/ })).toBeInTheDocument();

    const detail = screen.getByRole("link", { name: /View full profile/ }).closest("div");
    expect(detail).not.toBeNull();
    expect(screen.getByText("Community organizer focused on housing.")).toBeInTheDocument();
    expect(screen.getByText("3 mentions")).toBeInTheDocument();
    expect(screen.getByText("Housing Affordability")).toBeInTheDocument();
  });

  it("switches the detail panel to whoever the reader picks", async () => {
    const user = userEvent.setup();
    render(
      <AvatarRow
        people={[
          createEntryFixture({ name: "Jane Doe" }),
          createEntryFixture({
            description: "Ada runs the tenants union. She also teaches.",
            id: "entry-2",
            name: "Ada Reyes",
            source_count: 1,
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Ada/ }));

    expect(screen.getByRole("link", { name: /View full profile/ })).toHaveAttribute(
      "href",
      "/entries/entry-2",
    );
    // Only the opening sentence of the description survives into the panel.
    expect(screen.getByText("Ada runs the tenants union.")).toBeInTheDocument();
    expect(screen.getByText("1 mention")).toBeInTheDocument();
  });

  it("shows each person's first name under their avatar", () => {
    render(
      <AvatarRow people={[createEntryFixture({ name: "Jane Maria Doe" })]} showHeader={false} />,
    );
    const button = screen.getByRole("button");
    expect(within(button).getByText("Jane")).toBeInTheDocument();
    expect(screen.queryByText("People")).not.toBeInTheDocument();
  });

  it("keeps a whole description when it carries no sentence break", () => {
    render(<AvatarRow people={[createEntryFixture({ description: "Tenants union organizer" })]} />);
    expect(screen.getByText("Tenants union organizer")).toBeInTheDocument();
  });

  it("skips the description line for a record that has none", () => {
    render(<AvatarRow people={[createEntryFixture({ description: undefined })]} />);
    expect(screen.queryByText("Community organizer focused on housing.")).not.toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("skips the issue chips for a record with no issue areas", () => {
    render(<AvatarRow people={[createEntryFixture({ issue_areas: [] })]} />);
    expect(screen.queryByText("Housing Affordability")).not.toBeInTheDocument();
  });

  it("renders nothing when there are no people to show", () => {
    const { container } = render(<AvatarRow people={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("stops showing a detail panel when the picked person leaves the list", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <AvatarRow
        people={[
          createEntryFixture({ name: "Jane Doe" }),
          createEntryFixture({ id: "entry-2", name: "Ada Reyes" }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Ada/ }));
    rerender(<AvatarRow people={[createEntryFixture({ name: "Jane Doe" })]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

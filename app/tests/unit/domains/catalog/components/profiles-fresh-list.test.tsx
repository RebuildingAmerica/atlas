// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProfilesFreshList } from "@/domains/catalog/components/profiles/profiles-fresh-list";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ProfilesFreshList", () => {
  it("lists recent arrivals with their type, place, sources and freshness", () => {
    render(
      <ProfilesFreshList
        entries={[createEntryFixture({ latest_source_date: "2026-02-01", source_count: 4 })]}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "New in Atlas" })).toBeInTheDocument();
    expect(screen.getByText("Recent arrivals")).toBeInTheDocument();

    const row = screen.getByRole("link");
    expect(row).toHaveAttribute("href", "/profiles/people/jane-doe-a3f2");
    expect(within(row).getByText("Jane Doe")).toBeInTheDocument();
    expect(within(row).getByText("Person · Jackson, MS")).toBeInTheDocument();
    expect(within(row).getByText("4 sources")).toBeInTheDocument();
    expect(within(row).getByText("Feb 1, 2026")).toBeInTheDocument();
  });

  it("omits the freshness stamp when the record carries no source date", () => {
    render(<ProfilesFreshList entries={[createEntryFixture()]} />);
    expect(screen.getByText("3 sources")).toBeInTheDocument();
    expect(screen.queryByText(/\d{4}$/)).not.toBeInTheDocument();
  });

  it("renders placeholder rows while the list is loading", () => {
    const { container } = render(<ProfilesFreshList entries={[]} isLoading />);
    expect(screen.getByRole("heading", { level: 2, name: "New in Atlas" })).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(5);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("shows the failure rather than pretending nothing is new", () => {
    render(<ProfilesFreshList entries={[]} error={new Error("Could not load new profiles.")} />);
    expect(screen.getByText("Could not load new profiles.")).toBeInTheDocument();
  });

  it("hides itself when the load finished with nothing to show", () => {
    const { container } = render(<ProfilesFreshList entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SpotlightCard } from "@/domains/catalog/components/profiles/spotlight-card";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("SpotlightCard", () => {
  it("presents the featured record with place, sources, freshness and issues", () => {
    render(
      <SpotlightCard
        entry={createEntryFixture({
          issue_areas: ["housing_affordability", "public_health", "labor", "climate"],
          latest_source_date: "2026-02-01",
          source_count: 7,
        })}
        issueAreaLabels={{ housing_affordability: "Housing Affordability" }}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/profiles/people/jane-doe-a3f2");
    expect(within(link).getByText("Featured")).toBeInTheDocument();
    expect(within(link).getByRole("heading", { level: 2, name: "Jane Doe" })).toBeInTheDocument();
    expect(within(link).getByText("Jackson, MS")).toBeInTheDocument();
    expect(within(link).getByText("7 sources")).toBeInTheDocument();
    expect(within(link).getByText("Updated Feb 1, 2026")).toBeInTheDocument();
    expect(within(link).getByText("Housing Affordability")).toBeInTheDocument();
    expect(within(link).getByText("Public Health")).toBeInTheDocument();
    expect(within(link).getByText("Labor")).toBeInTheDocument();
    // The spotlight shows three issue slots, so the fourth stays off the card.
    expect(within(link).queryByText("Climate")).not.toBeInTheDocument();
  });

  it("prioritizes the hero photo so the lead card paints first", () => {
    const { container } = render(
      <SpotlightCard
        entry={createEntryFixture({ photo_url: "https://img.test/jane.jpg" })}
        issueAreaLabels={{}}
      />,
    );

    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "https://img.test/jane.jpg");
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("fetchpriority", "high");
  });

  it("leaves out the freshness stamp when nothing dates the record", () => {
    render(<SpotlightCard entry={createEntryFixture()} issueAreaLabels={{}} />);
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
  });
});

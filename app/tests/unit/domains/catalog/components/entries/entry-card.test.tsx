// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntryCard } from "@/domains/catalog/components/entries/entry-card";
import { recordDiscoveryEvents } from "../../../../../helpers/catalog/discovery-event-recorder";
import { createEntryFixture } from "../../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("EntryCard match reason", () => {
  it("describes a topic match without claiming current work in the listed place", () => {
    render(
      <EntryCard
        discoveryContext={{ issueAreas: ["housing_affordability"] }}
        entry={createEntryFixture()}
        issueAreaLabels={{ housing_affordability: "Housing Affordability" }}
      />,
    );

    expect(
      screen.getByText("Issue: Housing Affordability · Listed in Jackson, MS"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/works on Housing Affordability/)).not.toBeInTheDocument();
  });

  it("names the issue and the place a filtered result matched on", () => {
    render(
      <EntryCard
        discoveryContext={{ issueAreas: ["housing_affordability"] }}
        entry={createEntryFixture()}
        issueAreaLabels={{ housing_affordability: "Housing Affordability" }}
      />,
    );

    expect(
      screen.getByText("Issue: Housing Affordability · Listed in Jackson, MS"),
    ).toBeInTheDocument();
  });

  it("humanizes an issue slug the taxonomy has no label for", () => {
    render(
      <EntryCard
        discoveryContext={{ issueAreas: ["housing_affordability"] }}
        entry={createEntryFixture()}
      />,
    );

    expect(
      screen.getByText("Issue: Housing Affordability · Listed in Jackson, MS"),
    ).toBeInTheDocument();
  });

  it("names the issue alone when the record has no place on file", () => {
    render(
      <EntryCard
        discoveryContext={{ issueAreas: ["housing_affordability"] }}
        entry={createEntryFixture({ city: undefined, region: undefined, state: undefined })}
      />,
    );

    expect(screen.getByText("Issue: Housing Affordability")).toBeInTheDocument();
  });

  it("quotes the search text back when the name is what matched", () => {
    render(
      <EntryCard
        discoveryContext={{ query: " jane " }}
        entry={createEntryFixture({ issue_areas: [] })}
      />,
    );

    expect(screen.getByText("Name matches “jane”")).toBeInTheDocument();
  });

  it("credits the source-type filter when that is the only overlap", () => {
    render(
      <EntryCard
        discoveryContext={{ query: "prairie", sourceTypes: ["podcast"] }}
        entry={createEntryFixture({ issue_areas: [], source_types: ["news_article", "podcast"] })}
      />,
    );

    expect(screen.getByText("Source type matches")).toBeInTheDocument();
  });

  it("credits the place filter when neither issue nor name matched", () => {
    render(
      <EntryCard
        discoveryContext={{ places: ["Jackson"], sourceTypes: ["podcast"] }}
        entry={createEntryFixture({ issue_areas: [], source_types: ["news_article"] })}
      />,
    );

    expect(screen.getByText("Listed in Jackson, MS")).toBeInTheDocument();
  });

  it("falls back to describing the record when no filter explains it", () => {
    render(
      <EntryCard
        discoveryContext={{ places: ["Jackson"] }}
        entry={createEntryFixture({
          city: undefined,
          issue_areas: [],
          region: undefined,
          state: undefined,
        })}
      />,
    );

    expect(
      screen.queryByText(/Matched because|person in the Atlas directory/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("3 sources")).toBeInTheDocument();
  });
});

describe("EntryCard trust badge", () => {
  it("shows source availability without grading an unreviewed lead", () => {
    render(
      <EntryCard
        entry={createEntryFixture({
          source_count: 0,
          trust: {
            level: "unverified",
            independent_source_count: null,
            website_grounded: null,
            email_grounded: null,
          },
        })}
      />,
    );
    expect(screen.getByText("No sources listed")).toBeInTheDocument();
    expect(screen.queryByText("Source-backed")).not.toBeInTheDocument();
    expect(screen.queryByText(/Partner-ready|Qualify before outreach/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inspect sources" })).not.toBeInTheDocument();
  });

  it("credits a verified claim on a person as a verified person", () => {
    render(
      <EntryCard
        entry={createEntryFixture({
          claim: { status: "verified", verification_level: "subject-verified" },
        })}
      />,
    );

    expect(screen.getByText("Verified person")).toBeInTheDocument();
    expect(screen.getByText("3 sources")).toBeInTheDocument();
  });

  it("credits a verified claim on an organization as a verified representative", () => {
    render(
      <EntryCard
        entry={createEntryFixture({
          claim: { status: "verified", verification_level: "subject-verified" },
          type: "organization",
        })}
      />,
    );

    expect(screen.getByText("Verified representative")).toBeInTheDocument();
  });

  it("does not call a verified initiative a verified person", () => {
    render(
      <EntryCard
        entry={createEntryFixture({
          claim: { status: "verified", verification_level: "subject-verified" },
          type: "initiative",
        })}
      />,
    );

    expect(screen.queryByText("Verified person")).not.toBeInTheDocument();
  });

  it("describes a single-source record in the singular", () => {
    render(<EntryCard entry={createEntryFixture({ source_count: 1 })} />);
    expect(screen.getByText("1 source")).toBeInTheDocument();
    expect(screen.queryByText("Source-backed")).not.toBeInTheDocument();
  });
});

describe("EntryCard discovery tracking", () => {
  it("reports that a reader went to inspect the sources behind a card", async () => {
    const recorder = recordDiscoveryEvents();
    const user = userEvent.setup();
    render(<EntryCard entry={createEntryFixture({ id: "entry-1", type: "person" })} />);

    await user.click(screen.getByRole("link", { name: "Inspect sources" }));
    recorder.stop();

    expect(recorder.events).toEqual([
      {
        name: "catalog_sources_inspected",
        properties: { entry_id: "entry-1", entry_type: "person" },
      },
    ]);
  });

  it("reports that a reader opened a profile from the card title", async () => {
    const recorder = recordDiscoveryEvents();
    const user = userEvent.setup();
    render(
      <EntryCard entry={createEntryFixture({ id: "entry-2", name: "Jane Doe", type: "person" })} />,
    );

    await user.click(screen.getByRole("link", { name: "Jane Doe" }));
    recorder.stop();

    expect(recorder.events).toEqual([
      {
        name: "catalog_profile_opened",
        properties: { entry_id: "entry-2", entry_type: "person", source: "result_card_title" },
      },
    ]);
  });

  it("distinguishes the card's action button from its title in what it reports", async () => {
    const recorder = recordDiscoveryEvents();
    const user = userEvent.setup();
    render(<EntryCard entry={createEntryFixture({ id: "entry-3", type: "organization" })} />);

    await user.click(screen.getByRole("link", { name: "Open profile" }));
    recorder.stop();

    expect(recorder.events).toEqual([
      {
        name: "catalog_profile_opened",
        properties: {
          entry_id: "entry-3",
          entry_type: "organization",
          source: "result_card_action",
        },
      },
    ]);
  });

  it("points the source-inspection link at the profile's reporting trail", () => {
    render(<EntryCard entry={createEntryFixture({ slug: "jane-doe-a3f2", type: "person" })} />);
    expect(screen.getByRole("link", { name: "Inspect sources" })).toHaveAttribute(
      "href",
      "/profiles/people/jane-doe-a3f2#reporting-trail",
    );
  });

  it("points organization readers at the profile's appearances", () => {
    render(<EntryCard entry={createEntryFixture({ slug: "civic-team", type: "organization" })} />);
    expect(screen.getByRole("link", { name: "Inspect sources" })).toHaveAttribute(
      "href",
      "/profiles/organizations/civic-team#appearances",
    );
  });

  it("does not promise a source section when a slugless record redirects to Browse", () => {
    render(<EntryCard entry={createEntryFixture({ id: "entry-5", slug: undefined })} />);
    expect(screen.queryByRole("link", { name: "Inspect sources" })).not.toBeInTheDocument();
  });

  it("points the source-inspection link at the type's own profile space", () => {
    render(
      <EntryCard entry={createEntryFixture({ slug: "clean-water-c3", type: "initiative" })} />,
    );
    expect(screen.getByRole("link", { name: "Inspect sources" })).toHaveAttribute(
      "href",
      "/profiles/initiatives/clean-water-c3#reporting-trail",
    );
  });
});

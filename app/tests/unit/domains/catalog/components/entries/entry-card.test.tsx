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
  it("names the issue and the place a filtered result matched on", () => {
    render(
      <EntryCard
        discoveryContext={{ issueAreas: ["housing_affordability"] }}
        entry={createEntryFixture()}
        issueAreaLabels={{ housing_affordability: "Housing Affordability" }}
      />,
    );

    expect(
      screen.getByText("Matched because: works on Housing Affordability in Jackson, MS"),
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
      screen.getByText("Matched because: works on Housing Affordability in Jackson, MS"),
    ).toBeInTheDocument();
  });

  it("names the issue alone when the record has no place on file", () => {
    render(
      <EntryCard
        discoveryContext={{ issueAreas: ["housing_affordability"] }}
        entry={createEntryFixture({ city: undefined, region: undefined, state: undefined })}
      />,
    );

    expect(screen.getByText("Matched because: works on Housing Affordability")).toBeInTheDocument();
  });

  it("quotes the search text back when the name is what matched", () => {
    render(
      <EntryCard
        discoveryContext={{ query: " jane " }}
        entry={createEntryFixture({ issue_areas: [] })}
      />,
    );

    expect(screen.getByText('Matched because: name matches "jane"')).toBeInTheDocument();
  });

  it("credits the source-type filter when that is the only overlap", () => {
    render(
      <EntryCard
        discoveryContext={{ query: "prairie", sourceTypes: ["podcast"] }}
        entry={createEntryFixture({ issue_areas: [], source_types: ["news_article", "podcast"] })}
      />,
    );

    expect(
      screen.getByText("Matched because: has sources in the selected source type"),
    ).toBeInTheDocument();
  });

  it("credits the place filter when neither issue nor name matched", () => {
    render(
      <EntryCard
        discoveryContext={{ places: ["Jackson"], sourceTypes: ["podcast"] }}
        entry={createEntryFixture({ issue_areas: [], source_types: ["news_article"] })}
      />,
    );

    expect(screen.getByText("Matched because: listed in Jackson, MS")).toBeInTheDocument();
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
      screen.getByText("Matched because: person with source-linked civic activity"),
    ).toBeInTheDocument();
  });
});

describe("EntryCard trust badge", () => {
  it("credits a verified claim on a person as a verified person", () => {
    render(
      <EntryCard
        entry={createEntryFixture({
          claim: { status: "verified", verification_level: "subject-verified" },
        })}
      />,
    );

    expect(screen.getByText("Verified person")).toBeInTheDocument();
    expect(screen.getByText(/^3 sources · Verified person$/)).toBeInTheDocument();
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

  it("describes a single-source record in the singular", () => {
    render(<EntryCard entry={createEntryFixture({ source_count: 1 })} />);
    expect(screen.getByText(/^1 source · Source-backed$/)).toBeInTheDocument();
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

  it("points the source-inspection link at the entry route for a slugless record", () => {
    render(<EntryCard entry={createEntryFixture({ id: "entry-5", slug: undefined })} />);
    expect(screen.getByRole("link", { name: "Inspect sources" })).toHaveAttribute(
      "href",
      "/entries/entry-5#reporting-trail",
    );
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

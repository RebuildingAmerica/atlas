// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EntryCard } from "@/domains/catalog/components/entries/entry-card";
import { EntryDetail } from "@/domains/catalog/components/entries/entry-detail";
import { EntryFilters } from "@/domains/catalog/components/entries/entry-filters";
import { EntryList } from "@/domains/catalog/components/entries/entry-list";
import type { Entry } from "@/types/entry";
import type { Source } from "@/types/source";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));

describe("catalog entry components", () => {
  afterEach(() => {
    cleanup();
  });

  const sampleSource: Source = {
    created_at: "2026-04-10T00:00:00.000Z",
    extraction_context: "Mentioned in campaign coverage",
    extraction_method: "manual",
    id: "source_123",
    ingested_at: "2026-04-10T00:00:00.000Z",
    publication: "Atlas Weekly",
    published_date: "2026-04-11",
    title: "Coverage story",
    type: "report",
    url: "https://atlas.test/source",
  };

  const sampleEntry: Entry = {
    active: true,
    created_at: "2026-04-10T00:00:00.000Z",
    description: "Community housing coalition",
    id: "entry_123",
    issue_areas: ["housing_affordability"],
    latest_source_date: "2026-04-11",
    name: "Housing Justice KC",
    source_count: 2,
    source_types: ["news_article"],
    type: "organization",
    updated_at: "2026-04-12T00:00:00.000Z",
    verified: true,
    claim: { status: "unclaimed", verification_level: "atlas-verified" },
    trust: {
      level: "atlas_verified",
      independent_source_count: null,
      website_grounded: null,
      email_grounded: null,
    },
    city: "Kansas City",
    state: "MO",
    geo_specificity: "local",
    first_seen: "2026-04-10T00:00:00.000Z",
    last_seen: "2026-04-12T00:00:00.000Z",
    website: "https://atlas.test",
    email: "operator@atlas.test",
    phone: "555-1111",
    slug: "housing-justice-kc-a1b2",
    sources: [sampleSource],
  };

  it("renders entry cards with issue and source badges", () => {
    render(
      <EntryCard entry={sampleEntry} issueAreaLabels={{ housing_affordability: "Housing" }} />,
    );

    expect(screen.getByText("Housing Justice KC")).not.toBeNull();
    expect(screen.getByText("Housing")).not.toBeNull();
    expect(screen.getByText("Latest source: 2026-04-11")).not.toBeNull();
  });

  it("links a person entry to the people profile route", () => {
    const personEntry: Entry = {
      ...sampleEntry,
      type: "person",
      slug: "ada-lovelace-1234",
      name: "Ada Lovelace",
    };
    render(<EntryCard entry={personEntry} />);
    expect(screen.getByText("Ada Lovelace")).not.toBeNull();
    expect(screen.getByText("Person")).not.toBeNull();
  });

  it("falls back to the legacy entry route when slug is empty", () => {
    const slugless: Entry = { ...sampleEntry, slug: "" };
    render(<EntryCard entry={slugless} />);
    expect(screen.getByText("Housing Justice KC")).not.toBeNull();
  });

  it("falls back to the legacy entry route for non-person/non-org entries", () => {
    const initiativeEntry: Entry = {
      ...sampleEntry,
      type: "initiative",
      slug: "labor-action-1",
    };
    render(<EntryCard entry={initiativeEntry} />);
    expect(screen.getByText("Initiative")).not.toBeNull();
  });

  it("renders entry-card location and metadata fallbacks", () => {
    const regionEntry: Entry = {
      ...sampleEntry,
      city: undefined,
      state: undefined,
      region: "Midwest",
      latest_source_date: undefined,
      issue_areas: [],
      source_types: [],
      verified: false,
      trust: { ...sampleEntry.trust, level: "unverified" },
    };
    const { rerender } = render(<EntryCard entry={regionEntry} />);

    expect(screen.getByText("Midwest")).not.toBeNull();
    expect(screen.queryByText(/Latest source:/)).toBeNull();
    // Unverified entries carry no trust badge — silence is the honest signal.
    expect(screen.queryByText("Atlas-verified")).toBeNull();

    rerender(
      <EntryCard
        entry={
          {
            ...regionEntry,
            region: undefined,
            state: "KS",
          } as Entry
        }
      />,
    );

    expect(screen.getByText("KS")).not.toBeNull();

    rerender(
      <EntryCard
        entry={
          {
            ...regionEntry,
            region: undefined,
            state: undefined,
          } as Entry
        }
      />,
    );

    expect(screen.getByText("Location not specified")).not.toBeNull();
  });

  it("shows a 'Verified by subject' badge for the subject_verified tier", () => {
    render(
      <EntryCard
        entry={{ ...sampleEntry, trust: { ...sampleEntry.trust, level: "subject_verified" } }}
      />,
    );
    expect(screen.getByText("Verified by subject")).not.toBeNull();
  });

  it("shows an 'Atlas-verified' badge for the atlas_verified tier", () => {
    render(
      <EntryCard
        entry={{ ...sampleEntry, trust: { ...sampleEntry.trust, level: "atlas_verified" } }}
      />,
    );
    expect(screen.getByText("Atlas-verified")).not.toBeNull();
  });

  it("shows a 'Corroborated' badge with no count for the corroborated tier", () => {
    render(
      <EntryCard
        entry={{
          ...sampleEntry,
          trust: { ...sampleEntry.trust, level: "corroborated", independent_source_count: 4 },
        }}
      />,
    );
    expect(screen.getByText("Corroborated")).not.toBeNull();
  });

  it("renders no trust badge for the unverified tier, never the legacy 'Verified'", () => {
    render(
      <EntryCard
        entry={{ ...sampleEntry, trust: { ...sampleEntry.trust, level: "unverified" } }}
      />,
    );
    expect(screen.queryByText("Verified")).toBeNull();
    expect(screen.queryByText("Verified by subject")).toBeNull();
    expect(screen.queryByText("Atlas-verified")).toBeNull();
    expect(screen.queryByText("Corroborated")).toBeNull();
  });

  it("renders entry detail loading, error, empty, and success states", () => {
    const { rerender } = render(<EntryDetail isLoading />);
    expect(screen.getByText("Loading source-linked entry details…")).not.toBeNull();

    rerender(<EntryDetail error={new Error("No detail")} />);
    expect(screen.getByText("No detail")).not.toBeNull();

    rerender(<EntryDetail />);
    expect(screen.getByText("Entry not found.")).not.toBeNull();

    rerender(
      <EntryDetail entry={sampleEntry} issueAreaLabels={{ housing_affordability: "Housing" }} />,
    );
    expect(screen.getByText("Source trail")).not.toBeNull();
    expect(screen.getByText("Coverage story")).not.toBeNull();

    rerender(
      <EntryDetail
        entry={
          {
            ...sampleEntry,
            city: undefined,
            state: undefined,
            region: "Midwest",
            full_address: undefined,
            issue_areas: [],
            sources: [],
            verified: false,
          } as Entry
        }
      />,
    );

    expect(screen.getByText("Source-linked")).not.toBeNull();
    expect(screen.getByText("Midwest")).not.toBeNull();
    expect(screen.getByText("No linked sources yet.")).not.toBeNull();

    rerender(
      <EntryDetail
        entry={
          {
            ...sampleEntry,
            city: undefined,
            region: undefined,
            state: undefined,
            issue_areas: [],
            sources: [],
          } as Entry
        }
      />,
    );

    expect(screen.getByText("Location not specified")).not.toBeNull();

    rerender(
      <EntryDetail
        entry={
          {
            ...sampleEntry,
            email: undefined,
            full_address: "123 Main St, Kansas City, MO",
            issue_areas: ["water_quality"],
            phone: undefined,
            sources: [
              {
                ...sampleSource,
                extraction_context: undefined,
                publication: undefined,
                published_date: undefined,
                title: undefined,
                url: "https://atlas.test/fallback-source",
              } as Source,
            ],
            website: undefined,
          } as Entry
        }
      />,
    );

    expect(screen.getByText("123 Main St, Kansas City, MO")).not.toBeNull();
    expect(screen.getByText("Water Quality")).not.toBeNull();
    expect(screen.getByText("https://atlas.test/fallback-source")).not.toBeNull();
  });

  it("renders entry filters and propagates user input", () => {
    const onQueryChange = vi.fn();
    const onSearchSubmit = vi.fn();
    const onClear = vi.fn();
    const onToggleFilter = vi.fn();

    render(
      <EntryFilters
        query="housing"
        onQueryChange={onQueryChange}
        onSearchSubmit={onSearchSubmit}
        onClear={onClear}
        onToggleFilter={onToggleFilter}
        selectedFilters={{
          cities: [],
          entry_types: [],
          issue_areas: [],
          regions: [],
          source_types: [],
          states: [],
        }}
        facets={{
          cities: [],
          entity_types: [{ count: 2, value: "organization" }],
          issue_areas: [{ count: 3, value: "housing_affordability" }],
          regions: [],
          source_types: [],
          states: [{ count: 4, value: "MO" }],
        }}
        issueAreaLabels={{ housing_affordability: "Housing" }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Search people/i), {
      target: { value: "labor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply search" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: /Housing 3/i }));

    expect(onQueryChange).toHaveBeenCalledWith("labor");
    expect(onSearchSubmit).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onToggleFilter).toHaveBeenCalledWith("issue_areas", "housing_affordability");
  });

  it("renders selected facet styles and humanized fallback labels", () => {
    const onToggleFilter = vi.fn();

    render(
      <EntryFilters
        query=""
        onQueryChange={vi.fn()}
        onSearchSubmit={vi.fn()}
        onClear={vi.fn()}
        onToggleFilter={onToggleFilter}
        selectedFilters={{
          cities: [],
          entry_types: ["organization"],
          issue_areas: [],
          regions: [],
          source_types: ["news_article"],
          states: [],
        }}
        facets={{
          cities: [],
          entity_types: [{ count: 2, value: "organization" }],
          issue_areas: [],
          regions: [],
          source_types: [{ count: 1, value: "news_article" }],
          states: [],
        }}
        issueAreaLabels={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Organization 2/i }));
    fireEvent.click(screen.getByRole("button", { name: /News Article 1/i }));

    expect(onToggleFilter).toHaveBeenCalledWith("entry_types", "organization");
    expect(onToggleFilter).toHaveBeenCalledWith("source_types", "news_article");
  });

  it("renders entry list loading, error, empty, and populated states", () => {
    const { rerender } = render(<EntryList entries={[]} isLoading />);
    expect(screen.getByText("Loading entries...")).not.toBeNull();

    rerender(<EntryList entries={[]} error={new Error("Search unavailable")} />);
    expect(screen.getAllByText("Search unavailable")).toHaveLength(2);

    rerender(<EntryList entries={[]} hasActiveSearch />);
    expect(screen.getByText("No entries found.")).not.toBeNull();

    rerender(<EntryList entries={[]} />);
    expect(screen.getByText("Discovery")).not.toBeNull();

    rerender(<EntryList entries={[sampleEntry]} total={1} />);
    expect(screen.getByText("1 entries")).not.toBeNull();
    expect(screen.getByText("Housing Justice KC")).not.toBeNull();

    rerender(<EntryList entries={[sampleEntry]} />);
    expect(screen.queryByText("1 results")).toBeNull();
  });
});

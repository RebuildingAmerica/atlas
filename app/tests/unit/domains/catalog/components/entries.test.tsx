// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EntryCard } from "@/domains/catalog/components/entries/entry-card";
import { EntryDetail } from "@/domains/catalog/components/entries/entry-detail";
import { EntryFilters } from "@/domains/catalog/components/entries/entry-filters";
import { EntryList } from "@/domains/catalog/components/entries/entry-list";
import type { Entry } from "@/types/entry";
import type { Source } from "@/types/source";
import type { MockLinkProps } from "../../../../helpers/router-harness";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params, search }: MockLinkProps) => (
    <a
      href="#"
      data-link-to={to}
      data-link-params={params ? JSON.stringify(params) : undefined}
      data-link-search={search ? JSON.stringify(search) : undefined}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/domains/catalog/components/profiles/private-notes-panel", () => ({
  PrivateNotesPanel: ({
    targetId,
    targetLabel,
    type,
  }: {
    targetId: string;
    targetLabel: string;
    type: "entry" | "source";
  }) => <div data-testid={`private-notes-${type}-${targetId}`}>{targetLabel}</div>,
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
      <EntryCard
        entry={sampleEntry}
        issueAreaLabels={{ housing_affordability: "Housing" }}
        discoveryContext={{
          issueAreas: ["housing_affordability"],
          places: ["Kansas City", "MO"],
          query: "housing",
        }}
      />,
    );

    expect(screen.getByText("Housing Justice KC")).not.toBeNull();
    expect(screen.getByText("Housing")).not.toBeNull();
    expect(screen.getByText("Source-backed")).not.toBeNull();
    expect(screen.getByText("2 source packets")).not.toBeNull();
    expect(screen.getByText("Latest source: 2026-04-11")).not.toBeNull();
    expect(screen.getByText("Matched because: works on Housing in Kansas City, MO")).not.toBeNull();
    expect(screen.getByText("2 sources · latest 2026-04-11 · Atlas-verified")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Inspect sources" })).not.toBeNull();
  });

  it("surfaces lead-quality signals on browse cards", () => {
    render(
      <EntryCard
        entry={{
          ...sampleEntry,
          latest_source_date: new Date().toISOString(),
          source_types: ["news_article", "report"],
        }}
      />,
    );

    expect(screen.getByText("Local lead")).not.toBeNull();
    expect(screen.getByText("Recent source")).not.toBeNull();
    expect(screen.getByText("Diverse sources")).not.toBeNull();
    expect(screen.getByText("Reachable")).not.toBeNull();
  });

  it("surfaces partner qualification signals from trust, sources, and contactability", () => {
    const { rerender } = render(
      <EntryCard
        entry={{
          ...sampleEntry,
          source_count: 4,
          trust: { ...sampleEntry.trust, level: "subject_verified" },
        }}
      />,
    );

    expect(screen.getByText("Partner-ready")).not.toBeNull();

    rerender(
      <EntryCard
        entry={{
          ...sampleEntry,
          source_count: 4,
          trust: {
            ...sampleEntry.trust,
            level: "corroborated",
            independent_source_count: 3,
          },
        }}
      />,
    );

    expect(screen.getByText("Strong partner lead")).not.toBeNull();

    rerender(
      <EntryCard
        entry={{
          ...sampleEntry,
          email: undefined,
          phone: undefined,
          social_media: undefined,
          source_count: 1,
          trust: { ...sampleEntry.trust, level: "unverified" },
          website: undefined,
        }}
      />,
    );

    expect(screen.getByText("Qualify before outreach")).not.toBeNull();
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

  it("links non-actor entries with slugs to their dedicated detail routes", () => {
    const initiativeEntry: Entry = {
      ...sampleEntry,
      type: "initiative",
      slug: "labor-action-1",
    };
    render(<EntryCard entry={initiativeEntry} />);
    const link = screen.getByRole("link", { name: "Housing Justice KC" });
    expect(link.getAttribute("data-link-to")).toBe("/profiles/initiatives/$slug");
    expect(link.getAttribute("data-link-params")).toBe(JSON.stringify({ slug: "labor-action-1" }));
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

    expect(screen.getAllByText("Midwest").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Latest source:/)).toBeNull();
    // Unverified entries carry no trust badge — silence is the honest signal.
    expect(screen.queryByText("Atlas-verified")).toBeNull();

    rerender(
      <EntryCard
        entry={{
          ...regionEntry,
          region: undefined,
          state: "KS",
        }}
      />,
    );

    expect(screen.getByText("KS")).not.toBeNull();

    rerender(
      <EntryCard
        entry={{
          ...regionEntry,
          region: undefined,
          state: undefined,
        }}
      />,
    );

    expect(screen.getAllByText("Location not specified").length).toBeGreaterThan(0);
  });

  it("renders useful public recovery actions for empty active searches without workspace language", () => {
    render(
      <EntryList
        entries={[]}
        hasActiveSearch
        emptyRecoveryActions={[
          { label: "Remove Housing", onClick: vi.fn() },
          { label: "Browse Missouri", onClick: vi.fn() },
        ]}
      />,
    );

    expect(screen.getByText("No matching people or groups.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove Housing" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Browse Missouri" })).not.toBeNull();
    expect(screen.getByText("Submit a source")).not.toBeNull();
    expect(screen.queryByText(/research/i)).toBeNull();
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

  it("surfaces pending claim review markers on entry cards and detail pages", () => {
    const pendingEntry: Entry = {
      ...sampleEntry,
      claim: {
        status: "pending",
        verification_level: "source-derived",
      },
      trust: { ...sampleEntry.trust, level: "unverified" },
      verified: false,
    };
    const { rerender } = render(<EntryCard entry={pendingEntry} />);

    expect(screen.getByText("Claim under review")).not.toBeNull();

    rerender(<EntryDetail entry={pendingEntry} />);

    expect(screen.getAllByText("Claim under review").length).toBeGreaterThan(0);
    expect(screen.queryByText("Source-linked")).toBeNull();
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
    expect(screen.getByText("Source-backed record")).not.toBeNull();
    expect(screen.getAllByText("2 source packets").length).toBeGreaterThan(0);
    expect(screen.getByText("Source trail")).not.toBeNull();
    expect(screen.getByText("Evidence packets")).not.toBeNull();
    expect(screen.getByText("1 source packet")).not.toBeNull();
    expect(screen.getByText("1 source type")).not.toBeNull();
    expect(screen.getByText("Quoted evidence")).not.toBeNull();
    expect(screen.getAllByText("Coverage story").length).toBeGreaterThan(0);
    expect(screen.getByTestId("private-notes-entry-entry_123")).not.toBeNull();
    expect(screen.getByTestId("private-notes-source-source_123")).not.toBeNull();

    rerender(
      <EntryDetail
        entry={{
          ...sampleEntry,
          city: undefined,
          state: undefined,
          region: "Midwest",
          full_address: undefined,
          issue_areas: [],
          sources: [],
          trust: { ...sampleEntry.trust, level: "unverified" },
          verified: false,
        }}
      />,
    );

    expect(screen.getAllByText("Source-linked").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Midwest").length).toBeGreaterThan(0);
    expect(screen.getByText("No linked sources yet.")).not.toBeNull();

    rerender(
      <EntryDetail
        entry={{
          ...sampleEntry,
          city: undefined,
          region: undefined,
          state: undefined,
          issue_areas: [],
          sources: [],
        }}
      />,
    );

    expect(screen.getAllByText("Location not specified").length).toBeGreaterThan(0);

    rerender(
      <EntryDetail
        entry={{
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
            },
          ],
          website: undefined,
        }}
      />,
    );

    expect(screen.getByText("123 Main St, Kansas City, MO")).not.toBeNull();
    expect(screen.getAllByText("Water Quality").length).toBeGreaterThan(0);
    expect(screen.getAllByText("https://atlas.test/fallback-source").length).toBeGreaterThan(0);
  });

  it("frames entry details as reusable research records with nearby pivots", () => {
    render(
      <EntryDetail entry={sampleEntry} issueAreaLabels={{ housing_affordability: "Housing" }} />,
    );

    expect(screen.getByText("Research record")).not.toBeNull();
    expect(screen.getByText("What you can use this for")).not.toBeNull();
    expect(screen.getByText("Evaluate Housing Justice KC as a local housing lead.")).not.toBeNull();
    expect(screen.getByText("Why this record is usable")).not.toBeNull();
    expect(screen.getAllByText("2 source packets").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Atlas-verified").length).toBeGreaterThan(0);
    expect(screen.getByText("Pivot from this actor")).not.toBeNull();

    const placeLink = screen.getByRole("link", { name: "People and groups in Kansas City" });
    expect(placeLink.getAttribute("data-link-to")).toBe("/browse");
    expect(placeLink.getAttribute("data-link-search")).toBe(
      JSON.stringify({ cities: "Kansas City", states: "MO" }),
    );

    const issueLink = screen.getByRole("link", { name: "Housing actors" });
    expect(issueLink.getAttribute("data-link-to")).toBe("/browse");
    expect(issueLink.getAttribute("data-link-search")).toBe(
      JSON.stringify({ issue_areas: "housing_affordability" }),
    );
  });

  it("surfaces stale record and source warnings on entry detail pages", () => {
    const staleSource: Source = {
      ...sampleSource,
      freshness: {
        created_at: "2024-01-01T00:00:00.000Z",
        ingested_at: "2024-01-01T00:00:00.000Z",
        published_date: "2024-01-01",
        staleness_status: "stale",
        staleness_reason: "Most recent source record date is more than a year old.",
      },
    };

    render(
      <EntryDetail
        entry={{
          ...sampleEntry,
          latest_source_date: "2024-01-01",
          last_seen: "2024-01-01T00:00:00.000Z",
          sources: [staleSource],
        }}
      />,
    );

    expect(screen.getByText("Stale record")).not.toBeNull();
    expect(screen.getByText("Newest source is 2y+ ago.")).not.toBeNull();
    expect(screen.getByText("Stale source")).not.toBeNull();
    expect(
      screen.getByText("Most recent source record date is more than a year old."),
    ).not.toBeNull();
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
          source_patterns: [],
          source_types: [],
          states: [],
        }}
        facets={{
          cities: [],
          entity_types: [{ count: 2, value: "organization" }],
          issue_areas: [{ count: 3, value: "housing_affordability" }],
          regions: [],
          source_patterns: [],
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
          source_patterns: [],
          source_types: ["news_article"],
          states: [],
        }}
        facets={{
          cities: [],
          entity_types: [{ count: 2, value: "organization" }],
          issue_areas: [],
          regions: [],
          source_patterns: [],
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
    expect(screen.queryByText(/Searching the Atlas/i)).toBeNull();

    rerender(<EntryList entries={[]} error={new Error("Search unavailable")} />);
    expect(screen.getAllByText("Search unavailable")).toHaveLength(2);

    rerender(<EntryList entries={[]} hasActiveSearch />);
    expect(screen.getByText("No matching people or groups.")).not.toBeNull();
    expect(screen.queryByText(/yet/i)).toBeNull();

    rerender(<EntryList entries={[]} />);
    expect(screen.getByText("No people or groups listed.")).not.toBeNull();
    expect(screen.getByText("Start with a place, issue, person, or group.")).not.toBeNull();
    expect(screen.queryByText(/seed the directory/i)).toBeNull();

    rerender(<EntryList entries={[sampleEntry]} total={1} />);
    expect(screen.getByText("1 match")).not.toBeNull();
    expect(screen.getByText("Housing Justice KC")).not.toBeNull();

    rerender(<EntryList entries={[sampleEntry]} />);
    expect(screen.queryByText("1 results")).toBeNull();
  });
});

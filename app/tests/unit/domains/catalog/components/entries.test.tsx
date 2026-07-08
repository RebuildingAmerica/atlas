// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EntryCard } from "@/domains/catalog/components/entries/entry-card";
import { EntryDetail } from "@/domains/catalog/components/entries/entry-detail";
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
    linked_entity_ids: [],
    linked_entities: [],
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
});

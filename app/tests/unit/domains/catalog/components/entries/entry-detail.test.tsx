// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntryDetail } from "@/domains/catalog/components/entries/entry-detail";
import { createEntryFixture, createSourceFixture } from "../../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/components/profiles/private-notes-panel", () => ({
  PrivateNotesPanel: ({ targetId, type }: { targetId: string; type: "entry" | "source" }) => (
    <div data-testid={`private-notes-${type}-${targetId}`} />
  ),
}));

describe("EntryDetail research framing", () => {
  it("frames a national record as a national lead on its first issue", () => {
    render(
      <EntryDetail
        entry={createEntryFixture({ geo_specificity: "national", name: "Prairie Coop" })}
        issueAreaLabels={{ housing_affordability: "Housing affordability" }}
      />,
    );

    expect(
      screen.getByText("Evaluate Prairie Coop as a national housing affordability lead."),
    ).toBeInTheDocument();
  });

  it("calls the work civic when the record names no issue area", () => {
    render(<EntryDetail entry={createEntryFixture({ issue_areas: [], name: "Prairie Coop" })} />);
    expect(screen.getByText("Evaluate Prairie Coop as a local civic lead.")).toBeInTheDocument();
  });

  it("humanizes an issue slug the taxonomy does not label", () => {
    render(<EntryDetail entry={createEntryFixture({ issue_areas: ["food_security"] })} />);
    // Once in the research-record summary, once in the issue-area badge row.
    expect(screen.getAllByText("Food Security")).toHaveLength(2);
  });
});

describe("EntryDetail pivots", () => {
  it("pivots on the state when the record names no city", () => {
    render(
      <EntryDetail entry={createEntryFixture({ city: undefined, issue_areas: [], state: "MS" })} />,
    );

    expect(screen.getByRole("link", { name: "People and groups in MS" })).toHaveAttribute(
      "href",
      "/browse?states=MS",
    );
  });

  it("pivots on the region when neither city nor state is known", () => {
    render(
      <EntryDetail
        entry={createEntryFixture({
          city: undefined,
          issue_areas: [],
          region: "Gulf Coast",
          state: undefined,
        })}
      />,
    );

    expect(screen.getByRole("link", { name: "People and groups in Gulf Coast" })).toHaveAttribute(
      "href",
      "/browse?regions=Gulf+Coast",
    );
  });

  it("offers only the issue pivot for a placeless record", () => {
    render(
      <EntryDetail
        entry={createEntryFixture({
          city: undefined,
          issue_areas: ["housing_affordability"],
          region: undefined,
          state: undefined,
        })}
        issueAreaLabels={{ housing_affordability: "Housing affordability" }}
      />,
    );

    expect(screen.getByText("Pivot from this actor")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /People and groups in/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Housing affordability actors" })).toHaveAttribute(
      "href",
      "/browse?issue_areas=housing_affordability",
    );
  });

  it("offers no pivot section for a placeless, issueless record", () => {
    render(
      <EntryDetail
        entry={createEntryFixture({
          city: undefined,
          issue_areas: [],
          region: undefined,
          state: undefined,
        })}
      />,
    );

    expect(screen.queryByText("Pivot from this actor")).not.toBeInTheDocument();
    expect(screen.getAllByText("Location not specified")).toHaveLength(2);
  });
});

describe("EntryDetail verification badge", () => {
  it("credits a verified organization claim as a verified representative", () => {
    render(
      <EntryDetail
        entry={createEntryFixture({
          claim: { status: "verified", verification_level: "subject-verified" },
          type: "organization",
        })}
      />,
    );

    // The badge repeats in the header and in the "why this record is usable" panel.
    expect(screen.getAllByText("Verified representative")).toHaveLength(2);
  });

  it("credits a subject-verified person", () => {
    render(
      <EntryDetail
        entry={createEntryFixture({
          trust: {
            level: "subject_verified",
            independent_source_count: null,
            website_grounded: null,
            email_grounded: null,
          },
        })}
      />,
    );

    expect(screen.getAllByText("Verified person")).toHaveLength(2);
  });

  it("marks a corroborated record as corroborated", () => {
    render(
      <EntryDetail
        entry={createEntryFixture({
          trust: {
            level: "corroborated",
            independent_source_count: 2,
            website_grounded: null,
            email_grounded: null,
          },
        })}
      />,
    );

    expect(screen.getAllByText("Corroborated")).toHaveLength(2);
  });
});

describe("EntryDetail freshness", () => {
  it("stays quiet about staleness when the newest source is recent", () => {
    render(
      <EntryDetail entry={createEntryFixture({ latest_source_date: new Date().toISOString() })} />,
    );

    expect(screen.queryByText("Stale record")).not.toBeInTheDocument();
  });

  it("falls back to the last-seen date when no source carries one", () => {
    render(
      <EntryDetail
        entry={createEntryFixture({
          last_seen: "2020-01-01T00:00:00Z",
          latest_source_date: undefined,
        })}
      />,
    );

    expect(screen.getByText("Stale record")).toBeInTheDocument();
    expect(screen.queryByText(/^Latest source: /)).not.toBeInTheDocument();
  });

  it("names the aging and undated warnings the API sends on a source", () => {
    const aging = render(
      <EntryDetail
        entry={createEntryFixture({
          sources: [
            createSourceFixture({
              freshness: {
                staleness_status: "aging",
                staleness_reason: "Newest source is over six months old.",
              },
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Aging source")).toBeInTheDocument();
    aging.unmount();

    render(
      <EntryDetail
        entry={createEntryFixture({
          sources: [
            createSourceFixture({
              freshness: {
                staleness_status: "unknown",
                staleness_reason: "No source carries a publication date.",
              },
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Undated source")).toBeInTheDocument();
  });

  it("counts no source packets when the record carries no sources array", () => {
    render(<EntryDetail entry={createEntryFixture({ sources: undefined })} />);
    // The source-trail card has no packets of its own to count, so its badge
    // pair stays off the page.
    expect(screen.getByText("Source trail")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ source types?$/)).not.toBeInTheDocument();
  });
});

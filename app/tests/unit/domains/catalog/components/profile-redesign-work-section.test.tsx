// @vitest-environment jsdom

import "./profile-redesign-test-setup";

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkSection } from "@/domains/catalog/components/profiles/work-section";
import {
  createEntryFixture as buildEntry,
  createSourceFixture as buildSource,
} from "../../../../fixtures/catalog/entries";

describe("WorkSection", () => {
  it("renders a recent-activity strip when there are recent sources", () => {
    const entry = buildEntry({
      sources: [
        buildSource({
          extraction_context: "She fights for tenants.",
          published_date: new Date().toISOString().slice(0, 10),
          publication: "MS Today",
        }),
      ],
    });
    render(<WorkSection entry={entry} issueAreaLabels={{}} />);
    expect(screen.getByText(/source in last 90 days/i)).toBeInTheDocument();
  });

  it("hides issue chips when showIssueChips is false", () => {
    const entry = buildEntry({
      sources: [buildSource()],
    });
    render(
      <WorkSection
        entry={entry}
        issueAreaLabels={{ housing_affordability: "Housing" }}
        showIssueChips={false}
      />,
    );
    expect(screen.queryByText("Issue focus")).not.toBeInTheDocument();
  });

  it("shows issue chips by default", () => {
    const entry = buildEntry({
      sources: [buildSource()],
    });
    render(
      <WorkSection
        entry={entry}
        issueAreaLabels={{ housing_affordability: "Housing affordability" }}
      />,
    );
    expect(screen.getByText("Issue focus")).toBeInTheDocument();
    expect(screen.getByText("Housing affordability")).toBeInTheDocument();
  });

  it("renders a composed empty state when entry has no sources, issues, or recent activity", () => {
    const entry = buildEntry({ issue_areas: [], sources: [] });
    render(<WorkSection entry={entry} issueAreaLabels={{}} showIssueChips={false} />);
    expect(screen.getByRole("region", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getByText("No recent coverage on file.")).toBeInTheDocument();
    expect(screen.queryByText(/Atlas keeps watching/i)).not.toBeInTheDocument();
  });

  it("uses the title when most-recent source has no publication", () => {
    const entry = buildEntry({
      sources: [
        buildSource({
          publication: undefined,
          title: "Profile interview",
          published_date: new Date().toISOString().slice(0, 10),
        }),
      ],
    });
    render(<WorkSection entry={entry} issueAreaLabels={{}} />);
    expect(screen.getByText(/Profile interview/)).toBeInTheDocument();
  });

  it("falls back to the date label when most-recent source has neither publication nor title", () => {
    const entry = buildEntry({
      sources: [
        buildSource({
          publication: undefined,
          title: undefined,
          published_date: new Date().toISOString().slice(0, 10),
        }),
      ],
    });
    render(<WorkSection entry={entry} issueAreaLabels={{}} />);
    expect(screen.getByText(/source in last 90 days/i)).toBeInTheDocument();
  });

  it("orders by published_date even when one source omits it", () => {
    const recent = new Date().toISOString().slice(0, 10);
    const entry = buildEntry({
      sources: [
        buildSource({
          id: "older",
          publication: "Older Pub",
          published_date: undefined,
          ingested_at: "2024-01-01T00:00:00Z",
        }),
        buildSource({
          id: "newer",
          publication: "Newer Pub",
          published_date: recent,
          ingested_at: "2024-01-01T00:00:00Z",
        }),
      ],
    });
    render(<WorkSection entry={entry} issueAreaLabels={{}} />);
    expect(screen.getByText(/Newer Pub/)).toBeInTheDocument();
  });

  it("treats sources older than 90 days as no recent activity", () => {
    const old = "2020-01-01";
    const entry = buildEntry({
      issue_areas: ["housing_affordability"],
      sources: [buildSource({ published_date: old, ingested_at: `${old}T00:00:00Z` })],
    });
    render(<WorkSection entry={entry} issueAreaLabels={{ housing_affordability: "Housing" }} />);
    expect(screen.getByText(/No coverage in last 90 days/i)).toBeInTheDocument();
  });

  it("humanizes issue slugs when no label override is provided", () => {
    const entry = buildEntry({
      issue_areas: ["custom_issue_slug"],
      sources: [],
    });
    render(<WorkSection entry={entry} issueAreaLabels={{}} />);
    expect(screen.getByText("Custom Issue Slug")).toBeInTheDocument();
  });

  it("renders no recent strip when no sources but has issue chips", () => {
    const entry = buildEntry({ sources: undefined, issue_areas: ["housing_affordability"] });
    render(<WorkSection entry={entry} issueAreaLabels={{ housing_affordability: "Housing" }} />);
    expect(screen.queryByText(/last 90 days/i)).not.toBeInTheDocument();
    expect(screen.getByText("Housing")).toBeInTheDocument();
  });

  it("shows 'no coverage' when most-recent exists but is older than 90 days", () => {
    const entry = buildEntry({
      issue_areas: [],
      sources: [
        buildSource({
          published_date: "2020-01-01",
          ingested_at: "2020-01-01T00:00:00Z",
        }),
      ],
    });
    render(<WorkSection entry={entry} issueAreaLabels={{}} showIssueChips={false} />);
    expect(screen.getByText(/No coverage in last 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/most recent:/)).toBeInTheDocument();
  });

  it("uses ingested_at when both sources omit published_date", () => {
    const today = new Date();
    const a = new Date(today.getTime() - 5 * 86_400_000);
    const b = new Date(today.getTime() - 3 * 86_400_000);
    const entry = buildEntry({
      issue_areas: [],
      sources: [
        buildSource({
          id: "noPubA",
          publication: "First",
          published_date: undefined,
          ingested_at: a.toISOString(),
        }),
        buildSource({
          id: "noPubB",
          publication: "Second",
          published_date: undefined,
          ingested_at: b.toISOString(),
        }),
      ],
    });
    render(<WorkSection entry={entry} issueAreaLabels={{}} showIssueChips={false} />);
    expect(screen.getByText(/Second/)).toBeInTheDocument();
  });

  it("pluralizes the recent-source count and sorts multiple dated sources", () => {
    const today = new Date();
    const earlier = new Date(today.getTime() - 14 * 86_400_000);
    const later = new Date(today.getTime() - 1 * 86_400_000);
    const entry = buildEntry({
      issue_areas: [],
      sources: [
        buildSource({
          id: "earlier",
          publication: "Earlier Pub",
          published_date: earlier.toISOString().slice(0, 10),
        }),
        buildSource({
          id: "later",
          publication: "Later Pub",
          published_date: later.toISOString().slice(0, 10),
        }),
      ],
    });
    render(<WorkSection entry={entry} issueAreaLabels={{}} showIssueChips={false} />);
    expect(screen.getByText(/2 sources in last 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/Later Pub/)).toBeInTheDocument();
  });
});

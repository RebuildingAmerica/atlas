// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({}),
}));

import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import {
  FreshnessChip,
  formatFreshness,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { NetworkRails } from "@/domains/catalog/components/profiles/network-rails";
import { WorkSection } from "@/domains/catalog/components/profiles/work-section";
import type { ConnectionGroup, Entry, Source } from "@/types";

afterEach(() => {
  cleanup();
});

function buildEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "entry-1",
    type: "person",
    name: "Jane Doe",
    description: "Community organizer focused on housing.",
    city: "Jackson",
    state: "MS",
    geo_specificity: "local",
    first_seen: "2024-01-01T00:00:00Z",
    last_seen: "2026-04-01T00:00:00Z",
    active: true,
    verified: false,
    issue_areas: ["housing_affordability"],
    source_types: [],
    source_count: 3,
    slug: "jane-doe-a3f2",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function buildSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "source-1",
    url: "https://example.com/article",
    title: "Article title",
    publication: "Mississippi Today",
    published_date: "2026-02-01",
    type: "news_article",
    ingested_at: "2026-02-01T00:00:00Z",
    extraction_method: "ai_assisted",
    extraction_context: "Jane Doe leads the housing fight.",
    created_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

describe("formatFreshness", () => {
  it("returns 'today' for same-day timestamps", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    const result = formatFreshness("2026-04-26T08:00:00Z", now);
    expect(result.label).toBe("today");
    expect(result.status).toBe("fresh");
  });

  it("returns weeks-ago for ranges between 7 and 60 days", () => {
    const now = new Date("2026-04-26T00:00:00Z");
    const fortyDays = new Date("2026-03-17T00:00:00Z");
    const result = formatFreshness(fortyDays.toISOString(), now);
    expect(result.label).toMatch(/w ago/);
    expect(result.status).toBe("aging");
  });

  it("flags stale dates beyond 180 days", () => {
    const now = new Date("2026-04-26T00:00:00Z");
    const old = new Date("2024-01-01T00:00:00Z");
    const result = formatFreshness(old.toISOString(), now);
    expect(result.status).toBe("stale");
  });
});

describe("FreshnessChip", () => {
  it("renders the formatted label", () => {
    render(<FreshnessChip isoDate={new Date().toISOString()} prefix="Last seen" />);
    expect(screen.getByText(/Last seen/)).toBeInTheDocument();
  });
});

describe("DataQualityBlock", () => {
  it("renders Atlas-verified state when verified flag is true", () => {
    render(<DataQualityBlock entry={buildEntry({ verified: true })} />);
    expect(screen.getByText("Atlas verified")).toBeInTheDocument();
  });

  it("renders source-derived state when not verified", () => {
    render(<DataQualityBlock entry={buildEntry({ verified: false })} />);
    expect(screen.getByText("Source-derived")).toBeInTheDocument();
  });

  it("shows the source count", () => {
    render(<DataQualityBlock entry={buildEntry({ source_count: 12 })} />);
    expect(screen.getByText("12 sources")).toBeInTheDocument();
  });
});

describe("WorkSection", () => {
  it("renders the signature quote pulled from a source", () => {
    const entry = buildEntry({
      sources: [buildSource({ extraction_context: "She fights for tenants." })],
    });
    render(<WorkSection entry={entry} issueAreaLabels={{}} />);
    expect(screen.getByText("She fights for tenants.")).toBeInTheDocument();
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

  it("renders nothing when entry has no sources, issues, or recent activity", () => {
    const entry = buildEntry({ issue_areas: [], sources: [] });
    const { container } = render(
      <WorkSection entry={entry} issueAreaLabels={{}} showIssueChips={false} />,
    );
    expect(container.querySelector("section")).toBeNull();
  });
});

describe("NetworkRails", () => {
  function buildGroups(): ConnectionGroup[] {
    return [
      {
        type: "same_issue_area",
        actors: [
          {
            id: "a1",
            name: "Marcus Lee",
            type: "person",
            slug: "marcus-lee",
            description_snippet: "Tenant advocate",
            evidence: "Both work on housing",
          },
        ],
      },
      {
        type: "co_mentioned",
        actors: [
          {
            id: "a2",
            name: "Aaliyah Reid",
            type: "person",
            slug: "aaliyah-reid",
            description_snippet: null,
            evidence: "Quoted alongside in MS Today",
          },
        ],
      },
    ];
  }

  it("shows skeleton when loading", () => {
    render(<NetworkRails entry={buildEntry()} connections={[]} isLoading />);
    expect(screen.getByLabelText("Loading network")).toBeInTheDocument();
  });

  it("renders distinctive co-mentioned label", () => {
    render(<NetworkRails entry={buildEntry()} connections={buildGroups()} isLoading={false} />);
    expect(screen.getByText("Co-mentioned in coverage")).toBeInTheDocument();
    expect(screen.getByText("↳ only on Atlas")).toBeInTheDocument();
  });

  it("renders the same-region rail with state suffix", () => {
    const groups: ConnectionGroup[] = [
      {
        type: "same_geography",
        actors: [
          {
            id: "a3",
            name: "Delta Voices",
            type: "organization",
            slug: "delta-voices",
            description_snippet: null,
            evidence: "Both in Greenville",
          },
        ],
      },
    ];
    render(<NetworkRails entry={buildEntry()} connections={groups} isLoading={false} />);
    expect(screen.getByText("Same region · MS")).toBeInTheDocument();
  });

  it("hides empty groups but still renders Browse more", () => {
    render(
      <NetworkRails
        entry={buildEntry()}
        connections={[{ type: "same_organization", actors: [] }]}
        isLoading={false}
      />,
    );
    expect(screen.queryByText("Same organization")).not.toBeInTheDocument();
    expect(screen.getByText(/Keep browsing/i)).toBeInTheDocument();
  });
});

describe("ActionCluster", () => {
  it("renders the Share button always", () => {
    render(<ActionCluster shareUrl="https://example.com" shareTitle="Profile" />);
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });

  it("renders a mailto link when email is supplied", () => {
    render(
      <ActionCluster
        shareUrl="https://example.com"
        shareTitle="Profile"
        email="jane@example.org"
      />,
    );
    const link = screen.getByRole("link", { name: /contact/i });
    expect(link).toHaveAttribute("href", "mailto:jane@example.org");
  });

  it("hides the Contact link when no email is supplied", () => {
    render(<ActionCluster shareUrl="https://example.com" shareTitle="Profile" />);
    expect(screen.queryByRole("link", { name: /contact/i })).not.toBeInTheDocument();
  });

  it("copies the URL to clipboard when Web Share is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ActionCluster shareUrl="https://example.com/jane" shareTitle="Jane Doe" />);
    const button = screen.getByRole("button", { name: /share/i });
    button.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledWith("https://example.com/jane");
  });
});

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const claimsMocks = vi.hoisted(() => ({
  useProfileFollow: vi.fn(),
  useFollowProfile: vi.fn(),
  useUnfollowProfile: vi.fn(),
  useSavedLists: vi.fn(),
  useSavedListMembership: vi.fn(),
  useCreateSavedList: vi.fn(),
  useAddSavedListItem: vi.fn(),
  useRemoveSavedListItem: vi.fn(),
}));

const watchMocks = vi.hoisted(() => ({
  useWorkspaceWatchStatus: vi.fn(),
  useWatchWorkspaceResource: vi.fn(),
  useUnwatchWorkspaceResource: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
  }: {
    children: React.ReactNode;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
    to: string;
  }) => (
    <a
      href={to}
      data-link-params={params ? JSON.stringify(params) : undefined}
      data-link-search={search ? JSON.stringify(search) : undefined}
    >
      {children}
    </a>
  ),
  useRouter: () => ({}),
}));

vi.mock("@/domains/catalog/hooks/use-claims", () => claimsMocks);
vi.mock("@/domains/workspace/hooks/use-workspace-watches", () => watchMocks);
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

import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import {
  FreshnessChip,
  formatFreshness,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { ConnectionList } from "@/domains/catalog/components/profiles/connection-list";
import { ProfileResearchContext } from "@/domains/catalog/components/profiles/profile-research-context";
import { ProfileHistory } from "@/domains/catalog/components/profiles/profile-history";
import { WorkSection } from "@/domains/catalog/components/profiles/work-section";
import type { ConnectedActor, ConnectionNetwork, Entry } from "@/types";
import {
  createEntryFixture as buildEntry,
  createSourceFixture as buildSource,
} from "../../../../fixtures/catalog/entries";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  claimsMocks.useProfileFollow.mockReturnValue({ data: null, isLoading: false });
  claimsMocks.useFollowProfile.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  claimsMocks.useUnfollowProfile.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  claimsMocks.useSavedLists.mockReturnValue({ data: [], isLoading: false });
  claimsMocks.useSavedListMembership.mockReturnValue({ data: [], isLoading: false });
  claimsMocks.useCreateSavedList.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  claimsMocks.useAddSavedListItem.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  claimsMocks.useRemoveSavedListItem.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  watchMocks.useWorkspaceWatchStatus.mockReturnValue({
    data: { watch: null, watched: false },
    isLoading: false,
  });
  watchMocks.useWatchWorkspaceResource.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  watchMocks.useUnwatchWorkspaceResource.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
});

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

  it("returns 'yesterday' for one-day-old timestamps", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    const yesterday = new Date("2026-04-25T08:00:00Z");
    const result = formatFreshness(yesterday.toISOString(), now);
    expect(result.label).toBe("yesterday");
    expect(result.status).toBe("fresh");
  });

  it("returns days-ago for timestamps under a week", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    const threeDays = new Date("2026-04-23T12:00:00Z");
    const result = formatFreshness(threeDays.toISOString(), now);
    expect(result.label).toBe("3d ago");
  });

  it("returns months-ago for timestamps in the months range", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    const sixtyDays = new Date("2026-02-25T12:00:00Z");
    const result = formatFreshness(sixtyDays.toISOString(), now);
    expect(result.label).toMatch(/mo ago/);
  });

  it("returns years-ago for timestamps beyond 730 days", () => {
    const now = new Date("2026-04-26T12:00:00Z");
    const ancient = new Date("2020-01-01T00:00:00Z");
    const result = formatFreshness(ancient.toISOString(), now);
    expect(result.label).toMatch(/y\+ ago/);
  });
});

describe("FreshnessChip", () => {
  it("renders the formatted label", () => {
    render(<FreshnessChip isoDate={new Date().toISOString()} prefix="Last seen" />);
    expect(screen.getByText(/Last seen/)).toBeInTheDocument();
  });
});

describe("DataQualityBlock", () => {
  const trust = (overrides: Partial<Entry["trust"]>): Entry["trust"] => ({
    level: "unverified",
    independent_source_count: null,
    website_grounded: null,
    email_grounded: null,
    ...overrides,
  });

  it("renders Atlas-verified for the atlas_verified trust tier", () => {
    render(<DataQualityBlock entry={buildEntry({ trust: trust({ level: "atlas_verified" }) })} />);
    expect(screen.getByText("Atlas-verified")).toBeInTheDocument();
  });

  it("renders an honest 'Single source' for the unverified tier, never 'Source-derived'", () => {
    render(<DataQualityBlock entry={buildEntry({ trust: trust({ level: "unverified" }) })} />);
    expect(screen.getByText("Single source")).toBeInTheDocument();
    expect(screen.queryByText("Source-derived")).toBeNull();
  });

  it("shows corroboration breadth for the corroborated tier", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({ trust: trust({ level: "corroborated", independent_source_count: 3 }) })}
      />,
    );
    expect(screen.getByText("Corroborated · 3 independent sources")).toBeInTheDocument();
  });

  it("uses the singular for a single corroborating source", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({ trust: trust({ level: "corroborated", independent_source_count: 1 }) })}
      />,
    );
    expect(screen.getByText("Corroborated · 1 independent source")).toBeInTheDocument();
  });

  it("renders a bare 'Corroborated' when the independent source count is unknown", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          trust: trust({ level: "corroborated", independent_source_count: null }),
        })}
      />,
    );
    expect(screen.getByText("Corroborated")).toBeInTheDocument();
  });

  it("shows the source count", () => {
    render(<DataQualityBlock entry={buildEntry({ source_count: 12 })} />);
    expect(screen.getByText("12 sources")).toBeInTheDocument();
  });

  it("shows canonical profile coverage for complete actor records", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          description: "Runs tenant organizing campaigns.",
          city: "Jackson",
          state: "MS",
          issue_areas: ["housing_affordability"],
          source_count: 3,
          website: "https://janedoe.example",
        })}
      />,
    );

    expect(screen.getByText("Profile shape")).toBeInTheDocument();
    expect(screen.getByText("6 of 6 core fields")).toBeInTheDocument();
    const shapeFields = within(screen.getByLabelText("Canonical profile fields"));
    for (const label of ["Identity", "Work", "Place", "Issues", "Sources", "Contact"]) {
      expect(shapeFields.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows missing canonical profile fields without implementation copy", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          description: "",
          city: undefined,
          state: undefined,
          issue_areas: [],
          source_count: 0,
          website: undefined,
          email: undefined,
          phone: undefined,
          social_media: undefined,
        })}
      />,
    );

    expect(screen.getByText("1 of 6 core fields")).toBeInTheDocument();
    expect(screen.getByText("Missing Work, Place, Issues, Sources, Contact")).toBeInTheDocument();
    expect(screen.queryByText(/still gathering/i)).not.toBeInTheDocument();
  });

  it("renders claim-level evidence for visible profile facts", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim_evidence: {
            summary: {
              source_count: 3,
              source_ids: ["source-1", "source-2", "source-3"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            place: {
              source_count: 3,
              source_ids: ["source-1", "source-2", "source-3"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            issues: {
              source_count: 3,
              source_ids: ["source-1", "source-2", "source-3"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            contact: {
              source_count: 1,
              source_ids: ["source-1"],
              confidence: "partial",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
          },
        })}
      />,
    );

    expect(screen.getByText("Claim evidence")).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getAllByText("Place").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issues").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Contact").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 sources · corroborated · Apr 2026/)).toHaveLength(3);
    expect(screen.getByText(/1 source · partial · Apr 2026/)).toBeInTheDocument();
  });

  it("shows lead-quality signals from geography, freshness, source mix, and contact data", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          latest_source_date: new Date().toISOString(),
          source_types: ["news_article", "report"],
          website: "https://example.org",
        })}
      />,
    );

    expect(screen.getByText("Lead signals")).toBeInTheDocument();
    expect(screen.getByText("Local lead")).toBeInTheDocument();
    expect(screen.getByText("Recent source")).toBeInTheDocument();
    expect(screen.getByText("Diverse sources")).toBeInTheDocument();
    expect(screen.getByText("Reachable")).toBeInTheDocument();
  });

  it("shows actor-specificity quality for records with a concrete actor, work, place, issues, and sources", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          actor_quality: {
            level: "specific_actor",
            score: 5,
            total: 5,
            present: ["actor", "work", "place", "issues", "sources"],
            missing: [],
          },
        })}
      />,
    );

    expect(screen.getByText("Actor specificity")).toBeInTheDocument();
    expect(screen.getByText("5 of 5 specificity signals")).toBeInTheDocument();
    expect(screen.getByText("Specific actor")).toBeInTheDocument();
  });

  it("names missing actor-specificity fields without implementation copy", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          actor_quality: {
            level: "thin_record",
            score: 2,
            total: 5,
            present: ["actor", "sources"],
            missing: ["work", "place", "issues"],
          },
        })}
      />,
    );

    expect(screen.getByText("2 of 5 specificity signals")).toBeInTheDocument();
    expect(screen.getByText("Missing Work, Place, Issues")).toBeInTheDocument();
    expect(screen.queryByText(/still gathering/i)).not.toBeInTheDocument();
  });

  it("renders the inline claim CTA for unclaimed profiles", () => {
    render(<DataQualityBlock entry={buildEntry()} />);
    const cta = screen.getByRole("link", { name: /Are you Jane Doe\? Claim this profile/i });
    expect(cta).toHaveAttribute("href", expect.stringContaining("/claim"));
  });

  it("surfaces representation, stale-data, and missing-context stewardship paths", () => {
    render(<DataQualityBlock entry={buildEntry({ id: "entry-1", slug: "jane-doe-a3f2" })} />);

    expect(screen.getByText("Corrections")).toBeInTheDocument();
    expect(screen.queryByText("Improve this record")).not.toBeInTheDocument();

    const claim = screen.getByRole("link", { name: "Claim or correct representation" });
    expect(claim).toHaveAttribute("href", "/claim/$slug");
    expect(claim).toHaveAttribute("data-link-params", JSON.stringify({ slug: "jane-doe-a3f2" }));

    const report = screen.getByRole("link", { name: "Report stale or incorrect information" });
    expect(report).toHaveAttribute("href", "/feedback/$slug");
    expect(report).toHaveAttribute("data-link-params", JSON.stringify({ slug: "jane-doe-a3f2" }));
    expect(report).toHaveAttribute("data-link-search", JSON.stringify({ kind: "incorrect" }));

    const missing = screen.getByRole("link", { name: "Suggest missing context" });
    expect(missing).toHaveAttribute("href", "/feedback/$slug");
    expect(missing).toHaveAttribute(
      "data-link-search",
      JSON.stringify({ kind: "missing_context" }),
    );
  });

  it("hides the claim CTA once the profile is verified by subject", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim: { status: "verified", verification_level: "subject-verified" },
        })}
      />,
    );
    expect(screen.queryByRole("link", { name: /claim this profile/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Verified by subject/i)).toBeInTheDocument();
  });

  it("shows the pending status without a claim CTA while the claim is under review", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim: { status: "pending", verification_level: "source-derived" },
        })}
      />,
    );
    expect(screen.getByText(/Claim under review/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /claim this profile/i })).not.toBeInTheDocument();
  });

  it("appends the verification date when verified_at is present", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim: {
            status: "verified",
            verification_level: "subject-verified",
            claim_verified_at: "2026-01-15T00:00:00Z",
          },
        })}
      />,
    );
    expect(screen.getByText(/Verified by subject —/)).toBeInTheDocument();
  });

  it("renders the revoked claim CTA without the entry name", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim: { status: "revoked", verification_level: "source-derived" },
        })}
      />,
    );
    expect(screen.getByRole("link", { name: /^Claim this profile/ })).toBeInTheDocument();
  });

  it("uses the singular 'source' label when there is exactly one source", () => {
    render(<DataQualityBlock entry={buildEntry({ source_count: 1 })} />);
    expect(screen.getByText("1 source")).toBeInTheDocument();
  });

  it("falls back to last_seen when latest_source_date is not available", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          last_seen: new Date().toISOString(),
        })}
      />,
    );
    expect(screen.getAllByText(/today|d ago/).length).toBeGreaterThan(0);
  });
});

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

describe("ProfileResearchContext", () => {
  it("frames profiles as evidence snapshots with profile-section pivots", () => {
    render(
      <ProfileResearchContext
        entry={buildEntry({
          email: "jane@example.org",
          issue_areas: ["housing_affordability"],
          source_count: 3,
          sources: [buildSource()],
        })}
        issueAreaLabels={{ housing_affordability: "Housing" }}
      />,
    );

    expect(screen.getByText("Evidence")).toBeInTheDocument();
    expect(screen.queryByText("Reusable research record")).not.toBeInTheDocument();
    expect(screen.queryByText("Record reuse loop")).not.toBeInTheDocument();
    expect(screen.getByText("Related people and groups")).toBeInTheDocument();
    expect(screen.getAllByText("Issues").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sources").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Contact").length).toBeGreaterThan(0);
    expect(screen.getByText("3 sources")).toBeInTheDocument();

    const placeLink = screen.getByRole("link", { name: "People and groups in Jackson" });
    expect(placeLink).toHaveAttribute(
      "data-link-search",
      JSON.stringify({ cities: "Jackson", states: "MS" }),
    );

    const issueLink = screen.getByRole("link", { name: "Housing actors" });
    expect(issueLink).toHaveAttribute(
      "data-link-search",
      JSON.stringify({ issue_areas: "housing_affordability" }),
    );
  });
});

describe("ProfileHistory", () => {
  it("shows the public record timeline from existing profile evidence", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          first_seen: "2024-01-15T00:00:00Z",
          latest_source_date: "2026-04-12",
          updated_at: "2026-04-20T00:00:00Z",
          claim: {
            status: "verified",
            verification_level: "subject-verified",
            claim_verified_at: "2026-03-10T00:00:00Z",
          },
          sources: [
            buildSource({
              title: "Tenant hotline expands",
              publication: "Mississippi Today",
              published_date: "2026-04-12",
            }),
            buildSource({
              title: "Earlier profile",
              publication: "Jackson Free Press",
              published_date: "2025-11-02",
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Record history")).toBeInTheDocument();
    expect(screen.getByText("First listed")).toBeInTheDocument();
    expect(screen.getByText(/Jan 2024/)).toBeInTheDocument();
    expect(screen.getByText("Latest source")).toBeInTheDocument();
    expect(screen.getByText(/Mississippi Today/)).toBeInTheDocument();
    expect(screen.getByText("Subject verified")).toBeInTheDocument();
    expect(screen.getByText("Representation updated")).toBeInTheDocument();
  });

  it("shows an audit trail for corrections, verification, and representation changes", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          slug: "jane-doe-a3f2",
          first_seen: "2024-01-15T00:00:00Z",
          created_at: "2024-01-15T00:00:00Z",
          updated_at: "2026-04-20T00:00:00Z",
          claim: {
            status: "pending",
            verification_level: "source-derived",
          },
        })}
      />,
    );

    expect(screen.getByText("Audit trail")).toBeInTheDocument();
    expect(screen.getByText("Correction review")).toBeInTheDocument();
    const correctionLink = screen.getByRole("link", { name: "Send a correction" });
    expect(correctionLink).toHaveAttribute("href", "/feedback/$slug");
    expect(correctionLink).toHaveAttribute(
      "data-link-params",
      JSON.stringify({ slug: "jane-doe-a3f2" }),
    );
    expect(screen.getByText("Verification review")).toBeInTheDocument();
    expect(screen.getByText("Representation claim awaiting review.")).toBeInTheDocument();
    expect(screen.getByText("Representation changes")).toBeInTheDocument();
    expect(screen.getByText("Public profile fields changed Apr 2026.")).toBeInTheDocument();
  });

  it("uses an honest history state when dated source and verification evidence is absent", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          first_seen: "2024-01-15T00:00:00Z",
          latest_source_date: undefined,
          last_seen: "2024-01-15T00:00:00Z",
          updated_at: "2024-01-15T00:00:00Z",
          sources: [],
          claim: { status: "unclaimed", verification_level: "source-derived" },
        })}
      />,
    );

    expect(screen.getByText("No dated source updates.")).toBeInTheDocument();
    expect(screen.queryByText(/still gathering/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pipeline/i)).not.toBeInTheDocument();
  });
});

describe("AppearancesList", () => {
  it("summarizes sources as evidence packets with quoted extraction context", () => {
    render(
      <AppearancesList
        mode="organization"
        sources={[
          buildSource({
            extraction_context: "The coalition hosts a tenant hotline.",
            publication: "MS Today",
            type: "news_article",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Evidence packets")).toBeInTheDocument();
    expect(screen.getByText("1 source packet")).toBeInTheDocument();
    expect(screen.getByText("1 source type")).toBeInTheDocument();
    expect(screen.getByText("Quoted evidence")).toBeInTheDocument();
    expect(screen.getByTestId("private-notes-source-source-1")).toBeInTheDocument();
  });

  it("anchors source packets for relationship evidence links", () => {
    render(<AppearancesList mode="organization" sources={[buildSource({ id: "source-1" })]} />);

    expect(document.getElementById("source-source-1")).not.toBeNull();
  });

  it("surfaces API-provided stale source warnings on evidence packets", () => {
    render(
      <AppearancesList
        mode="organization"
        sources={[
          buildSource({
            freshness: {
              staleness_status: "stale",
              staleness_reason: "Most recent source record date is more than a year old.",
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Stale source")).toBeInTheDocument();
    expect(
      screen.getByText("Most recent source record date is more than a year old."),
    ).toBeInTheDocument();
  });
});

describe("ConnectionList", () => {
  function buildActor(overrides: Partial<ConnectedActor> = {}): ConnectedActor {
    return {
      id: "a1",
      name: "Marcus Lee",
      type: "person",
      slug: "marcus-lee",
      description_snippet: "Tenant advocate",
      score: 5,
      strength: 100,
      tier: "strong",
      reasons: [{ kind: "same_organization", label: "Their organization", count: null }],
      evidence: "Their organization",
      ...overrides,
    };
  }

  function buildNetwork(actors: ConnectedActor[], total?: number): ConnectionNetwork {
    return { actors, total: total ?? actors.length };
  }

  it("shows a labeled skeleton while loading with no server data", () => {
    render(<ConnectionList entry={buildEntry()} network={undefined} isLoading />);
    const skeleton = screen.getByLabelText("Loading network");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(/Loading connections/i)).toBeInTheDocument();
  });

  it("keeps server-provided data visible without a skeleton while revalidating", () => {
    render(
      <ConnectionList entry={buildEntry()} network={buildNetwork([buildActor()])} isLoading />,
    );
    expect(screen.queryByLabelText("Loading network")).not.toBeInTheDocument();
    expect(screen.getByText("Marcus Lee")).toBeInTheDocument();
  });

  it("renders ranked rows with the strength tier and reason chips", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([buildActor()])}
        isLoading={false}
      />,
    );
    expect(screen.getByText("Marcus Lee")).toBeInTheDocument();
    expect(screen.getByText("Their organization")).toBeInTheDocument();
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

  it("links source-backed relationship reasons to the matching evidence packet", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([
          buildActor({
            reasons: [
              {
                kind: "sourced_edge",
                label: "Staff profile",
                count: 1,
                source_id: "source-1",
              },
            ],
            evidence: "Staff profile",
          }),
        ])}
        isLoading={false}
      />,
    );

    expect(screen.getByRole("link", { name: "Staff profile" })).toHaveAttribute(
      "href",
      "#source-source-1",
    );
  });

  it("shows the semantic relationship type for source-backed connections", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([
          buildActor({
            reasons: [
              {
                kind: "sourced_edge",
                label: "Staff profile",
                count: 1,
                source_id: "source-1",
                relationship_type: "staff",
              },
            ],
            evidence: "Staff profile",
          }),
        ])}
        isLoading={false}
      />,
    );

    expect(screen.getByText("Staff")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Staff profile" })).toHaveAttribute(
      "href",
      "#source-source-1",
    );
  });

  it("labels the moderate and light tiers", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([
          buildActor({ id: "m", name: "Mod Tie", slug: "mod", tier: "moderate", strength: 50 }),
          buildActor({ id: "w", name: "Weak Tie", slug: "weak", tier: "weak", strength: 20 }),
        ])}
        isLoading={false}
      />,
    );
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
  });

  it("links person actors to the people route and org actors to the org route", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([
          buildActor({ id: "p", name: "Person A", type: "person", slug: "person-a" }),
          buildActor({ id: "o", name: "Acme Org", type: "organization", slug: "acme-org" }),
        ])}
        isLoading={false}
      />,
    );
    expect(screen.getByRole("link", { name: /Person A/ })).toHaveAttribute(
      "href",
      "/profiles/people/$slug",
    );
    expect(screen.getByRole("link", { name: /Acme Org/ })).toHaveAttribute(
      "href",
      "/profiles/organizations/$slug",
    );
  });

  it("renders an unlinked row when the actor has no slug", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([buildActor({ id: "anon", name: "Anon Actor", slug: null })])}
        isLoading={false}
      />,
    );
    expect(screen.getByText("Anon Actor")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Anon Actor/ })).not.toBeInTheDocument();
  });

  it("shows an honest 'strongest of N' note when the total exceeds the page", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([buildActor()], 25)}
        isLoading={false}
      />,
    );
    expect(screen.getByText(/strongest of 25 connections/i)).toBeInTheDocument();
  });

  it("omits the total note when everything is shown", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([buildActor()])}
        isLoading={false}
      />,
    );
    expect(screen.queryByText(/strongest of/i)).not.toBeInTheDocument();
  });

  it("shows an empty state with full browse links when there are no connections", () => {
    render(<ConnectionList entry={buildEntry()} network={buildNetwork([])} isLoading={false} />);
    expect(screen.getByText(/No connections surfaced yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Keep exploring/i)).toBeInTheDocument();
    expect(screen.getByText("More people in MS")).toBeInTheDocument();
    expect(screen.getByText("Organizations working on Housing Affordability")).toBeInTheDocument();
    expect(screen.getByText("Housing Affordability in another place")).toBeInTheDocument();
    expect(screen.getByText("All profiles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /More people in MS/ })).toHaveAttribute(
      "data-link-search",
      JSON.stringify({ entry_types: "person", states: "MS" }),
    );
  });

  it("treats undefined network (not loading) as empty", () => {
    render(<ConnectionList entry={buildEntry()} network={undefined} isLoading={false} />);
    expect(screen.getByText(/No connections surfaced yet/i)).toBeInTheDocument();
  });

  it("renders a minimal browse-more list when entry lacks state and issue areas", () => {
    render(
      <ConnectionList
        entry={buildEntry({ state: undefined, issue_areas: [] })}
        network={buildNetwork([])}
        isLoading={false}
      />,
    );
    expect(screen.getByText("All profiles")).toBeInTheDocument();
    expect(screen.queryByText(/All profiles in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Browse by issue area/)).not.toBeInTheDocument();
  });
});

describe("ActionCluster", () => {
  const baseProps = {
    entryId: "entry-1",
    entrySlug: "jane-doe-a3f2",
    shareUrl: "https://example.com/jane",
    shareTitle: "Jane Doe",
    profilePath: "/profiles/people/jane-doe",
    sourcesHref: "#reporting-trail",
  };

  it("keeps source inspection in the public action strip", () => {
    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    expect(screen.getByRole("link", { name: /inspect sources/i })).toHaveAttribute(
      "href",
      "#reporting-trail",
    );
  });

  it("renders the Share button always", () => {
    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });

  it("renders a mailto link when email is supplied", () => {
    render(<ActionCluster {...baseProps} email="jane@example.org" isSignedIn={false} />);
    const link = screen.getByRole("link", { name: /contact/i });
    expect(link).toHaveAttribute("href", "mailto:jane@example.org");
  });

  it("hides the Contact link when no email is supplied", () => {
    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    expect(screen.queryByRole("link", { name: /contact/i })).not.toBeInTheDocument();
  });

  it("renders Save and Follow as sign-in links when anonymous", () => {
    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    const save = screen.getByRole("link", { name: /save/i });
    const follow = screen.getByRole("link", { name: /follow/i });
    expect(save).toHaveAttribute("href", expect.stringContaining("/sign-in"));
    expect(follow).toHaveAttribute("href", expect.stringContaining("/sign-in"));
  });

  it("renders Save and Follow as buttons when signed in", () => {
    render(<ActionCluster {...baseProps} isSignedIn />);
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /follow/i })).toBeInTheDocument();
  });

  it("opens the save-list picker on Save click when signed in", () => {
    render(<ActionCluster {...baseProps} isSignedIn />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(screen.getByRole("dialog", { name: /save to list/i })).toBeInTheDocument();
  });

  it("copies the URL to clipboard when Web Share is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    const button = screen.getByRole("button", { name: /share/i });
    button.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledWith("https://example.com/jane");
  });

  it("shows the 'Link copied' label after a clipboard copy and resets after timeout", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    const button = screen.getByRole("button", { name: /share/i });
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /link copied/i })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
  });

  it("uses the Web Share API when available and shows the 'Shared' label", async () => {
    vi.useFakeTimers();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: share,
    });

    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    await act(async () => {
      screen.getByRole("button", { name: /share/i }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(share).toHaveBeenCalledWith({
      url: "https://example.com/jane",
      title: "Jane Doe",
    });
    expect(screen.getByRole("button", { name: /^shared$/i })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();

    Reflect.deleteProperty(navigator, "share");
  });

  it("falls through to the clipboard path when navigator.share rejects", async () => {
    const share = vi.fn().mockRejectedValue(new Error("denied"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: share,
    });
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    await act(async () => {
      screen.getByRole("button", { name: /share/i }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(share).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("https://example.com/jane");

    Reflect.deleteProperty(navigator, "share");
  });

  it("invokes the follow mutation when the user is not yet following", async () => {
    const followMutate = vi.fn().mockResolvedValue(undefined);
    claimsMocks.useProfileFollow.mockReturnValue({ data: null, isLoading: false });
    claimsMocks.useFollowProfile.mockReturnValue({ mutateAsync: followMutate, isPending: false });

    render(<ActionCluster {...baseProps} isSignedIn />);
    await act(async () => {
      screen.getByRole("button", { name: /follow updates/i }).click();
      await Promise.resolve();
    });

    expect(followMutate).toHaveBeenCalledWith("jane-doe-a3f2");
  });

  it("invokes the unfollow mutation when the user is already following", async () => {
    const unfollowMutate = vi.fn().mockResolvedValue(undefined);
    claimsMocks.useProfileFollow.mockReturnValue({
      data: { followed: true },
      isLoading: false,
    });
    claimsMocks.useUnfollowProfile.mockReturnValue({
      mutateAsync: unfollowMutate,
      isPending: false,
    });

    render(<ActionCluster {...baseProps} isSignedIn />);
    await act(async () => {
      screen.getByRole("button", { name: /following/i }).click();
      await Promise.resolve();
    });

    expect(unfollowMutate).toHaveBeenCalledWith("jane-doe-a3f2");
  });

  it("watches the entry in the active workspace when the profile is not watched", async () => {
    const watchMutate = vi.fn().mockResolvedValue(undefined);
    watchMocks.useWorkspaceWatchStatus.mockReturnValue({
      data: { watch: null, watched: false },
      isLoading: false,
    });
    watchMocks.useWatchWorkspaceResource.mockReturnValue({
      mutateAsync: watchMutate,
      isPending: false,
    });

    render(
      <ActionCluster {...baseProps} isSignedIn workspaceId="org_123" workspaceWatchingEnabled />,
    );
    await act(async () => {
      screen.getByRole("button", { name: /^watch$/i }).click();
      await Promise.resolve();
    });

    expect(watchMocks.useWorkspaceWatchStatus).toHaveBeenCalledWith(
      {
        resourceId: "entry-1",
        resourceType: "entry",
      },
      true,
      "org_123",
    );
    expect(watchMutate).toHaveBeenCalledWith({
      notificationPreference: "digest",
      resourceId: "entry-1",
      resourceType: "entry",
    });
  });

  it("unwatches the entry in the active workspace when the profile is watched", async () => {
    const unwatchMutate = vi.fn().mockResolvedValue(undefined);
    watchMocks.useWorkspaceWatchStatus.mockReturnValue({
      data: {
        watch: {
          created_at: "2026-06-25T00:00:00Z",
          created_by: "user_1",
          id: "watch_1",
          notification_preference: "digest",
          org_id: "org_1",
          resource_id: "entry-1",
          resource_type: "entry",
          updated_at: "2026-06-25T00:00:00Z",
        },
        watched: true,
      },
      isLoading: false,
    });
    watchMocks.useUnwatchWorkspaceResource.mockReturnValue({
      mutateAsync: unwatchMutate,
      isPending: false,
    });

    render(<ActionCluster {...baseProps} isSignedIn workspaceWatchingEnabled />);
    await act(async () => {
      screen.getByRole("button", { name: /^watching$/i }).click();
      await Promise.resolve();
    });

    expect(unwatchMutate).toHaveBeenCalledWith({
      resourceId: "entry-1",
      resourceType: "entry",
    });
  });

  it("leaves the share label unchanged when both Web Share and clipboard fail", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    const button = screen.getByRole("button", { name: /^share$/i });
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
  });

  it("closes the save-list picker when the picker requests close", () => {
    claimsMocks.useSavedLists.mockReturnValue({
      data: [{ id: "list-1", name: "Reading", item_count: 0 }],
      isLoading: false,
    });

    render(<ActionCluster {...baseProps} isSignedIn />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(screen.getByRole("dialog", { name: /save to list/i })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /save to list/i })).not.toBeInTheDocument();
  });
});

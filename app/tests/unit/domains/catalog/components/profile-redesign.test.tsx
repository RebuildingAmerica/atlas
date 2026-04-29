// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({}),
}));

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useProfileFollow: () => ({ data: null, isLoading: false }),
  useFollowProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnfollowProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSavedLists: () => ({ data: [], isLoading: false }),
  useSavedListMembership: () => ({ data: [], isLoading: false }),
  useCreateSavedList: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddSavedListItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveSavedListItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import {
  FreshnessChip,
  formatFreshness,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { NetworkRails } from "@/domains/catalog/components/profiles/network-rails";
import { WorkSection } from "@/domains/catalog/components/profiles/work-section";
import type { ConnectionGroup } from "@/types";
import {
  createEntryFixture as buildEntry,
  createSourceFixture as buildSource,
} from "../../../../fixtures/catalog/entries";

afterEach(() => {
  cleanup();
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
    expect(screen.getByText("Atlas-verified")).toBeInTheDocument();
  });

  it("renders source-derived state when not verified", () => {
    render(<DataQualityBlock entry={buildEntry({ verified: false })} />);
    expect(screen.getByText("Source-derived")).toBeInTheDocument();
  });

  it("shows the source count", () => {
    render(<DataQualityBlock entry={buildEntry({ source_count: 12 })} />);
    expect(screen.getByText("12 sources")).toBeInTheDocument();
  });

  it("renders the inline claim CTA for unclaimed profiles", () => {
    render(<DataQualityBlock entry={buildEntry()} />);
    const cta = screen.getByRole("link", { name: /Are you Jane Doe\? Claim this profile/i });
    expect(cta).toHaveAttribute("href", expect.stringContaining("/claim"));
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
  const baseProps = {
    entryId: "entry-1",
    entrySlug: "jane-doe-a3f2",
    shareUrl: "https://example.com/jane",
    shareTitle: "Jane Doe",
    profilePath: "/profiles/people/jane-doe",
  };

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
});

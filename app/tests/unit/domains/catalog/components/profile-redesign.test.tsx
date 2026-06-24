// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({}),
}));

vi.mock("@/domains/catalog/hooks/use-claims", () => claimsMocks);

import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import {
  FreshnessChip,
  formatFreshness,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { ConnectionList } from "@/domains/catalog/components/profiles/connection-list";
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

  it("renders nothing when entry has no sources, issues, or recent activity", () => {
    const entry = buildEntry({ issue_areas: [], sources: [] });
    const { container } = render(
      <WorkSection entry={entry} issueAreaLabels={{}} showIssueChips={false} />,
    );
    expect(container.querySelector("section")).toBeNull();
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

  it("shows a skeleton while loading with no server data", () => {
    render(<ConnectionList entry={buildEntry()} network={undefined} isLoading />);
    expect(screen.getByLabelText("Loading network")).toBeInTheDocument();
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
    expect(screen.getByText("All profiles in MS")).toBeInTheDocument();
    expect(screen.getByText("Browse by issue area")).toBeInTheDocument();
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

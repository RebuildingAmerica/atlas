// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowsSummarySection } from "@/domains/workspace/components/follows-summary-section";
import type {
  ActivitySummary,
  FeedActivityItem,
} from "@/domains/workspace/server/research-summary";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to?: string;
    params?: Record<string, string>;
  }) => (
    <a href={to} data-link-to={to} data-link-params={params ? JSON.stringify(params) : undefined}>
      {children}
    </a>
  ),
}));

vi.mock("@/domains/catalog/components/profiles/actor-avatar", () => ({
  ActorAvatar: ({ name, type }: { name: string; type: string }) => (
    <span data-testid="actor-avatar" data-avatar-type={type} aria-label={name} />
  ),
}));

describe("FollowsSummarySection", () => {
  afterEach(() => {
    cleanup();
  });

  function item(overrides: Partial<FeedActivityItem>): FeedActivityItem {
    return {
      entryId: "e1",
      entryName: "Acme",
      entrySlug: "acme",
      entryType: "organization",
      sourceId: "s1",
      sourceUrl: "https://acme.test/news",
      sourceTitle: null,
      sourcePublication: null,
      ingestedAt: "2026-06-20T00:00:00.000Z",
      ...overrides,
    };
  }

  function populatedActivity(): ActivitySummary {
    return {
      newSourcesThisWeek: 2,
      followedActorCount: 2,
      recentItems: [
        item({ entryId: "e1", entryName: "Acme", entrySlug: "acme", entryType: "organization" }),
        item({ entryId: "e1", entryName: "Acme", sourceId: "s2" }),
        item({ entryId: "e2", entryName: "Jane", entrySlug: null, entryType: "person" }),
      ],
    };
  }

  it("renders distinct followed actors with avatars, linking only those with a slug", () => {
    render(<FollowsSummarySection activity={populatedActivity()} />);

    expect(screen.getByText("2 actors")).toBeInTheDocument();
    const avatars = screen.getAllByTestId("actor-avatar");
    expect(avatars).toHaveLength(2);
    expect(avatars[0]).toHaveAttribute("data-avatar-type", "organization");
    expect(avatars[1]).toHaveAttribute("data-avatar-type", "person");

    const acme = screen.getByRole("link", { name: /Acme/ });
    expect(acme).toHaveAttribute("data-link-to", "/profiles/organizations/$slug");
    expect(acme).toHaveAttribute("data-link-params", JSON.stringify({ slug: "acme" }));
    expect(screen.queryByRole("link", { name: /Jane/ })).not.toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
  });

  it("links a followed person with a slug to the people profile and uses singular copy", () => {
    render(
      <FollowsSummarySection
        activity={{
          newSourcesThisWeek: 1,
          followedActorCount: 1,
          recentItems: [
            item({ entryId: "p1", entryName: "Ada", entrySlug: "ada", entryType: "person" }),
          ],
        }}
      />,
    );

    expect(screen.getByText("1 actor")).toBeInTheDocument();
    const ada = screen.getByRole("link", { name: /Ada/ });
    expect(ada).toHaveAttribute("data-link-to", "/profiles/people/$slug");
    expect(ada).toHaveAttribute("data-link-params", JSON.stringify({ slug: "ada" }));
  });

  it("shows the follow prompt when nothing is followed", () => {
    render(
      <FollowsSummarySection
        activity={{ newSourcesThisWeek: 0, followedActorCount: 0, recentItems: [] }}
      />,
    );

    expect(screen.getByText("You're not following anyone yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse profiles" })).toHaveAttribute(
      "data-link-to",
      "/profiles",
    );
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivitySummarySection } from "@/domains/workspace/components/activity-summary-section";
import type { ActivitySummary } from "@/domains/workspace/server/research-summary";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ActivitySummarySection", () => {
  afterEach(() => {
    cleanup();
  });

  function populatedActivity(): ActivitySummary {
    return {
      newSourcesThisWeek: 1,
      followedActorCount: 2,
      recentItems: [
        {
          entryId: "e1",
          entryName: "Acme",
          entrySlug: "acme",
          entryType: "organization",
          sourceId: "s1",
          sourceUrl: "https://acme.test/news",
          sourceTitle: "Big news",
          sourcePublication: "Acme Times",
          ingestedAt: "2026-06-20T00:00:00.000Z",
        },
        {
          entryId: "e2",
          entryName: "Jane",
          entrySlug: null,
          entryType: "person",
          sourceId: "s2",
          sourceUrl: "https://jane.test/post",
          sourceTitle: null,
          sourcePublication: null,
          ingestedAt: "2026-06-19T00:00:00.000Z",
        },
      ],
    };
  }

  function emptyActivity(): ActivitySummary {
    return { newSourcesThisWeek: 0, followedActorCount: 0, recentItems: [] };
  }

  it("renders the singular headline, inline rows, and a link to the full feed", () => {
    render(<ActivitySummarySection activity={populatedActivity()} />);

    expect(screen.getByText("1 new source")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Big news")).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    const seeAll = screen.getByRole("link", { name: "See all activity" });
    expect(seeAll).toHaveAttribute("data-link-to", "/feed");
  });

  it("pluralizes the source headline when more than one source landed", () => {
    const activity = populatedActivity();
    activity.newSourcesThisWeek = 3;
    render(<ActivitySummarySection activity={activity} />);

    expect(screen.getByText("3 new sources")).toBeInTheDocument();
  });

  it("shows the follow prompt and no feed link when nothing is tracked", () => {
    render(<ActivitySummarySection activity={emptyActivity()} />);

    expect(screen.getByText("Your activity feed is quiet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See all activity" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse profiles" })).toHaveAttribute(
      "data-link-to",
      "/profiles",
    );
  });
});

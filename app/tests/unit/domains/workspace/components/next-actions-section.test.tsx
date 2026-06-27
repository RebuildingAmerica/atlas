// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextActionsSection } from "@/domains/workspace/components/next-actions-section";
import type { ResearchSummary } from "@/domains/workspace/server/research-summary";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to?: string }) => (
    <a href={to} data-link-to={to}>
      {children}
    </a>
  ),
}));

describe("NextActionsSection", () => {
  afterEach(() => {
    cleanup();
  });

  function emptySummary(): ResearchSummary {
    return {
      lists: [],
      activity: { newSourcesThisWeek: 0, recentItems: [], followedActorCount: 0 },
      recentRuns: [],
      totals: { savedActors: 0, listCount: 0, runsThisMonth: 0 },
      watchlists: [],
    };
  }

  function fullSummary(): ResearchSummary {
    return {
      lists: [{ id: "list_1", name: "Climate", description: null, itemCount: 2 }],
      activity: { newSourcesThisWeek: 1, recentItems: [], followedActorCount: 3 },
      recentRuns: [
        {
          id: "r1",
          locationQuery: "Kansas City, MO",
          state: "MO",
          status: "completed",
          startedAt: "2026-06-20T00:00:00.000Z",
          issueAreas: ["housing_affordability"],
        },
      ],
      totals: { savedActors: 2, listCount: 1, runsThisMonth: 1 },
      watchlists: [],
    };
  }

  it("offers all three suggestions for a brand-new research base", () => {
    render(<NextActionsSection summary={emptySummary()} />);

    expect(screen.getByRole("link", { name: "Browse profiles" })).toHaveAttribute(
      "data-link-to",
      "/profiles",
    );
    expect(screen.getByRole("link", { name: "Start a list" })).toHaveAttribute(
      "data-link-to",
      "/lists",
    );
    expect(screen.getByRole("link", { name: "Start research" })).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
  });

  it("hides the follow suggestion once the user already follows an actor", () => {
    const summary = emptySummary();
    summary.activity.followedActorCount = 1;
    render(<NextActionsSection summary={summary} />);

    expect(screen.queryByRole("link", { name: "Browse profiles" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a list" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start research" })).toBeInTheDocument();
  });

  it("renders nothing when every suggestion is already satisfied", () => {
    const { container } = render(<NextActionsSection summary={fullSummary()} />);

    expect(container).toBeEmptyDOMElement();
  });
});

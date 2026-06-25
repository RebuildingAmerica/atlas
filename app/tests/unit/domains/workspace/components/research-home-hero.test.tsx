// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchHomeHero } from "@/domains/workspace/components/research-home-hero";
import type { ResearchSummary } from "@/domains/workspace/server/research-summary";

describe("ResearchHomeHero", () => {
  afterEach(() => {
    cleanup();
  });

  function populatedSummary(): ResearchSummary {
    return {
      lists: [],
      activity: { newSourcesThisWeek: 3, recentItems: [], followedActorCount: 4 },
      recentRuns: [],
      totals: { savedActors: 12, listCount: 2, runsThisMonth: 0 },
    };
  }

  function singularSummary(): ResearchSummary {
    return {
      lists: [],
      activity: { newSourcesThisWeek: 1, recentItems: [], followedActorCount: 1 },
      recentRuns: [],
      totals: { savedActors: 1, listCount: 1, runsThisMonth: 0 },
    };
  }

  it("greets the operator by first name and shows plural stat captions", () => {
    render(<ResearchHomeHero firstName="Ada" summary={populatedSummary()} />);

    expect(screen.getByRole("heading", { name: "Welcome back, Ada" })).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("actors saved across 2 lists")).toBeInTheDocument();
    expect(screen.getByText("actors followed")).toBeInTheDocument();
    expect(screen.getByText("new sources this week")).toBeInTheDocument();
  });

  it("falls back to a name-less greeting and uses singular captions", () => {
    render(<ResearchHomeHero firstName={null} summary={singularSummary()} />);

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByText("actor saved across 1 list")).toBeInTheDocument();
    expect(screen.getByText("actor followed")).toBeInTheDocument();
    expect(screen.getByText("new source this week")).toBeInTheDocument();
  });
});

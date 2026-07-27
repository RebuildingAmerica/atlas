// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WatchlistsSummarySection } from "@/domains/workspace/components/watchlists-summary-section";
import type { WatchlistSummary } from "@/domains/workspace/server/research-summary";

describe("WatchlistsSummarySection", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders place and issue watchlists with recent-request context", () => {
    const watchlists: WatchlistSummary[] = [
      {
        id: "place:kansas city, mo:mo",
        kind: "place",
        label: "Kansas City, MO",
        detail: "2 recent requests",
        changedSinceLastTime: "2 new research requests",
      },
      {
        id: "issue:housing_affordability",
        kind: "issue",
        label: "Housing affordability",
        detail: "2 recent requests",
        changedSinceLastTime: "2 new research requests",
      },
      {
        id: "research_set:list_housing",
        kind: "research_set",
        label: "Housing outreach",
        detail: "6 saved actors",
        changedSinceLastTime: "6 saved actors",
      },
    ];

    render(<WatchlistsSummarySection watchlists={watchlists} />);

    expect(screen.getByRole("heading", { name: "Watchlists" })).toBeInTheDocument();
    expect(screen.getByText("Place")).toBeInTheDocument();
    expect(screen.getByText("Kansas City, MO")).toBeInTheDocument();
    expect(screen.getByText("Issue")).toBeInTheDocument();
    expect(screen.getByText("Housing affordability")).toBeInTheDocument();
    expect(screen.getByText("Research set")).toBeInTheDocument();
    expect(screen.getByText("Housing outreach")).toBeInTheDocument();
    expect(screen.getByText("Digest")).toBeInTheDocument();
    expect(screen.getByText("1 place")).toBeInTheDocument();
    expect(screen.getByText("1 issue")).toBeInTheDocument();
    expect(screen.getAllByText("2 new research requests")).toHaveLength(2);
    expect(screen.getAllByText("6 saved actors")).toHaveLength(2);
    expect(screen.getAllByText("2 recent requests")).toHaveLength(2);
  });

  it("renders an empty state when no watchlists exist", () => {
    render(<WatchlistsSummarySection watchlists={[]} />);

    expect(screen.getByText("No watchlists yet.")).toBeInTheDocument();
  });

  it("counts several watchlists of one kind in the plural", () => {
    const watchlists: WatchlistSummary[] = [
      {
        id: "place:kansas city, mo:mo",
        kind: "place",
        label: "Kansas City, MO",
        detail: "2 recent requests",
        changedSinceLastTime: "2 new research requests",
      },
      {
        id: "place:tulsa, ok:ok",
        kind: "place",
        label: "Tulsa, OK",
        detail: "3 recent requests",
        changedSinceLastTime: "3 new research requests",
      },
    ];

    render(<WatchlistsSummarySection watchlists={watchlists} />);

    expect(screen.getByText("2 places")).toBeInTheDocument();
    expect(screen.getByText("0 issues")).toBeInTheDocument();
  });
});

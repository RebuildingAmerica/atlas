// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchTrendsSection } from "@/domains/workspace/components/research-trends-section";
import type { ResearchTrend } from "@/domains/workspace/server/research-summary";

describe("ResearchTrendsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders repeated place and issue patterns with latest-run context", () => {
    const trends: ResearchTrend[] = [
      {
        id: "place:kansas city, mo:mo",
        kind: "place",
        label: "Kansas City, MO",
        latestRunAt: "2026-06-23T00:00:00.000Z",
        runCount: 2,
        signal: "2 runs over time",
      },
      {
        id: "issue:housing_affordability",
        kind: "issue",
        label: "Housing affordability",
        latestRunAt: "2026-06-21T00:00:00.000Z",
        runCount: 3,
        signal: "3 runs over time",
      },
    ];

    render(<ResearchTrendsSection trends={trends} />);

    expect(screen.getByRole("heading", { name: "Research trends" })).toBeInTheDocument();
    expect(screen.getByText("Place")).toBeInTheDocument();
    expect(screen.getByText("Kansas City, MO")).toBeInTheDocument();
    expect(screen.getByText("2 runs over time")).toBeInTheDocument();
    expect(screen.getByText("Latest request Jun 23, 2026")).toBeInTheDocument();
    expect(screen.getByText("Issue")).toBeInTheDocument();
    expect(screen.getByText("Housing affordability")).toBeInTheDocument();
    expect(screen.getByText("3 runs over time")).toBeInTheDocument();
    expect(screen.getByText("Latest request Jun 21, 2026")).toBeInTheDocument();
  });

  it("renders nothing when no repeat trends exist", () => {
    const { container } = render(<ResearchTrendsSection trends={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

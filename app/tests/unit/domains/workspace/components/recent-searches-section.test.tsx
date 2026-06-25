// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecentSearchesSection } from "@/domains/workspace/components/recent-searches-section";
import type { RecentRunSummary } from "@/domains/workspace/server/research-summary";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to?: string }) => (
    <a href={to} data-link-to={to}>
      {children}
    </a>
  ),
}));

describe("RecentSearchesSection", () => {
  afterEach(() => {
    cleanup();
  });

  function runs(): RecentRunSummary[] {
    return [
      {
        id: "r1",
        locationQuery: "Kansas City, MO",
        state: "MO",
        status: "completed",
        startedAt: "2026-06-20T00:00:00.000Z",
      },
    ];
  }

  it("renders recent run cards linking to discovery and the honest free-run counter", () => {
    render(<RecentSearchesSection runs={runs()} runsThisMonth={1} runsPerMonthLimit={2} />);

    const card = screen.getByRole("link", { name: /Kansas City, MO/ });
    expect(card).toHaveAttribute("data-link-to", "/discovery");
    expect(screen.getByText(/MO · completed/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 free runs used this month\./)).toBeInTheDocument();
  });

  it("uses the singular run noun when the monthly allowance is one", () => {
    render(<RecentSearchesSection runs={runs()} runsThisMonth={0} runsPerMonthLimit={1} />);

    expect(screen.getByText(/0 of 1 free run used this month\./)).toBeInTheDocument();
  });

  it("hides the counter when no finite limit applies", () => {
    render(<RecentSearchesSection runs={runs()} runsThisMonth={5} runsPerMonthLimit={null} />);

    expect(screen.queryByText(/free run/)).not.toBeInTheDocument();
  });

  it("shows the empty state when no searches have run", () => {
    render(<RecentSearchesSection runs={[]} runsThisMonth={0} runsPerMonthLimit={null} />);

    expect(screen.getByText("No searches yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a search" })).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
  });
});

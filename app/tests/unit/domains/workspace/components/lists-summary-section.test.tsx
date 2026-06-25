// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListsSummarySection } from "@/domains/workspace/components/lists-summary-section";
import type { SavedListSummary } from "@/domains/workspace/server/research-summary";
import type { ResearchValueGate } from "@/domains/workspace/components/research-value-nudge";
import type { SerializedResolvedCapabilities } from "@/domains/access/capabilities";

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

vi.mock("@/domains/workspace/components/research-value-nudge", () => ({
  ResearchValueNudge: ({ gate }: { gate: ResearchValueGate }) => (
    <div data-testid="value-nudge" data-gate={JSON.stringify(gate)} />
  ),
}));

describe("ListsSummarySection", () => {
  afterEach(() => {
    cleanup();
  });

  function lists(): SavedListSummary[] {
    return [
      { id: "list_1", name: "Climate", description: "Greens", itemCount: 4 },
      { id: "list_2", name: "Housing", description: null, itemCount: 1 },
    ];
  }

  const freeCapabilities: SerializedResolvedCapabilities = {
    capabilities: [],
    limits: {
      research_runs_per_month: 2,
      max_shortlists: 1,
      max_shortlist_entries: 25,
      max_api_keys: 0,
      api_requests_per_day: 0,
      public_api_requests_per_hour: 100,
      max_members: 1,
    },
  };

  it("renders a card per list, the New list affordance, and the all-lists link", () => {
    render(<ListsSummarySection lists={lists()} capabilities={freeCapabilities} isLocal={false} />);

    const climate = screen.getByRole("link", { name: /Climate/ });
    expect(climate).toHaveAttribute("data-link-to", "/lists/$id");
    expect(climate).toHaveAttribute("data-link-params", JSON.stringify({ id: "list_1" }));
    expect(screen.getByText("Greens")).toBeInTheDocument();
    expect(screen.getByText("4 actors")).toBeInTheDocument();
    expect(screen.getByText("1 actor")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New list/ })).toHaveAttribute(
      "data-link-to",
      "/lists",
    );
    expect(screen.getByRole("link", { name: "All lists" })).toHaveAttribute(
      "data-link-to",
      "/lists",
    );
  });

  it("passes an export gate keyed off the largest list to the value nudge", () => {
    render(<ListsSummarySection lists={lists()} capabilities={freeCapabilities} isLocal={false} />);

    expect(screen.getByTestId("value-nudge")).toHaveAttribute(
      "data-gate",
      JSON.stringify({ kind: "export", itemCount: 4 }),
    );
  });

  it("shows the empty state when the user has no lists", () => {
    render(<ListsSummarySection lists={[]} capabilities={freeCapabilities} isLocal={false} />);

    expect(screen.getByText("You haven't built any lists yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a list" })).toHaveAttribute(
      "data-link-to",
      "/lists",
    );
    expect(screen.queryByRole("link", { name: /New list/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("value-nudge")).toHaveAttribute(
      "data-gate",
      JSON.stringify({ kind: "export", itemCount: 0 }),
    );
  });
});

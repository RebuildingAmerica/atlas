// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListsSummarySection } from "@/domains/workspace/components/lists-summary-section";
import type { SavedListSummary } from "@/domains/workspace/server/research-summary";

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

  it("renders a card per list, the New list affordance, and the all-lists link", () => {
    render(<ListsSummarySection lists={lists()} />);

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

  it("shows the empty state when the user has no lists", () => {
    render(<ListsSummarySection lists={[]} />);

    expect(screen.getByText("You haven't built any lists yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a list" })).toHaveAttribute(
      "data-link-to",
      "/lists",
    );
    expect(screen.queryByRole("link", { name: /New list/ })).not.toBeInTheDocument();
  });
});

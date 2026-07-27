// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowseSearchHeader } from "@/domains/catalog/components/browse/browse-search-header";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("BrowseSearchHeader", () => {
  it("keeps the filter disclosures out of the way until a visitor asks for them", async () => {
    const user = userEvent.setup();
    const onToggleFilter = vi.fn();
    render(
      <BrowseSearchHeader
        activeCounts={{ issues: 1, sources: 0, types: 0 }}
        initialQuery=""
        intentChips={[]}
        mapSearch={{ query: "tenants" }}
        onResetBrowse={vi.fn()}
        onSearch={vi.fn()}
        onToggleFilter={onToggleFilter}
        quickIssueAreas={[{ label: "Housing", slug: "housing_affordability" }]}
        selectedEntryTypes={[]}
        selectedIssueAreas={[]}
        selectedSourceTypes={[]}
        showEntryTypeFilter
      />,
    );

    const filterButton = screen.getByRole("button", { name: /Filter/ });
    expect(filterButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Types")).not.toBeInTheDocument();

    await user.click(filterButton);
    expect(filterButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Issues")).toBeInTheDocument();
    expect(screen.getByText("Types")).toBeInTheDocument();
    expect(screen.getByText("Evidence")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Types/ }));
    await user.click(screen.getByRole("button", { name: "People" }));
    expect(onToggleFilter).toHaveBeenCalledWith("entry_types", "person");
  });

  it("hides the type disclosure on a surface locked to one kind of record", async () => {
    const user = userEvent.setup();
    render(
      <BrowseSearchHeader
        activeCounts={{ issues: 0, sources: 0, types: 0 }}
        initialQuery=""
        intentChips={[]}
        mapSearch={{}}
        onResetBrowse={vi.fn()}
        onSearch={vi.fn()}
        onToggleFilter={vi.fn()}
        quickIssueAreas={[]}
        selectedEntryTypes={[]}
        selectedIssueAreas={[]}
        selectedSourceTypes={[]}
        showEntryTypeFilter={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Filter/ }));
    expect(screen.getByText("Issues")).toBeInTheDocument();
    expect(screen.queryByText("Types")).not.toBeInTheDocument();
  });

  it("hands the visitor to the map carrying the browse search with them", () => {
    render(
      <BrowseSearchHeader
        activeCounts={{ issues: 0, sources: 0, types: 0 }}
        initialQuery=""
        intentChips={[]}
        mapSearch={{ query: "tenants" }}
        onResetBrowse={vi.fn()}
        onSearch={vi.fn()}
        onToggleFilter={vi.fn()}
        quickIssueAreas={[]}
        selectedEntryTypes={[]}
        selectedIssueAreas={[]}
        selectedSourceTypes={[]}
        showEntryTypeFilter
      />,
    );

    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("href", "/map?query=tenants");
  });
});

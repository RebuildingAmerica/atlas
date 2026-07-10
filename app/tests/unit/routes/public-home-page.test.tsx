// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import { HomePage } from "@/platform/pages/home-page";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useAtlasSession: vi.fn(),
  useEntries: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    className?: string;
  }) => (
    <a href={props.to} className={props.className}>
      {children}
    </a>
  ),
  createFileRoute: () => (_options: unknown) => _options,
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/catalog/hooks/use-entries", () => ({
  useEntries: mocks.useEntries,
}));

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigate.mockResolvedValue(undefined);
    mocks.useAtlasSession.mockReturnValue({ data: null, isLoading: false });
    mocks.useEntries.mockReturnValue({
      data: {
        data: [
          createEntryFixture({
            id: "entry-1",
            name: "María Martínez",
            source_count: 8,
            type: "person",
          }),
          createEntryFixture({
            id: "entry-2",
            name: "Restore the Vote NC",
            source_count: 14,
            type: "organization",
          }),
        ],
        facets: {
          cities: [],
          entity_types: [
            { count: 3000, value: "organization" },
            { count: 37247, value: "person" },
          ],
          issue_areas: [
            { count: 120, value: "housing_affordability" },
            { count: 90, value: "climate_resilience" },
            { count: 48, value: "voting_rights" },
          ],
          regions: [],
          source_patterns: [],
          source_types: [
            { count: 1240, value: "government_record" },
            { count: 980, value: "news_article" },
          ],
          states: [
            { count: 140, value: "MO" },
            { count: 100, value: "MI" },
            ...Array.from({ length: 48 }, (_, index) => ({
              count: index + 1,
              value: `S${String(index)}`,
            })),
          ],
        },
        pagination: {
          has_more: true,
          limit: 16,
          offset: 0,
          total: 40247,
        },
      },
      isError: false,
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the verify-instead-of-save copy when running in local mode", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: { isLocal: true },
      isLoading: false,
    });
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { name: "Find the people rebuilding America." }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Want to save your work\?/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Go to your research/ })).not.toBeInTheDocument();
  });

  it("renders issue chips before account prompts for anonymous visitors", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: null,
      isLoading: false,
    });
    render(<HomePage />);
    expect(screen.getAllByRole("link", { name: "Housing" })[0]).toHaveAttribute(
      "href",
      "/browse?query=Housing&offset=0",
    );
    expect(screen.getAllByRole("link", { name: "Climate" })[0]).toHaveAttribute(
      "href",
      "/browse?query=Climate&offset=0",
    );
    expect(screen.getAllByRole("link", { name: "Criminal Justice" })[0]).toHaveAttribute(
      "href",
      "/browse?query=Criminal%20Justice&offset=0",
    );
    expect(screen.getByText(/Want to save your work\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create a free account/ })).toHaveAttribute(
      "href",
      "/sign-up",
    );
    expect(screen.queryByRole("link", { name: /Go to your research/ })).not.toBeInTheDocument();
  });

  it("frames Atlas as public civic search on the public home page", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: "Find the people rebuilding America." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Atlas indexes civic actors: individuals, organizations, and initiatives working on public problems in every corner of the country.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("40,247")).toBeInTheDocument();
    expect(screen.getByText("3,000")).toBeInTheDocument();
    expect(screen.getByText("All 50")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Housing" })[0]).toHaveAttribute(
      "href",
      "/browse?query=Housing&offset=0",
    );
    expect(screen.getAllByRole("link", { name: "Voting Rights" })[0]).toHaveAttribute(
      "href",
      "/browse?query=Voting%20Rights&offset=0",
    );
    expect(screen.queryByText(/with sources local intelligence/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/profile directories/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/broader civic graph/i)).not.toBeInTheDocument();
  });

  it("uses catalog facets and recent records instead of hardcoded demo scenarios", () => {
    render(<HomePage />);

    expect(screen.getAllByText("Housing Affordability").length).toBeGreaterThan(0);
    expect(screen.getAllByText("120 records").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missouri").length).toBeGreaterThan(0);
    expect(screen.getAllByText("140 records").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Government records").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1,240 records").length).toBeGreaterThan(0);

    expect(screen.queryByText("housing organizers in Detroit")).not.toBeInTheDocument();
    expect(screen.queryByText("Meeting prep · Wayne County housing")).not.toBeInTheDocument();
    expect(screen.queryByText("Prepared today")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Avery is confirming meeting details before outreach."),
    ).not.toBeInTheDocument();
  });

  it("shows recently indexed rows from the catalog query", () => {
    render(<HomePage />);

    expect(mocks.useEntries).toHaveBeenCalledWith({ limit: 16, offset: 0 });
    expect(screen.getByRole("heading", { name: "Recently indexed" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Browse all 40,247/ })).toHaveAttribute(
      "href",
      "/browse",
    );
    const recentSection = screen
      .getByRole("heading", { name: "Recently indexed" })
      .closest("section");
    if (!recentSection) {
      throw new Error("Expected recent section");
    }
    expect(within(recentSection).getByRole("link", { name: /María Martínez/ })).toBeInTheDocument();
    expect(within(recentSection).getByText("8 sources")).toBeInTheDocument();
    expect(
      within(recentSection).getByRole("link", { name: /Restore the Vote NC/ }),
    ).toBeInTheDocument();
    expect(within(recentSection).getByText("14 sources")).toBeInTheDocument();
  });

  it("centers the discovery section as a viewport-filling panel", () => {
    render(<HomePage />);

    const section = screen
      .getByRole("heading", {
        name: "Good people are doing good work everywhere. Atlas helps you find them.",
      })
      .closest("section");
    expect(section).toHaveClass("min-h-[100svh]");
    expect(section).toHaveClass("items-center");
  });

  it("uses a plain empty state when the recent catalog query has no rows", () => {
    mocks.useEntries.mockReturnValue({
      data: {
        data: [],
        facets: {},
        pagination: {
          has_more: false,
          limit: 16,
          offset: 0,
          total: 0,
        },
      },
      isError: false,
      isLoading: false,
    });

    render(<HomePage />);

    expect(screen.getByText("No people listed yet.")).toBeInTheDocument();
  });

  it("invites signed-in visitors to their research base", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: { isLocal: false },
      isLoading: false,
    });
    render(<HomePage />);
    expect(screen.queryByText(/Want to save your work\?/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Create a free account/ })).not.toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /Go to your research/ });
    expect(cta).toHaveAttribute("href", "/home");
  });

  it("submits browse searches with a normal GET form", async () => {
    mocks.navigate.mockRejectedValue(new Error("Router blew up"));

    render(<HomePage />);

    const searchInput = screen.getByRole("textbox", {
      name: "Search Atlas by name, place, issue, or organization",
    });
    const form = screen.getByRole("button", { name: /^search$/i }).closest("form");
    if (!form) {
      throw new Error("Expected search form");
    }

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "housing" } });
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(form).toHaveAttribute("action", "/browse");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByDisplayValue("housing")).toHaveAttribute("name", "query");
    expect(screen.getByDisplayValue("0")).toHaveAttribute("name", "offset");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

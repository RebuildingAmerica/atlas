// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import { createEntryListFixture } from "@/../tests/fixtures/catalog/entry-list";
import { HomePage } from "@/platform/pages/home-page";

const mocks = vi.hoisted(() => ({
  useAtlasSession: vi.fn(),
  useEntries: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-entries", () => ({
  useEntries: mocks.useEntries,
}));

describe("HomePage recently indexed", () => {
  beforeEach(() => {
    mocks.useAtlasSession.mockReturnValue({ data: null, isLoading: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("stays quiet about the catalog while the first page is still loading", () => {
    mocks.useEntries.mockReturnValue({ data: undefined, isError: false, isLoading: true });

    render(<HomePage />);

    const recentSection = screen
      .getByRole("heading", { name: "Recently indexed" })
      .closest("section");
    if (!recentSection) {
      throw new Error("Expected the recently indexed section to render.");
    }
    expect(within(recentSection).queryByText("No people listed yet.")).not.toBeInTheDocument();
    expect(within(recentSection).getByText("0 shown")).toBeInTheDocument();
    expect(within(recentSection).getByRole("link", { name: /Browse all actors/ })).toHaveAttribute(
      "href",
      "/browse",
    );
  });

  it("names the place of a record the catalog has no description for", () => {
    mocks.useEntries.mockReturnValue({
      data: createEntryListFixture([
        createEntryFixture({
          city: "Jackson",
          description: "",
          id: "entry-no-description",
          name: "Delta Housing Collective",
          state: "MS",
          type: "organization",
        }),
      ]),
      isError: false,
      isLoading: false,
    });

    render(<HomePage />);

    const recentSection = screen
      .getByRole("heading", { name: "Recently indexed" })
      .closest("section");
    if (!recentSection) {
      throw new Error("Expected the recently indexed section to render.");
    }
    const row = within(recentSection).getByRole("link", { name: /Delta Housing Collective/ });
    expect(within(row).getAllByText("Jackson, MS")).toHaveLength(2);
  });
});

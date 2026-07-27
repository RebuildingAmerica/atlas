// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry, TaxonomyResponse } from "@rebuildingamerica/atlas-api-client";
import { ProfilesOverviewPage } from "@/domains/catalog/pages/profiles/overview/profiles-overview-page";
import { createEntryFixture } from "../../../../../../fixtures/catalog/entries";
import { renderWithProviders } from "../../../../../../helpers/render-with-providers";
import { stubFetch } from "../../../../../../helpers/stub-fetch";
import { createEntryListFixture } from "../../../../../../fixtures/catalog/entry-list";
import { seedCatalogSlice } from "./profiles-overview-page-test-support";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ProfilesOverviewPage", () => {
  beforeEach(() => {
    stubFetch({ body: { detail: "the page should not have needed the network" }, status: 500 });
  });

  function taxonomy(): TaxonomyResponse {
    return {
      housing: [
        {
          description: "Rent, ownership and displacement.",
          name: "Housing affordability",
          slug: "housing_affordability",
        },
      ],
    };
  }

  function heroTrio(): Entry[] {
    return [
      createEntryFixture({
        id: "entry-ada",
        issue_areas: ["housing_affordability"],
        latest_source_date: "2026-05-01",
        name: "Ada Reyes",
        slug: "ada-reyes",
      }),
      createEntryFixture({
        id: "entry-beacon",
        issue_areas: ["housing_affordability", "food_security"],
        latest_source_date: "2026-04-01",
        name: "Beacon Housing Trust",
        slug: "beacon-housing-trust",
        type: "organization",
      }),
      createEntryFixture({
        id: "entry-cyrus",
        issue_areas: ["food_security"],
        latest_source_date: "2026-03-01",
        name: "Cyrus Lane",
        slug: "cyrus-lane",
      }),
    ];
  }

  function deltaMutualAid(): Entry {
    return createEntryFixture({
      id: "entry-delta",
      issue_areas: ["housing_affordability"],
      latest_source_date: undefined,
      name: "Delta Mutual Aid",
      slug: "delta-mutual-aid",
      type: "organization",
      updated_at: "2026-02-10T00:00:00Z",
    });
  }

  function tailPair(): Entry[] {
    return [
      deltaMutualAid(),
      createEntryFixture({
        id: "entry-evergreen",
        issue_areas: ["civic_infrastructure"],
        latest_source_date: undefined,
        name: "Evergreen Coalition",
        slug: "evergreen-coalition",
        type: "organization",
        updated_at: "2026-01-05T00:00:00Z",
      }),
    ];
  }

  function seedAllScope(queryClient: QueryClient): void {
    queryClient.setQueryData(["taxonomy"], taxonomy());
    seedCatalogSlice(queryClient, { entryTypes: ["person", "organization"], limit: 18 }, [
      ...heroTrio(),
      ...tailPair(),
    ]);
    seedCatalogSlice(queryClient, { entryTypes: ["person"], limit: 10 }, [
      createEntryFixture({
        id: "entry-priya",
        latest_source_date: "2026-06-01",
        name: "Priya Nair",
        slug: "priya-nair",
      }),
    ]);
    seedCatalogSlice(queryClient, { entryTypes: ["organization"], limit: 10 }, [
      createEntryFixture({
        id: "entry-open-delta",
        latest_source_date: "2026-05-15",
        name: "Open Delta",
        slug: "open-delta",
        type: "organization",
      }),
      deltaMutualAid(),
    ]);
  }

  function sectionFor(headingText: string): HTMLElement {
    const section = screen.getByRole("heading", { name: headingText }).closest("section");
    if (!section) {
      throw new TypeError(`Expected a section wrapping the "${headingText}" heading.`);
    }
    return section;
  }

  function issueColumnFor(title: string): HTMLElement {
    const column = screen.getByRole("heading", { name: title }).parentElement;
    if (!column) {
      throw new TypeError(`Expected a column wrapping the "${title}" heading.`);
    }
    return column;
  }

  /**
   * The profile name each row in a section links to, in render order.
   *
   * @param section - A section of the overview page.
   * @returns One name per link, top to bottom.
   */
  function linkedNamesIn(section: HTMLElement): (string | null)[] {
    return within(section)
      .getAllByRole("link")
      .map((link) => link.querySelector("h2, h3, p")?.textContent ?? null);
  }

  it("names the surface and spotlights the freshest catalog entries", async () => {
    renderWithProviders(<ProfilesOverviewPage />, { seed: seedAllScope });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Profiles");
    expect(
      screen.getByText(
        "Explore source-linked people and organizations by issue, place, and public record.",
      ),
    ).toBeInTheDocument();

    const marquee = sectionFor("Profiles worth opening");
    expect(within(marquee).getByRole("heading", { name: "Ada Reyes" })).toBeInTheDocument();
    expect(
      within(marquee).getByRole("heading", { name: "Beacon Housing Trust" }),
    ).toBeInTheDocument();
    expect(within(marquee).getByRole("heading", { name: "Cyrus Lane" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("No profiles listed yet.")).toBeNull();
    });
  });

  it("splits people and organizations into their own shelves in the combined view", () => {
    renderWithProviders(<ProfilesOverviewPage scope="all" />, { seed: seedAllScope });

    expect(linkedNamesIn(sectionFor("People worth knowing"))).toEqual(["Priya Nair"]);
    expect(linkedNamesIn(sectionFor("Organizations doing the work"))).toEqual([
      "Open Delta",
      "Delta Mutual Aid",
    ]);
  });

  it("clusters the two busiest issue areas and labels them from the taxonomy", () => {
    renderWithProviders(<ProfilesOverviewPage />, { seed: seedAllScope });

    expect(linkedNamesIn(issueColumnFor("Housing affordability"))).toEqual([
      "Ada Reyes",
      "Beacon Housing Trust",
      "Delta Mutual Aid",
    ]);
    expect(linkedNamesIn(issueColumnFor("food security"))).toEqual([
      "Beacon Housing Trust",
      "Cyrus Lane",
    ]);
    expect(screen.queryByRole("heading", { name: /civic.infrastructure/i })).toBeNull();
  });

  it("lists the newest non-spotlit profiles once each, freshest first", () => {
    renderWithProviders(<ProfilesOverviewPage />, { seed: seedAllScope });

    const fresh = sectionFor("New in Atlas");
    expect(within(fresh).getAllByText("Delta Mutual Aid")).toHaveLength(1);
    expect(linkedNamesIn(fresh)).toEqual([
      "Priya Nair",
      "Open Delta",
      "Delta Mutual Aid",
      "Evergreen Coalition",
    ]);
    expect(within(fresh).queryByText("Ada Reyes")).toBeNull();
  });

  it("falls back to the raw issue slug when the taxonomy has not loaded", () => {
    renderWithProviders(<ProfilesOverviewPage />, {
      seed: (queryClient) => {
        seedCatalogSlice(
          queryClient,
          { entryTypes: ["person", "organization"], limit: 18 },
          heroTrio(),
        );
        seedCatalogSlice(queryClient, { entryTypes: ["person"], limit: 10 }, []);
        seedCatalogSlice(queryClient, { entryTypes: ["organization"], limit: 10 }, []);
      },
    });

    expect(screen.getByRole("heading", { name: "housing affordability" })).toBeInTheDocument();
  });

  it("tells a visitor the shelf is empty rather than showing bare scaffolding", () => {
    renderWithProviders(<ProfilesOverviewPage scope="organizations" />, {
      seed: (queryClient) => {
        queryClient.setQueryData(["taxonomy"], {});
        seedCatalogSlice(queryClient, { entryTypes: ["organization"], limit: 18 }, []);
        seedCatalogSlice(queryClient, { entryTypes: ["person"], limit: 10 }, []);
        seedCatalogSlice(queryClient, { entryTypes: ["organization"], limit: 10 }, []);
      },
    });

    expect(screen.getByText("No organizations listed yet.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Featured profiles" })).toBeNull();
  });

  it("shows only the people shelf when the visitor scoped the page to people", () => {
    renderWithProviders(<ProfilesOverviewPage scope="people" />, {
      seed: (queryClient) => {
        queryClient.setQueryData(["taxonomy"], taxonomy());
        seedCatalogSlice(queryClient, { entryTypes: ["person"], limit: 18 }, [
          ...heroTrio(),
          createEntryFixture({ id: "entry-4", name: "Dana Fox", slug: "dana-fox" }),
          createEntryFixture({ id: "entry-5", name: "Eli Moss", slug: "eli-moss" }),
        ]);
        seedCatalogSlice(queryClient, { entryTypes: ["person"], limit: 10 }, []);
        seedCatalogSlice(queryClient, { entryTypes: ["organization"], limit: 10 }, []);
      },
    });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("People");
    expect(linkedNamesIn(sectionFor("People worth knowing"))).toEqual(["Dana Fox", "Eli Moss"]);
    expect(screen.queryByRole("heading", { name: "Organizations doing the work" })).toBeNull();
  });

  it("shows only the organization shelf when the visitor scoped the page to organizations", () => {
    renderWithProviders(<ProfilesOverviewPage scope="organizations" />, {
      seed: (queryClient) => {
        queryClient.setQueryData(["taxonomy"], taxonomy());
        seedCatalogSlice(queryClient, { entryTypes: ["organization"], limit: 18 }, [
          ...heroTrio(),
          createEntryFixture({
            id: "entry-4",
            name: "Delta Works",
            slug: "delta-works",
            type: "organization",
          }),
        ]);
        seedCatalogSlice(queryClient, { entryTypes: ["person"], limit: 10 }, []);
        seedCatalogSlice(queryClient, { entryTypes: ["organization"], limit: 10 }, []);
      },
    });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Organizations");
    expect(linkedNamesIn(sectionFor("Organizations doing the work"))).toEqual(["Delta Works"]);
    expect(screen.queryByRole("heading", { name: "People worth knowing" })).toBeNull();
  });

  it("paints the server-rendered slice before any browser request resolves", () => {
    renderWithProviders(
      <ProfilesOverviewPage initialCatalog={createEntryListFixture(heroTrio())} />,
    );

    expect(screen.getByRole("heading", { name: "Ada Reyes" })).toBeInTheDocument();
  });

  it("holds the section scaffolding while the catalog is still loading", async () => {
    renderWithProviders(<ProfilesOverviewPage />);

    expect(screen.getByRole("heading", { name: "Featured profiles" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Where the work is clustering" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New in Atlas" })).toBeInTheDocument();
    expect(screen.queryByText("No profiles listed yet.")).toBeNull();

    await waitFor(() => {
      expect(
        screen.getAllByText("Atlas is temporarily unavailable. Please try again."),
      ).not.toHaveLength(0);
    });
  });

  it("keeps a scoped shelf visible while its catalog slice loads", async () => {
    renderWithProviders(<ProfilesOverviewPage scope="people" />);

    expect(screen.getByRole("heading", { name: "People worth knowing" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Organizations doing the work" })).toBeNull();

    await waitFor(() => {
      expect(
        screen.getAllByText("Atlas is temporarily unavailable. Please try again."),
      ).not.toHaveLength(0);
    });
  });

  it("keeps a scoped organization shelf visible while its catalog slice loads", async () => {
    renderWithProviders(<ProfilesOverviewPage scope="organizations" />);

    expect(
      screen.getByRole("heading", { name: "Organizations doing the work" }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getAllByText("Atlas is temporarily unavailable. Please try again."),
      ).not.toHaveLength(0);
    });
  });

  it("says the catalog is unavailable instead of pretending Atlas is empty", async () => {
    renderWithProviders(<ProfilesOverviewPage />, {
      seed: (queryClient) => {
        queryClient.setQueryData(["taxonomy"], taxonomy());
        seedCatalogSlice(queryClient, { entryTypes: ["person"], limit: 10 }, [
          createEntryFixture({ id: "entry-priya", name: "Priya Nair", slug: "priya-nair" }),
        ]);
        seedCatalogSlice(queryClient, { entryTypes: ["organization"], limit: 10 }, []);
      },
    });

    await waitFor(() =>
      expect(
        screen.getByText("Atlas is temporarily unavailable. Please try again."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("No profiles listed yet.")).toBeNull();
    expect(linkedNamesIn(sectionFor("People worth knowing"))).toEqual(["Priya Nair"]);
  });
});

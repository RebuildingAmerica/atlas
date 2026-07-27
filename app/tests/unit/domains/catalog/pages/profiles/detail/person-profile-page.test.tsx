// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "@rebuildingamerica/atlas-api-client";
import { PersonProfilePage } from "@/domains/catalog/pages/profiles/detail/person-profile-page";
import {
  createAtlasResolvedCapabilities,
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../../../../fixtures/access/sessions";
import {
  createEntryFixture,
  createSourceFixture,
} from "../../../../../../fixtures/catalog/entries";
import { renderWithProviders } from "../../../../../../helpers/render-with-providers";
import { stubFetch } from "../../../../../../helpers/stub-fetch";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("PersonProfilePage", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    stubFetch({ body: { detail: "the page should not have needed the network" }, status: 500 });
  });

  function person(overrides: Partial<Entry> = {}): Entry {
    return createEntryFixture({
      first_seen: "2026-01-01T00:00:00Z",
      last_seen: "2026-06-01T00:00:00Z",
      name: "Ada Reyes",
      slug: "ada-reyes",
      sources: [createSourceFixture()],
      ...overrides,
    });
  }

  function seedAnonymous(queryClient: QueryClient): void {
    queryClient.setQueryData(["auth", "session"], null);
    queryClient.setQueryData(["taxonomy"], {
      housing: [
        {
          description: "Rent and displacement.",
          name: "Housing affordability",
          slug: "housing_affordability",
        },
      ],
    });
  }

  /**
   * The figure shown above a stat tile's label, unit included.
   *
   * @param label - The tile's caption, as written in the markup.
   * @returns The rendered figure text.
   */
  function statValue(label: string): string {
    const caption = screen.getByText(label);
    const value = caption.previousElementSibling?.textContent;
    if (value === undefined || value === null) {
      throw new TypeError(`Expected a figure above the "${label}" stat.`);
    }
    return value;
  }

  it("summarises coverage, focus and tracking span for a reader who just arrived", () => {
    renderWithProviders(<PersonProfilePage entry={person({ source_count: 3 })} />, {
      seed: seedAnonymous,
    });

    expect(screen.getByText("Coverage")).toBeInTheDocument();
    expect(statValue("Coverage")).toBe("3srcs");
    expect(statValue("Tracked since")).toBe("5mo");
    expect(screen.getAllByText("Housing affordability")[0]).toBeInTheDocument();
  });

  it("counts a single source in the singular", () => {
    renderWithProviders(<PersonProfilePage entry={person({ source_count: 1 })} />, {
      seed: seedAnonymous,
    });

    expect(statValue("Coverage")).toBe("1src");
  });

  it("switches the tracking span to years once a record passes a year", () => {
    renderWithProviders(
      <PersonProfilePage
        entry={person({ first_seen: "2023-01-01T00:00:00Z", last_seen: "2026-01-01T00:00:00Z" })}
      />,
      { seed: seedAnonymous },
    );

    expect(statValue("Tracked since")).toBe("3yr");
  });

  it("reports an unreadable tracking window as no time at all rather than a negative span", () => {
    renderWithProviders(<PersonProfilePage entry={person({ first_seen: "not a date" })} />, {
      seed: seedAnonymous,
    });

    expect(statValue("Tracked since")).toBe("0mo");
  });

  it.each([
    ["2026-07-01", "today"],
    ["2026-06-28", "3d"],
    ["2026-06-10", "3w"],
    ["2026-01-01", "6mo"],
    ["2023-01-01", "3y+"],
  ])("dates the last confirmation of %s as %s", (latestSourceDate, expected) => {
    renderWithProviders(
      <PersonProfilePage entry={person({ latest_source_date: latestSourceDate })} />,
      { seed: seedAnonymous },
    );

    expect(statValue("Last confirmed")).toBe(expected);
  });

  it("shows a dash rather than a fabricated date when the record has no readable one", () => {
    renderWithProviders(
      <PersonProfilePage entry={person({ last_seen: "unknown", latest_source_date: undefined })} />,
      { seed: seedAnonymous },
    );

    expect(statValue("Last confirmed")).toBe("—");
  });

  it("humanises an issue area the taxonomy has no name for", () => {
    renderWithProviders(
      <PersonProfilePage entry={person({ issue_areas: ["civic_infrastructure"] })} />,
      {
        seed: (queryClient) => {
          queryClient.setQueryData(["auth", "session"], null);
        },
      },
    );

    expect(screen.getAllByText("Civic Infrastructure")[0]).toBeInTheDocument();
  });

  it("hides the reach section for a person with no published contact route", () => {
    renderWithProviders(<PersonProfilePage entry={person()} />, { seed: seedAnonymous });

    expect(screen.queryByRole("region", { name: "Contact details" })).toBeNull();
  });

  it("shows the reach section as soon as one contact route is on file", () => {
    renderWithProviders(<PersonProfilePage entry={person({ website: "https://ada.test" })} />, {
      seed: seedAnonymous,
    });

    expect(screen.getByRole("region", { name: "Contact details" })).toBeInTheDocument();
  });

  it("links a person to the organization they work for", () => {
    renderWithProviders(<PersonProfilePage entry={person({ affiliated_org_id: "entry-org" })} />, {
      seed: (queryClient) => {
        seedAnonymous(queryClient);
        queryClient.setQueryData(
          ["entries", "entry-org"],
          createEntryFixture({
            city: "Jackson",
            id: "entry-org",
            name: "Beacon Housing Trust",
            slug: "beacon-housing-trust",
            state: "MS",
            type: "organization",
          }),
        );
      },
    });

    const affiliation = screen.getByRole("region", { name: "Affiliated organization" });
    expect(within(affiliation).getByRole("link")).toHaveAttribute(
      "href",
      "/profiles/organizations/beacon-housing-trust",
    );
    expect(within(affiliation).getByText("Beacon Housing Trust")).toBeInTheDocument();
  });

  it("omits the affiliation section when no organization is on record", () => {
    renderWithProviders(<PersonProfilePage entry={person()} />, { seed: seedAnonymous });

    expect(screen.queryByRole("region", { name: "Affiliated organization" })).toBeNull();
  });

  it("renders for a person whose record carries no sources yet", () => {
    renderWithProviders(<PersonProfilePage entry={person({ sources: undefined })} />, {
      seed: seedAnonymous,
    });

    expect(screen.getByRole("region", { name: "Reporting trail" })).toBeInTheDocument();
  });

  it("offers workspace watching to a signed-in operator whose plan includes it", () => {
    renderWithProviders(<PersonProfilePage entry={person()} />, {
      seed: (queryClient) => {
        seedAnonymous(queryClient);
        queryClient.setQueryData(
          ["auth", "session"],
          createAtlasSessionFixture({
            workspace: createAtlasWorkspace({
              resolvedCapabilities: createAtlasResolvedCapabilities({}, [
                "research.run",
                "monitoring.watchlists",
              ]),
            }),
          }),
        );
      },
    });

    expect(screen.getByRole("button", { name: /watch/i })).toBeInTheDocument();
  });

  it("withholds workspace watching from a signed-in operator without that capability", () => {
    renderWithProviders(<PersonProfilePage entry={person()} />, {
      seed: (queryClient) => {
        seedAnonymous(queryClient);
        queryClient.setQueryData(["auth", "session"], createAtlasSessionFixture());
      },
    });

    expect(screen.queryByRole("button", { name: /watch/i })).toBeNull();
  });

  it("withholds workspace watching from a signed-in operator with no active workspace", () => {
    renderWithProviders(<PersonProfilePage entry={person()} />, {
      seed: (queryClient) => {
        seedAnonymous(queryClient);
        queryClient.setQueryData(
          ["auth", "session"],
          createAtlasSessionFixture({
            workspace: createAtlasWorkspace({ activeOrganization: null }),
          }),
        );
      },
    });

    expect(screen.queryByRole("button", { name: /watch/i })).toBeNull();
  });
});

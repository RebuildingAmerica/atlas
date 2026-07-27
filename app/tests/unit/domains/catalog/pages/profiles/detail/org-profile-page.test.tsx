// @vitest-environment jsdom
import type { QueryClient } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "@rebuildingamerica/atlas-api-client";
import { OrgProfilePage } from "@/domains/catalog/pages/profiles/detail/org-profile-page";
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
import { createEntryListFixture } from "../../../../../../fixtures/catalog/entry-list";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("OrgProfilePage", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    stubFetch({ body: { detail: "the page should not have needed the network" }, status: 500 });
  });

  function organization(overrides: Partial<Entry> = {}): Entry {
    return createEntryFixture({
      first_seen: "2026-01-01T00:00:00Z",
      id: "entry-beacon",
      issue_areas: ["housing_affordability"],
      last_seen: "2026-06-01T00:00:00Z",
      name: "Beacon Housing Trust",
      slug: "beacon-housing-trust",
      sources: [createSourceFixture()],
      type: "organization",
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
    seedAffiliatedPeople(queryClient, []);
  }

  function seedAffiliatedPeople(queryClient: QueryClient, people: Entry[]): void {
    queryClient.setQueryData(
      ["entries", { affiliated_org_id: "entry-beacon", entry_types: ["person"], limit: 50 }],
      createEntryListFixture(people),
    );
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

  it("summarises coverage and issue footprint for an organization", () => {
    renderWithProviders(<OrgProfilePage entry={organization({ source_count: 4 })} />, {
      seed: seedAnonymous,
    });

    expect(statValue("Coverage")).toBe("4srcs");
    expect(statValue("Issue areas")).toBe("1");
    expect(statValue("People tied")).toBe("0");
    expect(statValue("Last confirmed")).toBe("4w");
    expect(screen.getByRole("region", { name: "Issue footprint" })).toBeInTheDocument();
  });

  it("counts a single source in the singular", () => {
    renderWithProviders(<OrgProfilePage entry={organization({ source_count: 1 })} />, {
      seed: seedAnonymous,
    });

    expect(statValue("Coverage")).toBe("1src");
  });

  it.each([
    ["2026-07-01", "today"],
    ["2026-06-28", "3d"],
    ["2026-06-10", "3w"],
    ["2023-01-01", "3y+"],
  ])("dates the last confirmation of %s as %s", (latestSourceDate, expected) => {
    renderWithProviders(
      <OrgProfilePage entry={organization({ latest_source_date: latestSourceDate })} />,
      { seed: seedAnonymous },
    );

    expect(statValue("Last confirmed")).toBe(expected);
  });

  it("shows a dash rather than a fabricated date when the record has no readable one", () => {
    renderWithProviders(
      <OrgProfilePage
        entry={organization({ last_seen: "unknown", latest_source_date: undefined })}
      />,
      { seed: seedAnonymous },
    );

    expect(statValue("Last confirmed")).toBe("—");
  });

  it("names the people tied to the organization", () => {
    renderWithProviders(<OrgProfilePage entry={organization()} />, {
      seed: (queryClient) => {
        seedAnonymous(queryClient);
        seedAffiliatedPeople(queryClient, [
          createEntryFixture({ id: "entry-ada", name: "Ada Reyes", slug: "ada-reyes" }),
        ]);
      },
    });

    const people = screen.getByRole("region", { name: "People tied to this organization" });
    expect(within(people).getByText("Ada Reyes")).toBeInTheDocument();
    expect(statValue("People tied")).toBe("1");
  });

  it("omits the people section when nobody is tied to the organization yet", () => {
    renderWithProviders(<OrgProfilePage entry={organization()} />, { seed: seedAnonymous });

    expect(screen.queryByRole("region", { name: "People tied to this organization" })).toBeNull();
  });

  it("omits the issue footprint when the record names no issue area", () => {
    renderWithProviders(<OrgProfilePage entry={organization({ issue_areas: [] })} />, {
      seed: seedAnonymous,
    });

    expect(screen.queryByRole("region", { name: "Issue footprint" })).toBeNull();
  });

  it("shows the presence section once anything locates the organization publicly", () => {
    renderWithProviders(
      <OrgProfilePage entry={organization({ website: "https://beacon.test" })} />,
      { seed: seedAnonymous },
    );

    expect(screen.getByRole("region", { name: "Presence and contact" })).toBeInTheDocument();
  });

  it("omits the presence section for a record with nothing public to show", () => {
    renderWithProviders(<OrgProfilePage entry={organization({ first_seen: "" })} />, {
      seed: seedAnonymous,
    });

    expect(screen.queryByRole("region", { name: "Presence and contact" })).toBeNull();
  });

  it("renders for an organization whose record carries no sources yet", () => {
    renderWithProviders(<OrgProfilePage entry={organization({ sources: undefined })} />, {
      seed: seedAnonymous,
    });

    expect(screen.getByRole("region", { name: "Appearances and coverage" })).toBeInTheDocument();
  });

  it("counts nobody tied while the affiliated-people lookup is still in flight", () => {
    renderWithProviders(<OrgProfilePage entry={organization()} />, {
      seed: (queryClient) => {
        queryClient.setQueryData(["auth", "session"], null);
        queryClient.setQueryData(["taxonomy"], {});
      },
    });

    expect(statValue("People tied")).toBe("0");
    expect(screen.queryByRole("region", { name: "People tied to this organization" })).toBeNull();
  });

  it("falls back to the raw issue slug before the taxonomy arrives", () => {
    renderWithProviders(<OrgProfilePage entry={organization()} />, {
      seed: (queryClient) => {
        queryClient.setQueryData(["auth", "session"], null);
        seedAffiliatedPeople(queryClient, []);
      },
    });

    expect(screen.getAllByText("Housing Affordability")[0]).toBeInTheDocument();
  });

  it("offers workspace watching to a signed-in operator whose plan includes it", () => {
    renderWithProviders(<OrgProfilePage entry={organization()} />, {
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
    renderWithProviders(<OrgProfilePage entry={organization()} />, {
      seed: (queryClient) => {
        seedAnonymous(queryClient);
        queryClient.setQueryData(["auth", "session"], createAtlasSessionFixture());
      },
    });

    expect(screen.queryByRole("button", { name: /watch/i })).toBeNull();
  });

  it("withholds workspace watching from a signed-in operator with no active workspace", () => {
    renderWithProviders(<OrgProfilePage entry={organization()} />, {
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

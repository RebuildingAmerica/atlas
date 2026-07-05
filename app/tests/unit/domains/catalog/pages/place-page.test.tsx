// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlacePage } from "@/domains/catalog/pages/place-page";
import { placePageFixture } from "@/../tests/fixtures/catalog/place-page";

const apiMocks = vi.hoisted(() => ({
  listActors: vi.fn(),
  listLatest: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    places: {
      listActors: apiMocks.listActors,
      listLatest: apiMocks.listLatest,
    },
  },
}));

describe("PlacePage", () => {
  beforeEach(() => {
    apiMocks.listActors.mockReset();
    apiMocks.listLatest.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a content-first place page without internal source or metadata jargon", () => {
    const view = render(<PlacePage data={placePageFixture} />);

    expect(screen.getByRole("heading", { level: 1, name: "Las Vegas" })).toBeInTheDocument();
    expect(screen.getByText("Clark County agenda, Jul 2")).toBeInTheDocument();
    expect(screen.getByText("Government record")).toBeInTheDocument();
    expect(screen.getByText("HUD CHAS, 2023")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "People & Organizations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Places" })).toBeInTheDocument();

    expect(view.container).not.toHaveTextContent(/receipt/i);
    expect(view.container).not.toHaveTextContent(/source packet/i);
    expect(view.container).not.toHaveTextContent(/public bodies/i);
    expect(view.container).not.toHaveTextContent(/census:/i);
    expect(view.container).not.toHaveTextContent(/mapped signals/i);
    expect(view.container).not.toHaveTextContent(/current scope/i);
    expect(view.container).not.toHaveTextContent(/Places\s*\//i);
  });

  it("makes related places visual instead of plain text rows", () => {
    render(<PlacePage data={placePageFixture} />);

    const placesSection = screen.getByRole("heading", { name: "Places" }).closest("section");
    if (placesSection === null) {
      throw new Error("Places section was not rendered.");
    }
    const hendersonCard = within(placesSection).getByRole("link", { name: /Henderson/ });
    expect(hendersonCard).toHaveClass("bg-surface-container-lowest");
    expect(within(hendersonCard).getByTestId("place-map-thumb-Henderson")).toBeInTheDocument();
    expect(
      within(hendersonCard).getByText(
        "Housing growth, water, parks, transit access, public safety.",
      ),
    ).toBeInTheDocument();
  });

  it("plots related places from coordinates without exposing raw geography metadata", () => {
    const view = render(<PlacePage data={placePageFixture} />);

    const placesSection = screen.getByRole("heading", { name: "Places" }).closest("section");
    if (placesSection === null) {
      throw new Error("Places section was not rendered.");
    }
    const hendersonCard = within(placesSection).getByRole("link", { name: /Henderson/ });
    const northLasVegasCard = within(placesSection).getByRole("link", {
      name: /North Las Vegas/,
    });

    const hendersonThumb = within(hendersonCard).getByLabelText("Henderson location");
    const northLasVegasThumb = within(northLasVegasCard).getByLabelText("North Las Vegas location");
    const hendersonDot = hendersonThumb.querySelector('[data-current-place="true"]');
    const northLasVegasDot = northLasVegasThumb.querySelector('[data-current-place="true"]');

    expect(hendersonDot?.tagName).toBe("circle");
    expect(northLasVegasDot?.tagName).toBe("circle");
    expect(hendersonDot?.getAttribute("cx")).not.toBe(northLasVegasDot?.getAttribute("cx"));
    expect(hendersonDot?.getAttribute("cy")).not.toBe(northLasVegasDot?.getAttribute("cy"));
    expect(view.container).not.toHaveTextContent("36.039525");
    expect(view.container).not.toHaveTextContent("census:place/3231900");
  });

  it("falls back cleanly when a related place has no coordinates yet", () => {
    const firstPlace = placePageFixture.places[0];
    if (!firstPlace) {
      throw new Error("Fixture must include a related place.");
    }

    render(
      <PlacePage
        data={{
          ...placePageFixture,
          places: [
            {
              ...firstPlace,
              latitude: undefined,
              longitude: undefined,
            },
          ],
        }}
      />,
    );

    const placesSection = screen.getByRole("heading", { name: "Places" }).closest("section");
    if (placesSection === null) {
      throw new Error("Places section was not rendered.");
    }
    const hendersonCard = within(placesSection).getByRole("link", { name: /Henderson/ });

    expect(within(hendersonCard).getByTestId("place-map-thumb-Henderson")).toBeInTheDocument();
    expect(within(hendersonCard).queryByLabelText("Henderson location")).not.toBeInTheDocument();
  });

  it("filters latest activity by source type", async () => {
    const user = userEvent.setup();
    apiMocks.listLatest.mockResolvedValueOnce({
      items: [
        {
          id: "latest-report",
          title: "Housing conditions report",
          attribution: "City Lab, Jun 20",
          dateLabel: "Jun 20",
          href: "https://example.test/report",
          linkedActors: [
            {
              id: "actor-2",
              name: "Las Vegas Housing Justice Table",
              href: "/profiles/organizations/las-vegas-housing-justice-table",
            },
          ],
          linkedEntityIds: ["actor-2"],
          sourceType: "report",
          excerpt: "The report names eviction filings and rent burden in valley cities.",
          topics: [],
        },
      ],
      nextCursor: undefined,
    });

    render(<PlacePage data={placePageFixture} />);
    await user.click(screen.getByRole("button", { name: "Reports" }));

    expect(apiMocks.listLatest).toHaveBeenCalledWith("las-vegas-nv", {
      cursor: undefined,
      kind: "polity",
      limit: 10,
      query: undefined,
      sourceTypes: ["report"],
    });
    expect(await screen.findByText("Housing conditions report")).toBeInTheDocument();
    expect(screen.getByText("Las Vegas Housing Justice Table")).toBeInTheDocument();
    expect(
      screen.queryByText("County commissioners advance bus stop shade and water funding"),
    ).not.toBeInTheDocument();
  });

  it("sorts people and organizations through the place API", async () => {
    const user = userEvent.setup();
    apiMocks.listActors.mockResolvedValueOnce({
      items: [
        {
          id: "actor-a",
          name: "Aardvark Civic League",
          href: "/profiles/organizations/aardvark-civic-league",
          type: "organization",
          description: "Neighborhood housing and repair work.",
          work: "Housing affordability",
          latest: "Jul 1",
        },
        {
          id: "actor-b",
          name: "Boulder Transit Riders",
          href: "/profiles/organizations/boulder-transit-riders",
          type: "organization",
          description: "Bus frequency and shade organizing.",
          work: "Public transit",
          latest: "Jun 28",
        },
      ],
      nextCursor: undefined,
    });

    render(<PlacePage data={placePageFixture} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Sort people and organizations" }),
      "name",
    );

    expect(apiMocks.listActors).toHaveBeenCalledWith("las-vegas-nv", {
      kind: "polity",
      limit: 20,
      sort: "name",
    });
    expect(await screen.findByText("Aardvark Civic League")).toBeInTheDocument();
    expect(screen.getByText("Boulder Transit Riders")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
});

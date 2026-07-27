import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";
import { placePageFixture } from "@/../tests/fixtures/catalog/place-page";
import { asRouteStub, readRouterMocks } from "@/../tests/helpers/router-harness";
import type { PageHead } from "@/platform/seo";
import type { PlaceKind, PlacePageData } from "@rebuildingamerica/atlas-api-client";

/** The slice of the API client the place routes and page reach for. */
export interface PlaceApiMock {
  places: {
    getPage: ReturnType<typeof vi.fn>;
    listActors: ReturnType<typeof vi.fn>;
    listLatest: ReturnType<typeof vi.fn>;
  };
}

const placeApi: PlaceApiMock = {
  places: {
    getPage: vi.fn(),
    listActors: vi.fn(),
    listLatest: vi.fn(),
  },
};

/**
 * Module surface for `vi.mock("@rebuildingamerica/atlas-api-client", ...)` in
 * the place-slug route suites.
 *
 * @returns The mocked API client module.
 */
export function installPlaceApiMock(): Record<string, unknown> {
  return { api: placeApi };
}

/**
 * Hands a test the same mock the route module received.
 *
 * @returns The live place API mock.
 */
export function readPlaceApiMock(): PlaceApiMock {
  return placeApi;
}

export interface PlaceFixtureInput {
  display: string;
  kind: PlaceKind;
  name: string;
  slug: string;
}

/**
 * Re-labels the shared place fixture for one geography kind.
 *
 * @param input - Identity the route under test should be serving.
 * @returns Place page data with that identity.
 */
export function placeRouteFixture(input: PlaceFixtureInput): PlacePageData {
  return {
    ...placePageFixture,
    identity: {
      ...placePageFixture.identity,
      display: input.display,
      kind: input.kind,
      name: input.name,
      slug: input.slug,
    },
  } satisfies PlacePageData;
}

export interface PlaceSlugRouteExpectation {
  /** Path the canonical URL should point at, e.g. `/places/counties/clark-county-nv`. */
  canonicalPath: string;
  /** Identity the route should load and render. */
  data: PlacePageData;
  /** Geography kind the route is scoped to. */
  kind: PlaceKind;
  /** The `Route` exported by the route module under test. */
  route: unknown;
}

/**
 * Exercises one `places/<kind>/$placeSlug` route end to end: the loader asks
 * the API for the right geography kind, the head advertises a kind-specific
 * canonical URL, and the component renders the loaded place.
 *
 * The six place-kind routes are byte-identical apart from their kind and path,
 * so they share this one assertion rather than six near-copies of it.
 *
 * @param expectation - The route module and the identity it should serve.
 */
export async function expectPlaceSlugRoute(expectation: PlaceSlugRouteExpectation): Promise<void> {
  const Route = asRouteStub(expectation.route);
  const { data, kind } = expectation;
  const slug = data.identity.slug;

  placeApi.places.getPage.mockResolvedValueOnce(data);

  if (!Route.options.loader) throw new Error("Expected a route loader");
  const loaded = await Route.options.loader({ params: { placeSlug: slug } });

  expect(placeApi.places.getPage).toHaveBeenCalledWith(slug, { kind });
  expect(loaded).toBe(data);

  if (!Route.options.head) throw new Error("Expected a route head");
  const head = Route.options.head({
    loaderData: loaded,
    params: { placeSlug: slug },
  }) as PageHead;

  expect(head.meta).toContainEqual({ title: `${data.identity.name} | Atlas` });
  expect(head.links).toContainEqual({
    rel: "canonical",
    href: `https://atlas.rebuildingamerica.com${expectation.canonicalPath}`,
  });

  readRouterMocks().useLoaderData.mockReturnValue(loaded);
  const Component = Route.options.component;
  if (!Component) throw new Error("Expected a route component");
  render(<Component />);

  expect(screen.getByRole("heading", { level: 1, name: data.identity.name })).toBeInTheDocument();
  expect(screen.getByText(data.identity.display)).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: `${data.identity.name} sections` })).toBeVisible();
}

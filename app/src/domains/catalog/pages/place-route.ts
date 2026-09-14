import { notFound } from "@tanstack/react-router";
import { api } from "@rebuildingamerica/atlas-api-client";
import { AtlasApiError } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import { loadOrDegrade } from "@/platform/routes/load-or-degrade";
import { buildPageHead, type PageHead } from "@/platform/seo";
import type { PlaceKind, PlacePageData } from "@rebuildingamerica/atlas-api-client";

export interface PlaceRouteParams {
  placeSlug: string;
}

export interface PlaceRouteOptions {
  kind?: PlaceKind;
}

export type PlaceRouteHead = PageHead | Record<string, never>;

export async function loadPlaceRoute(
  params: PlaceRouteParams,
  options: PlaceRouteOptions = {},
): Promise<PlacePageData> {
  try {
    if (options.kind) {
      return await api.places.getPage(params.placeSlug, { kind: options.kind });
    }
    return await api.places.getPage(params.placeSlug);
  } catch (error) {
    if (error instanceof AtlasApiError && error.status === 404) {
      notFound({ throw: true });
    }
    throw error;
  }
}

/**
 * The place routes' loader: the place page, or nothing when the API failed.
 *
 * @param params - The route's slug.
 * @param options - The geography kind the route pins, if any.
 * @returns The page data, or `undefined` so the route renders placeholders.
 */
export async function loadPlaceRouteOrDegrade(
  params: PlaceRouteParams,
  options: PlaceRouteOptions = {},
): Promise<PlacePageData | undefined> {
  return loadOrDegrade(() => loadPlaceRoute(params, options));
}

/**
 * Cache key for one place page, distinct per pinned geography kind.
 *
 * @param params - The route's slug.
 * @param options - The geography kind the route pins, if any.
 * @returns The React Query key.
 */
export function placePageQueryKey(params: PlaceRouteParams, options: PlaceRouteOptions = {}) {
  return ["places", "page", options.kind ?? "any", params.placeSlug] as const;
}

export function buildPlaceRouteHead(data: PlacePageData | undefined, path: string): PlaceRouteHead {
  if (!data) {
    return {};
  }

  const description = [
    "People, organizations, public records, issues, facts, government, and places in",
    data.identity.display,
  ].join(" ");

  return buildPageHead({
    title: `${data.identity.name} | Atlas`,
    socialTitle: data.identity.name,
    description,
    path,
  });
}

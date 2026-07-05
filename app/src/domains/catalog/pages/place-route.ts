import { api } from "@/lib/api";
import { buildPageHead, type PageHead } from "@/platform/seo";
import type { PlaceKind, PlacePageData } from "@/types";

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
  if (options.kind) {
    return api.places.getPage(params.placeSlug, { kind: options.kind });
  }
  return api.places.getPage(params.placeSlug);
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

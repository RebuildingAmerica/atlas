import { api } from "@/lib/api";
import { buildPageHead, type PageHead } from "@/platform/seo";
import type { PlacePageData } from "@/types";

export interface PlaceRouteParams {
  placeSlug: string;
}

export type PlaceRouteHead = PageHead | Record<string, never>;

export async function loadPlaceRoute(params: PlaceRouteParams): Promise<PlacePageData> {
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

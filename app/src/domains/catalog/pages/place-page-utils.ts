import type { EntryType, PlaceActorSort, PlaceRelatedSummary, SourceType } from "@/types";

interface SectionNavItem {
  id: string;
  label: string;
}

interface CoordinateBounds {
  maxLat: number;
  maxLng: number;
  minLat: number;
  minLng: number;
}

interface SvgPoint {
  x: number;
  y: number;
}

type CoordinatePlace = PlaceRelatedSummary & {
  latitude: number;
  longitude: number;
};

export const ACTOR_TYPES: { label: string; value: EntryType }[] = [
  { label: "Organizations", value: "organization" },
  { label: "People", value: "person" },
  { label: "Initiatives", value: "initiative" },
];

export const ACTOR_SORTS: { label: string; value: PlaceActorSort }[] = [
  { label: "Best match", value: "relevance" },
  { label: "Most documented", value: "source_count" },
  { label: "Recent", value: "recent" },
  { label: "Name", value: "name" },
];

export const LATEST_SOURCE_TYPES: { label: string; value: SourceType }[] = [
  { label: "Government records", value: "government_record" },
  { label: "News", value: "news_article" },
  { label: "Reports", value: "report" },
  { label: "Org websites", value: "org_website" },
];

export const SECTION_NAV_ITEMS: SectionNavItem[] = [
  { id: "latest", label: "Latest" },
  { id: "people-organizations", label: "People & Organizations" },
  { id: "issues", label: "Issues" },
  { id: "facts", label: "Facts" },
  { id: "government", label: "Government" },
  { id: "places", label: "Places" },
];

export const PLACE_ACCENT_CLASSES: Record<PlaceRelatedSummary["accent"], string> = {
  climate: "bg-surface-container",
  democracy: "bg-paper-deep",
  education: "bg-surface-container-high",
  health: "bg-paper-faded",
  housing: "bg-surface-container-low",
  labor: "bg-surface-container",
  neutral: "bg-surface-container-low",
};

export const PLACE_THUMBNAIL_WIDTH = 160;
export const PLACE_THUMBNAIL_HEIGHT = 96;
export const PLACE_THUMBNAIL_PADDING = 14;
export const MIN_PLACE_THUMBNAIL_SPAN_DEGREES = 0.08;

export function formatSourceType(value: string): string {
  const label = value.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function latestStatusText(isLoading: boolean, count: number): string {
  if (isLoading) {
    return "Loading";
  }
  return `Showing ${count} latest activity ${count === 1 ? "item" : "items"}`;
}

export function actorStatusText(isLoading: boolean, count: number): string {
  if (isLoading) {
    return "Loading";
  }
  return `Showing ${count} ${count === 1 ? "person or organization" : "people and organizations"}`;
}

export function hasCoordinates(place: PlaceRelatedSummary): place is CoordinatePlace {
  return (
    typeof place.latitude === "number" &&
    Number.isFinite(place.latitude) &&
    typeof place.longitude === "number" &&
    Number.isFinite(place.longitude)
  );
}

export function relatedCoordinatePlaces(places: PlaceRelatedSummary[]): CoordinatePlace[] {
  return places.filter(hasCoordinates);
}

export function coordinateBounds(places: CoordinatePlace[]): CoordinateBounds {
  const latitudes = places.map((place) => place.latitude);
  const longitudes = places.map((place) => place.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latCenter = (minLat + maxLat) / 2;
  const lngCenter = (minLng + maxLng) / 2;
  const latSpan = Math.max(maxLat - minLat, MIN_PLACE_THUMBNAIL_SPAN_DEGREES);
  const lngSpan = Math.max(maxLng - minLng, MIN_PLACE_THUMBNAIL_SPAN_DEGREES);

  return {
    maxLat: latCenter + latSpan / 2,
    maxLng: lngCenter + lngSpan / 2,
    minLat: latCenter - latSpan / 2,
    minLng: lngCenter - lngSpan / 2,
  };
}

export function coordinatePoint(place: CoordinatePlace, bounds: CoordinateBounds): SvgPoint {
  const drawableWidth = PLACE_THUMBNAIL_WIDTH - PLACE_THUMBNAIL_PADDING * 2;
  const drawableHeight = PLACE_THUMBNAIL_HEIGHT - PLACE_THUMBNAIL_PADDING * 2;
  const lngRange = bounds.maxLng - bounds.minLng;
  const latRange = bounds.maxLat - bounds.minLat;

  return {
    x: PLACE_THUMBNAIL_PADDING + ((place.longitude - bounds.minLng) / lngRange) * drawableWidth,
    y: PLACE_THUMBNAIL_PADDING + ((bounds.maxLat - place.latitude) / latRange) * drawableHeight,
  };
}

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { api } from "@/lib/api";
import type { EntryType, MapBounds, MapPointCollection, SourcePattern, SourceType } from "@/types";

/**
 * The continental-US bounding box the map opens on.
 *
 * Matches the basemap's initial framing so the dots the loader seeds line up
 * with the country the visitor first sees, with a little breathing room on
 * every edge.
 */
export const CONUS_BBOX_BOUNDS: MapBounds = {
  minLng: -125,
  minLat: 24,
  maxLng: -66.5,
  maxLat: 49.5,
};

const optionalList = z.array(z.string()).optional();

const mapSeedSchema = z.object({
  query: z.string().optional(),
  states: optionalList,
  cities: optionalList,
  regions: optionalList,
  issue_areas: optionalList,
  entry_types: optionalList,
  source_types: optionalList,
  source_patterns: optionalList,
});

/**
 * Seed the initial US-bbox dots during the route load so the first paint has
 * actors, not an empty country.
 *
 * Runs the same viewport query the live map issues, framed on the continental
 * US and narrowed by whatever browse filters the shared URL carried, so a
 * shared `/map?issue_areas=housing` link arrives already showing the right
 * dots. React Query then treats this as the initial data for the matching
 * query key rather than refetching on hydration.
 *
 * @param data The browse filters carried by the route's search params.
 * @returns The placed actors inside the continental US for those filters.
 */
export const loadMapPoints = createServerFn({ method: "GET" })
  .inputValidator(mapSeedSchema)
  .handler(async ({ data }): Promise<MapPointCollection> => {
    return await api.entries.mapPoints({
      bounds: CONUS_BBOX_BOUNDS,
      query: data.query ? data.query : undefined,
      states: data.states ?? [],
      cities: data.cities ?? [],
      regions: data.regions ?? [],
      issue_areas: data.issue_areas ?? [],
      entry_types: (data.entry_types ?? []) as EntryType[],
      source_types: (data.source_types ?? []) as SourceType[],
      source_patterns: (data.source_patterns ?? []) as SourcePattern[],
    });
  });

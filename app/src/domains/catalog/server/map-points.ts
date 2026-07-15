import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { api } from "@rebuildingamerica/atlas-api-client";
import { CONUS_BBOX_BOUNDS, boundsFromSearch } from "@/domains/catalog/map/map-viewport";
import type {
  EntryType,
  MapPointCollection,
  SourcePattern,
  SourceType,
} from "@rebuildingamerica/atlas-api-client";

export { CONUS_BBOX_BOUNDS };

const optionalList = z.array(z.string()).optional();

const mapSeedSchema = z.object({
  query: z.string().optional(),
  z: z.number().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
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
  .validator(mapSeedSchema)
  .handler(async ({ data }): Promise<MapPointCollection> => {
    return await api.entries.mapPoints({
      bounds: boundsFromSearch(data),
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

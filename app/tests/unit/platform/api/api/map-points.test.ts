import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as GeneratedAtlas from "@rebuildingamerica/atlas-api-client/generated/atlas";

vi.mock("@rebuildingamerica/atlas-api-client/orval/fetcher", () => ({
  atlasFetch: vi.fn(),
}));

const mapMocks = vi.hoisted(() => ({
  getEntitiesMap: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-api-client/generated/atlas", async () => {
  const actual = await vi.importActual<typeof GeneratedAtlas>(
    "@rebuildingamerica/atlas-api-client/generated/atlas",
  );
  return {
    ...actual,
    getEntitiesMap: mapMocks.getEntitiesMap,
  };
});

import { api } from "@rebuildingamerica/atlas-api-client";
import { CONUS_BOUNDS } from "../../../../fixtures/catalog/map";

describe("api.entries.mapPoints", () => {
  beforeEach(() => {
    mapMocks.getEntitiesMap.mockReset();
  });

  it("requests the viewport and maps every placed actor onto the internal shape", async () => {
    mapMocks.getEntitiesMap.mockResolvedValueOnce({
      points: [
        {
          id: "ent_1",
          name: "Prairie Housing Trust",
          type: "organization",
          slug: "prairie-housing-trust-1",
          place_label: "Kansas City, MO",
          geo_specificity: "local",
          geocode_precision: "city",
          geocode_source: "gazetteer",
          lat: 39.1,
          lng: -94.6,
          issue_areas: ["housing_affordability"],
          source_count: 2,
          latest_source_date: "2026-05-04",
          trust_level: "corroborated",
        },
      ],
      total: 1,
      capped: false,
    });

    const result = await api.entries.mapPoints({
      bounds: CONUS_BOUNDS,
      issue_areas: ["housing_affordability"],
    });

    expect(mapMocks.getEntitiesMap).toHaveBeenCalledWith(
      expect.objectContaining({
        min_lng: -125,
        max_lat: 49.5,
        issue_area: ["housing_affordability"],
      }),
    );
    expect(result).toEqual({
      points: [
        {
          id: "ent_1",
          name: "Prairie Housing Trust",
          type: "organization",
          slug: "prairie-housing-trust-1",
          place_label: "Kansas City, MO",
          geo_specificity: "local",
          geocode_precision: "city",
          geocode_source: "gazetteer",
          lat: 39.1,
          lng: -94.6,
          issue_areas: ["housing_affordability"],
          source_count: 2,
          latest_source_date: "2026-05-04",
          trust_level: "corroborated",
        },
      ],
      total: 1,
      capped: false,
    });
  });

  it("defaults the slug to null and issue areas to an empty list when the API omits them", async () => {
    mapMocks.getEntitiesMap.mockResolvedValueOnce({
      points: [
        {
          id: "ent_2",
          name: "Jane Organizer",
          type: "person",
          slug: null,
          place_label: null,
          geo_specificity: null,
          geocode_precision: null,
          geocode_source: null,
          lat: 30.3,
          lng: -97.7,
          source_count: 0,
          latest_source_date: null,
          trust_level: "unverified",
        },
      ],
      total: 1,
      capped: false,
    });

    const result = await api.entries.mapPoints({ bounds: CONUS_BOUNDS });

    expect(result.points[0]).toEqual({
      id: "ent_2",
      name: "Jane Organizer",
      type: "person",
      slug: null,
      place_label: null,
      geo_specificity: null,
      geocode_precision: null,
      geocode_source: null,
      lat: 30.3,
      lng: -97.7,
      issue_areas: [],
      source_count: 0,
      latest_source_date: null,
      trust_level: "unverified",
    });
  });

  it("returns an empty collection when the viewport carries no points field", async () => {
    mapMocks.getEntitiesMap.mockResolvedValueOnce({ total: 0, capped: false });

    const result = await api.entries.mapPoints({ bounds: CONUS_BOUNDS });

    expect(result).toEqual({ points: [], total: 0, capped: false });
  });
});

import { isNotFound } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacePageData } from "@rebuildingamerica/atlas-api-client";
import { AtlasApiError } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import {
  buildPlaceRouteHead,
  loadPlaceRoute,
  loadPlaceRouteOrDegrade,
  placePageQueryKey,
} from "@/domains/catalog/pages/place-route";
import { placePageFixture } from "../../../../fixtures/catalog/place-page";

const apiMocks = vi.hoisted(() => ({
  getPage: vi.fn<(slug: string, params?: unknown) => Promise<PlacePageData>>(),
}));

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: { places: { getPage: apiMocks.getPage } },
}));

describe("place route data", () => {
  beforeEach(() => {
    apiMocks.getPage.mockReset();
    apiMocks.getPage.mockResolvedValue(placePageFixture);
  });

  describe("loadPlaceRoute", () => {
    it("asks for the place at whatever scope the route pins it to", async () => {
      const data = await loadPlaceRoute({ placeSlug: "las-vegas-nv" }, { kind: "city" });

      expect(data).toEqual(placePageFixture);
      expect(apiMocks.getPage).toHaveBeenCalledWith("las-vegas-nv", { kind: "city" });
    });

    it("lets the API choose the scope when the route does not pin one", async () => {
      await loadPlaceRoute({ placeSlug: "las-vegas-nv" });

      expect(apiMocks.getPage).toHaveBeenCalledWith("las-vegas-nv");
    });

    it("answers a place the API does not know with not-found", async () => {
      apiMocks.getPage.mockRejectedValue(new AtlasApiError(404, "Place not found"));

      const thrown: unknown = await loadPlaceRoute({ placeSlug: "atlantis" }).catch(
        (error: unknown) => error,
      );

      expect(isNotFound(thrown)).toBe(true);
    });

    it("passes any other failure through for the caller to degrade", async () => {
      const outage = new AtlasApiError(429, "Too many requests");
      apiMocks.getPage.mockRejectedValue(outage);

      await expect(loadPlaceRoute({ placeSlug: "las-vegas-nv" })).rejects.toBe(outage);
    });
  });

  describe("loadPlaceRouteOrDegrade", () => {
    it("returns the place when the API answers", async () => {
      await expect(
        loadPlaceRouteOrDegrade({ placeSlug: "las-vegas-nv" }, { kind: "city" }),
      ).resolves.toEqual(placePageFixture);
      expect(apiMocks.getPage).toHaveBeenCalledWith("las-vegas-nv", { kind: "city" });
    });

    it("returns nothing during an outage so the page renders placeholders", async () => {
      apiMocks.getPage.mockRejectedValue(new AtlasApiError(429, "Too many requests"));

      await expect(loadPlaceRouteOrDegrade({ placeSlug: "las-vegas-nv" })).resolves.toBeUndefined();
    });

    it("still answers a missing place with not-found", async () => {
      apiMocks.getPage.mockRejectedValue(new AtlasApiError(404, "Place not found"));

      const thrown: unknown = await loadPlaceRouteOrDegrade({ placeSlug: "atlantis" }).catch(
        (error: unknown) => error,
      );

      expect(isNotFound(thrown)).toBe(true);
    });
  });

  describe("placePageQueryKey", () => {
    it("keys a place separately for each geography kind a route pins", () => {
      expect(placePageQueryKey({ placeSlug: "las-vegas-nv" }, { kind: "city" })).toEqual([
        "places",
        "page",
        "city",
        "las-vegas-nv",
      ]);
      expect(placePageQueryKey({ placeSlug: "las-vegas-nv" })).toEqual([
        "places",
        "page",
        "any",
        "las-vegas-nv",
      ]);
    });
  });

  describe("buildPlaceRouteHead", () => {
    it("titles and describes the place for search results and link previews", () => {
      const head = buildPlaceRouteHead(placePageFixture, "/places/las-vegas-nv");

      expect(head).toHaveProperty("meta");
      const meta = "meta" in head ? head.meta : [];
      expect(meta).toContainEqual({ title: "Las Vegas | Atlas" });
      expect(meta).toContainEqual({ content: "Las Vegas", property: "og:title" });
      expect(meta).toContainEqual({
        content:
          "People, organizations, public records, issues, facts, government, and places in Las Vegas, NV",
        name: "description",
      });
      expect("links" in head ? head.links : []).toContainEqual(
        expect.objectContaining({ rel: "canonical" }),
      );
    });

    it("emits nothing rather than a head describing a place that failed to load", () => {
      expect(buildPlaceRouteHead(undefined, "/places/las-vegas-nv")).toEqual({});
    });
  });
});

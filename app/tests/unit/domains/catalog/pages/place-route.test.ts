import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacePageData } from "@rebuildingamerica/atlas-api-client";
import { buildPlaceRouteHead, loadPlaceRoute } from "@/domains/catalog/pages/place-route";
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

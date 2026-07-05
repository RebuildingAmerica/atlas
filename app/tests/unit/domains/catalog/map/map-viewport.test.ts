import { describe, expect, it } from "vitest";
import {
  CONUS_VIEW,
  boundsFromSearch,
  boundsFromView,
  boundsFromCorners,
  viewFromSearch,
  viewToSearch,
} from "@/domains/catalog/map/map-viewport";

describe("map-viewport", () => {
  describe("viewFromSearch", () => {
    it("restores a saved center and zoom from the URL search", () => {
      expect(viewFromSearch({ lat: 32.78, lng: -96.8, z: 9 })).toEqual({
        center: { lng: -96.8, lat: 32.78 },
        zoom: 9,
      });
    });

    it("falls back to the continental-US view when no viewport is saved", () => {
      expect(viewFromSearch({})).toEqual(CONUS_VIEW);
    });

    it("falls back to the CONUS view when the saved viewport is only partial", () => {
      // A shared link that lost its zoom should land on the country, not crash.
      expect(viewFromSearch({ lat: 32.78, lng: -96.8 })).toEqual(CONUS_VIEW);
      expect(viewFromSearch({ z: 9, lng: -96.8 })).toEqual(CONUS_VIEW);
      expect(viewFromSearch({ z: 9, lat: 32.78 })).toEqual(CONUS_VIEW);
    });
  });

  describe("viewToSearch", () => {
    it("rounds the camera into a compact, shareable search patch", () => {
      expect(viewToSearch({ center: { lng: -96.80123, lat: 32.78456 }, zoom: 9.4123 })).toEqual({
        lng: -96.8012,
        lat: 32.7846,
        z: 9.41,
      });
    });
  });

  describe("boundsFromCorners", () => {
    it("orders an unordered corner pair into a min/max bounding box", () => {
      expect(boundsFromCorners({ lng: -66.5, lat: 49.5 }, { lng: -125, lat: 24 })).toEqual({
        minLng: -125,
        minLat: 24,
        maxLng: -66.5,
        maxLat: 49.5,
      });
    });
  });

  describe("boundsFromSearch", () => {
    it("opens shared camera links near the saved viewport instead of the whole country", () => {
      const bounds = boundsFromSearch({ lat: 32.78, lng: -96.8, z: 9 });

      expect(bounds.minLng).toBeGreaterThan(-100);
      expect(bounds.maxLng).toBeLessThan(-93);
      expect(bounds.minLat).toBeGreaterThan(31);
      expect(bounds.maxLat).toBeLessThan(35);
    });

    it("falls back to CONUS bounds when the shared camera is incomplete", () => {
      expect(boundsFromSearch({ lat: 32.78, lng: -96.8 })).toEqual({
        minLng: -125,
        minLat: 24,
        maxLng: -66.5,
        maxLat: 49.5,
      });
    });

    it("derives ordered bounds from a concrete map view", () => {
      const bounds = boundsFromView({ center: { lat: 32.78, lng: -96.8 }, zoom: 9 });

      expect(bounds.minLng).toBeLessThan(-96.8);
      expect(bounds.maxLng).toBeGreaterThan(-96.8);
      expect(bounds.minLat).toBeLessThan(32.78);
      expect(bounds.maxLat).toBeGreaterThan(32.78);
    });
  });
});

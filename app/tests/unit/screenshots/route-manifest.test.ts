import { describe, expect, it } from "vitest";

import { routeIdToPattern } from "../../helpers/screenshot-manifest-harness";
import { CAPTURE_ROUTES, EXCLUDED_ROUTES } from "../../screenshots/route-manifest";

describe("screenshot route manifest", () => {
  it("gives every capture a unique output name", () => {
    const names = CAPTURE_ROUTES.map((route) => route.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every capture exactly one way to resolve its URL", () => {
    for (const route of CAPTURE_ROUTES) {
      const hasPath = route.path !== undefined;
      const hasDiscovery = "discovery" in route && route.discovery !== undefined;
      expect(hasPath !== hasDiscovery, `${route.name} must set exactly one of path/discovery`).toBe(
        true,
      );
    }
  });

  it("uses paths that structurally match their route id", () => {
    for (const route of CAPTURE_ROUTES) {
      if (route.path === undefined || route.expectPathname !== undefined) {
        continue;
      }
      expect(routeIdToPattern(route.routeId).test(route.path), `${route.name}: ${route.path}`).toBe(
        true,
      );
    }
  });

  it("never captures a route that is also excluded", () => {
    const excluded = new Set(Object.keys(EXCLUDED_ROUTES));
    for (const route of CAPTURE_ROUTES) {
      expect(excluded.has(route.routeId), `${route.name} is both captured and excluded`).toBe(
        false,
      );
    }
  });

  it("explains every exclusion", () => {
    for (const [path, excluded] of Object.entries(EXCLUDED_ROUTES)) {
      expect(excluded.reason.length, `${path} needs a reason`).toBeGreaterThan(0);
    }
  });

  it("captures pages in both modes", () => {
    const modes = new Set(CAPTURE_ROUTES.map((route) => route.mode));
    expect(modes).toEqual(new Set(["local", "session"]));
  });
});

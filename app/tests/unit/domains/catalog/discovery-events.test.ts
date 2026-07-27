// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { trackDiscoveryEvent } from "@/domains/catalog/discovery-events";

describe("trackDiscoveryEvent", () => {
  it("dispatches a browser event with the discovery event name and metadata", () => {
    const listener = vi.fn();
    window.addEventListener("atlas:discovery", listener);

    trackDiscoveryEvent("catalog_search_submitted", {
      query: "housing in Phoenix",
      result_count: 0,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({
      name: "catalog_search_submitted",
      properties: {
        query: "housing in Phoenix",
        result_count: 0,
      },
    });

    window.removeEventListener("atlas:discovery", listener);
  });

  it("stays silent during server rendering, where there is nothing listening", () => {
    const listener = vi.fn();
    window.addEventListener("atlas:discovery", listener);
    vi.stubGlobal("window", undefined);

    expect(() => {
      trackDiscoveryEvent("catalog_zero_results");
    }).not.toThrow();

    vi.unstubAllGlobals();
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("atlas:discovery", listener);
  });
});

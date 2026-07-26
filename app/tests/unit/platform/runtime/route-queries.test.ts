import { describe, expect, it } from "vitest";
import { warmRouteQueries } from "@/platform/runtime/route-queries";

describe("warmRouteQueries", () => {
  it("waits for every query and hands the route nothing to serialise", async () => {
    const settled: string[] = [];
    const runs = Promise.resolve({ items: [{ id: "run_1" }] }).then((payload) => {
      settled.push("runs");
      return payload;
    });
    const taxonomy = Promise.resolve({ Housing: [] }).then((payload) => {
      settled.push("taxonomy");
      return payload;
    });

    await expect(warmRouteQueries(runs, taxonomy)).resolves.toBeUndefined();
    expect(settled).toEqual(["runs", "taxonomy"]);
  });

  it("surfaces a failed query so the route's error boundary sees it", async () => {
    await expect(warmRouteQueries(Promise.reject(new Error("upstream down")))).rejects.toThrow(
      "upstream down",
    );
  });
});

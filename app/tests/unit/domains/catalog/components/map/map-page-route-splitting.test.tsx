import { describe, expect, it, vi } from "vitest";

vi.mock("@/domains/catalog/components/map/map-interactive-surface", () => {
  throw new Error("MapPage import should not evaluate the WebGL map surface.");
});

describe("MapPage route splitting", () => {
  it("imports the page shell without loading the WebGL surface chunk", async () => {
    await expect(import("@/domains/catalog/components/map/map-page")).resolves.toHaveProperty(
      "MapPage",
    );
  });
});

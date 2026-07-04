import { describe, expect, it } from "vitest";
import { PUBLIC_ATLAS_ENV_KEYS } from "../../vite.config";

describe("vite config", () => {
  it("exposes the map style URL to the client bundle", () => {
    expect(PUBLIC_ATLAS_ENV_KEYS).toContain("ATLAS_MAP_STYLE_URL");
  });
});

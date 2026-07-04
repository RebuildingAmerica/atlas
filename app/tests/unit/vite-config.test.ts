import { describe, expect, it } from "vitest";
import { PUBLIC_ATLAS_ENV_KEYS, validateProductionPublicEnv } from "../../vite.config";

describe("vite config", () => {
  it("exposes public origin and map style values to the client bundle", () => {
    expect(PUBLIC_ATLAS_ENV_KEYS).toContain("ATLAS_PUBLIC_URL");
    expect(PUBLIC_ATLAS_ENV_KEYS).toContain("ATLAS_MAP_STYLE_URL");
  });

  it("rejects production deploy builds without a real map style URL", () => {
    expect(() => {
      validateProductionPublicEnv({
        ATLAS_DEPLOY_MODE: "production",
      });
    }).toThrow("ATLAS_MAP_STYLE_URL is required for production Atlas builds.");

    expect(() => {
      validateProductionPublicEnv({
        ATLAS_MAP_STYLE_URL: "https://maptiler.invalid/maps/atlas-placeholder/style.json",
        VERCEL_ENV: "production",
      });
    }).toThrow("ATLAS_MAP_STYLE_URL must not use the placeholder in production Atlas builds.");
  });

  it("allows non-production builds to omit the map style URL", () => {
    expect(() => {
      validateProductionPublicEnv({ ATLAS_DEPLOY_MODE: "local" });
    }).not.toThrow();
    expect(() => {
      validateProductionPublicEnv({});
    }).not.toThrow();
  });
});

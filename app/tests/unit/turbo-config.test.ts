import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { envForTask, loadRootTurboConfig, loadTurboConfig } from "../helpers/turbo-config-harness";

describe("turbo config", () => {
  it("generates the API client before a clean app build", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.prebuild).toBe(
      "pnpm run api-client && pnpm run generate:route-tree",
    );
  });

  it("does not model the public map style as deployment environment", () => {
    const config = loadTurboConfig();

    expect(envForTask(config, "build")).not.toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "dev:e2e")).not.toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "start:e2e")).not.toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "test:acceptance")).not.toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "test:acceptance:browser")).not.toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "test:acceptance:stripe")).not.toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "test:acceptance:headed")).not.toContain("ATLAS_MAP_STYLE_URL");
  });

  it("keeps Stripe credentials out of browser-only acceptance", () => {
    const config = loadTurboConfig();

    expect(envForTask(config, "test:acceptance:browser")).not.toContain("STRIPE_API_KEY");
    expect(envForTask(config, "test:acceptance:browser")).not.toContain("STRIPE_ATLAS_CATALOG");
    expect(envForTask(config, "test:acceptance:stripe")).toContain("STRIPE_API_KEY");
    expect(envForTask(config, "test:acceptance:stripe")).toContain("STRIPE_ATLAS_CATALOG");
    expect(envForTask(config, "start:e2e")).toContain("STRIPE_API_KEY");
    expect(envForTask(config, "start:e2e")).toContain("STRIPE_ATLAS_CATALOG");
  });

  it("forwards the ATProto OAuth harness flag to the API acceptance server", () => {
    const config = loadRootTurboConfig();

    expect(envForTask(config, "//#e2e:api")).toContain("ATLAS_ATPROTO_OAUTH_E2E_HARNESS");
    expect(envForTask(config, "//#e2e:api")).toContain("ATLAS_ATPROTO_PDS_E2E_HARNESS");
  });

  it("forwards hosted identity runtime configuration to the app build", () => {
    const config = loadTurboConfig();

    expect(envForTask(config, "build")).toEqual(
      expect.arrayContaining([
        "ATLAS_ATPROTO_OAUTH_E2E_HARNESS",
        "ATLAS_ATPROTO_PDS_E2E_HARNESS",
        "ATLAS_HOSTED_E2E_ENABLED",
        "ATLAS_HOSTED_E2E_PRODUCTION_ENABLED",
        "ATLAS_HOSTED_E2E_SECRET",
        "ATLAS_PDS_ADMIN_PASSWORD",
        "ATLAS_PDS_PUBLIC_URL",
      ]),
    );
  });
});

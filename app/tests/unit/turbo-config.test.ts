import { describe, expect, it } from "vitest";
import { envForTask, loadTurboConfig } from "../helpers/turbo-config-harness";

describe("turbo config", () => {
  it("does not model the public map style as deployment environment", () => {
    const config = loadTurboConfig();

    expect(envForTask(config, "build")).not.toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "dev:e2e")).not.toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "start:e2e")).not.toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "test:acceptance")).not.toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "test:acceptance:headed")).not.toContain("ATLAS_MAP_STYLE_URL");
  });
});

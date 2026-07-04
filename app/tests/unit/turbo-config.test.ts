import { describe, expect, it } from "vitest";
import { envForTask, loadTurboConfig } from "../helpers/turbo-config-harness";

describe("turbo config", () => {
  it("forwards the map style URL to build and browser-test tasks", () => {
    const config = loadTurboConfig();

    expect(envForTask(config, "build")).toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "dev:e2e")).toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "start:e2e")).toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "test:acceptance")).toContain("ATLAS_MAP_STYLE_URL");
    expect(envForTask(config, "test:acceptance:headed")).toContain("ATLAS_MAP_STYLE_URL");
  });
});

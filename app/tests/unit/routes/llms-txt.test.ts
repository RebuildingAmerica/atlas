import { afterEach, describe, expect, it, vi } from "vitest";
import { readTextRouteResponse } from "../../helpers/plain-text-route-harness";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/llms.txt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("publishes canonical public entry points for answer engines", async () => {
    vi.stubEnv("ATLAS_PUBLIC_URL", "https://preview.atlas.example/app");
    const routeModule = await import("@/routes/llms[.]txt");

    const { body } = await readTextRouteResponse(routeModule.Route);

    expect(body).toContain("# Atlas");
    expect(body).toContain("https://preview.atlas.example/");
    expect(body).toContain("https://preview.atlas.example/browse");
    expect(body).toContain("https://preview.atlas.example/map");
    expect(body).toContain("https://preview.atlas.example/sitemap.xml");
    expect(body).toContain("source-linked public profiles");
    expect(body).not.toContain("warming up");
    expect(body).not.toContain("gathering");
  });
});

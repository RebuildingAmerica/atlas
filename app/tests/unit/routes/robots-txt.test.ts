import { afterEach, describe, expect, it, vi } from "vitest";
import { readTextRouteResponse } from "../../helpers/plain-text-route-harness";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/robots.txt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("advertises the canonical sitemap and protects private surfaces", async () => {
    vi.stubEnv("ATLAS_PUBLIC_URL", "https://preview.atlas.example/app");
    const routeModule = await import("@/routes/robots[.]txt");

    const { body } = await readTextRouteResponse(routeModule.Route);

    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Disallow: /sign-in");
    expect(body).toContain("Disallow: /account");
    expect(body).toContain("Sitemap: https://preview.atlas.example/sitemap.xml");
    expect(body).not.toContain("https://atlas.rebuildingamerica.com/sitemap.xml");
  });
});

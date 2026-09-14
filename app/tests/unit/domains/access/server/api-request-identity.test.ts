import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthRuntimeConfig: vi.fn(),
  getRequest: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({ getRequest: mocks.getRequest }));
vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

import { atlasFetch } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import {
  registerApiRequestIdentity,
  visitorIdentityHeaders,
} from "@/domains/access/server/api-request-identity";
import { visitorRequest } from "../../../../helpers/access/visitor-request";

describe("visitorIdentityHeaders", () => {
  it("signs the visitor's address with the internal secret", () => {
    expect(visitorIdentityHeaders(visitorRequest("203.0.113.10"), "secret", 1)).toEqual({
      "X-Atlas-Client-IP": "203.0.113.10",
      "X-Atlas-Proxy-Secret": "secret", // pragma: allowlist secret - test fixture
    });
  });

  it("names nobody when the address or the secret is missing", () => {
    expect(visitorIdentityHeaders(visitorRequest(null), "secret", 1)).toEqual({});
    expect(visitorIdentityHeaders(visitorRequest("203.0.113.10"), "", 1)).toEqual({});
  });
});

describe("registerApiRequestIdentity", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubEnv("ATLAS_SERVER_API_PROXY_TARGET", "https://api.atlas.test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("gives each server-side API call the identity of the visitor it serves", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({
      anonymousRateLimit: { trustedProxyHops: 1 },
      internalSecret: "secret", // pragma: allowlist secret - test fixture
    });
    mocks.getRequest.mockReturnValue(visitorRequest("198.51.100.7"));
    registerApiRequestIdentity();

    await atlasFetch("/api/entities?limit=1");

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({
      "X-Atlas-Client-IP": "198.51.100.7",
      "X-Atlas-Proxy-Secret": "secret", // pragma: allowlist secret - test fixture
    });
  });
});

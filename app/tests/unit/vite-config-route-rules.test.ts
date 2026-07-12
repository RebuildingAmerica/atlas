import { describe, expect, it } from "vitest";

import { buildHostedProxyRouteRules } from "../../vite.config";

describe("hosted proxy route rules", () => {
  it("proxies public catalog API reads at the platform layer", () => {
    const rules = buildHostedProxyRouteRules({
      ATLAS_SERVER_API_PROXY_TARGET: "https://atlas-api.example.com",
    });

    expect(rules["/api/entities"]).toEqual({
      proxy: "https://atlas-api.example.com/api/entities",
    });
    expect(rules["/api/entities/**"]).toEqual({
      proxy: "https://atlas-api.example.com/api/entities/**",
    });
    expect(rules["/api/auth/**"]).toBeUndefined();
  });
});

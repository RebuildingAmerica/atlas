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

  it("sends pages that moved to the platform admin to the admin host", () => {
    const rules = buildHostedProxyRouteRules({
      ATLAS_ADMIN_PUBLIC_URL: "https://atlas-admin.example.com/",
    });

    expect(rules["/admin/discounts"]).toEqual({
      redirect: { to: "https://atlas-admin.example.com/discounts", status: 308 },
    });
    expect(rules["/admin/cloud-costs"]).toEqual({
      redirect: { to: "https://atlas-admin.example.com/cloud-costs", status: 308 },
    });
    expect(rules["/admin/corrections"]).toBeUndefined();
  });

  it("has nothing to redirect on a deployment with no platform admin", () => {
    const rules = buildHostedProxyRouteRules({ ATLAS_ADMIN_PUBLIC_URL: "  " });

    expect(rules["/admin/discounts"]).toBeUndefined();
  });
});

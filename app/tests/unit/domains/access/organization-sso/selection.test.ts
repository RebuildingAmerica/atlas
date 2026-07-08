import { describe, expect, it } from "vitest";

import { makeAtlasWorkspaceSSOProvider } from "./support";
import { selectPreferredWorkspaceSSOProvider } from "@/domains/access/organization-sso";

describe("selectPreferredWorkspaceSSOProvider", () => {
  it("returns the workspace primary provider when available", () => {
    const providers = [
      makeAtlasWorkspaceSSOProvider({ providerId: "p1", providerType: "oidc" }),
      makeAtlasWorkspaceSSOProvider({ providerId: "p2", providerType: "saml" }),
    ];
    const result = selectPreferredWorkspaceSSOProvider({
      domain: "atlas.test",
      primaryProviderId: "p2",
      providers,
    });
    expect(result?.providerId).toBe("p2");
  });

  it("prefers a verified SAML provider when no primary is set", () => {
    const providers = [
      makeAtlasWorkspaceSSOProvider({ providerId: "p1", providerType: "oidc" }),
      makeAtlasWorkspaceSSOProvider({ providerId: "p2", providerType: "saml" }),
    ];
    const result = selectPreferredWorkspaceSSOProvider({
      domain: "atlas.test",
      primaryProviderId: null,
      providers,
    });
    expect(result?.providerId).toBe("p2");
  });

  it("falls back to the first verified provider when no SAML is configured", () => {
    const providers = [
      makeAtlasWorkspaceSSOProvider({ providerId: "p1", providerType: "oidc" }),
      makeAtlasWorkspaceSSOProvider({ providerId: "p2", providerType: "oidc" }),
    ];
    const result = selectPreferredWorkspaceSSOProvider({
      domain: "atlas.test",
      primaryProviderId: null,
      providers,
    });
    expect(result?.providerId).toBe("p1");
  });

  it("filters by email domain when provided", () => {
    const providers = [
      makeAtlasWorkspaceSSOProvider({
        providerId: "p1",
        providerType: "oidc",
        domain: "elsewhere.test",
      }),
      makeAtlasWorkspaceSSOProvider({
        providerId: "p2",
        providerType: "saml",
        domain: "atlas.test",
      }),
    ];
    const result = selectPreferredWorkspaceSSOProvider({
      domain: "atlas.test",
      primaryProviderId: null,
      providers,
    });
    expect(result?.providerId).toBe("p2");
  });

  it("returns null when nothing matches", () => {
    const result = selectPreferredWorkspaceSSOProvider({
      domain: "elsewhere.test",
      primaryProviderId: null,
      providers: [makeAtlasWorkspaceSSOProvider({ domain: "atlas.test" })],
    });
    expect(result).toBeNull();
  });

  it("returns null when no providers are verified", () => {
    const result = selectPreferredWorkspaceSSOProvider({
      domain: undefined,
      primaryProviderId: null,
      providers: [makeAtlasWorkspaceSSOProvider({ domainVerified: false })],
    });
    expect(result).toBeNull();
  });

  it("uses all providers when domain is null", () => {
    const providers = [makeAtlasWorkspaceSSOProvider({ providerId: "p1", domain: "atlas.test" })];
    const result = selectPreferredWorkspaceSSOProvider({
      domain: null,
      primaryProviderId: null,
      providers,
    });
    expect(result?.providerId).toBe("p1");
  });
});

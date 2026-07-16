import { describe, expect, it } from "vitest";

import { buildOidcProvider } from "./support";
import { buildWorkspaceSSOState } from "../organization-sso";

describe("buildWorkspaceSSOState", () => {
  it("filters providers to the requested workspace and reuses the unique provider domain", () => {
    const providers = [
      buildOidcProvider({ providerId: "p1", organizationId: "org_1", domain: "atlas.test" }),
      buildOidcProvider({ providerId: "p2", organizationId: "org_2", domain: "other.test" }),
    ];
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "owner@unrelated.example",
      primaryProviderId: "p1",
      providers,
      publicBaseUrl: "https://atlas.test",
    });

    expect(state.providers).toHaveLength(1);
    expect(state.providers[0]?.providerId).toBe("p1");
    expect(state.primaryProviderId).toBe("p1");
    expect(state.primaryHistory).toEqual([]);
    expect(state.setup.workspaceDomainSuggestion).toBe("atlas.test");
  });

  it("falls back to operator email domain when no providers exist", () => {
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "owner@example.org",
      primaryProviderId: null,
      providers: [],
      publicBaseUrl: "https://atlas.test/",
    });

    expect(state.setup.workspaceDomainSuggestion).toBe("example.org");
  });

  it("falls back to operator email when providers expose multiple domains", () => {
    const providers = [
      buildOidcProvider({ providerId: "p1", organizationId: "org_1", domain: "a.test, b.test" }),
    ];
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "owner@fallback.test",
      primaryProviderId: null,
      providers,
      publicBaseUrl: "https://atlas.test",
    });

    expect(state.setup.workspaceDomainSuggestion).toBe("fallback.test");
  });

  it("returns empty suggestion when operator email is malformed", () => {
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "no-at-sign",
      primaryProviderId: null,
      providers: [],
      publicBaseUrl: "https://atlas.test",
    });

    expect(state.setup.workspaceDomainSuggestion).toBe("");
  });

  it("preserves primaryHistory when provided", () => {
    const history = [{ changedAt: "2026-04-01", changedByEmail: "owner@a.test", providerId: "p1" }];
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "owner@a.test",
      primaryHistory: history,
      primaryProviderId: "p1",
      providers: [],
      publicBaseUrl: "https://atlas.test",
    });

    expect(state.primaryHistory).toEqual(history);
  });

  it("ignores empty domain entries within a comma-separated provider domain", () => {
    const providers = [
      buildOidcProvider({ providerId: "p1", organizationId: "org_1", domain: " , atlas.test ,," }),
    ];
    const state = buildWorkspaceSSOState({
      organizationId: "org_1",
      organizationSlug: "atlas",
      operatorEmail: "owner@unrelated.example",
      primaryProviderId: null,
      providers,
      publicBaseUrl: "https://atlas.test",
    });

    expect(state.setup.workspaceDomainSuggestion).toBe("atlas.test");
  });
});

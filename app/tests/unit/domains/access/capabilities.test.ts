import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPABILITIES,
  DEFAULT_LIMITS,
  PRODUCT_CAPABILITIES,
  PRODUCT_LIMITS,
  SELF_SERVE_PRODUCTS,
  deserializeResolvedCapabilities,
  getLimit,
  getSerializedLimit,
  hasCapability,
  hasSerializedCapability,
  resolveCapabilities,
} from "@/domains/access/capabilities";

describe("capabilities", () => {
  describe("resolveCapabilities", () => {
    it("only configures the real Atlas plans", () => {
      const expectedProducts = ["atlas_pro", "atlas_research_pass", "atlas_team"];

      expect([...SELF_SERVE_PRODUCTS].sort()).toEqual(expectedProducts);
      expect(Object.keys(PRODUCT_CAPABILITIES).sort()).toEqual(expectedProducts);
      expect(Object.keys(PRODUCT_LIMITS).sort()).toEqual(expectedProducts);
    });

    it("returns defaults when no products are active", () => {
      const resolved = resolveCapabilities([]);
      expect(resolved.capabilities).toEqual(DEFAULT_CAPABILITIES);
      expect(resolved.limits).toEqual(DEFAULT_LIMITS);
    });

    it("resolves atlas_pro capabilities", () => {
      const resolved = resolveCapabilities(["atlas_pro"]);
      expect(resolved.capabilities.has("research.unlimited")).toBe(true);
      expect(resolved.capabilities.has("workspace.notes")).toBe(true);
      expect(resolved.capabilities.has("workspace.export")).toBe(true);
      expect(resolved.capabilities.has("api.keys")).toBe(true);
      expect(resolved.capabilities.has("api.mcp")).toBe(true);
      expect(resolved.capabilities.has("workspace.shared")).toBe(false);
      expect(resolved.capabilities.has("monitoring.watchlists")).toBe(false);
      expect(resolved.capabilities.has("auth.sso")).toBe(false);
      expect([...resolved.capabilities]).not.toContain("auth.scim");
      expect([...resolved.capabilities]).not.toContain("integrations.slack");
    });

    it("resolves atlas_team capabilities including team-only identity", () => {
      const resolved = resolveCapabilities(["atlas_team"]);
      expect(resolved.capabilities.has("workspace.shared")).toBe(true);
      expect(resolved.capabilities.has("monitoring.watchlists")).toBe(true);
      expect(resolved.capabilities.has("auth.sso")).toBe(true);
      expect(resolved.capabilities.has("auth.scim")).toBe(true);
      expect([...resolved.capabilities]).not.toContain("integrations.slack");
    });

    it("resolves atlas_research_pass with team-level individual access", () => {
      const team = resolveCapabilities(["atlas_team"]);
      const pass = resolveCapabilities(["atlas_research_pass"]);

      expect(pass.capabilities.has("research.unlimited")).toBe(true);
      expect(pass.capabilities.has("workspace.notes")).toBe(true);
      expect(pass.capabilities.has("workspace.export")).toBe(true);
      expect(pass.capabilities.has("api.keys")).toBe(true);
      expect(pass.capabilities.has("api.mcp")).toBe(true);
      expect(pass.capabilities.has("monitoring.watchlists")).toBe(true);
      expect(pass.capabilities.has("workspace.shared")).toBe(false);
      expect(pass.capabilities.has("auth.sso")).toBe(false);
      expect(pass.capabilities.has("auth.scim")).toBe(false);
      expect([...pass.capabilities]).not.toContain("integrations.slack");
      expect(pass.limits.research_runs_per_month).toBe(team.limits.research_runs_per_month);
      expect(pass.limits.max_shortlists).toBe(team.limits.max_shortlists);
      expect(pass.limits.max_shortlist_entries).toBe(team.limits.max_shortlist_entries);
      expect(pass.limits.max_api_keys).toBe(team.limits.max_api_keys);
      expect(pass.limits.api_requests_per_day).toBe(team.limits.api_requests_per_day);
      expect(pass.limits.max_members).toBe(1);
    });

    it("unions capabilities from multiple products", () => {
      const resolved = resolveCapabilities(["atlas_pro", "atlas_team"]);
      expect(resolved.capabilities.has("workspace.export")).toBe(true);
      expect(resolved.capabilities.has("workspace.shared")).toBe(true);
    });

    it("takes most permissive limits across products", () => {
      const resolved = resolveCapabilities(["atlas_pro", "atlas_team"]);
      expect(resolved.limits.max_api_keys).toBeNull();
      expect(resolved.limits.max_members).toBe(50);
    });

    it("pro limits override defaults", () => {
      const resolved = resolveCapabilities(["atlas_pro"]);
      expect(resolved.limits.research_runs_per_month).toBeNull();
      expect(resolved.limits.max_shortlists).toBeNull();
      expect(resolved.limits.max_api_keys).toBe(1);
      expect(resolved.limits.api_requests_per_day).toBe(1000);
    });

    it("team limits guarantee SCIM-ready workspace capacity", () => {
      const resolved = resolveCapabilities(["atlas_team"]);
      expect(resolved.limits.max_members).toBe(50);
      expect(resolved.limits.max_api_keys).toBeNull();
      expect(resolved.limits.api_requests_per_day).toBe(10000);
    });
  });

  describe("hasCapability", () => {
    it("returns true for granted capabilities", () => {
      const resolved = resolveCapabilities(["atlas_pro"]);
      expect(hasCapability(resolved, "workspace.export")).toBe(true);
    });

    it("returns false for missing capabilities", () => {
      const resolved = resolveCapabilities([]);
      expect(hasCapability(resolved, "workspace.export")).toBe(false);
    });

    it("returns true for default capabilities", () => {
      const resolved = resolveCapabilities([]);
      expect(hasCapability(resolved, "research.run")).toBe(true);
    });
  });

  describe("getLimit", () => {
    it("returns null for unlimited", () => {
      const resolved = resolveCapabilities(["atlas_pro"]);
      expect(getLimit(resolved, "research_runs_per_month")).toBeNull();
    });

    it("returns numeric value for constrained limits", () => {
      const resolved = resolveCapabilities([]);
      expect(getLimit(resolved, "research_runs_per_month")).toBe(2);
    });
  });

  describe("serialized helpers", () => {
    it("round-trips through deserializeResolvedCapabilities", () => {
      const resolved = resolveCapabilities(["atlas_pro"]);
      const serialized = {
        capabilities: [...resolved.capabilities],
        limits: { ...resolved.limits },
      };
      const restored = deserializeResolvedCapabilities(serialized);
      expect(restored.capabilities).toEqual(resolved.capabilities);
      expect(restored.limits).toEqual(resolved.limits);
    });

    it("hasSerializedCapability matches the live resolveCapabilities check", () => {
      const resolved = resolveCapabilities(["atlas_pro"]);
      const serialized = {
        capabilities: [...resolved.capabilities],
        limits: { ...resolved.limits },
      };
      expect(hasSerializedCapability(serialized, "api.keys")).toBe(true);
      expect(hasSerializedCapability(serialized, "auth.sso")).toBe(false);
    });

    it("getSerializedLimit returns the configured limit value", () => {
      const resolved = resolveCapabilities([]);
      const serialized = {
        capabilities: [...resolved.capabilities],
        limits: { ...resolved.limits },
      };
      expect(getSerializedLimit(serialized, "research_runs_per_month")).toBe(2);
    });
  });
});

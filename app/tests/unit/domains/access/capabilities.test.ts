import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPABILITIES,
  DEFAULT_LIMITS,
  deserializeResolvedCapabilities,
  getLimit,
  getSerializedLimit,
  hasCapability,
  hasSerializedCapability,
  resolveCapabilities,
} from "@/domains/access/capabilities";

describe("capabilities", () => {
  describe("resolveCapabilities", () => {
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
      expect(resolved.capabilities.has("integrations.slack")).toBe(false);
      expect(resolved.capabilities.has("auth.sso")).toBe(false);
    });

    it("resolves atlas_team capabilities including team-only", () => {
      const resolved = resolveCapabilities(["atlas_team"]);
      expect(resolved.capabilities.has("workspace.shared")).toBe(true);
      expect(resolved.capabilities.has("monitoring.watchlists")).toBe(true);
      expect(resolved.capabilities.has("integrations.slack")).toBe(true);
      expect(resolved.capabilities.has("auth.sso")).toBe(true);
    });

    it("resolves atlas_research_pass same as pro", () => {
      const pro = resolveCapabilities(["atlas_pro"]);
      const pass = resolveCapabilities(["atlas_research_pass"]);
      expect(pass.capabilities).toEqual(pro.capabilities);
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

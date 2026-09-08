import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { catalogProbeResponse } from "../../../../helpers/billing/catalog-probe-responses";

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/platform/config/app-config", () => ({
  getServerApiBaseUrl: () => "https://api.atlas.test/api",
}));

describe("checkout availability", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe("isCheckoutEnabled", () => {
    it("is disabled when the flag is unset", async () => {
      vi.stubEnv("ATLAS_BILLING_CHECKOUT_ENABLED", "");
      const { isCheckoutEnabled } = await import("@/domains/billing/server/checkout-availability");
      expect(isCheckoutEnabled()).toBe(false);
    });

    it("is enabled only for an exact true, ignoring case and padding", async () => {
      vi.stubEnv("ATLAS_BILLING_CHECKOUT_ENABLED", "  TRUE ");
      const { isCheckoutEnabled } = await import("@/domains/billing/server/checkout-availability");
      expect(isCheckoutEnabled()).toBe(true);
    });

    it("does not treat other truthy-looking values as enabled", async () => {
      vi.stubEnv("ATLAS_BILLING_CHECKOUT_ENABLED", "1");
      const { isCheckoutEnabled } = await import("@/domains/billing/server/checkout-availability");
      expect(isCheckoutEnabled()).toBe(false);
    });
  });

  describe("probeCatalogHealth", () => {
    it("is healthy when the catalog returns an item array", async () => {
      vi.mocked(fetch).mockResolvedValue(catalogProbeResponse({ items: [{ id: "e1" }] }));
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(true);
    });

    it("is healthy when the catalog returns a bare array", async () => {
      vi.mocked(fetch).mockResolvedValue(catalogProbeResponse([{ id: "e1" }]));
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(true);
    });

    it("is unhealthy when the catalog is reachable but empty", async () => {
      vi.mocked(fetch).mockResolvedValue(catalogProbeResponse({ items: [] }));
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(false);
    });

    it("is unhealthy when the payload has no recognisable entries", async () => {
      vi.mocked(fetch).mockResolvedValue(catalogProbeResponse({ total: 0 }));
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(false);
    });

    it("is unhealthy on a non-200 response", async () => {
      vi.mocked(fetch).mockResolvedValue(catalogProbeResponse({ items: [{ id: "e1" }] }, false));
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(false);
    });

    it("is unhealthy when the request throws", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(false);
    });

    it("memoises the result until the cache window expires", async () => {
      vi.mocked(fetch).mockResolvedValue(catalogProbeResponse({ items: [{ id: "e1" }] }));
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");

      await probeCatalogHealth(1_000);
      await probeCatalogHealth(2_000);
      expect(fetch).toHaveBeenCalledTimes(1);

      await probeCatalogHealth(1_000 + 30_001);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("re-probes after the cache is reset", async () => {
      vi.mocked(fetch).mockResolvedValue(catalogProbeResponse({ items: [{ id: "e1" }] }));
      const { probeCatalogHealth, resetCatalogProbeCache } =
        await import("@/domains/billing/server/checkout-availability");

      await probeCatalogHealth(1_000);
      resetCatalogProbeCache();
      await probeCatalogHealth(1_000);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("aborts a probe that outlives the timeout", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(fetch).mockImplementation(
          (_input, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new Error("aborted"));
              });
            }),
        );
        const { probeCatalogHealth } =
          await import("@/domains/billing/server/checkout-availability");
        const pending = probeCatalogHealth();
        await vi.advanceTimersByTimeAsync(2_500);
        await expect(pending).resolves.toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("resolveCheckoutAvailability", () => {
    it("refuses without probing when an operator has not enabled checkout", async () => {
      vi.stubEnv("ATLAS_BILLING_CHECKOUT_ENABLED", "false");
      const { resolveCheckoutAvailability } =
        await import("@/domains/billing/server/checkout-availability");
      await expect(resolveCheckoutAvailability()).resolves.toEqual({
        available: false,
        reason: "disabled",
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("refuses when the catalog cannot serve results", async () => {
      vi.stubEnv("ATLAS_BILLING_CHECKOUT_ENABLED", "true");
      vi.mocked(fetch).mockResolvedValue(catalogProbeResponse({ items: [] }));
      const { resolveCheckoutAvailability } =
        await import("@/domains/billing/server/checkout-availability");
      await expect(resolveCheckoutAvailability()).resolves.toEqual({
        available: false,
        reason: "catalog_unavailable",
      });
    });

    it("allows checkout when the switch is on and the catalog serves", async () => {
      vi.stubEnv("ATLAS_BILLING_CHECKOUT_ENABLED", "true");
      vi.mocked(fetch).mockResolvedValue(catalogProbeResponse({ items: [{ id: "e1" }] }));
      const { resolveCheckoutAvailability } =
        await import("@/domains/billing/server/checkout-availability");
      await expect(resolveCheckoutAvailability()).resolves.toEqual({
        available: true,
        reason: null,
      });
    });
  });
});

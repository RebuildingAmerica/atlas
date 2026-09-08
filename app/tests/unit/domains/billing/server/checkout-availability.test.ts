import { afterEach, describe, expect, it, vi } from "vitest";

import { stubFetch } from "../../../../helpers/stub-fetch";

vi.mock("@tanstack/react-start/server-only", () => ({}));
const appConfigMocks = vi.hoisted(() => ({
  getServerApiBaseUrl: vi.fn(() => "https://api.atlas.test/api"),
}));

vi.mock("@/platform/config/app-config", () => appConfigMocks);

describe("checkout availability", () => {
  afterEach(() => {
    appConfigMocks.getServerApiBaseUrl.mockReset();
    appConfigMocks.getServerApiBaseUrl.mockReturnValue("https://api.atlas.test/api");
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

    it("refuses a value it cannot parse instead of guessing", async () => {
      vi.stubEnv("ATLAS_BILLING_CHECKOUT_ENABLED", "1");
      const { isCheckoutEnabled } = await import("@/domains/billing/server/checkout-availability");
      // Guessing would either sell a dead product or refuse every sale.
      expect(() => isCheckoutEnabled()).toThrow(/must be "true" or "false"/);
    });
  });

  describe("probeCatalogHealth", () => {
    it("is healthy when the catalog returns an item array", async () => {
      stubFetch({ body: { items: [{ id: "e1" }] } });
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(true);
    });

    it("is healthy when the catalog returns a bare array", async () => {
      stubFetch({ body: [{ id: "e1" }] });
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(true);
    });

    it("is unhealthy when the catalog is reachable but empty", async () => {
      stubFetch({ body: { items: [] } });
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(false);
    });

    it("is unhealthy when the payload has no recognisable entries", async () => {
      stubFetch({ body: { total: 0 } });
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(false);
    });

    it("is unhealthy on a non-200 response", async () => {
      stubFetch({ body: { items: [{ id: "e1" }] }, status: 503 });
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(false);
    });

    it("is unhealthy, and says so, when the probe URL cannot be resolved", async () => {
      // A missing proxy target is a deployment fault, not a sick catalog, and
      // it would otherwise report "temporarily unavailable" forever in silence.
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        appConfigMocks.getServerApiBaseUrl.mockImplementation(() => {
          throw new Error("ATLAS_SERVER_API_PROXY_TARGET is required for Atlas API calls.");
        });
        const { probeCatalogHealth } =
          await import("@/domains/billing/server/checkout-availability");

        await expect(probeCatalogHealth()).resolves.toBe(false);
        expect(consoleError).toHaveBeenCalledWith(
          "Atlas checkout catalog probe is misconfigured.",
          expect.any(Error),
        );
      } finally {
        consoleError.mockRestore();
      }
    });

    it("is unhealthy when the request throws", async () => {
      stubFetch(() => {
        throw new Error("ECONNREFUSED");
      });
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");
      await expect(probeCatalogHealth()).resolves.toBe(false);
    });

    it("memoises a healthy result until the cache window expires", async () => {
      vi.useFakeTimers();
      try {
        const fetchStub = stubFetch({ body: { items: [{ id: "e1" }] } });
        const { probeCatalogHealth } =
          await import("@/domains/billing/server/checkout-availability");

        await probeCatalogHealth();
        await probeCatalogHealth();
        expect(fetchStub.requests).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(30_001);
        await probeCatalogHealth();
        expect(fetchStub.requests).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("re-probes an unhealthy result sooner than a healthy one", async () => {
      vi.useFakeTimers();
      try {
        const fetchStub = stubFetch({ body: { items: [] } });
        const { probeCatalogHealth } =
          await import("@/domains/billing/server/checkout-availability");

        await probeCatalogHealth();
        expect(fetchStub.requests).toHaveLength(1);

        // One slow cold start must not refuse every sale for half a minute.
        await vi.advanceTimersByTimeAsync(5_001);
        await probeCatalogHealth();
        expect(fetchStub.requests).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("shares one probe between concurrent callers", async () => {
      const fetchStub = stubFetch({ body: { items: [{ id: "e1" }] } });
      const { probeCatalogHealth } = await import("@/domains/billing/server/checkout-availability");

      const results = await Promise.all([
        probeCatalogHealth(),
        probeCatalogHealth(),
        probeCatalogHealth(),
      ]);

      expect(results).toEqual([true, true, true]);
      expect(fetchStub.requests).toHaveLength(1);
    });

    it("re-probes after the cache is reset", async () => {
      const fetchStub = stubFetch({ body: { items: [{ id: "e1" }] } });
      const { probeCatalogHealth, resetCatalogProbeCache } =
        await import("@/domains/billing/server/checkout-availability");

      await probeCatalogHealth();
      resetCatalogProbeCache();
      await probeCatalogHealth();
      expect(fetchStub.requests).toHaveLength(2);
    });

    it("aborts a probe that outlives the timeout", async () => {
      vi.useFakeTimers();
      try {
        vi.stubGlobal("fetch", vi.fn());
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
      const fetchStub = stubFetch({ body: { items: [{ id: "e1" }] } });
      const { resolveCheckoutAvailability } =
        await import("@/domains/billing/server/checkout-availability");
      await expect(resolveCheckoutAvailability()).resolves.toEqual({
        available: false,
        reason: "disabled",
      });
      expect(fetchStub.requests).toHaveLength(0);
    });

    it("refuses when the catalog cannot serve results", async () => {
      vi.stubEnv("ATLAS_BILLING_CHECKOUT_ENABLED", "true");
      stubFetch({ body: { items: [] } });
      const { resolveCheckoutAvailability } =
        await import("@/domains/billing/server/checkout-availability");
      await expect(resolveCheckoutAvailability()).resolves.toEqual({
        available: false,
        reason: "catalog_unavailable",
      });
    });

    it("allows checkout when the switch is on and the catalog serves", async () => {
      vi.stubEnv("ATLAS_BILLING_CHECKOUT_ENABLED", "true");
      stubFetch({ body: { items: [{ id: "e1" }] } });
      const { resolveCheckoutAvailability } =
        await import("@/domains/billing/server/checkout-availability");
      await expect(resolveCheckoutAvailability()).resolves.toEqual({
        available: true,
        reason: null,
      });
    });
  });
});

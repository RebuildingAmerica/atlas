import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expectedHostedPublicOrigin,
  hostedPublicRequestInit,
} from "@/../tests/helpers/hosted-endpoints";

describe("hostedPublicRequestInit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves ordinary hosted requests unchanged", () => {
    const requestInit = hostedPublicRequestInit({
      headers: {
        accept: "application/json",
      },
      redirect: "manual",
    });
    const headers = new Headers(requestInit.headers);

    expect(headers.get("accept")).toBe("application/json");
    expect(requestInit.redirect).toBe("manual");
  });

  it("adds the Cloudflare Access token pair and prevents cross-origin redirect leakage", () => {
    vi.stubEnv("ATLAS_HOSTED_CF_ACCESS_CLIENT_ID", "client-id");
    vi.stubEnv("ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET", "client-secret");
    const init = hostedPublicRequestInit();
    expect(new Headers(init.headers).get("cf-access-client-id")).toBe("client-id");
    expect(new Headers(init.headers).get("cf-access-client-secret")).toBe("client-secret");
    expect(init.redirect).toBe("manual");
    expect(() => hostedPublicRequestInit({ redirect: "follow" })).toThrow("redirect");
  });

  it("rejects incomplete Cloudflare service tokens", () => {
    vi.stubEnv("ATLAS_HOSTED_CF_ACCESS_CLIENT_ID", "client-id");
    expect(() => hostedPublicRequestInit()).toThrow("together");
  });
});

describe("expectedHostedPublicOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the canonical hosted origin when a preview URL is under test", () => {
    vi.stubEnv("ATLAS_HOSTED_PUBLIC_URL", "https://atlas-workers-staging.example.com/some/path");
    vi.stubEnv("ATLAS_HOSTED_EXPECTED_PUBLIC_URL", "https://atlas-staging.rebuildingus.org");

    expect(expectedHostedPublicOrigin()).toBe("https://atlas-staging.rebuildingus.org");
  });

  it("falls back to the hosted origin when no canonical override is configured", () => {
    vi.stubEnv("ATLAS_HOSTED_PUBLIC_URL", "https://atlas-workers-staging.example.com");

    expect(expectedHostedPublicOrigin()).toBe("https://atlas-workers-staging.example.com");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expectedHostedPublicOrigin,
  hostedPublicRequestInit,
} from "@/../tests/helpers/hosted-endpoints";

describe("hostedPublicRequestInit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes both supported Vercel protection headers to hosted preview requests", () => {
    vi.stubEnv("ATLAS_HOSTED_VERCEL_BYPASS_SECRET", "preview-bypass");
    vi.stubEnv("ATLAS_HOSTED_VERCEL_TRUSTED_OIDC_TOKEN", "trusted-oidc");

    const requestInit = hostedPublicRequestInit({
      headers: {
        accept: "application/json",
      },
      redirect: "manual",
    });
    const headers = new Headers(requestInit.headers);

    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("x-vercel-protection-bypass")).toBe("preview-bypass");
    expect(headers.get("x-vercel-trusted-oidc-idp-token")).toBe("trusted-oidc");
    expect(requestInit.redirect).toBe("manual");
  });
});

describe("expectedHostedPublicOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the canonical hosted origin when a preview URL is under test", () => {
    vi.stubEnv("ATLAS_HOSTED_PUBLIC_URL", "https://atlas-preview.vercel.app/some/path");
    vi.stubEnv("ATLAS_HOSTED_EXPECTED_PUBLIC_URL", "https://atlas-staging.rebuildingus.org");

    expect(expectedHostedPublicOrigin()).toBe("https://atlas-staging.rebuildingus.org");
  });

  it("falls back to the hosted origin when no canonical override is configured", () => {
    vi.stubEnv("ATLAS_HOSTED_PUBLIC_URL", "https://atlas-preview.vercel.app");

    expect(expectedHostedPublicOrigin()).toBe("https://atlas-preview.vercel.app");
  });
});

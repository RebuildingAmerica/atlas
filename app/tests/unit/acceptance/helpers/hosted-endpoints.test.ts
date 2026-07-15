import { afterEach, describe, expect, it, vi } from "vitest";
import { hostedPublicRequestInit } from "@/../tests/helpers/hosted-endpoints";

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

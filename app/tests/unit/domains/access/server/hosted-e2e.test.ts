import { afterEach, describe, expect, test, vi } from "vitest";
import {
  assertHostedE2EAuthorized,
  buildHostedE2EAccountSeeds,
  buildHostedE2EPasskeySeed,
  hostedE2EPayloadSchema,
} from "@/domains/access/server/hosted-e2e";
import {
  hostedE2ERequestWithSecret,
  hostedE2EResponsePayload,
} from "../../../../helpers/access/hosted-e2e";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hosted E2E guard", () => {
  test("returns 404 when hosted E2E is disabled", async () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("secret"), {
      ATLAS_DEPLOY_MODE: "staging",
      ATLAS_HOSTED_E2E_SECRET: "secret", // pragma: allowlist secret
    });

    expect(response?.status).toBe(404);
    expect(response).toBeInstanceOf(Response);
    if (!response) throw new Error("Expected disabled hosted E2E to return a response.");
    await expect(hostedE2EResponsePayload(response)).resolves.toEqual({
      error: "Hosted E2E is unavailable.",
    });
  });

  test("returns 404 when the shared secret is missing", () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("secret"), {
      ATLAS_DEPLOY_MODE: "staging",
      ATLAS_HOSTED_E2E_ENABLED: "1",
    });

    expect(response?.status).toBe(404);
  });

  test("returns 404 when the request secret does not match", () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("wrong"), {
      ATLAS_DEPLOY_MODE: "staging",
      ATLAS_HOSTED_E2E_ENABLED: "1",
      ATLAS_HOSTED_E2E_SECRET: "secret", // pragma: allowlist secret
    });

    expect(response?.status).toBe(404);
  });

  test("returns 404 in production deploy mode without explicit production proof access", () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("secret"), {
      ATLAS_DEPLOY_MODE: "production",
      ATLAS_HOSTED_E2E_ENABLED: "1",
      ATLAS_HOSTED_E2E_SECRET: "secret", // pragma: allowlist secret
    });

    expect(response?.status).toBe(404);
  });

  test("returns 404 in Vercel production without explicit production proof access", () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("secret"), {
      ATLAS_DEPLOY_MODE: "staging",
      ATLAS_HOSTED_E2E_ENABLED: "1",
      ATLAS_HOSTED_E2E_SECRET: "secret", // pragma: allowlist secret
      VERCEL_ENV: "production",
    });

    expect(response?.status).toBe(404);
  });

  test("allows production proof only when the production gate and shared secret match", () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("secret"), {
      ATLAS_DEPLOY_MODE: "production",
      ATLAS_HOSTED_E2E_ENABLED: "1",
      ATLAS_HOSTED_E2E_PRODUCTION_ENABLED: "1",
      ATLAS_HOSTED_E2E_SECRET: "secret", // pragma: allowlist secret
      VERCEL_ENV: "production",
    });

    expect(response).toBeNull();
  });

  test("allows staging requests with the matching secret", () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("secret"), {
      ATLAS_DEPLOY_MODE: "staging",
      ATLAS_HOSTED_E2E_ENABLED: "1",
      ATLAS_HOSTED_E2E_SECRET: "secret", // pragma: allowlist secret
      VERCEL_ENV: "preview",
    });

    expect(response).toBeNull();
  });
});

describe("hosted E2E run scope", () => {
  test("rejects unsafe run identifiers", () => {
    expect(() => hostedE2EPayloadSchema.parse({ action: "prepare", runId: "../prod" })).toThrow();
    expect(() => hostedE2EPayloadSchema.parse({ action: "prepare", runId: "" })).toThrow();
  });

  test("builds deterministic account seeds for a hosted run", () => {
    const seeds = buildHostedE2EAccountSeeds("29364644020-1");

    expect(seeds).toEqual({
      delegate: {
        email: "atlas-hosted-e2e+29364644020-1-delegate@atlas.test",
        handle: "atlas-hosted-29364644020-1-delegate.atlas.test",
        name: "Hosted E2E Delegate 29364644020-1",
        role: "delegate",
      },
      owner: {
        email: "atlas-hosted-e2e+29364644020-1-owner@atlas.test",
        handle: "atlas-hosted-29364644020-1-owner.atlas.test",
        name: "Hosted E2E Owner 29364644020-1",
        role: "owner",
      },
      runId: "29364644020-1",
    });
  });

  test("uses short PDS-scoped handles when a hosted PDS URL is configured", () => {
    vi.stubEnv("ATLAS_PDS_PUBLIC_URL", "https://atlas-pds-staging.rebuildingus.org");
    const seeds = buildHostedE2EAccountSeeds("29364644020-1");

    expect(seeds.delegate.handle).toBe("a293646440201d.atlas-pds-staging.rebuildingus.org");
    expect(seeds.owner.handle).toBe("a293646440201o.atlas-pds-staging.rebuildingus.org");
  });

  test("builds a deterministic synthetic passkey seed", () => {
    expect(buildHostedE2EPasskeySeed({ role: "owner", runId: "29364644020-1" })).toEqual({
      aaguid: "00000000-0000-0000-0000-000000000000",
      backedUp: false,
      counter: 0,
      credentialID: "atlas-hosted-e2e-29364644020-1-owner",
      deviceType: "singleDevice",
      name: "Hosted E2E passkey",
      publicKey: "atlas-hosted-e2e-public-key",
      transports: "internal",
    });
  });
});

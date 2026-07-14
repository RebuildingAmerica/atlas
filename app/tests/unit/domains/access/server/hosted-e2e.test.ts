import { describe, expect, test } from "vitest";
import { assertHostedE2EAuthorized } from "@/domains/access/server/hosted-e2e";
import {
  hostedE2ERequestWithSecret,
  hostedE2EResponsePayload,
} from "../../../../helpers/access/hosted-e2e";

describe("hosted E2E guard", () => {
  test("returns 404 when hosted E2E is disabled", async () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("secret"), {
      ATLAS_DEPLOY_MODE: "staging",
      ATLAS_HOSTED_E2E_SECRET: "secret",
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
      ATLAS_HOSTED_E2E_SECRET: "secret",
    });

    expect(response?.status).toBe(404);
  });

  test("returns 404 in production deploy mode even when enabled", () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("secret"), {
      ATLAS_DEPLOY_MODE: "production",
      ATLAS_HOSTED_E2E_ENABLED: "1",
      ATLAS_HOSTED_E2E_SECRET: "secret",
    });

    expect(response?.status).toBe(404);
  });

  test("returns 404 in Vercel production even when enabled", () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("secret"), {
      ATLAS_DEPLOY_MODE: "staging",
      ATLAS_HOSTED_E2E_ENABLED: "1",
      ATLAS_HOSTED_E2E_SECRET: "secret",
      VERCEL_ENV: "production",
    });

    expect(response?.status).toBe(404);
  });

  test("allows staging requests with the matching secret", () => {
    const response = assertHostedE2EAuthorized(hostedE2ERequestWithSecret("secret"), {
      ATLAS_DEPLOY_MODE: "staging",
      ATLAS_HOSTED_E2E_ENABLED: "1",
      ATLAS_HOSTED_E2E_SECRET: "secret",
      VERCEL_ENV: "preview",
    });

    expect(response).toBeNull();
  });
});

import { afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ensureAuthReady: vi.fn() }));
vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
  getAuthPgPool: vi.fn(),
}));
import { handleHostedE2EIdentityRequest } from "@/domains/access/server/hosted-e2e";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("hosted preparation refuses to create accounts when PDS cleanup is unavailable", async () => {
  vi.stubEnv("ATLAS_PUBLIC_URL", "https://atlas.test");
  vi.stubEnv("ATLAS_HOSTED_E2E_ENABLED", "1");
  vi.stubEnv("ATLAS_HOSTED_E2E_PRODUCTION_ENABLED", "1");
  vi.stubEnv("ATLAS_HOSTED_E2E_SECRET", "synthetic-hosted-verifier");
  vi.stubEnv("ATLAS_PDS_PUBLIC_URL", "https://pds.example.org");
  vi.stubEnv("ATLAS_PDS_INVITE_BROKER_URL", "https://pds.example.org/_atlas/pds/invites");
  vi.stubEnv("ATLAS_PDS_INVITE_BROKER_SECRET", "synthetic-broker-test-credential");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 405 })));
  mocks.ensureAuthReady.mockRejectedValue(new Error("Authentication storage must not be opened"));
  const response = await handleHostedE2EIdentityRequest(
    new Request("https://atlas.test/api/e2e/hosted/identity", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlas-hosted-e2e-secret": "synthetic-hosted-verifier", // Synthetic test credential. pragma: allowlist secret
      },
      body: JSON.stringify({ action: "prepare", runId: "38246581597-1" }),
    }),
  );
  expect(response.status).toBe(503);
  expect(mocks.ensureAuthReady).not.toHaveBeenCalled();
  expect(await response.json()).toEqual({ error: "Hosted E2E cleanup is unavailable." });
});
